const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { validateEmail, sanitizeUrl, extractDomain } = require('../utils/validation');
const { checkRateLimit } = require('../utils/cache');
const hubspot = require('../services/hubspot');
const anysite = require('../services/anysite');
const scraper = require('../services/scraper');
const anthropic = require('../services/anthropic');
const store = require('../utils/store');

const router = express.Router();

// Analyses are persisted via the store (Redis when REDIS_URL is set, else an
// in-process Map). Used for PDF retrieval and chat grounding.
const analysisKey = (id) => `analysis:${id}`;

router.post('/analyze', async (req, res) => {
  const { email, website } = req.body;

  // Validate inputs
  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const websiteUrl = sanitizeUrl(website);
  if (!websiteUrl) {
    return res.status(400).json({ error: 'Please enter a valid website URL.' });
  }

  if (!checkRateLimit(email)) {
    return res.status(429).json({ error: 'You have reached the maximum number of analyses for today. Please try again tomorrow.' });
  }

  const domain = extractDomain(websiteUrl);
  const analysisId = uuidv4();

  // Set up SSE for progress + streaming updates
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  function sendProgress(stage, message) {
    res.write(`data: ${JSON.stringify({ type: 'progress', stage, message })}\n\n`);
  }

  function sendDelta(text) {
    res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
  }

  function sendResult(data) {
    res.write(`data: ${JSON.stringify({ type: 'result', data })}\n\n`);
    res.end();
  }

  function sendError(message) {
    res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    res.end();
  }

  try {
    sendProgress('start', 'Starting your GTM analysis...');

    // Ensure HubSpot properties exist (fire and forget)
    hubspot.ensureProperties().catch(err =>
      console.warn('Property setup warning:', err.message)
    );

    // PARALLEL: Workstream A (enrichment + CRM + LinkedIn evidence) and Workstream B (website scraping)
    sendProgress('research', 'Analyzing your website...');

    const [enrichmentResult, scrapeResult] = await Promise.all([
      runWorkstreamA(email, domain, sendProgress),
      scraper.scrapeWebsite(websiteUrl).catch(err => {
        console.error('Scraping error:', err.message);
        return { raw: `Company website: ${websiteUrl}\nDomain: ${domain}\n(Website content could not be fully retrieved)`, meta: {}, pagesScraped: 0 };
      })
    ]);

    const { contactId, enrichedPerson, usesHubSpot, linkedinPosts, jobPostings, companyProfile } = enrichmentResult;

    // Fold LinkedIn company facts into the research so the model has them too.
    let research = scrapeResult.raw;
    if (companyProfile && (companyProfile.industry || companyProfile.employeeCount || companyProfile.description)) {
      const facts = [
        companyProfile.industry ? `Industry: ${companyProfile.industry}` : '',
        companyProfile.employeeCount ? `Employees: ${companyProfile.employeeCount}` : '',
        companyProfile.headquarters ? `HQ: ${companyProfile.headquarters}` : '',
        companyProfile.description ? `LinkedIn description: ${companyProfile.description}` : ''
      ].filter(Boolean).join('\n');
      research = `## Company (LinkedIn)\n${facts}\n\n${research}`;
    }

    const companyLogoUrl = (companyProfile && companyProfile.logoUrl) || '';

    sendProgress('enrichment', 'Research complete. Building your signal strategy...');

    // AI Analysis (streamed). Model tier depends on BuiltWith result.
    sendProgress('analysis', usesHubSpot
      ? 'Deploying premium analysis engine...'
      : 'Generating your custom signal strategy...');

    let analysis;
    try {
      analysis = await anthropic.generateAnalysis({
        websiteResearch: research,
        domain,
        usesHubSpot,
        enrichedPerson,
        linkedinPosts,
        jobPostings,
        onDelta: sendDelta
      });
    } catch (err) {
      console.error('Anthropic API error:', err.message);
      sendError('We are experiencing high demand. Your analysis is being queued. We will email you when it is ready.');
      return;
    }

    sendProgress('saving', 'Finalizing your report...');

    // Store analysis for PDF generation + chat grounding
    const storedAnalysis = {
      id: analysisId,
      email,
      websiteUrl,
      domain,
      sections: analysis.sections,
      fullText: analysis.fullText,
      modelUsed: analysis.modelUsed,
      usesHubSpot,
      companyLogoUrl,
      enrichedPerson,
      jobPostingsCount: Array.isArray(jobPostings) ? jobPostings.length : 0,
      postsCount: Array.isArray(linkedinPosts) ? linkedinPosts.length : 0,
      createdAt: new Date().toISOString()
    };
    await store.setJSON(analysisKey(analysisId), storedAnalysis);

    // Push to HubSpot (non-blocking)
    if (contactId) {
      hubspot.pushAnalysisToContact(contactId, {
        websiteUrl,
        icpProfile: analysis.sections.icpProfile || '',
        uspAnalysis: analysis.sections.uspAnalysis || '',
        alphaSignal: analysis.sections.alphaSignal || '',
        outboundSequence: analysis.sections.outboundSequence || '',
        contentStrategy: analysis.sections.contentStrategy || '',
        reportNarrative: analysis.fullText,
        usesHubSpot,
        companyResearch: scrapeResult.raw.slice(0, 60000),
        modelUsed: analysis.modelUsed
      }).catch(err => console.error('HubSpot update error:', err.message));
    }

    sendResult({
      analysisId,
      sections: analysis.sections,
      modelUsed: analysis.modelUsed,
      domain,
      usesHubSpot,
      companyLogoUrl,
      person: enrichedPerson ? { firstName: enrichedPerson.firstName || '', title: enrichedPerson.title || '' } : null
    });

  } catch (err) {
    console.error('Analysis pipeline error:', err);
    sendError('Something went wrong during analysis. Please try again.');
  }
});

