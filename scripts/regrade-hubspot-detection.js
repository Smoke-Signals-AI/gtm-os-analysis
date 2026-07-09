// Regrade HubSpot detection for every submission on record.
//
// The original detection was a bare substring scan of page source, so a blog
// post ABOUT HubSpot could count as "uses HubSpot" and a bot-blocked scrape
// silently counted as "doesn't". This re-probes every submitted website with
// the tiered detector (portal-id patterns, response headers, asset references,
// GTM container follow-up, Firecrawl fallback when configured) and corrects:
//   - HubSpot contacts: gtmos_crm, plus gtmos_hubspot_portal_id when found
//   - stored analyses in Redis: the usesHubSpot flag reports render with
//
// Unreachable sites are left exactly as they are — a failed probe is not
// evidence of anything.
//
// Usage (inside the deployed container via `railway ssh`):
//   node scripts/regrade-hubspot-detection.js            # dry run: report only
//   node scripts/regrade-hubspot-detection.js --apply    # actually write

const hubspot = require('../server/services/hubspot');
const { probeHubSpot } = require('../server/services/scraper');

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

// Raw paged search: every contact that ever got a website written by the app.
// (Covers submissions whose Redis entries have already expired.)
async function listContactsWithWebsiteUrl() {
  const contacts = [];
  let after;
  while (true) {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'gtmos_website_url', operator: 'HAS_PROPERTY' }] }],
      properties: ['email', 'gtmos_website_url', 'gtmos_crm', 'gtmos_hubspot_portal_id'],
      limit: 100,
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

function normalizeUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '').toLowerCase();
}

async function main() {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    console.error('HUBSPOT_ACCESS_TOKEN is required.');
    process.exit(1);
  }

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — regrading HubSpot detection for all submissions...`);

  // One probe per unique URL, cached; sites are only hit once even when a URL
  // appears on both a contact and a stored analysis (or on duplicates).
  const probeCache = new Map();
  async function probe(url) {
    const key = normalizeUrl(url);
    if (!key) return { checked: false };
    if (!probeCache.has(key)) {
      probeCache.set(key, await probeHubSpot(url));
      await sleep(300);
    }
    return probeCache.get(key);
  }

  const stats = {
    contactsChecked: 0, upgraded: 0, downgraded: 0, portalIdsAdded: 0,
    unchanged: 0, unreachable: 0, contactUpdateFailed: 0, redisFixed: 0
  };

  if (APPLY) {
    // Creates gtmos_hubspot_portal_id (and anything else missing) up front.
    await hubspot.ensureProperties();
  }

  // --- Pass 1: contacts ----------------------------------------------------
  const contacts = await listContactsWithWebsiteUrl();
  console.log(`Found ${contacts.length} contacts with a submitted website.\n`);

  for (const c of contacts) {
    const url = c.properties.gtmos_website_url;
    const email = c.properties.email || c.id;
    if (!url) continue;
    stats.contactsChecked++;

    const p = await probe(url);
    if (!p.checked) {
      stats.unreachable++;
      console.log(`? ${email}: ${url} unreachable — leaving "${c.properties.gtmos_crm || ''}" as is`);
      continue;
    }

    const oldCrm = c.properties.gtmos_crm || '';
    const newCrm = p.usesHubSpot ? 'HubSpot' : 'Other/Unknown';
    const oldPortal = c.properties.gtmos_hubspot_portal_id || '';

    const props = {};
    if (newCrm !== oldCrm) props.gtmos_crm = newCrm;
    if (p.portalId && p.portalId !== oldPortal) props.gtmos_hubspot_portal_id = p.portalId;

    if (!Object.keys(props).length) {
      stats.unchanged++;
      continue;
    }

    const evidence = p.evidence.length ? ` [${p.evidence.join(', ')}]` : '';
    console.log(`~ ${email}: ${oldCrm || '(unset)'} -> ${newCrm}${props.gtmos_hubspot_portal_id ? ` portal=${p.portalId}` : ''}${evidence}`);
    if (newCrm !== oldCrm) {
      if (newCrm === 'HubSpot') stats.upgraded++; else stats.downgraded++;
    }
    if (props.gtmos_hubspot_portal_id) stats.portalIdsAdded++;

    if (APPLY) {
      try {
        await withRetry(() => hubspot.updateContact(c.id, props), 'contact update');
      } catch (err) {
        stats.contactUpdateFailed++;
        console.error(`! ${email}: ${err.message}`);
      }
      await sleep(400);
    }
  }

  // --- Pass 2: stored analyses (what shared reports render with) -----------
  if (process.env.REDIS_URL) {
    const { createClient } = require('redis');
    const redis = createClient({ url: process.env.REDIS_URL, socket: { family: 0 } });
    redis.on('error', (e) => console.warn('Redis error:', e.message));
    await redis.connect();

    for await (const key of redis.scanIterator({ MATCH: 'analysis:*', COUNT: 100 })) {
      let a;
      try {
        a = JSON.parse(await redis.get(key));
      } catch (_) {
        continue;
      }
      if (!a || !a.websiteUrl) continue;

      const p = await probe(a.websiteUrl);
      if (!p.checked) continue;
      if (Boolean(a.usesHubSpot) === p.usesHubSpot && !p.portalId) continue;

      stats.redisFixed++;
      if (Boolean(a.usesHubSpot) !== p.usesHubSpot) {
        console.log(`~ report ${a.id} (${a.domain}): usesHubSpot ${Boolean(a.usesHubSpot)} -> ${p.usesHubSpot}`);
      }
      if (APPLY) {
        a.usesHubSpot = p.usesHubSpot;
        a.hubspotPortalId = p.portalId || '';
        const ttl = await redis.ttl(key);
        // Preserve the remaining TTL so the regrade doesn't extend report lifetime.
        if (ttl > 0) {
          await redis.set(key, JSON.stringify(a), { EX: ttl });
        } else {
          await redis.set(key, JSON.stringify(a));
        }
      }
    }
    await redis.quit();
  } else {
    console.log('\nREDIS_URL not set — skipping stored-analysis pass.');
  }

  console.log('\nDone:', stats);
  if (!APPLY) console.log('Dry run only — re-run with --apply to write.');
}

main().catch((e) => { console.error(e); process.exit(1); });
