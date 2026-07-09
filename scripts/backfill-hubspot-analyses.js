// Backfill HubSpot contacts with analysis payloads that failed to write.
//
// Recovers from two outages, using the reports still in the Redis store
// (30-day TTL, analysis:* keys, each carrying the visitor's email):
//   1. ~June 15-29: new-contact creates 400'd (payload included linkedin_url,
//      which isn't a portal property; fixed in #27), so those visitors have a
//      report in Redis but NO contact at all. The contact is created here.
//   2. June 29 - July 9: pushAnalysisToContact PATCHes 400'd (payload included
//      gtmos_linkedin_url, deleted in a portal cleanup; fixed in #29), so those
//      contacts exist but never received their gtmos_* analysis properties.
//
// Usage (run inside the deployed container via `railway ssh` — Redis's internal
// hostname doesn't resolve from outside Railway's network):
//   node scripts/backfill-hubspot-analyses.js            # dry run: report only
//   node scripts/backfill-hubspot-analyses.js --apply    # actually write
//
// Idempotent: contacts that already have gtmos_completed_at are skipped, so
// re-running never overwrites a successful write (old or new).

const hubspot = require('../server/services/hubspot');
const { validateEmail } = require('../server/utils/validation');

const APPLY = process.argv.includes('--apply');
const BASE_URL = process.env.PUBLIC_BASE_URL || 'https://gtmos.smokesignals.ai';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// HubSpot's search API allows ~5 req/s per portal, shared with the live app's
// traffic, so back off and retry instead of failing the record on a 429.
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

function analysisPayload(a) {
  return {
    websiteUrl: a.websiteUrl || '',
    reportUrl: `${BASE_URL}/?report=${encodeURIComponent(a.id)}`,
    linkedinUrl: (a.enrichedPerson && a.enrichedPerson.linkedinUrl) || '',
    icpProfile: (a.sections && a.sections.icpProfile) || '',
    uspAnalysis: (a.sections && a.sections.uspAnalysis) || '',
    alphaSignal: (a.sections && a.sections.alphaSignal) || '',
    outboundSequence: (a.sections && a.sections.outboundSequence) || '',
    contentStrategy: (a.sections && a.sections.contentStrategy) || '',
    reportNarrative: a.fullText || '',
    usesHubSpot: Boolean(a.usesHubSpot),
    companyResearch: '', // the raw scrape isn't stored; nothing to backfill
    modelUsed: a.modelUsed || '',
    completedAt: a.createdAt || undefined
  };
}

// Same conservative shape runWorkstreamA uses: standard properties only.
function contactProps(a) {
  const p = a.enrichedPerson || {};
  const props = { email: a.email };
  if (p.firstName) props.firstname = p.firstName;
  if (p.lastName) props.lastname = p.lastName;
  if (p.title) props.jobtitle = p.title;
  if (p.company) props.company = p.company;
  return props;
}

async function main() {
  if (!process.env.REDIS_URL) {
    console.error('REDIS_URL is required (the reports to backfill live in Redis).');
    process.exit(1);
  }
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    console.error('HUBSPOT_ACCESS_TOKEN is required.');
    process.exit(1);
  }

  const { createClient } = require('redis');
  const redis = createClient({ url: process.env.REDIS_URL, socket: { family: 0 } });
  redis.on('error', (e) => console.warn('Redis error:', e.message));
  await redis.connect();

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — scanning ${BASE_URL} analyses in Redis...`);

  const stats = { scanned: 0, badEmail: 0, alreadyWritten: 0, created: 0, pushed: 0, failed: 0 };

  for await (const key of redis.scanIterator({ MATCH: 'analysis:*', COUNT: 100 })) {
    stats.scanned++;
    let a;
    try {
      a = JSON.parse(await redis.get(key));
    } catch (_) {
      continue;
    }
    if (!a || !validateEmail(a.email)) { stats.badEmail++; continue; }

    try {
      let contact = await withRetry(() => hubspot.searchContactByEmail(a.email), 'search');

      if (contact && contact.properties && contact.properties.gtmos_completed_at) {
        stats.alreadyWritten++;
        continue;
      }

      if (!contact) {
        // A lead lost to the June create bug: no CRM record exists at all.
        console.log(`+ ${a.email}: ${APPLY ? 'creating' : 'would create'} contact (lead was never captured)`);
        if (APPLY) {
          contact = await withRetry(() => hubspot.createContact(contactProps(a)), 'create');
          stats.created++;
        }
      }

      console.log(`+ ${a.email}: ${APPLY ? 'pushing' : 'would push'} analysis ${a.id} (${a.domain || 'unknown domain'}, created ${a.createdAt || 'unknown'})`);
      if (APPLY) {
        await withRetry(() => hubspot.pushAnalysisToContact(contact.id, analysisPayload(a)), 'push');
        stats.pushed++;
      }
    } catch (err) {
      stats.failed++;
      console.error(`! ${a.email}: ${err.message}`);
    }

    // Stay well under HubSpot's shared search rate limit (~5 req/s per portal).
    await sleep(600);
  }

  await redis.quit();
  console.log('\nDone:', stats);
  if (!APPLY) console.log('Dry run only — re-run with --apply to write.');
}

main().catch((e) => { console.error(e); process.exit(1); });
