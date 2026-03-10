function buildPdfHtml(analysisData) {
  const { sections, domain, websiteUrl } = analysisData;

  const sectionEntries = [
    { num: '01', title: 'ICP Profile', content: sections.icpProfile },
    { num: '02', title: 'Unique Selling Proposition Analysis', content: sections.uspAnalysis },
    { num: '03', title: 'Custom Alpha Signal + Interactive App Concept', content: sections.alphaSignal },
    { num: '04', title: 'Outbound Sequence Concept', content: sections.outboundSequence },
    { num: '05', title: 'Content + LinkedIn Plan', content: sections.contentStrategy }
  ];

  const sectionsHtml = sectionEntries.map(s => `
    <div class="section">
      <div class="section-header">
        <span class="section-num">${s.num}</span>
        <span class="section-rule"></span>
        <span class="section-title">${s.title.toUpperCase()}</span>
      </div>
      <div class="section-body">${formatContentForPdf(s.content || '')}</div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>GTM Intelligence Report — ${escapeHtml(domain || '')}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #2D2D2D;
    background: #FFFFFF;
    padding: 48px 56px;
  }

  .print-btn {
    position: fixed;
    top: 20px;
    right: 20px;
    font-family: Inter, sans-serif;
    font-size: 13px;
    font-weight: 600;
    background: #E85D50;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 10px 20px;
    cursor: pointer;
  }

  .print-btn:hover { background: #D14D41; }

  .cover {
    text-align: center;
    padding: 60px 0 40px;
    border-bottom: 2px solid #E85D50;
    margin-bottom: 40px;
  }

  .cover h1 {
    font-family: Inter, sans-serif;
    font-weight: 800;
    font-size: 28pt;
    color: #1A1A1A;
    letter-spacing: -0.02em;
    margin-bottom: 8px;
  }

  .cover .subtitle {
    font-family: Inter, sans-serif;
    font-size: 10pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6B6B6B;
  }

  .cover .domain {
    font-family: Inter, sans-serif;
    font-weight: 600;
    font-size: 14pt;
    color: #E85D50;
    margin-top: 12px;
  }

  .intro {
    font-style: italic;
    font-size: 11pt;
    line-height: 1.7;
    color: #6B6B6B;
    margin-bottom: 40px;
    padding: 0 20px;
    max-width: 680px;
    margin-left: auto;
    margin-right: auto;
  }

  .section {
    margin-bottom: 36px;
    max-width: 780px;
    margin-left: auto;
    margin-right: auto;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }

  .section-num {
    font-family: Inter, sans-serif;
    font-weight: 800;
    font-size: 18pt;
    color: #E85D50;
  }

  .section-rule {
    flex: 1;
    height: 1px;
    background: #E5E5E5;
  }

  .section-title {
    font-family: Inter, sans-serif;
    font-weight: 700;
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #1A1A1A;
  }

  .section-body {
    font-size: 11pt;
    line-height: 1.65;
  }

  .section-body p { margin-bottom: 10px; }

  .section-body h3, .section-body h4 {
    font-family: Inter, sans-serif;
    font-weight: 700;
    color: #1A1A1A;
    margin: 16px 0 8px;
  }

  .section-body h3 { font-size: 12pt; }
  .section-body h4 { font-size: 10pt; }

  .section-body ul, .section-body ol {
    margin: 8px 0 8px 20px;
  }

  .section-body li { margin-bottom: 4px; }
  .section-body strong { color: #1A1A1A; }

  .section-body blockquote {
    border-left: 3px solid #E85D50;
    padding: 8px 16px;
    margin: 12px 0;
    font-style: italic;
    color: #6B6B6B;
  }

  .footer {
    margin-top: 48px;
    padding-top: 16px;
    border-top: 1px solid #E5E5E5;
    font-family: Inter, sans-serif;
    font-size: 8pt;
    color: #6B6B6B;
    text-align: center;
    max-width: 780px;
    margin-left: auto;
    margin-right: auto;
  }

  @media print {
    body { padding: 36px 48px; }
    .print-btn { display: none; }
    .section { page-break-inside: avoid; }
  }
</style>
</head>
<body>

<button class="print-btn" onclick="window.print()">Save as PDF</button>

<div class="cover">
  <div class="subtitle">GTM Intelligence Report</div>
  <h1>Smoke Signals AI</h1>
  <div class="domain">${escapeHtml(domain || websiteUrl)}</div>
</div>

<div class="intro">
  Alpha signals are the backbone of modern GTM. They are proprietary indicators of buying intent, detectable before competitors notice them, and deployable across every channel: outbound, content, LinkedIn, and sales enablement. This report identifies your highest-value signals and maps them to actionable programs.
</div>

${sectionsHtml}

<div class="footer">
  Prepared by Smoke Signals AI &bull; nick@smokesignals.ai &bull; smokesignals.ai
</div>

</body>
</html>`;
}

function formatContentForPdf(content) {
  if (!content) return '<p>Analysis pending.</p>';

  // Remove section header lines
  content = content.replace(/^##\s*Section\s*\d+[:\s].*$/gm, '');

  return content
    .split('\n')
    .map(line => {
      line = escapeHtml(line);
      if (/^#{3,4}\s/.test(line)) {
        const level = line.startsWith('####') ? 'h4' : 'h3';
        const text = line.replace(/^#{1,4}\s*/, '');
        return `<${level}>${text}</${level}>`;
      }
      if (/^[-*]\s/.test(line)) {
        return `<li>${line.replace(/^[-*]\s*/, '')}</li>`;
      }
      if (/^\d+\.\s/.test(line)) {
        return `<li>${line.replace(/^\d+\.\s*/, '')}</li>`;
      }
      if (line.startsWith('&gt; ')) {
        return `<blockquote>${line.replace(/^&gt;\s*/, '')}</blockquote>`;
      }
      if (line.trim() === '') return '';
      // Bold formatting
      line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      return `<p>${line}</p>`;
    })
    .join('\n')
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { buildPdfHtml };
