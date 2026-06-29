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
  .section-body a { color: #E85D50; text-decoration: underline; }

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

  // Replace the micro-app JSON spec with a readable summary instead of dumping
  // raw JSON into the PDF (Section 3 is otherwise a wall of escaped braces).
  let microHtml = '';
  content = content.replace(/```microapp\s*([\s\S]*?)```/i, (_, json) => {
    microHtml = renderMicroAppSummaryForPdf(json);
    return '\n';
  });
  // Drop any other stray code fences, keeping their inner text as plain lines
  // (a literal ``` would otherwise render as backticks).
  content = content.replace(/```[a-z0-9]*\s*([\s\S]*?)```/gi, '$1');

  // Remove section header lines
  content = content.replace(/^##\s*Section\s*\d+[:\s].*$/gm, '');

  // Inline formatting: links (quote -> source post) then bold. Runs on already
  // HTML-escaped text, so [text](url) survives and the url's & is &amp; (valid).
  const inline = (s) => s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Track list state so ordered lists stay <ol> (numbered) and separate lists
  // don't get fused into one by a post-hoc regex.
  const out = [];
  let listType = null; // 'ul' | 'ol' | null
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const openList = (type) => { if (listType !== type) { closeList(); out.push(`<${type}>`); listType = type; } };

  content.split('\n').forEach((raw) => {
    const line = escapeHtml(raw);
    if (/^#{3,4}\s/.test(line)) {
      closeList();
      const level = line.startsWith('####') ? 'h4' : 'h3';
      out.push(`<${level}>${inline(line.replace(/^#{1,4}\s*/, ''))}</${level}>`);
    } else if (/^[-*]\s/.test(line)) {
      openList('ul');
      out.push(`<li>${inline(line.replace(/^[-*]\s*/, ''))}</li>`);
    } else if (/^\d+\.\s/.test(line)) {
      openList('ol');
      out.push(`<li>${inline(line.replace(/^\d+\.\s*/, ''))}</li>`);
    } else if (line.startsWith('&gt; ')) {
      closeList();
      out.push(`<blockquote>${inline(line.replace(/^&gt;\s*/, ''))}</blockquote>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  });
  closeList();

  return out.join('\n') + microHtml;
}

// Turn the micro-app JSON spec into a short, readable block for the PDF: the
// concept's name, what it does, and what the prospect would answer.
function renderMicroAppSummaryForPdf(jsonStr) {
  let spec;
  try { spec = JSON.parse(String(jsonStr).trim()); } catch (e) { return ''; }
  if (!spec || typeof spec !== 'object') return '';

  let h = `<h4>${escapeHtml(spec.title || 'Interactive App Concept')}</h4>`;
  if (spec.tagline) h += `<p><em>${escapeHtml(spec.tagline)}</em></p>`;

  const inputs = Array.isArray(spec.inputs) ? spec.inputs : [];
  const labels = inputs.map(i => i && i.label).filter(Boolean);
  if (labels.length) {
    h += '<p><strong>What the prospect answers:</strong></p><ul>';
    labels.forEach(l => { h += `<li>${escapeHtml(l)}</li>`; });
    h += '</ul>';
  }
  if (spec.benchmark) {
    h += `<p>${escapeHtml(String(spec.benchmark).replace('{score}', 'their score'))}</p>`;
  }
  return h;
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
