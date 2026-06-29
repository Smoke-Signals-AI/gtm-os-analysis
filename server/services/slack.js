const crypto = require('crypto');

// Slack integration for the results-page concierge.
//
// Required environment variables (the feature self-disables if missing):
//   SLACK_BOT_TOKEN       xoxb-... bot token with chat:write
//   SLACK_CHANNEL_ID      the channel where visitor conversations land (e.g. C0123ABCD)
//   SLACK_SIGNING_SECRET  used to verify inbound Events API requests
//
// Each visitor conversation maps to one Slack thread. Visitor messages and the
// AI's replies are posted into that thread; when a teammate replies in the
// thread, the Events API delivers it back and the widget picks it up.

const SLACK_API = 'https://slack.com/api';

function isConfigured() {
  return Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID);
}

async function slackPost(method, body) {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(`Slack ${method} error: ${data.error || res.status}`);
  }
  return data;
}

// Post the visitor's first message as a new thread. Returns the thread ts.
async function startThread({ domain, person, text, resultsUrl }) {
  const who = person && person.firstName
    ? `${person.firstName}${person.title ? ', ' + person.title : ''}`
    : 'A visitor';
  const header = `:fire: *New GTM OS chat* from ${who} at *${domain || 'unknown'}*` +
    (resultsUrl ? `\n<${resultsUrl}|Open their report>` : '');

  const parent = await slackPost('chat.postMessage', {
    channel: process.env.SLACK_CHANNEL_ID,
    text: header,
    unfurl_links: false
  });

  // First visitor message in the thread. Best-effort: if this post fails we must
  // still return the parent ts so the thread->analysis mapping gets saved (else
  // team replies on this thread would never route back).
  try {
    await slackPost('chat.postMessage', {
      channel: process.env.SLACK_CHANNEL_ID,
      thread_ts: parent.ts,
      text: `:speech_balloon: *${who}:* ${text}`,
      unfurl_links: false
    });
  } catch (err) {
    console.warn('Slack first-message post failed (thread kept):', err.message);
  }

  return parent.ts;
}

// Post a follow-up into an existing thread. `author` is "visitor" or "bot".
async function postToThread({ threadTs, text, author, person }) {
  if (!threadTs) return;
  const who = person && person.firstName ? person.firstName : 'Visitor';
  const prefix = author === 'visitor'
    ? `:speech_balloon: *${who}:*`
    : ':robot_face: *Concierge:*';
  await slackPost('chat.postMessage', {
    channel: process.env.SLACK_CHANNEL_ID,
    thread_ts: threadTs,
    text: `${prefix} ${text}`,
    unfurl_links: false
  });
}

// Verify an inbound Slack Events API request signature.
// `rawBody` must be the exact raw request body bytes/string.
function verifySignature({ rawBody, timestamp, signature }) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;

  // Reject requests older than 5 minutes (replay protection)
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const mySig = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');

  try {
    const a = Buffer.from(mySig);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

module.exports = { isConfigured, startThread, postToThread, verifySignature };
