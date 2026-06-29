const express = require('express');
const path = require('path');
const fs = require('fs');
const store = require('./utils/store');

const app = express();
const PORT = process.env.PORT || 3000;

// Process-level safety net. Without these, Node terminates the process on any
// unhandled promise rejection (e.g. a write to a socket the client already
// closed), which kills every in-flight analysis on the instance mid-stream.
process.on('unhandledRejection', (reason) => {
  console.error('[gtmos] Unhandled promise rejection:', reason && reason.stack ? reason.stack : reason);
});
const BENIGN_ERRORS = new Set(['EPIPE', 'ECONNRESET', 'ERR_STREAM_WRITE_AFTER_END', 'ERR_STREAM_DESTROYED']);
process.on('uncaughtException', (err) => {
  console.error('[gtmos] Uncaught exception:', err && err.stack ? err.stack : err);
  // A dead client socket must never take the whole server down. Anything else
  // leaves the process in an undefined state, so exit and let the platform
  // restart a clean instance.
  if (err && BENIGN_ERRORS.has(err.code)) return;
  process.exit(1);
});

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

// Health check. Surfaces the durable-store status so a degraded backend (Redis
// configured but down, or not configured at all) is visible instead of silent.
app.get('/health', (req, res) => {
  const redis = store.health();
  const degraded = redis.configured && !redis.ready;
  res.json({
    status: degraded ? 'degraded' : 'ok',
    store: redis.configured ? (redis.ready ? 'redis' : 'redis-unavailable') : 'memory',
    timestamp: new Date().toISOString()
  });
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

// Final error handler: turn a thrown/next(err) route error into a clean response
// instead of a hung request or a process-killing throw. SSE responses may already
// be streaming, so only write if the headers haven't gone out yet.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[gtmos] Request error:', err && err.stack ? err.stack : err);
  if (res.headersSent) {
    try { res.end(); } catch (_) { /* socket already gone */ }
    return;
  }
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`GTM OS server running on port ${PORT}`);
});
