// Firecrawl fallback scraper. Used only when the plain fetch comes back
// blocked or thin (bot walls, client-rendered SPAs): Firecrawl renders the
// page in a real browser, which also exposes tag-manager-injected scripts
// (e.g. HubSpot loaded through GTM) that raw HTML can't show.
//
// Optional integration: self-disables when FIRECRAWL_API_KEY is missing, so
// the app never depends on it to function.

const FIRECRAWL_API = 'https://api.firecrawl.dev/v1';

function isConfigured() {
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

// Render-scrape one URL. Returns { html, markdown, meta } or null.
// Never throws: a Firecrawl failure must degrade to the plain-fetch result,
// not break the analysis.
async function scrapeUrl(url) {
  if (!isConfigured()) return null;
  const timeoutMs = Number(process.env.FIRECRAWL_TIMEOUT_MS) || 30000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs + 5000);
  try {
    const res = await fetch(`${FIRECRAWL_API}/scrape`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        // rawHtml keeps script tags (needed for HubSpot detection); markdown is
        // the clean text for the research document. onlyMainContent would strip
        // the head/footer where tracking scripts live.
        formats: ['markdown', 'rawHtml'],
        onlyMainContent: false,
        timeout: timeoutMs
      }),
      signal: controller.signal
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.success === false || !body.data) {
      console.warn('[gtmos] firecrawl scrape failed:', res.status, (body && body.error) || '');
      return null;
    }
    return {
      html: body.data.rawHtml || '',
      markdown: body.data.markdown || '',
      meta: body.data.metadata || {}
    };
  } catch (err) {
    console.warn('[gtmos] firecrawl error:', err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { isConfigured, scrapeUrl };
