const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Railway's TLS proxy: trust X-Forwarded-* so req.protocol is https.
app.set('trust proxy', true);

// Cache-bust assets per deploy: index.html references the CSS/JS with
// ?v=__ASSET_V__, replaced here with a per-boot version so each deploy always
// serves fresh CSS/JS (kills stale-asset confusion).
const ASSET_VERSION = Date.now().toString(36);
const INDEX_HTML = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8')
      .replace(/__ASSET_V__/g, ASSET_VERSION);
  } catch (e) {
    console.error('index.html load failed:', e.message);
    return '';
  }
})();

// Middleware. Capture the raw body so we can verify Slack request signatures.
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); }
}));
app.use(express.urlencoded({ extended: true }));

// CORS for the domain
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = [
    'https://gtmos.smokesignals.ai',
    'http://localhost:3000',
    'http://localhost:3001'
  ];
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Static files. no-cache = always revalidate via ETag, so a deploy's CSS/JS is
// never served stale (cheap 304s, avoids "is it deployed?" cache confusion).
app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: false, // serve index.html via the version-injected handler below
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
const analyzeRouter = require('./routes/analyze');
const pdfRouter = require('./routes/pdf');
const surveyRouter = require('./routes/survey');
const chatRouter = require('./routes/chat');

// Wire up the analysis store to the PDF + chat routers
pdfRouter.setAnalysisStore(analyzeRouter.getAnalysis);
chatRouter.setAnalysisStore(analyzeRouter.getAnalysis);

app.use('/api', analyzeRouter);
app.use('/api', pdfRouter);
app.use('/api', surveyRouter);
app.use('/api', chatRouter);

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  if (INDEX_HTML) return res.type('html').send(INDEX_HTML);
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`GTM OS server running on port ${PORT}`);
});
