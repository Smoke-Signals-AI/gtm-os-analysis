const Anthropic = require('@anthropic-ai/sdk');
const { getAnalysisPrompt, getChatSystemPrompt } = require('../prompts/analysis');

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
async function generateAnalysis({ websiteResearch, domain, usesHubSpot, enrichedPerson, linkedinPosts, jobPostings, decisionMakers, onDelta }) {
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

  const stream = anthropic.messages.stream({
    model: tier.id,
    max_tokens: 8000,
    // The system prompt is static across requests, so cache it. Cheaper and a
    // little faster on the prefix; harmless when the prefix is below the cache
    // minimum for a given model.
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }
    ],
    messages: [{ role: 'user', content: userPrompt }]
  });

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

  const messages = [];
  (history || []).slice(-12).forEach((m) => {
    if (m.role === 'visitor') messages.push({ role: 'user', content: m.text });
    else if (m.role === 'assistant') messages.push({ role: 'assistant', content: m.text });
    // human/team replies are folded in as assistant turns so the bot stays consistent
    else if (m.role === 'team') messages.push({ role: 'assistant', content: m.text });
  });
  messages.push({ role: 'user', content: userMessage });

  const message = await anthropic.messages.create({
    model: MODELS.standard.id,
    max_tokens: 600,
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }
    ],
    messages
  });

  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();
}

function parseSections(text) {
  const sectionPatterns = [
    { key: 'icpProfile', pattern: /(?:section\s*1|01)[:\s]*(?:icp\s*profile|ideal\s*customer)/i },
    { key: 'uspAnalysis', pattern: /(?:section\s*2|02)[:\s]*(?:unique\s*selling|usp\s*analysis)/i },
    { key: 'alphaSignal', pattern: /(?:section\s*3|03)[:\s]*(?:custom\s*alpha|alpha\s*signal)/i },
    { key: 'outboundSequence', pattern: /(?:section\s*4|04)[:\s]*(?:outbound\s*sequence)/i },
    { key: 'contentStrategy', pattern: /(?:section\s*5|05)[:\s]*(?:content|linkedin)/i }
  ];

  const sections = {};
  const lines = text.split('\n');

  let currentKey = null;
  let currentContent = [];

  for (const line of lines) {
    let matched = false;
    for (const { key, pattern } of sectionPatterns) {
      if (pattern.test(line)) {
        if (currentKey) {
          sections[currentKey] = currentContent.join('\n').trim();
        }
        currentKey = key;
        currentContent = [line];
        matched = true;
        break;
      }
    }
    if (!matched && currentKey) {
      currentContent.push(line);
    }
  }

  if (currentKey) {
    sections[currentKey] = currentContent.join('\n').trim();
  }

  // Fallback: if parsing failed, split into roughly equal parts
  if (Object.keys(sections).length < 3) {
    const keys = ['icpProfile', 'uspAnalysis', 'alphaSignal', 'outboundSequence', 'contentStrategy'];
    const chunkSize = Math.ceil(lines.length / 5);
    keys.forEach((key, i) => {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, lines.length);
      sections[key] = lines.slice(start, end).join('\n').trim();
    });
  }

  return sections;
}

module.exports = { generateAnalysis, generateChatReply };
