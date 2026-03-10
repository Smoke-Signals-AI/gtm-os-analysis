function getAnalysisPrompt({ websiteResearch, domain, enrichedPerson }) {
  const personContext = enrichedPerson
    ? `The person requesting this analysis works as ${enrichedPerson.title || 'unknown role'} at ${enrichedPerson.company || domain}.`
    : '';

  const systemPrompt = `You are a senior GTM strategist at Smoke Signals AI, a signal-based demand generation agency that builds GTM operating systems for B2B companies. You specialize in detecting "alpha signals", proprietary indicators of buying intent before competitors notice them, and deploying them through integrated outbound, content, and LinkedIn programs.

Your analysis should be specific, original, and actionable. Every recommendation must be tailored to this exact company. No generic advice.

Writing rules (these are non-negotiable):
- Never use exclamation points
- Never use em dashes. Use commas, periods, or restructure the sentence instead
- Write at a peer-to-peer level, not a consultant-to-client level
- Be direct and specific. No filler phrases like "in today's competitive landscape" or "leverage synergies"
- The alpha signal you design must be genuinely novel. Not a repackaged version of "they're hiring" or "they raised funding"
- Email copy must follow signal-first architecture: signal hook, bridge to relevance, value without pitching, grateful CTA
- LinkedIn content should be written for organic reach: hook-first, no hashtag spam, educational tone
- Keep language clean and sharp. Short paragraphs. No walls of text.`;

  const userPrompt = `Analyze the following company and produce a comprehensive GTM intelligence report with exactly FIVE sections.

Company domain: ${domain}
${personContext}

Website research:
${websiteResearch}

Produce these five sections. Use the exact section headers shown below.

## Section 1: ICP Profile

Analyze:
- Who is their ideal customer (industry, company size, title of buyer, use case)
- What job-to-be-done does their product address
- What is the buying trigger: what event or change causes someone to look for this solution
- What is the signal blind spot: what buying signals exist that they are probably not detecting

## Section 2: Unique Selling Proposition Analysis

Analyze:
- What is their core USP to the identified ICP
- How differentiated is it (scale of 1-5 with explanation)
- Where the positioning is strong vs. where it is generic
- One recommended positioning tweak that would sharpen their story

## Section 3: Custom Alpha Signal + Interactive App Concept

Design ONE highly original, creative alpha signal specific to this company. An alpha signal is a proprietary indicator of buying intent that competitors are not watching. It must be:
- Specific to their ICP and industry
- Detectable through publicly available data (LinkedIn, job postings, tech stack changes, SEC filings, review sites, social media, etc.)
- Actionable: a sales team could act on it within 24 hours of detection

Then describe an interactive micro-app concept that demonstrates the signal in action. Describe: what it does, what the visitor inputs, what it produces, and how it proves the signal thesis. Think along the lines of ROI calculators, readiness assessments, benchmarking tools, or risk scorecards, but designed specifically for this company's signal.

## Section 4: Outbound Sequence Concept

Design a 3-email outbound sequence triggered by the alpha signal from Section 3.

For each email provide:
- Subject line (lowercase, 3-6 words, no punctuation except question marks)
- Email body

Email structure (each email):
1. Signal hook (1-2 sentences): reference the alpha signal specifically
2. Bridge to relevance (1-2 sentences): connect signal to a problem using hedging language ("Not sure how you're thinking about...", "Depending on how you're handling...")
3. Value without pitching (1-2 sentences): results, proof, or insight. No product description.
4. Grateful CTA (1 sentence): "I'd be grateful for 15 minutes" energy

Rules:
- 50-90 words per email body
- No self-introduction as opening line
- No buzzwords or jargon
- Each follow-up adds new value, not "just bumping this"
- Sound like a human texting a professional acquaintance

## Section 5: Content + LinkedIn Plan

Part A: One long-form content idea (blog post, guide, or report) that positions their expertise around the alpha signal theme. Include: title, target audience, key sections, estimated length, distribution strategy.

Part B: A 4-post LinkedIn content plan for the company's founder or head of marketing. Each post should follow a different format:
1. One contrarian take
2. One data/proof post
3. One story/narrative post
4. One educational breakdown

Include the opening hook line for each post. No hashtags.`;

  return { systemPrompt, userPrompt };
}

module.exports = { getAnalysisPrompt };
