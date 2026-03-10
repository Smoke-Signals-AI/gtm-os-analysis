// ============================================
// GTM OS — Frontend Application
// ============================================

(function () {
  'use strict';

  // DOM Elements
  const heroScreen = document.getElementById('heroScreen');
  const loadingScreen = document.getElementById('loadingScreen');
  const errorScreen = document.getElementById('errorScreen');
  const resultsScreen = document.getElementById('resultsScreen');
  const analysisForm = document.getElementById('analysisForm');
  const emailInput = document.getElementById('email');
  const websiteInput = document.getElementById('website');
  const submitBtn = document.getElementById('submitBtn');
  const formError = document.getElementById('formError');
  const loadingStatus = document.getElementById('loadingStatus');
  const loadingSubstatus = document.getElementById('loadingSubstatus');
  const loadingBar = document.getElementById('loadingBar');
  const errorMessage = document.getElementById('errorMessage');
  const retryBtn = document.getElementById('retryBtn');
  const downloadPdfBtn = document.getElementById('downloadPdfBtn');
  const resultsDomain = document.getElementById('resultsDomain');

  // State
  let currentAnalysisId = null;
  let progressPercent = 0;

  // ---------- Screen Management ----------
  function showScreen(screen) {
    heroScreen.style.display = 'none';
    heroScreen.classList.remove('active');
    loadingScreen.style.display = 'none';
    loadingScreen.classList.remove('active');
    errorScreen.style.display = 'none';
    errorScreen.classList.remove('active');
    resultsScreen.style.display = 'none';
    resultsScreen.classList.remove('active');

    screen.style.display = '';
    screen.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- Loading Progress ----------
  const statusMessages = {
    start: { text: 'Starting your analysis...', sub: 'Setting up your GTM intelligence report', pct: 5 },
    research: { text: 'Analyzing your website...', sub: 'Scanning pages, extracting positioning and market signals', pct: 20 },
    enrichment: { text: 'Researching your competitive landscape...', sub: 'Cross-referencing industry data and tech stack signals', pct: 40 },
    crm: { text: 'Building your profile...', sub: 'Pulling existing intelligence from our systems', pct: 45 },
    analysis: { text: 'Building your custom signal strategy...', sub: 'Our AI is designing a unique alpha signal for your company', pct: 60 },
    saving: { text: 'Finalizing your report...', sub: 'Formatting your GTM intelligence report', pct: 90 }
  };

  function updateProgress(stage, message) {
    const preset = statusMessages[stage];
    if (preset) {
      loadingStatus.textContent = preset.text;
      loadingSubstatus.textContent = preset.sub;
      animateProgress(preset.pct);
    } else if (message) {
      loadingStatus.textContent = message;
    }
  }

  function animateProgress(target) {
    progressPercent = target;
    loadingBar.style.width = target + '%';
  }

  // ---------- Validation ----------
  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  function validateUrl(url) {
    if (!url || !url.trim()) return false;
    let cleaned = url.trim();
    if (!/^https?:\/\//i.test(cleaned)) cleaned = 'https://' + cleaned;
    try {
      const parsed = new URL(cleaned);
      return parsed.hostname.includes('.');
    } catch {
      return false;
    }
  }

  function showFormError(msg) {
    formError.textContent = msg;
    formError.classList.add('visible');
  }

  function clearFormError() {
    formError.textContent = '';
    formError.classList.remove('visible');
  }

  // ---------- Form Submission ----------
  analysisForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearFormError();

    const email = emailInput.value.trim();
    const website = websiteInput.value.trim();

    if (!validateEmail(email)) {
      showFormError('Please enter a valid email address.');
      emailInput.focus();
      return;
    }

    if (!validateUrl(website)) {
      showFormError('Please enter a valid website URL.');
      websiteInput.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Starting...';
    showScreen(loadingScreen);
    progressPercent = 0;
    loadingBar.style.width = '0%';

    try {
      await runAnalysis(email, website);
    } catch (err) {
      showError(err.message || 'Something went wrong. Please try again.');
    }
  });

  // ---------- SSE Analysis Stream ----------
  async function runAnalysis(email, website) {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, website })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Request failed. Please try again.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);

          if (event.type === 'progress') {
            updateProgress(event.stage, event.message);
          } else if (event.type === 'result') {
            animateProgress(100);
            setTimeout(() => renderResults(event.data), 400);
            return;
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        } catch (parseErr) {
          if (parseErr.message && !parseErr.message.includes('JSON')) {
            throw parseErr;
          }
        }
      }
    }
  }

  // ---------- Results Rendering ----------
  function renderResults(data) {
    currentAnalysisId = data.analysisId;

    // Set domain header
    resultsDomain.textContent = data.domain || 'Your Company';

    // Render each section
    const sectionMap = {
      section1Body: data.sections.icpProfile,
      section2Body: data.sections.uspAnalysis,
      section3Body: data.sections.alphaSignal,
      section4Body: data.sections.outboundSequence,
      section5Body: data.sections.contentStrategy
    };

    for (const [elementId, content] of Object.entries(sectionMap)) {
      const el = document.getElementById(elementId);
      if (el && content) {
        el.innerHTML = formatMarkdown(content);
      } else if (el) {
        el.innerHTML = '<p class="caption">This section is being generated. Please refresh in a moment.</p>';
      }
    }

    showScreen(resultsScreen);
  }

  // ---------- Markdown-to-HTML Formatter ----------
  function formatMarkdown(text) {
    if (!text) return '';

    // Remove section header lines (we render our own headers)
    text = text.replace(/^##\s*Section\s*\d+[:\s].*$/gm, '');

    const lines = text.split('\n');
    let html = '';
    let inList = false;
    let listType = 'ul';
    let pullQuoteAdded = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) {
        if (inList) {
          html += `</${listType}>`;
          inList = false;
        }
        continue;
      }

      // Headers
      if (line.startsWith('#### ')) {
        if (inList) { html += `</${listType}>`; inList = false; }
        html += `<h4>${inlineFormat(line.slice(5))}</h4>`;
        continue;
      }
      if (line.startsWith('### ')) {
        if (inList) { html += `</${listType}>`; inList = false; }
        html += `<h3>${inlineFormat(line.slice(4))}</h3>`;
        continue;
      }

      // Blockquotes as pull quotes (first one gets special styling)
      if (line.startsWith('> ')) {
        if (inList) { html += `</${listType}>`; inList = false; }
        const quoteText = line.slice(2);
        if (!pullQuoteAdded) {
          html += `<div class="pull-quote">${inlineFormat(quoteText)}</div>`;
          pullQuoteAdded = true;
        } else {
          html += `<div class="callout"><p>${inlineFormat(quoteText)}</p></div>`;
        }
        continue;
      }

      // Unordered list
      if (/^[-*]\s/.test(line)) {
        if (!inList || listType !== 'ul') {
          if (inList) html += `</${listType}>`;
          html += '<ul>';
          inList = true;
          listType = 'ul';
        }
        html += `<li>${inlineFormat(line.replace(/^[-*]\s*/, ''))}</li>`;
        continue;
      }

      // Ordered list
      if (/^\d+\.\s/.test(line)) {
        if (!inList || listType !== 'ol') {
          if (inList) html += `</${listType}>`;
          html += '<ol>';
          inList = true;
          listType = 'ol';
        }
        html += `<li>${inlineFormat(line.replace(/^\d+\.\s*/, ''))}</li>`;
        continue;
      }

      // Regular paragraph
      if (inList) { html += `</${listType}>`; inList = false; }
      html += `<p>${inlineFormat(line)}</p>`;
    }

    if (inList) html += `</${listType}>`;

    return html;
  }

  function inlineFormat(text) {
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Inline code
    text = text.replace(/`(.+?)`/g, '<code>$1</code>');
    return text;
  }

  // ---------- PDF Download ----------
  downloadPdfBtn.addEventListener('click', function () {
    if (!currentAnalysisId) return;
    downloadPdfBtn.textContent = 'Generating PDF...';
    downloadPdfBtn.disabled = true;

    window.open(`/api/pdf/${currentAnalysisId}`, '_blank');

    setTimeout(() => {
      downloadPdfBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download Full Report (PDF)
      `;
      downloadPdfBtn.disabled = false;
    }, 3000);
  });

  // ---------- Error Handling ----------
  function showError(message) {
    errorMessage.textContent = message;
    showScreen(errorScreen);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Generate Your Analysis';
  }

  retryBtn.addEventListener('click', function () {
    showScreen(heroScreen);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Generate Your Analysis';
  });

})();
