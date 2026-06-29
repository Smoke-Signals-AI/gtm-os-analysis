const express = require('express');
const { buildPdfHtml } = require('../services/pdf');
const store = require('../utils/store');

const router = express.Router();

let getAnalysis = null;

router.setAnalysisStore = (fn) => {
  getAnalysis = fn;
};

// This route opens in a browser tab, so failures must render as a readable page,
// never a raw JSON 500 blob.
function errorPage(title, message, status) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: #f4f5f7; color: #1b1e25; margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #fff; border: 1px solid #e2e5ea; border-radius: 14px;
    padding: 36px 40px; max-width: 460px; text-align: center;
    box-shadow: 0 1px 3px rgba(0,0,0,.04); }
  h1 { font-size: 1.25rem; margin: 0 0 10px; letter-spacing: -0.01em; }
  p { color: #69707d; margin: 0 0 20px; line-height: 1.55; }
  a { display: inline-block; background: #16181d; color: #fff; text-decoration: none;
    font-weight: 600; font-size: .9rem; padding: 10px 20px; border-radius: 8px; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p>
<a href="/">Back to GTM OS</a></div></body></html>`;
}

router.get('/pdf/:id', async (req, res) => {
  const { id } = req.params;

  if (!getAnalysis) {
    return res.status(503).type('html').send(errorPage(
      'One moment', 'The report service is starting up. Please try again in a few seconds.'));
  }

  // Per-IP throttle: the route is unauthenticated and regenerates HTML on demand.
  if (!(await store.checkRateLimit('pdf:' + (req.ip || 'anon'), 40, 3600))) {
    return res.status(429).type('html').send(errorPage(
      'Too many requests', 'You have opened a lot of reports in a short window. Please wait a few minutes and try again.'));
  }

  let analysis = null;
  try {
    analysis = await getAnalysis(id);
  } catch (err) {
    console.error('PDF store lookup error:', err.message);
  }

  if (!analysis) {
    return res.status(404).type('html').send(errorPage(
      'Report not found',
      'We could not find this report. Shared links expire, and reports are cleared when the service restarts. Generate a fresh analysis to get a new one.'));
  }

  try {
    const html = buildPdfHtml(analysis);
    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).type('html').send(errorPage(
      'Could not build your PDF',
      'Something went wrong rendering this report. Please try again, and contact us if it keeps happening.'));
  }
});

module.exports = router;
