const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
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

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
const analyzeRouter = require('./routes/analyze');
const pdfRouter = require('./routes/pdf');
const surveyRouter = require('./routes/survey');

// Wire up the analysis store to the PDF router
pdfRouter.setAnalysisStore(analyzeRouter.getAnalysis);

app.use('/api', analyzeRouter);
app.use('/api', pdfRouter);
app.use('/api', surveyRouter);

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`GTM OS server running on port ${PORT}`);
});
