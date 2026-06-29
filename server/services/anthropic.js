const Anthropic = require('@anthropic-ai/sdk');
const { getAnalysisPrompt, getChatSystemPrompt } = require('../prompts/analysis');
const { stripLoneSurrogates } = require('../utils/validation');

let client;

function getClient() {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

// Premium path uses the most capable Opus tier; standard path uses Sonnet.
const MODELS = {
  premium: { id: 'claude-opus-4-8', label: 'opus-4.8' },
  standard: { id: 'claude-sonnet-4-6', label: 'sonnet-4.6' }
};

// Generate the analysis with streaming. onDelta(textChunk) is invoked as tokens
// arrive so the frontend can render the report progressively. The model and
// total token count are unchanged versus a blocking call, but the reader sees
// content within seconds instead of staring at a bar for 60-90s.
async function generateAnalysis({ websiteResearch, domain, usesHubSpot, enrichedPerson, linkedinPosts, jobPostings, decisionMakers, onDelta, signal }) {
  const tier = usesHubSpot ? MODELS.premium : MODELS.standard;

  const { systemPrompt, userPrompt } = getAnalysisPrompt({
    websiteResearch,
    domain,
    enrichedPerson,
    linkedinPosts,
    jobPostings,
    decisionMakers
  });

  const anthropic = getClient();

  // Strip unpaired UTF-16 surrogates before the SDK serializes the body. Scraped
  // copy and LinkedIn posts carry emoji that truncation can split, and a lone
  // surrogate makes the request body invalid JSON (API 400, retries never recover).
  const stream = anthropic.messages.stream({
    model: tier.id,
    max_tokens: 8000,
    // The system prompt is static across requests, so cache it. Cheaper and a
    // little faster on the prefix; harmless when the prefix is below the cache
    // minimum for a given model.
    system: [
      { type: 'text', text: stripLoneSurrogates(systemPrompt), cache_control: { type: 'ephemeral' } }
    ],
    messages: [{ role: 'user', content: stripLoneSurrogates(userPrompt) }]
  // A client disconnect aborts the upstream generation so we stop paying for and
  // streaming tokens nobody is reading.
  }, signal ? { signal } : undefined);

  if (typeof onDelta === 'function') {
    stream.on('text', (delta) => {
      try { onDelta(delta); } catch (_) { /* never let a render error kill the stream */ }
    });
  }

  const message = await stream.finalMessage();

  const fullText = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  const sections = parseSections(fullText);

  return {
    fullText,
    sections,
    modelUsed: tier.label,
    model: tier.id
  };
}

// Concierge chat reply, grounded in the visitor's report. Fast, non-streaming,
// short answers. Uses Sonnet for speed and cost.
async function generateChatReply({ domain, sections, enrichedPerson, history, userMessage }) {
  const anthropic = getClient();

  const systemPrompt = getChatSystemPrompt({ domain, sections, enrichedPerson });

  // stripLoneSurrogates on every text field: visitor input and the report-grounded
  // system prompt can carry orphaned surrogates that would make the body invalid JSON.
  const messages = [];
  (history || []).slice(-12).forEach((m) => {
    if (m.role === 'visitor') messages.push({ role: 'user', content: stripLoneSurrogates(m.text) });
    else if (m.role === 'assistant') messages.push({ role: 'assistant', content: stripLoneSurrogates(m.text) });
    // human/team replies are folded in as assistant turns so the bot stays consistent
    else if (m.role === 'team') messages.push({ role: 'assistant', content: stripLoneSurrogates(m.text) });
  });
  messages.push({ role: 'user', content: stripLoneSurrogates(userMessage) });

  const message = await anthropic.messages.create({
    model: MODELS.standard.id,
    max_tokens: 600,
    system: [
      { type: 'text', text: stripLoneSurrogates(systemPrompt), cache_control: { type: 'ephemeral' } }
    ],
    messages
  });

  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();
}

const SECTION_KEYS = ['icpProfile', 'uspAnalysis', 'alphaSignal', 'outboundSequence', 'contentStrategy'];

// Match a section by the title's keywords rather than its number, so the report
// still parses if the model drops/renames the "Section N" prefix. Order in the
// document doesn't matter; each heading is mapped to its key by content.
const SECTION_MATCHERS = [
  { key: 'icpProfile', re: /icp\s*profile|ideal\s*customer/i },
  { key: 'uspAnalysis', re: /unique\s*selling|usp\s*analysis|value\s*prop/i },
  { key: 'alphaSignal', re: /alpha\s*signal|custom\b[\s\S]{0,20}signal|interactive\s*app/i },
  { key: 'outboundSequence', re: /outbound\s*sequence|email\s*sequence|sequence\s*concept/i },
  { key: 'contentStrategy', re: /content\s*(?:\+|and|&)?\s*linkedin|linkedin\s*plan|content\s*plan/i }
];

function parseSections(text) {
  const lines = String(text || '').split('\n');
  const sections = {};
  let currentKey = null;
  let buf = [];

  const flush = () => {
    if (!currentKey) return;
    const prev = sections[currentKey] ? sections[currentKey] + '\n' : '';
    sections[currentKey] = (prev + buf.join('\n')).trim();
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const isHeading = /^#{1,3}\s/.test(trimmed) || /^section\s*\d/i.test(trimmed);
    let matchedKey = null;
    if (isHeading) {
      for (const m of SECTION_MATCHERS) {
        if (m.re.test(trimmed)) { matchedKey = m.key; break; }
      }
    }
    if (matchedKey) {
      flush();
      currentKey = matchedKey;
      buf = [line];
    } else if (currentKey) {
      buf.push(line);
    }
  }
  flush();

  // Backfill any section that never parsed (or parsed empty) from a positional
  // slice of the text, so no section ever renders blank in the page, PDF, or
  // chat grounding. We only fill the gaps; cleanly parsed sections are untouched.
  const missing = SECTION_KEYS.filter(k => !sections[k] || !sections[k].trim());
  if (missing.length) {
    const chunk = Math.max(1, Math.ceil(lines.length / 5));
    SECTION_KEYS.forEach((key, i) => {
      if (sections[key] && sections[key].trim()) return;
      sections[key] = lines.slice(i * chunk, Math.min((i + 1) * chunk, lines.length)).join('\n').trim();
    });
  }

  return sections;
}

module.exports = { generateAnalysis, generateChatReply };
