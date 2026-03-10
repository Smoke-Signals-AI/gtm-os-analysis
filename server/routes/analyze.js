const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { validateEmail, sanitizeUrl, extractDomain } = require('../utils/validation');
const { checkRateLimit } = require('../utils/cache');
const hubspot = require('../services/hubspot');
const anysite = require('../services/anysite');
const scraper = require('../services/scraper');
const anthropic = require('../services/anthropic');

const router = express.Router();

// In-memory store for analysis results (for PDF retrieval)
const analysisStore = new Map();

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

  // Set up SSE for progress updates
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  function sendProgress(stage, message) {
    res.write(`data: ${JSON.stringify({ type: 'progress', stage, message })}\n\n`);
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

    // PARALLEL: Workstream A (enrichment + CRM) and Workstream B (website scraping)
    sendProgress('research', 'Analyzing your website...');

    const [enrichmentResult, scrapeResult] = await Promise.all([
      runWorkstreamA(email, domain, sendProgress),
      scraper.scrapeWebsite(websiteUrl).catch(err => {
        console.error('Scraping error:', err.message);
        return { raw: `Company website: ${websiteUrl}\nDomain: ${domain}\n(Website content could not be fully retrieved)`, meta: {}, pagesScraped: 0 };
      })
    ]);

    sendProgress('enrichment', 'Research complete. Building your signal strategy...');

    const { contactId, enrichedPerson, usesHubSpot } = enrichmentResult;

    // Step B2: AI Analysis (depends on BuiltWith result for model selection)
    sendProgress('analysis', usesHubSpot
      ? 'Deploying premium analysis engine...'
      : 'Generating your custom signal strategy...');

    let analysis;
    try {
      analysis = await anthropic.generateAnalysis({
        websiteResearch: scrapeResult.raw,
        domain,
        usesHubSpot,
        enrichedPerson
      });
    } catch (err) {
      console.error('Anthropic API error:', err.message);
      sendError('We are experiencing high demand. Your analysis is being queued. We will email you when it is ready.');
      return;
    }

    sendProgress('saving', 'Finalizing your report...');

    // Store analysis for PDF generation
    const storedAnalysis = {
      id: analysisId,
      email,
      websiteUrl,
      domain,
      sections: analysis.sections,
      fullText: analysis.fullText,
      modelUsed: analysis.modelUsed,
      usesHubSpot,
      enrichedPerson,
      createdAt: new Date().toISOString()
    };
    analysisStore.set(analysisId, storedAnalysis);

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
      usesHubSpot
    });

  } catch (err) {
    console.error('Analysis pipeline error:', err);
    sendError('Something went wrong during analysis. Please try again.');
  }
});

async function runWorkstreamA(email, domain, sendProgress) {
  let contactId = null;
  let enrichedPerson = null;
  let usesHubSpot = false;

  // Run HubSpot contact search and BuiltWith check in parallel
  const [existingContact, builtWithResult] = await Promise.all([
    hubspot.searchContactByEmail(email).catch(err => {
      console.warn('HubSpot search error:', err.message);
      return null;
    }),
    anysite.checkBuiltWith(domain).catch(err => {
      console.warn('BuiltWith error:', err.message);
      return { usesHubSpot: false, technologies: [] };
    })
  ]);

  usesHubSpot = builtWithResult.usesHubSpot;

  if (existingContact) {
    contactId = existingContact.id;
    enrichedPerson = {
      firstName: existingContact.properties?.firstname || '',
      lastName: existingContact.properties?.lastname || '',
      title: existingContact.properties?.jobtitle || '',
      company: existingContact.properties?.company || ''
    };
    sendProgress('crm', 'Found your profile...');
  } else {
    // Enrich via Anysite then create in HubSpot
    sendProgress('enrichment', 'Researching your competitive landscape...');
    enrichedPerson = await anysite.enrichPersonByEmail(email).catch(() => null);

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

  return { contactId, enrichedPerson, usesHubSpot };
}

// Export the store for the PDF route
router.getAnalysis = (id) => analysisStore.get(id);

module.exports = router;
