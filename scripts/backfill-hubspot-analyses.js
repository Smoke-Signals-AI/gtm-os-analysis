// Backfill HubSpot contacts with analysis payloads that failed to write.
//
// Between 2026-06-29 and the fix, every pushAnalysisToContact PATCH was
// rejected by HubSpot (the payload included gtmos_linkedin_url, which had been
// deleted in the portal), so contacts were created but never received their
// gtmos_* analysis properties. The full reports still live in the Redis store
// (30-day TTL) under analysis:* keys, and each one carries the visitor's email
// — enough to reattach every lost payload.
//
// Usage (needs REDIS_URL and HUBSPOT_ACCESS_TOKEN, e.g. via `railway run`):
//   node scripts/backfill-hubspot-analyses.js            # dry run: report only
//   node scripts/backfill-hubspot-analyses.js --apply    # actually write
//
// Idempotent: contacts that already have gtmos_completed_at are skipped, so
// re-running never overwrites a successful write (old or new).

const hubspot = require('../server/services/hubspot');

const APPLY = process.argv.includes('--apply');
const BASE_URL = process.env.PUBLIC_BASE_URL || 'https://gtmos.smokesignals.ai';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

  const stats = { scanned: 0, noEmail: 0, noContact: 0, alreadyWritten: 0, pushed: 0, failed: 0 };

  for await (const key of redis.scanIterator({ MATCH: 'analysis:*', COUNT: 100 })) {
    stats.scanned++;
    let a;
    try {
      a = JSON.parse(await redis.get(key));
    } catch (_) {
      continue;
    }
    if (!a || !a.email) { stats.noEmail++; continue; }

    try {
      const contact = await hubspot.searchContactByEmail(a.email);
      if (!contact) {
        stats.noContact++;
        console.log(`- ${a.email}: no HubSpot contact, skipping`);
        continue;
      }
      if (contact.properties && contact.properties.gtmos_completed_at) {
        stats.alreadyWritten++;
        continue;
      }

      const reportUrl = `${BASE_URL}/?report=${encodeURIComponent(a.id)}`;
      console.log(`+ ${a.email}: ${APPLY ? 'pushing' : 'would push'} analysis ${a.id} (${a.domain || 'unknown domain'}, created ${a.createdAt || 'unknown'})`);

      if (APPLY) {
        await hubspot.pushAnalysisToContact(contact.id, {
          websiteUrl: a.websiteUrl || '',
          reportUrl,
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
        });
        stats.pushed++;
      }
    } catch (err) {
      stats.failed++;
      console.error(`! ${a.email}: ${err.message}`);
    }

    // Stay well under HubSpot's private-app rate limit.
    await sleep(300);
  }

  await redis.quit();
  console.log('\nDone:', stats);
  if (!APPLY) console.log('Dry run only — re-run with --apply to write.');
}

main().catch((e) => { console.error(e); process.exit(1); });
