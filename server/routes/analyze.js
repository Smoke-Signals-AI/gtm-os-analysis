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

// Conservatively derive a first name from an email local-part for light
// personalization. Returns '' for role/generic inboxes or anything that does
// not clearly look like a person's name, so we never greet "Info" or "Sales".
const ROLE_LOCALPARTS = new Set([
  'info', 'sales', 'hello', 'hi', 'hey', 'team', 'support', 'contact', 'admin',
  'marketing', 'careers', 'jobs', 'press', 'media', 'help', 'billing', 'accounts',
  'account', 'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'office', 'mail',
  'inbox', 'gtm', 'growth', 'revops', 'founders', 'founder', 'ceo', 'ar', 'ap',
  'legal', 'hr', 'it', 'dev', 'eng', 'engineering', 'partnerships', 'partners',
  'events', 'community', 'newsletter', 'notifications', 'security', 'privacy',
  'abuse', 'postmaster', 'webmaster', 'enquiries', 'inquiries', 'ask', 'connect',
  'general', 'main', 'service', 'services', 'order', 'orders', 'feedback', 'demo',
  'book', 'meet', 'biz', 'business', 'welcome', 'signup', 'subscribe'
]);

function guessFirstNameFromEmail(email) {
  if (!email || typeof email !== 'string') return '';
  let local = email.split('@')[0].toLowerCase().trim();
  local = local.split('+')[0]; // strip +tag
  if (!local || ROLE_LOCALPARTS.has(local)) return '';
  const first = local.split(/[._\-]+/).filter(Boolean)[0] || '';
  if (ROLE_LOCALPARTS.has(first)) return '';
  if (!/^[a-z]{2,12}$/.test(first)) return ''; // must read like a name, not an initial or handle
  return first.charAt(0).toUpperCase() + first.slice(1);
}

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
        return { raw: `Company website: ${websiteUrl}\nDomain: ${domain}\n(Website content could not be fully retrieved)`, meta: {}, pagesScraped: 0, usesHubSpot: false };
      })
    ]);

    const { contactId, linkedinPosts, jobPostings, companyProfile, decisionMakers } = enrichmentResult;
    let enrichedPerson = enrichmentResult.enrichedPerson;

    // If enrichment yielded no first name, conservatively guess one from the
    // email local-part. Skips role/generic inboxes (info@, sales@, ...).
    if (!enrichedPerson || !enrichedPerson.firstName) {
      const guessed = guessFirstNameFromEmail(email);
      if (guessed) {
        enrichedPerson = Object.assign({}, enrichedPerson, { firstName: guessed });
        console.log('[gtmos] guessed first name from email local-part:', guessed);
      }
    }

    // Tier off HubSpot detected in the site source (the BuiltWith endpoint is gone).
    const usesHubSpot = Boolean(scrapeResult.usesHubSpot);
    const execPostCount = Array.isArray(decisionMakers) ? decisionMakers.reduce((n, d) => n + (Array.isArray(d.posts) ? d.posts.length : 0), 0) : 0;
    console.log('[gtmos] summary:', { usesHubSpot, posts: Array.isArray(linkedinPosts) ? linkedinPosts.length : 0, jobs: Array.isArray(jobPostings) ? jobPostings.length : 0, company: (companyProfile && companyProfile.name) || 'none', logo: !!(companyProfile && companyProfile.logoUrl), decisionMakers: Array.isArray(decisionMakers) ? decisionMakers.length : 0, execPosts: execPostCount });

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
    const companyName = (companyProfile && companyProfile.name) || scrapeResult.siteName || (enrichedPerson && enrichedPerson.company) || domain;

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
        decisionMakers,
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
      companyName,
      enrichedPerson,
      jobPostingsCount: Array.isArray(jobPostings) ? jobPostings.length : 0,
      postsCount: Array.isArray(linkedinPosts) ? linkedinPosts.length : 0,
      createdAt: new Date().toISOString()
    };
    await store.setJSON(analysisKey(analysisId), storedAnalysis);

    // Shareable results URL for this report (also written to HubSpot below so
    // the link to the visitor's results lives on their contact record).
    const reportUrl = `${req.protocol}://${req.get('host')}/?report=${encodeURIComponent(analysisId)}`;

    // Push to HubSpot (non-blocking)
    if (contactId) {
      hubspot.pushAnalysisToContact(contactId, {
        websiteUrl,
        reportUrl,
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
      companyName,
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

  // Round 1 (parallel): CRM lookup, LinkedIn profile from the email, and the
  // company resolved straight from the website domain (independent of the person).
  const [existingContact, linkedinProfile, resolvedCompany] = await Promise.all([
    hubspot.searchContactByEmail(email).catch(err => {
      console.warn('HubSpot search error:', err.message);
      return null;
    }),
    anysite.enrichPersonByEmail(email).catch(() => null),
    anysite.resolveCompanyByDomain(domain).catch(() => null)
  ]);

  // Merge CRM + LinkedIn. Prefer known CRM names; keep the LinkedIn profile URN
  // and company URN (the CRM lacks them) so we can pull posts, the logo, and jobs.
  if (existingContact || linkedinProfile) {
    const cp = existingContact && existingContact.properties ? existingContact.properties : {};
    enrichedPerson = {
      firstName: cp.firstname || (linkedinProfile && linkedinProfile.firstName) || '',
      lastName: cp.lastname || (linkedinProfile && linkedinProfile.lastName) || '',
      title: cp.jobtitle || (linkedinProfile && linkedinProfile.title) || '',
      company: cp.company || (linkedinProfile && linkedinProfile.company) || '',
      companyUrn: (linkedinProfile && linkedinProfile.companyUrn) || '',
      profileUrn: (linkedinProfile && linkedinProfile.profileUrn) || '',
      linkedinUrl: (linkedinProfile && linkedinProfile.linkedinUrl) || cp.linkedin_url || '',
      headline: (linkedinProfile && linkedinProfile.headline) || ''
    };
  }

  // Person fallback: if email lookup gave no profile URN, search by guessed
  // first name + resolved company so we can still pull the reader's posts.
  if (!(enrichedPerson && enrichedPerson.profileUrn)) {
    const guessedFirst = guessFirstNameFromEmail(email);
    const coName = (resolvedCompany && resolvedCompany.name) || (enrichedPerson && enrichedPerson.company) || '';
    if (guessedFirst && coName) {
      const found = await anysite.searchPerson(guessedFirst, coName).catch(() => null);
      if (found && found.profileUrn) {
        enrichedPerson = enrichedPerson || { firstName: '', lastName: '', title: '', company: coName, companyUrn: '', linkedinUrl: '', headline: '' };
        enrichedPerson.profileUrn = found.profileUrn;
        if (!enrichedPerson.firstName) enrichedPerson.firstName = found.firstName || guessedFirst;
        if (!enrichedPerson.lastName) enrichedPerson.lastName = found.lastName || '';
        if (!enrichedPerson.headline) enrichedPerson.headline = found.headline || '';
        if (!enrichedPerson.linkedinUrl) enrichedPerson.linkedinUrl = found.linkedinUrl || '';
        if (!enrichedPerson.company) enrichedPerson.company = coName;
      }
    }
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

  // Round 2 (parallel): the reader's recent posts (by profile URN) + the
  // company's LinkedIn profile (for logo, name, and the company URN). The company
  // identifier comes from the domain resolution first, then the person.
  sendProgress('signals', 'Reading your public signals...');
  const companyId = (resolvedCompany && (resolvedCompany.alias || resolvedCompany.urn || resolvedCompany.url || resolvedCompany.name))
    || (enrichedPerson && (enrichedPerson.companyUrn || enrichedPerson.company))
    || domain;
  let [linkedinPosts, companyProfile] = await Promise.all([
    anysite.getLinkedInPosts(enrichedPerson && enrichedPerson.profileUrn, 20).catch(() => []),
    anysite.getCompanyProfile(companyId).catch(() => null)
  ]);

  // If the full profile failed but we resolved a company, keep its name + URN.
  if (!companyProfile && resolvedCompany && (resolvedCompany.name || resolvedCompany.urn)) {
    companyProfile = {
      name: resolvedCompany.name, logoUrl: '', urn: resolvedCompany.urn,
      website: resolvedCompany.url, industry: '', employeeCount: '', description: '', headquarters: ''
    };
  }

  const companyUrn = (companyProfile && companyProfile.urn) || (resolvedCompany && resolvedCompany.urn) || (enrichedPerson && enrichedPerson.companyUrn) || '';
  const companyName = (companyProfile && companyProfile.name) || (resolvedCompany && resolvedCompany.name) || '';

  // Round 3 (parallel): open jobs + the company's buying committee.
  const [jobPostings, execs] = await Promise.all([
    companyUrn ? anysite.getCompanyJobs(companyUrn, 15).catch(() => []) : Promise.resolve([]),
    (companyUrn || companyName) ? anysite.getCompanyDecisionMakers(companyUrn, companyName, 12).catch(() => []) : Promise.resolve([])
  ]);

  // Identify the reader among the execs (by URN or full name) so we never quote
  // them as a third-person "decision-maker" and can recover their own posts.
  const readerUrn = enrichedPerson && enrichedPerson.profileUrn;
  const readerName = enrichedPerson ? `${enrichedPerson.firstName || ''} ${enrichedPerson.lastName || ''}`.trim().toLowerCase() : '';
  const isReader = (e) => (readerUrn && e.profileUrn === readerUrn) ||
    (readerName && readerName.includes(' ') && e.name && e.name.trim().toLowerCase() === readerName);

  const readerExec = execs.find(isReader);
  const otherExecs = execs.filter(e => e.profileUrn && !isReader(e)).slice(0, 3);

  const decisionMakers = await Promise.all(otherExecs.map(async (e) => ({
    name: e.name,
    headline: e.headline,
    posts: await anysite.getLinkedInPosts(e.profileUrn, 10).catch(() => [])
  })));

  // If the reader showed up as an exec and we have no reader posts yet, pull theirs
  // (so their own words are attributed in the first person, not as "your CEO").
  let readerPosts = linkedinPosts;
  if ((!readerPosts || !readerPosts.length) && readerExec && readerExec.profileUrn) {
    readerPosts = await anysite.getLinkedInPosts(readerExec.profileUrn, 20).catch(() => []);
    if (enrichedPerson) {
      enrichedPerson.profileUrn = enrichedPerson.profileUrn || readerExec.profileUrn;
      if (!enrichedPerson.headline) enrichedPerson.headline = readerExec.headline || '';
    }
  }

  return { contactId, enrichedPerson, linkedinPosts: readerPosts, jobPostings, companyProfile, decisionMakers };
}

// Shape a stored analysis into the client render payload (the same shape the
// SSE 'result' event sends). Shared by the GET and unlock routes below.
function shapeAnalysisForClient(a) {
  return {
    analysisId: a.id,
    sections: a.sections,
    modelUsed: a.modelUsed,
    domain: a.domain,
    companyName: a.companyName || a.domain,
    usesHubSpot: a.usesHubSpot,
    companyLogoUrl: a.companyLogoUrl || '',
    person: a.enrichedPerson
      ? { firstName: a.enrichedPerson.firstName || '', title: a.enrichedPerson.title || '' }
      : null
  };
}

// The report payload is gated: it is served only through the email capture at
// POST /analysis/:id/unlock. A plain GET must never return report content, or
// anyone holding the link could skip the email step. We refuse it outright and
// do not look the id up, so this also never reveals whether an id exists.
// (Internal/team "Open their report" links are the /?report=<id> browser URL,
// which also routes through the email gate.)
router.get('/analysis/:id', (req, res) => {
  res.status(403).json({ error: 'This report is gated. Open the share link and enter an email to unlock it.' });
});

// Unlock a shared report. A visitor following someone's share link enters their
// email here; we capture them in HubSpot as a shared-report lead (best-effort,
// non-blocking) and return the report so the frontend can render it.
router.post('/analysis/:id/unlock', async (req, res) => {
  const { id } = req.params;
  const email = (req.body && req.body.email ? String(req.body.email) : '').trim();

  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const a = await store.getJSON(analysisKey(id));
  if (!a) return res.status(404).json({ error: 'Report not found. It may have expired.' });

  // Capture the viewer in HubSpot. ensureProperties first so the attribution
  // properties exist (idempotent), then upsert. Non-blocking: a CRM hiccup must
  // never keep someone from reading a report that was shared with them.
  const reportUrl = `${req.protocol}://${req.get('host')}/?report=${encodeURIComponent(id)}`;
  hubspot.ensureProperties()
    .then(() => hubspot.recordSharedReportView({ email, reportUrl }))
    .catch(err => console.warn('Shared report capture error:', err.message));

  res.json(shapeAnalysisForClient(a));
});

// Export the store accessor for the PDF + chat routes (async: returns a Promise)
router.getAnalysis = (id) => store.getJSON(analysisKey(id));

module.exports = router;
