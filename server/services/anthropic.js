const Anthropic = require('@anthropic-ai/sdk');
const { getAnalysisPrompt } = require('../prompts/analysis');

let client;

function getClient() {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

async function generateAnalysis({ websiteResearch, domain, usesHubSpot, enrichedPerson }) {
  const model = usesHubSpot ? 'claude-opus-4-6' : 'claude-sonnet-4-6';
  const modelLabel = usesHubSpot ? 'opus-4.6' : 'sonnet-4.6';

  const { systemPrompt, userPrompt } = getAnalysisPrompt({
    websiteResearch,
    domain,
    enrichedPerson
  });

  const anthropic = getClient();

  const message = await anthropic.messages.create({
    model,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const fullText = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  // Parse the five sections
  const sections = parseSections(fullText);

  return {
    fullText,
    sections,
    modelUsed: modelLabel,
    model
  };
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

module.exports = { generateAnalysis };
