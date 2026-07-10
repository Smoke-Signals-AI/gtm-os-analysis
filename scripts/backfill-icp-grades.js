// Backfill ICP grades (gtmos_icp_grade / gtmos_icp_grade_detail) for every
// submission that predates the grading feature (#33).
//
// Uses the same evaluator as live traffic (services/icp.js):
//   - usesHubSpot comes from the contact's gtmos_crm, which was re-verified
//     across the whole portal on 2026-07-09. Contacts with no verdict are
//     re-probed now; still-unreachable sites are SKIPPED, never failed —
//     missing data must not stamp an F.
//   - Headcount/description come from a fresh LinkedIn company lookup by
//     domain (cached per domain), title from the contact's jobtitle (plus the
//     stored analysis' headline when Redis still has it).
//   - The AI classifier (agency check etc.) runs only for HubSpot-positive
//     contacts, exactly like the live path.
//
// Deliberately does NOT send Slack notifications: this is a bulk historical
// pass, not 190 new leads for the sales channel.
//
// Idempotent: contacts that already have gtmos_icp_grade are skipped, so
// organic grades are never overwritten and re-runs continue where they left off.
//
// Usage (inside the deployed container via `railway ssh`):
//   node scripts/backfill-icp-grades.js            # dry run: report only
//   node scripts/backfill-icp-grades.js --apply    # write grades

const hubspot = require('../server/services/hubspot');
const anysite = require('../server/services/anysite');
const icp = require('../server/services/icp');
const { probeHubSpot } = require('../server/services/scraper');
const { extractDomain } = require('../server/utils/validation');

const APPLY = process.argv.includes('--apply');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, label) {
  let delay = 2000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err && err.status === 429 && attempt < 5) {
        console.log(`  429 rate-limited (${label}), waiting ${delay / 1000}s...`);
        await sleep(delay);
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
}

// Paged search over every contact the app ever wrote a website to. Small pages
// because gtmos_company_research (classifier input) can be 60KB per contact.
async function listSubmissionContacts() {
  const contacts = [];
  let after;
  while (true) {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'gtmos_website_url', operator: 'HAS_PROPERTY' }] }],
      properties: ['email', 'gtmos_website_url', 'gtmos_crm', 'gtmos_hubspot_portal_id', 'gtmos_icp_grade', 'jobtitle', 'gtmos_company_research'],
      limit: 25,
      ...(after ? { after } : {})
    };
    const res = await withRetry(() => fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = new Error(`HubSpot search error: ${r.status}`);
        err.status = r.status;
        throw err;
      }
      return data;
    }), 'contact search');

    contacts.push(...(res.results || []));
    after = res.paging && res.paging.next && res.paging.next.after;
    if (!after) break;
    await sleep(400);
  }
  return contacts;
}

// Best-effort headline/title enrichment from analyses still in Redis.
async function loadPersonsFromRedis() {
  if (!process.env.REDIS_URL) return {};
  const { createClient } = require('redis');
  const redis = createClient({ url: process.env.REDIS_URL, socket: { family: 0 } });
  redis.on('error', (e) => console.warn('Redis error:', e.message));
  const byEmail = {};
  try {
    await redis.connect();
    for await (const key of redis.scanIterator({ MATCH: 'analysis:*', COUNT: 100 })) {
      try {
        const a = JSON.parse(await redis.get(key));
        if (a && a.email && a.enrichedPerson) {
          byEmail[a.email.toLowerCase()] = {
            title: a.enrichedPerson.title || '',
            headline: a.enrichedPerson.headline || ''
          };
        }
      } catch (_) { /* skip unparseable */ }
    }
    await redis.quit();
  } catch (e) {
    console.warn('Redis unavailable, grading without stored headlines:', e.message);
  }
  return byEmail;
}

