const express = require('express');
const anthropic = require('../services/anthropic');
const slack = require('../services/slack');
const store = require('../utils/store');

const router = express.Router();

// Injected from index.js (mirrors the PDF route wiring). Async: returns a Promise.
let getAnalysis = async () => null;
router.setAnalysisStore = (fn) => { getAnalysis = fn; };

// Storage keys (Redis when REDIS_URL is set, else in-process Map)
const chatKey = (analysisId) => `chat:${analysisId}`;            // -> { messages, slackThreadTs, domain, person }
const threadKey = (ts) => `slackthread:${ts}`;                    // -> analysisId

// Slack retry de-dupe is fine to keep in-process (loss on restart is harmless).
const seenSlackEvents = new Set();

function newConvo(analysis) {
  return {
    messages: [],
    slackThreadTs: null,
    domain: analysis ? analysis.domain : '',
    person: analysis ? analysis.enrichedPerson : null
  };
}

// ---- Visitor sends a message ----
router.post('/chat/:analysisId/message', async (req, res) => {
  const { analysisId } = req.params;
  const text = (req.body && req.body.text ? String(req.body.text) : '').trim();

  if (!text) return res.status(400).json({ error: 'Message is required.' });
  if (text.length > 2000) return res.status(400).json({ error: 'Message is too long.' });

  const analysis = await getAnalysis(analysisId);
  if (!analysis) {
    return res.status(404).json({ error: 'This report has expired. Please regenerate your analysis.' });
  }

  const convo = (await store.getJSON(chatKey(analysisId))) || newConvo(analysis);
  convo.messages.push({ role: 'visitor', text, ts: Date.now() });

  const resultsUrl = `${req.protocol}://${req.get('host')}`;

  // Relay to Slack (creates/continues the thread). Best-effort.
  let newThread = false;
  try {
    newThread = await relayVisitorToSlack(convo, text, resultsUrl);
  } catch (err) {
    console.warn('Slack relay error:', err.message);
  }

  // Generate the concierge reply, grounded in the report.
  let reply;
  try {
    reply = await anthropic.generateChatReply({
      domain: analysis.domain,
      sections: analysis.sections,
      enrichedPerson: analysis.enrichedPerson,
      history: convo.messages,
      userMessage: text
    });
  } catch (err) {
    console.error('Chat reply error:', err.message);
    reply = 'Thanks for that. I have pinged the Smoke Signals team and someone will jump into this chat shortly. In the meantime, what is the biggest gap in your current pipeline?';
  }

  const assistantMsg = { role: 'assistant', text: reply, ts: Date.now() };
  convo.messages.push(assistantMsg);

  // Persist the conversation (and the thread index if a new thread was opened).
  await store.setJSON(chatKey(analysisId), convo);
  if (newThread && convo.slackThreadTs) {
    await store.setJSON(threadKey(convo.slackThreadTs), analysisId);
  }

  // Post the AI reply into the Slack thread for team visibility (don't block).
  if (slack.isConfigured() && convo.slackThreadTs) {
    slack.postToThread({ threadTs: convo.slackThreadTs, text: reply, author: 'bot', person: convo.person })
      .catch(err => console.warn('Slack bot post error:', err.message));
  }

  res.json({ reply, ts: assistantMsg.ts });
});

// Mutates convo (sets slackThreadTs). Returns true if a new thread was created.
async function relayVisitorToSlack(convo, text, resultsUrl) {
  if (!slack.isConfigured()) return false;
  if (!convo.slackThreadTs) {
    convo.slackThreadTs = await slack.startThread({
      domain: convo.domain,
      person: convo.person,
      text,
      resultsUrl
    });
    return true;
  }
  await slack.postToThread({ threadTs: convo.slackThreadTs, text, author: 'visitor', person: convo.person });
  return false;
}

// ---- Visitor polls for new messages (team replies from Slack) ----
router.get('/chat/:analysisId/messages', async (req, res) => {
  const { analysisId } = req.params;
  const since = Number(req.query.since || 0);
  const convo = await store.getJSON(chatKey(analysisId));
  if (!convo) return res.json({ messages: [] });

  const messages = convo.messages
    .filter(m => m.ts > since && (m.role === 'team' || m.role === 'assistant'))
    .map(m => ({ role: m.role, text: m.text, ts: m.ts }));

  res.json({ messages });
});

// ---- Slack Events API: team replies in the thread come back here ----
router.post('/slack/events', (req, res) => {
  const body = req.body || {};

  // URL verification handshake
  if (body.type === 'url_verification') {
    return res.json({ challenge: body.challenge });
  }

  // Verify signature on real events
  const ok = slack.verifySignature({
    rawBody: req.rawBody || '',
    timestamp: req.get('x-slack-request-timestamp'),
    signature: req.get('x-slack-signature')
  });
  if (!ok) return res.status(401).send('bad signature');

  // Acknowledge fast; process after.
  res.status(200).send('');

  if (body.type !== 'event_callback' || !body.event) return;
  const event = body.event;

  // Dedupe retries
  const eventKey = body.event_id || `${event.ts}:${event.channel}`;
  if (eventKey) {
    if (seenSlackEvents.has(eventKey)) return;
    seenSlackEvents.add(eventKey);
    if (seenSlackEvents.size > 5000) seenSlackEvents.clear();
  }

  if (event.type !== 'message') return;
  // Ignore our own bot posts, edits, deletes, and non-thread channel chatter.
  if (event.bot_id || event.subtype) return;
  if (!event.thread_ts) return;

  const text = stripMrkdwn(event.text || '');
  if (!text) return;

  // Persist the team reply (async, after the ack).
  (async () => {
    const analysisId = await store.getJSON(threadKey(event.thread_ts));
    if (!analysisId) return;
    const convo = await store.getJSON(chatKey(analysisId));
    if (!convo) return;
    convo.messages.push({ role: 'team', text, ts: Date.now() });
    await store.setJSON(chatKey(analysisId), convo);
  })().catch(err => console.warn('Slack event handling error:', err.message));
});

function stripMrkdwn(text) {
  return String(text)
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')   // <url|label> -> label
    .replace(/<(https?:[^>]+)>/g, '$1')       // <url> -> url
    .replace(/[*_~`]/g, '')
    .trim();
}

module.exports = router;