async function runWorkstreamA(email, domain, sendProgress) {
  let contactId = null;
  let enrichedPerson = null;

  // Round 1 (parallel): CRM lookup, tech-stack check, LinkedIn profile enrichment.
  const [existingContact, builtWithResult, linkedinProfile] = await Promise.all([
    hubspot.searchContactByEmail(email).catch(err => {
      console.warn('HubSpot search error:', err.message);
      return null;
    }),
    anysite.checkBuiltWith(domain).catch(err => {
      console.warn('BuiltWith error:', err.message);
      return { usesHubSpot: false, technologies: [] };
    }),
    anysite.enrichPersonByEmail(email).catch(() => null)
  ]);

  const usesHubSpot = builtWithResult.usesHubSpot;

  // Merge CRM + LinkedIn data. Prefer known CRM name fields; keep the LinkedIn
  // URL and headline (the CRM usually lacks them) so we can pull posts.
  if (existingContact || linkedinProfile) {
    const cp = existingContact && existingContact.properties ? existingContact.properties : {};
    enrichedPerson = {
      firstName: cp.firstname || (linkedinProfile && linkedinProfile.firstName) || '',
      lastName: cp.lastname || (linkedinProfile && linkedinProfile.lastName) || '',
      title: cp.jobtitle || (linkedinProfile && linkedinProfile.title) || '',
      company: cp.company || (linkedinProfile && linkedinProfile.company) || '',
      linkedinUrl: (linkedinProfile && linkedinProfile.linkedinUrl) || cp.linkedin_url || '',
      headline: (linkedinProfile && linkedinProfile.headline) || ''
    };
  }

  if (existingContact) {
    contactId = existingContact.id;
    sendProgress('crm', 'Found your profile...');
  } else {
    sendProgress('enrichment', 'Researching your competitive landscape...');
    const contactProps = { email };
    if (enrichedPerson) {
      if (enrichedPerson.firstName) contactProps.firstname = enrichedPerson.firstName;
      if (enrichedPerson.lastName) contactProps.lastname = enrichedPerson.lastName;
      if (enrichedPerson.title) contactProps.jobtitle = enrichedPerson.title;
      if (enrichedPerson.company) contactProps.company = enrichedPerson.company;
      if (enrichedPerson.linkedinUrl) contactProps.linkedin_url = enrichedPerson.linkedinUrl;
    }
    try {
      const newContact = await hubspot.createContact(contactProps);
      contactId = newContact.id;
    } catch (err) {
      console.warn('HubSpot create error:', err.message);
    }
  }

  // Round 2 (parallel): the reader's recent posts, the company's open jobs, and
  // the company's LinkedIn profile (logo + facts).
  sendProgress('signals', 'Reading your public signals...');
  const company = (enrichedPerson && enrichedPerson.company) || domain;
  const [linkedinPosts, jobPostings, companyProfile] = await Promise.all([
    (enrichedPerson && enrichedPerson.linkedinUrl)
      ? anysite.getLinkedInPosts(enrichedPerson.linkedinUrl, 20).catch(() => [])
      : Promise.resolve([]),
    anysite.getCompanyJobs(company, 15).catch(() => []),
    anysite.getCompanyProfile(company).catch(() => null)
  ]);

  return { contactId, enrichedPerson, usesHubSpot, linkedinPosts, jobPostings, companyProfile };
}

// Fetch a stored analysis for rendering (used by the "Open their report"
// deep link: /?report=<id>). Returns the same shape the SSE 'result' sends.
router.get('/analysis/:id', async (req, res) => {
  const a = await store.getJSON(analysisKey(req.params.id));
  if (!a) return res.status(404).json({ error: 'Report not found. It may have expired.' });
  res.json({
    analysisId: a.id,
    sections: a.sections,
    modelUsed: a.modelUsed,
    domain: a.domain,
    usesHubSpot: a.usesHubSpot,
    companyLogoUrl: a.companyLogoUrl || '',
    person: a.enrichedPerson
      ? { firstName: a.enrichedPerson.firstName || '', title: a.enrichedPerson.title || '' }
      : null
  });
});

// Export the store accessor for the PDF + chat routes (async: returns a Promise)
router.getAnalysis = (id) => store.getJSON(analysisKey(id));

module.exports = router;
