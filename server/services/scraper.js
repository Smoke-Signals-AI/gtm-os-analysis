const firecrawl = require('./firecrawl');

const SUBPAGES = ['/about', '/products', '/solutions', '/customers', '/pricing', '/services', '/platform', '/contact'];

// A real browser UA: the old self-identifying bot UA was exactly what
// bot-blockers filter, which failed the scrape AND defaulted the HubSpot
// detection to false.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Returns { html, headers } or null. headers is the (lowercased-key) subset we
// inspect; HubSpot-CMS-hosted sites identify themselves in response headers.
async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;
    return {
      html: await res.text(),
      headers: {
        'x-powered-by': res.headers.get('x-powered-by') || '',
        'server': res.headers.get('server') || ''
      }
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractText(html) {
  if (!html) return '';
  // Remove scripts, styles, nav, footer, header tags
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 15000);
}

function extractMeta(html) {
  if (!html) return {};
  const meta = {};
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch) meta.title = titleMatch[1].trim();

  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (descMatch) meta.description = descMatch[1].trim();

  const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  if (ogDescMatch) meta.ogDescription = ogDescMatch[1].trim();

  // og:site_name is usually the clean brand name, a good company-name fallback.
  const ogSiteMatch = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i);
  if (ogSiteMatch) meta.siteName = ogSiteMatch[1].trim();

  return meta;
}

// ---------------------------------------------------------------------------
// HubSpot detection.
//
// Tiered, so a blog post ABOUT HubSpot can't buy a false positive:
//   1. Portal-id patterns (definitive): the tracking loader / forms embed carry
//      the account's portal id. Can't appear by accident in prose, and the id
//      itself is a useful CRM signal.
//   2. Response headers (definitive): HubSpot-CMS-hosted sites answer with
//      x-powered-by: HubSpot.
//   3. HubSpot resources in src/href attributes (strong): actual loaded assets,
//      not text content.
//   4. GTM container (strong): sites that load HubSpot via Google Tag Manager
//      show no HubSpot markup in raw HTML; the public gtm.js container script
//      does, so fetch and scan it.
// A bare mention of a hubspot domain in page text no longer counts.
// ---------------------------------------------------------------------------

