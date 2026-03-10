const express = require('express');
const { buildPdfHtml } = require('../services/pdf');

const router = express.Router();

let getAnalysis = null;

router.setAnalysisStore = (fn) => {
  getAnalysis = fn;
};

router.get('/pdf/:id', async (req, res) => {
  const { id } = req.params;

  if (!getAnalysis) {
    return res.status(500).json({ error: 'PDF service not initialized' });
  }

  const analysis = getAnalysis(id);
  if (!analysis) {
    return res.status(404).json({ error: 'Analysis not found. It may have expired.' });
  }

  try {
    const html = buildPdfHtml(analysis);
    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: 'Failed to generate report. Please try again.' });
  }
});

module.exports = router;
