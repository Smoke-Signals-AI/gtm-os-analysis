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
// The fast tier handles small structured classifications (ICP scoring).
const MODELS = {
  premium: { id: 'claude-opus-4-8', label: 'opus-4.8' },
  standard: { id: 'claude-sonnet-4-6', label: 'sonnet-4.6' },
  fast: { id: 'claude-haiku-4-5', label: 'haiku-4.5' }
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

// Structured classification for ICP grading. Reads the scraped website plus
// the LinkedIn company/person facts and answers the judgment calls the grade
// needs: is this an agency, how big are they, how senior is the submitter, and
// do their buyers live on LinkedIn. Returns a plain object or null when the
// response can't be parsed; callers must treat null as "no verdict", never as
// a fail. Deterministic grading itself lives in services/icp.js.
async function classifyICP({ websiteResearch, domain, companyProfile, enrichedPerson }) {
  const anthropic = getClient();

  const companyFacts = companyProfile ? [
    companyProfile.name ? `Name: ${companyProfile.name}` : '',
    companyProfile.industry ? `Industry: ${companyProfile.industry}` : '',
    companyProfile.employeeCount ? `LinkedIn employee count: ${companyProfile.employeeCount}` : '',
    companyProfile.description ? `LinkedIn description: ${companyProfile.description}` : ''
  ].filter(Boolean).join('\n') : '(no LinkedIn company data)';

  const personFacts = enrichedPerson ? [
    enrichedPerson.title ? `Job title: ${enrichedPerson.title}` : '',
    enrichedPerson.headline ? `LinkedIn headline: ${enrichedPerson.headline}` : ''
  ].filter(Boolean).join('\n') : '';

  const userPrompt = `You are qualifying an inbound lead for Smoke Signals AI (sells signal-based GTM software to B2B companies that run HubSpot).

Company domain: ${domain}

## LinkedIn company facts
${companyFacts}

## Person who submitted (the lead)
${personFacts || '(no title or headline known)'}

## Website research
${String(websiteResearch || '').slice(0, 12000)}

Answer these questions about the COMPANY (not the person, except where asked):

1. is_agency: Is this company an agency — i.e. its business is providing marketing, growth, demand-gen, GTM, sales, RevOps, CRM-implementation, or HubSpot services/consulting to client companies (HubSpot solutions partners count)? Product companies and non-marketing service firms (accounting, legal, MSPs, etc.) are NOT agencies here.
2. headcount_band: Best estimate of employee count, as one of "lt10" (under 10), "10-25", "gt25" (more than 25), or "unknown". Weigh the LinkedIn employee count most heavily; team pages and language like "our team of 40" also count.
3. headcount_estimate: your single best numeric estimate of employees, or null.
4. title_level: From the submitter's title/headline: "director_plus" (director, head of, VP, C-level, founder/owner), "below_director" (manager, analyst, associate, IC roles), or "unknown" if there is no usable title.
5. buyers_on_linkedin: Based on who this company sells to, are their buyers/ICP the kind of professionals who are active on LinkedIn (B2B decision-makers, executives, operators)? "yes", "no" (e.g. consumers, local retail walk-ins), or "unknown".

Respond with ONLY a JSON object, no markdown fence, exactly these keys:
{"is_agency": boolean, "agency_reason": "one short clause, empty if not an agency", "headcount_band": "lt10|10-25|gt25|unknown", "headcount_estimate": number or null, "title_level": "director_plus|below_director|unknown", "buyers_on_linkedin": "yes|no|unknown", "buyers_on_linkedin_reason": "one short clause"}`;

  const message = await anthropic.messages.create({
    model: MODELS.fast.id,
    max_tokens: 400,
    messages: [{ role: 'user', content: stripLoneSurrogates(userPrompt) }]
  });

  const text = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  // Tolerate a stray fence or preamble: parse the outermost {...} in the reply.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    console.warn('[gtmos] classifyICP: no JSON object in reply:', text.slice(0, 200));
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    console.warn('[gtmos] classifyICP: JSON parse failed:', err.message, text.slice(0, 200));
    return null;
  }

  return {
    isAgency: parsed.is_agency === true,
    agencyReason: typeof parsed.agency_reason === 'string' ? parsed.agency_reason : '',
    headcountBand: typeof parsed.headcount_band === 'string' ? parsed.headcount_band : 'unknown',
    headcountEstimate: typeof parsed.headcount_estimate === 'number' ? parsed.headcount_estimate : null,
    titleLevel: typeof parsed.title_level === 'string' ? parsed.title_level : 'unknown',
    buyersOnLinkedIn: typeof parsed.buyers_on_linkedin === 'string' ? parsed.buyers_on_linkedin : 'unknown',
    buyersOnLinkedInReason: typeof parsed.buyers_on_linkedin_reason === 'string' ? parsed.buyers_on_linkedin_reason : ''
  };
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

module.exports = { generateAnalysis, generateChatReply, classifyICP };
