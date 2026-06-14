const SUBPAGES = ['/about', '/products', '/solutions', '/customers', '/pricing', '/services', '/platform'];

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SmokesignalsBot/2.0)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;
    return res.text();
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

  return meta;
}

// HubSpot leaves an unmistakable footprint in a site's source (tracking script,
// forms, CTAs). Detecting it from the raw HTML is instant and deterministic.
const HUBSPOT_SIGNATURES = [
  'js.hs-scripts.com', 'hs-scripts', 'js.hsforms.net', 'hsforms.net', 'hsforms.com',
  'hs-analytics.net', 'hs-banner.com', 'hubspotusercontent', 'hscollectedforms',
  'track.hubspot.com', 'cdn2.hubspot.net', 'hbspt.', '_hsenc', 'api.hubapi.com',
  'hsleadflows', 'forms.hsforms'
];

function detectHubSpot(htmls) {
  const hay = htmls.filter(Boolean).join(' ').toLowerCase();
  return HUBSPOT_SIGNATURES.some(sig => hay.includes(sig));
}

async function scrapeWebsite(websiteUrl) {
  const pages = {};
  const rawHtmls = [];

  // Fetch homepage first
  const homepageHtml = await fetchPage(websiteUrl);
  if (homepageHtml) rawHtmls.push(homepageHtml);
  const homeMeta = extractMeta(homepageHtml);
  pages.homepage = {
    url: websiteUrl,
    title: homeMeta.title || '',
    description: homeMeta.description || homeMeta.ogDescription || '',
    content: extractText(homepageHtml)
  };

  // Fetch subpages in parallel
  const subpagePromises = SUBPAGES.map(async (path) => {
    const url = websiteUrl.replace(/\/$/, '') + path;
    const html = await fetchPage(url);
    if (html) rawHtmls.push(html);
    if (!html) return null;
    const meta = extractMeta(html);
    const content = extractText(html);
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

  // Detect HubSpot from the raw source (before scripts are stripped for text).
  const usesHubSpot = detectHubSpot(rawHtmls);
  console.log('[gtmos] scrape:', { url: websiteUrl, pages: 1 + pages.subpages.length, usesHubSpot });

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
    pagesScraped: 1 + pages.subpages.length,
    usesHubSpot
  };
}

module.exports = { scrapeWebsite };
