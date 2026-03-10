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
- Keep language clean and sharp. Short paragraphs. No walls of text.
- Be CONCISE. Sections 1 and 2 should be punchy insight cards, not essays.`;

  const userPrompt = `Analyze the following company and produce a comprehensive GTM intelligence report with exactly FIVE sections.

Company domain: ${domain}
${personContext}

Website research:
${websiteResearch}

Produce these five sections. Use the exact section headers shown below. Follow the formatting instructions precisely.

## Section 1: ICP Profile

Write SHORT, punchy insight cards. No paragraphs of explanation. Format EXACTLY like this:

### Target Buyer
- **Industry:** [specific industry/vertical]
- **Company size:** [employee range or revenue range]
- **Buyer title:** [specific titles that sign or champion the deal]
- **Use case:** [one sentence describing the job-to-be-done]

### Buying Trigger
[2 sentences MAX. What specific event or change causes someone to look for this solution right now?]

### Signal Blind Spot
[2 sentences MAX. What buying signal exists that this company is probably not detecting today?]

## Section 2: Unique Selling Proposition Analysis

Write SHORT, punchy analysis. No essays. Format EXACTLY like this:

> [One powerful sentence that captures their core USP to the ICP above]

### Differentiation: X/5
[One sentence explaining the score]

### Where the positioning lands
- **Strong:** [one specific thing they do well in their messaging]
- **Generic:** [one specific thing that sounds like every competitor]

### Recommended tweak
[1-2 sentences with a specific, actionable positioning recommendation]

## Section 3: Custom Alpha Signal + Interactive App Concept

Design ONE highly original alpha signal specific to this company. An alpha signal is a proprietary indicator of buying intent that competitors are not watching. It must be:
- Specific to their ICP and industry
- Detectable through publicly available data (LinkedIn, job postings, tech stack changes, SEC filings, review sites, social media, etc.)
- Actionable: a sales team could act on it within 24 hours of detection

Describe the signal with these subsections:
### The Signal
[Name and describe the alpha signal in 2-3 sentences]

### Why It Works
[2-3 sentences on why this signal indicates buying intent]

### How to Detect It
[2-3 bullet points on the data sources and detection method]

Then design an interactive micro-app that demonstrates the signal. Output the micro-app specification as a JSON code block using this EXACT format:

\`\`\`microapp
{
  "title": "Name of the Assessment/Calculator/Scorecard",
  "tagline": "One line describing what the user gets in 90 seconds",
  "inputs": [
    {"id": "field1", "label": "Display Label", "type": "text", "placeholder": "e.g., example value"},
    {"id": "field2", "label": "Category", "type": "select", "options": ["Option A", "Option B", "Option C", "Option D"]},
    {"id": "field3", "label": "Scale Metric", "type": "range", "min": 0, "max": 100, "step": 5, "unit": "units"},
    {"id": "field4", "label": "Yes/No Question", "type": "yesno"}
  ],
  "resultTitle": "Your Score/Assessment Title",
  "resultMetrics": [
    {"label": "Metric Name 1", "description": "What this dimension measures"},
    {"label": "Metric Name 2", "description": "What this dimension measures"},
    {"label": "Metric Name 3", "description": "What this dimension measures"}
  ],
  "benchmark": "Companies in your vertical with similar profiles average a score of {score}/100. Here is where you stand."
}
\`\`\`

Design 3-5 inputs that are specific to this company's ICP and signal. Use a mix of input types (at least one text, one select, and one range or yesno). The metrics should align with the alpha signal theme.

## Section 4: Outbound Sequence Concept

Design a 3-email outbound sequence triggered by the alpha signal from Section 3.

Format each email EXACTLY like this (this format is critical for rendering):

### Email 1: Signal Detection
**Subject:** [lowercase, 3-6 words, no punctuation except question marks]

[Email body: 50-90 words following signal-first architecture]
- Signal hook (1-2 sentences): reference the alpha signal
- Bridge (1-2 sentences): connect to problem with hedging language
- Value (1-2 sentences): results or insight, no product pitch
- CTA (1 sentence): "grateful for 15 minutes" energy

### Email 2: Value Add
**Subject:** [lowercase, 3-6 words]

[Email body: 50-90 words, adds new value, not "just bumping this"]

### Email 3: Proof + Close
**Subject:** [lowercase, 3-6 words]

[Email body: 50-90 words, includes proof point or case reference]

Rules:
- No self-introduction as opening line
- No buzzwords or jargon
- Sound like a human texting a professional acquaintance

## Section 5: Content + LinkedIn Plan

### Long-form Content Idea
- **Title:** [specific, compelling title]
- **Target audience:** [who this is for]
- **Format:** [blog post / guide / report]
- **Key sections:** [3-4 bullet points]
- **Distribution:** [1-2 sentences on how to distribute]

### LinkedIn Content Plan

**Post 1 (Contrarian Take)**
Hook: "[opening line that stops the scroll]"
[3-4 sentence summary of the post]

**Post 2 (Data/Proof)**
Hook: "[opening line]"
[3-4 sentence summary]

**Post 3 (Story/Narrative)**
Hook: "[opening line]"
[3-4 sentence summary]

**Post 4 (Educational Breakdown)**
Hook: "[opening line]"
[3-4 sentence summary]

No hashtags. Write for organic reach.`;

  return { systemPrompt, userPrompt };
}

module.exports = { getAnalysisPrompt };