const PORTAL_ID_PATTERNS = [
  /js\.hs-scripts\.com\/(\d{4,12})\.js/i,                    // standard tracking loader
  /js\.hs-analytics\.net\/analytics\/\d+\/(\d{4,12})\.js/i,  // analytics runtime
  /js\.hsforms\.net\/forms\/embed\/(\d{4,12})\.js/i,         // v4 forms embed
  /portalId["']?\s*[:=]\s*["']?(\d{4,12})/                   // hbspt.forms/meetings config
];

// HubSpot-owned hosts referenced as actual assets/links (src/href/url()).
const ATTR_SIGNATURE = /(?:src|href|url\()\s*=?\s*["']?(?:https?:)?\/\/[^"'\s)]*(?:hs-scripts\.com|hsforms\.(?:net|com)|hs-analytics\.net|hs-banner\.com|hscollectedforms\.net|hubspotusercontent[\w.-]*\.(?:net|com)|cdn2\.hubspot\.net|track\.hubspot\.com|hsleadflows\.net|js\.hubspot\.com)/i;

const GTM_ID_PATTERN = /GTM-[A-Z0-9]{4,10}/;

// Pure check over already-fetched pages. `pages` is [{ html, headers }].
// Returns { found, portalId, evidence }.
function detectHubSpot(pages) {
  const evidence = [];
  let portalId = '';

  for (const page of pages.filter(Boolean)) {
    const html = page.html || '';

    for (const pattern of PORTAL_ID_PATTERNS) {
      const m = html.match(pattern);
      if (m) {
        portalId = portalId || m[1];
        if (!evidence.some(e => e.startsWith('portal-id'))) {
          evidence.push(`portal-id:${m[1]}`);
        }
      }
    }

    const poweredBy = (page.headers && page.headers['x-powered-by']) || '';
    if (/hubspot/i.test(poweredBy) && !evidence.includes('x-powered-by-header')) {
      evidence.push('x-powered-by-header');
    }

    if (ATTR_SIGNATURE.test(html) && !evidence.includes('asset-reference')) {
      evidence.push('asset-reference');
    }
  }

  return { found: evidence.length > 0, portalId, evidence };
}

// When raw HTML shows GTM but no HubSpot, fetch the public GTM container
// script and scan it: tag-manager-injected HubSpot lives there.
async function checkGtmContainer(htmls) {
  const combined = htmls.filter(Boolean).join(' ');
  const gtmMatch = combined.match(GTM_ID_PATTERN);
  if (!gtmMatch) return null;
  const gtmId = gtmMatch[0];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`https://www.googletagmanager.com/gtm.js?id=${gtmId}`, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const js = await res.text();
    const result = detectHubSpot([{ html: js, headers: {} }]);
    if (result.found) {
      return { portalId: result.portalId, evidence: [`gtm-container:${gtmId}`, ...result.evidence] };
    }
    return null;
  } catch {
    return null;
  }
}

// Full detection pass over fetched pages + GTM follow-up. Shared by
// scrapeWebsite and the standalone probe used for regrades.
async function resolveHubSpot(pages) {
  const direct = detectHubSpot(pages);
  if (direct.found) {
    return { usesHubSpot: true, portalId: direct.portalId, evidence: direct.evidence };
  }
  const viaGtm = await checkGtmContainer(pages.filter(Boolean).map(p => p.html));
  if (viaGtm) {
    return { usesHubSpot: true, portalId: viaGtm.portalId, evidence: viaGtm.evidence };
  }
  return { usesHubSpot: false, portalId: '', evidence: [] };
}

// Standalone probe for one site (used by scripts/regrade-hubspot-detection.js).
// Fetches the homepage and /contact (where forms usually live), falls back to
// Firecrawl when nothing loads, follows GTM. Returns { checked, usesHubSpot,
// portalId, evidence } — checked=false means the site couldn't be reached at
// all, so callers must NOT treat it as a negative.
async function probeHubSpot(websiteUrl) {
  const base = websiteUrl.replace(/\/$/, '');
  const pages = (await Promise.all([fetchPage(base), fetchPage(base + '/contact')])).filter(Boolean);

  if (!pages.length && firecrawl.isConfigured()) {
    const fc = await firecrawl.scrapeUrl(websiteUrl);
    if (fc && fc.html) pages.push({ html: fc.html, headers: {} });
  }

  if (!pages.length) {
    return { checked: false, usesHubSpot: false, portalId: '', evidence: [] };
  }
  const result = await resolveHubSpot(pages);
  return { checked: true, ...result };
}

// Derive a clean company/brand name from the page <title>. "Smoke Signals | The
// GTM OS" -> "Smoke Signals". A reliable, zero-dependency fallback for the title.
function cleanCompanyName(title) {
  if (!title) return '';
  const parts = String(title).split(/\s*[|–—·:]\s*|\s+[-]\s+/)
    .map(s => s.trim()).filter(Boolean);
  if (!parts.length) return '';
  const generic = /^(home|welcome|homepage|official site|loading|untitled)$/i;
  let name = parts.find(p => !generic.test(p) && p.length <= 40) || parts[0];
  name = name.replace(/\s+/g, ' ').trim();
  // Reject sentence-like results (likely a tagline, not a brand).
  if (!name || name.length > 50 || name.split(' ').length > 6) return '';
  return name;
}

async function scrapeWebsite(websiteUrl) {
  const pages = {};
  const fetched = []; // [{ html, headers }] for detection

  // Fetch homepage first
  let homepage = await fetchPage(websiteUrl);
  if (homepage) fetched.push(homepage);
  let homeMeta = extractMeta(homepage && homepage.html);
  let homeContent = extractText(homepage && homepage.html);

  // Thin-scrape fallback: bot walls and client-rendered SPAs return nothing or
  // a near-empty shell. Firecrawl renders the page in a real browser, which
  // recovers both the research text and the detection surface.
  let usedFirecrawl = false;
  if ((!homepage || homeContent.length < 500) && firecrawl.isConfigured()) {
    const fc = await firecrawl.scrapeUrl(websiteUrl);
    if (fc && (fc.html || fc.markdown)) {
      usedFirecrawl = true;
      if (fc.html) fetched.push({ html: fc.html, headers: {} });
      if (!homeContent || homeContent.length < 500) {
        homeContent = (fc.markdown || extractText(fc.html)).slice(0, 15000);
      }
      if (!homeMeta.title && fc.meta) {
        homeMeta = {
          title: fc.meta.title || '',
          description: fc.meta.description || '',
          ogDescription: fc.meta.ogDescription || '',
          siteName: fc.meta.ogSiteName || ''
        };
      }
    }
  }

  pages.homepage = {
    url: websiteUrl,
    title: homeMeta.title || '',
    description: homeMeta.description || homeMeta.ogDescription || '',
    content: homeContent
  };

  // Fetch subpages in parallel
  const subpagePromises = SUBPAGES.map(async (path) => {
    const url = websiteUrl.replace(/\/$/, '') + path;
    const page = await fetchPage(url);
    if (!page) return null;
    fetched.push(page);
    const meta = extractMeta(page.html);
    const content = extractText(page.html);
    if (content.length < 100) return null;
    return {
      path,
      url,
      title: meta.title || '',
      content
    };
  });

  const subResults = await Promise.all(subpagePromises);
  pages.subpages = subResults.filter(Boolean);

  // Detect HubSpot from the raw sources + response headers (+ GTM follow-up).
  const hubspot = await resolveHubSpot(fetched);
  console.log('[gtmos] scrape:', {
    url: websiteUrl,
    pages: (homepage || usedFirecrawl ? 1 : 0) + pages.subpages.length,
    firecrawl: usedFirecrawl,
    usesHubSpot: hubspot.usesHubSpot,
    portalId: hubspot.portalId || null,
    evidence: hubspot.evidence
  });

  // Compile into a research document
  let research = `# Website Analysis: ${websiteUrl}\n\n`;
  research += `## Homepage\n`;
  if (pages.homepage.title) research += `Title: ${pages.homepage.title}\n`;
  if (pages.homepage.description) research += `Description: ${pages.homepage.description}\n`;
  research += `\n${pages.homepage.content}\n\n`;

  for (const sub of pages.subpages) {
    research += `## ${sub.path.replace('/', '').charAt(0).toUpperCase() + sub.path.slice(2)} Page\n`;
    if (sub.title) research += `Title: ${sub.title}\n`;
    research += `\n${sub.content}\n\n`;
  }

  return {
    raw: research.slice(0, 50000),
    meta: homeMeta,
    pagesScraped: (homepage || usedFirecrawl ? 1 : 0) + pages.subpages.length,
    usesHubSpot: hubspot.usesHubSpot,
    hubspotPortalId: hubspot.portalId,
    hubspotEvidence: hubspot.evidence,
    siteName: homeMeta.siteName || cleanCompanyName(homeMeta.title)
  };
}

module.exports = { scrapeWebsite, probeHubSpot, detectHubSpot };