async function main() {
  for (const k of ['HUBSPOT_ACCESS_TOKEN', 'ANTHROPIC_API_KEY']) {
    if (!process.env[k]) {
      console.error(`${k} is required.`);
      process.exit(1);
    }
  }
  if (!process.env.ANYSITE_API_KEY) {
    console.warn('ANYSITE_API_KEY not set — no LinkedIn headcount lookups; grades will lean on the classifier reading the research.');
  }

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — backfilling ICP grades...`);

  if (APPLY) {
    await hubspot.ensureProperties();
  }

  const [contacts, persons] = await Promise.all([listSubmissionContacts(), loadPersonsFromRedis()]);
  console.log(`Found ${contacts.length} submission contacts; ${Object.keys(persons).length} stored analyses for person context.\n`);

  const companyCache = new Map(); // domain -> companyProfile|null
  async function companyProfileForDomain(domain) {
    if (!domain || !process.env.ANYSITE_API_KEY) return null;
    if (!companyCache.has(domain)) {
      let profile = null;
      try {
        const resolved = await anysite.resolveCompanyByDomain(domain);
        const id = resolved && (resolved.alias || resolved.urn || resolved.url || resolved.name);
        if (id) profile = await anysite.getCompanyProfile(id);
        if (!profile && resolved && (resolved.name || resolved.urn)) {
          profile = { name: resolved.name, urn: resolved.urn, website: resolved.url, logoUrl: '', industry: '', employeeCount: '', description: '', headquarters: '' };
        }
      } catch (e) {
        console.warn(`  company lookup failed for ${domain}:`, e.message);
      }
      companyCache.set(domain, profile);
    }
    return companyCache.get(domain);
  }

  const stats = { total: contacts.length, alreadyGraded: 0, graded: 0, byGrade: { A: 0, B: 0, C: 0, F: 0 }, probed: 0, skippedUnknown: 0, failed: 0 };

  for (const c of contacts) {
    const email = c.properties.email || c.id;
    const url = c.properties.gtmos_website_url || '';
    const domain = extractDomain(url) || '';

    if (c.properties.gtmos_icp_grade) {
      stats.alreadyGraded++;
      continue;
    }

    try {
      // HubSpot verdict: trust the re-verified gtmos_crm; probe only when unset.
      let usesHubSpot;
      if (c.properties.gtmos_crm === 'HubSpot') usesHubSpot = true;
      else if (c.properties.gtmos_crm === 'Other/Unknown') usesHubSpot = false;
      else {
        stats.probed++;
        const p = await probeHubSpot(url);
        if (!p.checked) {
          stats.skippedUnknown++;
          console.log(`? ${email}: ${domain} unreachable and no stored verdict — left ungraded`);
          continue;
        }
        usesHubSpot = p.usesHubSpot;
      }

      const person = persons[String(email).toLowerCase()] || {};
      const result = await icp.evaluateIcp({
        usesHubSpot,
        websiteResearch: c.properties.gtmos_company_research || '',
        domain,
        companyProfile: usesHubSpot ? await companyProfileForDomain(domain) : null,
        enrichedPerson: {
          title: c.properties.jobtitle || person.title || '',
          headline: person.headline || ''
        }
      });

      stats.byGrade[result.grade] = (stats.byGrade[result.grade] || 0) + 1;
      console.log(`${result.grade} ${email} (${domain}): ${result.reasons.join('; ')}`);

      if (APPLY) {
        // Direct write, not pushIcpGrade: that helper re-runs ensureProperties
        // on every call, which triples the API traffic across a 190-contact
        // loop. ensureProperties already ran once at the top of this script.
        await withRetry(() => hubspot.updateContact(c.id, {
          gtmos_icp_grade: result.grade,
          gtmos_icp_grade_detail: String(result.detail || '').slice(0, 5000)
        }), 'grade write');
        stats.graded++;
        await sleep(500);
      }
    } catch (err) {
      stats.failed++;
      console.error(`! ${email}: ${err.message}`);
    }
  }

  console.log('\nDone:', JSON.stringify(stats));
  if (!APPLY) console.log('Dry run only — re-run with --apply to write.');
}

main().catch((e) => { console.error(e); process.exit(1); });
