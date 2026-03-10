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
  const companyLogo = document.getElementById('companyLogo');

  // Survey elements
  const surveySubmitBtn = document.getElementById('surveySubmitBtn');
  const surveyThanks = document.getElementById('surveyThanks');
  const surveySection = document.getElementById('surveySection');

  // State
  let currentAnalysisId = null;
  let currentEmail = null;
  let progressPercent = 0;

  // ---------- Screen Management ----------
  function showScreen(screen) {
    [heroScreen, loadingScreen, errorScreen, resultsScreen].forEach(s => {
      s.style.display = 'none';
      s.classList.remove('active');
    });
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

  // ---------- Survey ----------
  function setupSurvey() {
    const checkboxes = surveySection.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        const anyChecked = surveySection.querySelector('input[type="checkbox"]:checked');
        surveySubmitBtn.disabled = !anyChecked;
      });
    });

    surveySubmitBtn.addEventListener('click', async () => {
      const tools = Array.from(document.querySelectorAll('input[name="tools"]:checked')).map(c => c.value);
      const capture = Array.from(document.querySelectorAll('input[name="capture"]:checked')).map(c => c.value);

      surveySubmitBtn.disabled = true;
      surveySubmitBtn.textContent = 'Submitting...';

      try {
        await fetch('/api/survey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: currentEmail, tools, capture })
        });
      } catch (e) {
        // Silently fail
      }

      surveySubmitBtn.style.display = 'none';
      surveyThanks.style.display = 'block';

      // Disable all checkboxes
      checkboxes.forEach(cb => { cb.disabled = true; });
    });
  }

  setupSurvey();

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

    currentEmail = email;
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

    const domain = data.domain || 'Your Company';
    resultsDomain.textContent = domain;

    // Company logo via Clearbit
    companyLogo.src = 'https://logo.clearbit.com/' + domain;
    companyLogo.onerror = function () { this.style.display = 'none'; };

    // Render sections
    renderSection('section1Body', data.sections.icpProfile);
    renderSection('section2Body', data.sections.uspAnalysis);
    renderSignalSection(data.sections.alphaSignal);
    renderSequence(data.sections.outboundSequence);
    renderSection('section5Body', data.sections.contentStrategy);

    showScreen(resultsScreen);

    // Setup sidebar scroll tracking
    setupSidebarNav();
  }

  function renderSection(elementId, content) {
    const el = document.getElementById(elementId);
    if (el && content) {
      el.innerHTML = formatMarkdown(content);
    } else if (el) {
      el.innerHTML = '<p style="color:var(--text-caption)">This section is being generated.</p>';
    }
  }

  // ---------- Alpha Signal + Micro-App ----------
  function renderSignalSection(content) {
    if (!content) return;

    // Extract micro-app JSON if present
    const microAppMatch = content.match(/```microapp\s*\n([\s\S]*?)\n```/);
    let microAppSpec = null;
    let textContent = content;

    if (microAppMatch) {
      textContent = content.replace(/```microapp\s*\n[\s\S]*?\n```/, '').trim();
      try {
        microAppSpec = JSON.parse(microAppMatch[1]);
      } catch (e) {
        console.warn('Could not parse micro-app spec:', e);
      }
    }

    // Render the text part
    const el = document.getElementById('section3Body');
    if (el) el.innerHTML = formatMarkdown(textContent);

    // Build the micro-app
    const container = document.getElementById('microAppContainer');
    if (microAppSpec && container) {
      buildMicroApp(container, microAppSpec);
    }
  }

  function buildMicroApp(container, spec) {
    const app = document.createElement('div');
    app.className = 'micro-app';

    // Header
    const header = document.createElement('div');
    header.className = 'micro-app-header';
    header.innerHTML = '<h3>' + escapeHtml(spec.title || 'Assessment Tool') + '</h3>' +
      '<p>' + escapeHtml(spec.tagline || '') + '</p>';
    app.appendChild(header);

    // Form
    const form = document.createElement('div');
    form.className = 'micro-app-form';

    const inputs = spec.inputs || [];
    inputs.forEach(function (input) {
      const field = document.createElement('div');
      field.className = 'micro-app-field';

      const label = document.createElement('label');
      label.textContent = input.label || '';
      field.appendChild(label);

      if (input.type === 'text') {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = input.placeholder || '';
        inp.id = 'ma-' + input.id;
        field.appendChild(inp);
      } else if (input.type === 'select') {
        const sel = document.createElement('select');
        sel.id = 'ma-' + input.id;
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = 'Select...';
        sel.appendChild(defaultOpt);
        (input.options || []).forEach(function (opt) {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = opt;
          sel.appendChild(o);
        });
        field.appendChild(sel);
      } else if (input.type === 'range') {
        const range = document.createElement('input');
        range.type = 'range';
        range.id = 'ma-' + input.id;
        range.min = input.min || 0;
        range.max = input.max || 100;
        range.step = input.step || 1;
        range.value = Math.round(((input.max || 100) - (input.min || 0)) / 2 + (input.min || 0));
        field.appendChild(range);

        const val = document.createElement('div');
        val.className = 'range-value';
        val.id = 'ma-' + input.id + '-val';
        val.textContent = range.value + (input.unit ? ' ' + input.unit : '');
        field.appendChild(val);

        range.addEventListener('input', function () {
          val.textContent = this.value + (input.unit ? ' ' + input.unit : '');
        });
      } else if (input.type === 'yesno') {
        const group = document.createElement('div');
        group.className = 'yesno-group';
        ['Yes', 'No'].forEach(function (opt) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'yesno-btn';
          btn.textContent = opt;
          btn.dataset.field = input.id;
          btn.dataset.value = opt.toLowerCase();
          btn.addEventListener('click', function () {
            group.querySelectorAll('.yesno-btn').forEach(function (b) { b.classList.remove('selected'); });
            this.classList.add('selected');
          });
          group.appendChild(btn);
        });
        field.appendChild(group);
      }

      form.appendChild(field);
    });

    // Submit button
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'micro-app-submit';
    submitBtn.textContent = 'Generate Your Score';
    form.appendChild(submitBtn);

    app.appendChild(form);

    // Results area
    const results = document.createElement('div');
    results.className = 'micro-app-results';
    results.id = 'microAppResults';
    app.appendChild(results);

    container.appendChild(app);

    // Handle submit
    submitBtn.addEventListener('click', function () {
      generateMicroAppResults(results, spec);
    });
  }

  function generateMicroAppResults(resultsEl, spec) {
    const metrics = spec.resultMetrics || [];
    const totalScore = Math.floor(Math.random() * 30) + 45; // 45-75 range

    let html = '<h4>' + escapeHtml(spec.resultTitle || 'Your Results') + '</h4>';
    html += '<div class="micro-app-score"><div class="score-circle">' + totalScore + '</div><div class="score-label">out of 100</div></div>';

    metrics.forEach(function (m) {
      const score = Math.floor(Math.random() * 40) + 35; // 35-75
      const color = score >= 65 ? 'green' : score >= 45 ? 'yellow' : 'red';
      html += '<div class="metric-bar">' +
        '<span class="metric-bar-label">' + escapeHtml(m.label) + '</span>' +
        '<div class="metric-bar-track"><div class="metric-bar-fill ' + color + '" style="width:' + score + '%"></div></div>' +
        '<span class="metric-bar-val">' + score + '</span>' +
        '</div>';
    });

    if (spec.benchmark) {
      html += '<div class="micro-app-benchmark">' + escapeHtml(spec.benchmark).replace('{score}', String(totalScore)) + '</div>';
    }

    resultsEl.innerHTML = html;
    resultsEl.classList.add('visible');
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------- Sequence Visualization ----------
  function renderSequence(content) {
    const container = document.getElementById('sequenceTimeline');
    if (!container || !content) return;

    const emails = parseEmails(content);
    if (emails.length === 0) {
      // Fallback: render as markdown
      container.innerHTML = '<div class="section-body">' + formatMarkdown(content) + '</div>';
      return;
    }

    let html = '';

    // Trigger block
    html += '<div class="seq-trigger">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>' +
      'Alpha Signal Detected' +
      '</div>';

    const delays = ['Day 0', 'Day 3', 'Day 7'];

    emails.forEach(function (email, i) {
      // Connector
      html += '<div class="seq-connector" data-delay="' + (delays[i] || 'Day ' + (i * 3)) + '"></div>';

      // Email card
      html += '<div class="seq-email">' +
        '<div class="seq-email-header">' +
        '<span class="seq-email-num">' + (i + 1) + '</span>' +
        '<div class="seq-email-meta">' +
        '<div class="seq-email-label">' + escapeHtml(email.label || 'Email ' + (i + 1)) + '</div>' +
        '<div class="seq-email-subject">' + escapeHtml(email.subject) + '</div>' +
        '</div>' +
        '</div>' +
        '<div class="seq-email-body">' + formatMarkdown(email.body) + '</div>' +
        '</div>';
    });

    container.innerHTML = html;
  }

  function parseEmails(text) {
    const emails = [];
    // Try to match "### Email N: Label" pattern
    const emailBlocks = text.split(/###\s*Email\s*\d+[:\s]*/i).filter(Boolean);

    emailBlocks.forEach(function (block) {
      const lines = block.trim().split('\n');
      let label = '';
      let subject = '';
      let bodyLines = [];

      // First line might be the label
      if (lines[0] && !/\*\*subject/i.test(lines[0]) && !/^subject/i.test(lines[0])) {
        label = lines[0].replace(/^#+\s*/, '').trim();
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Match subject line
        const subMatch = line.match(/\*\*subject:?\*\*\s*(.*)/i) || line.match(/^subject(?:\s*line)?:?\s*(.*)/i);
        if (subMatch) {
          subject = subMatch[1].trim().replace(/^\*\*|\*\*$/g, '');
          // Rest is body
          bodyLines = lines.slice(i + 1).filter(function (l) { return l.trim() !== ''; });
          break;
        }
      }

      if (subject) {
        emails.push({
          label: label,
          subject: subject,
          body: bodyLines.join('\n').trim()
        });
      }
    });

    return emails;
  }

  // ---------- Sidebar Navigation ----------
  function setupSidebarNav() {
    const navItems = document.querySelectorAll('.nav-item');
    const sections = [];

    navItems.forEach(function (item) {
      const targetId = item.getAttribute('data-target');
      const targetEl = document.getElementById(targetId);
      if (targetEl) sections.push({ nav: item, el: targetEl });

      item.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.getElementById(targetId);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });

    // Scroll spy
    const main = document.querySelector('.main-content');
    if (main) {
      main.addEventListener('scroll', onMainScroll);
      window.addEventListener('scroll', onMainScroll);
    }

    function onMainScroll() {
      let current = '';
      sections.forEach(function (s) {
        const rect = s.el.getBoundingClientRect();
        if (rect.top <= 120) {
          current = s.nav.getAttribute('data-target');
        }
      });

      navItems.forEach(function (item) {
        item.classList.toggle('active', item.getAttribute('data-target') === current);
      });
    }
  }

  // ---------- Markdown-to-HTML ----------
  function formatMarkdown(text) {
    if (!text) return '';

    // Remove section header lines
    text = text.replace(/^##\s*Section\s*\d+[:\s].*$/gm, '');

    const lines = text.split('\n');
    let html = '';
    let inList = false;
    let listType = 'ul';

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) {
        if (inList) { html += '</' + listType + '>'; inList = false; }
        continue;
      }

      // Headers
      if (line.startsWith('#### ')) {
        if (inList) { html += '</' + listType + '>'; inList = false; }
        html += '<h4>' + inlineFormat(line.slice(5)) + '</h4>';
        continue;
      }
      if (line.startsWith('### ')) {
        if (inList) { html += '</' + listType + '>'; inList = false; }
        html += '<h3>' + inlineFormat(line.slice(4)) + '</h3>';
        continue;
      }

      // Blockquotes as pull quotes
      if (line.startsWith('> ')) {
        if (inList) { html += '</' + listType + '>'; inList = false; }
        html += '<blockquote>' + inlineFormat(line.slice(2)) + '</blockquote>';
        continue;
      }

      // Unordered list
      if (/^[-*]\s/.test(line)) {
        if (!inList || listType !== 'ul') {
          if (inList) html += '</' + listType + '>';
          html += '<ul>';
          inList = true;
          listType = 'ul';
        }
        html += '<li>' + inlineFormat(line.replace(/^[-*]\s*/, '')) + '</li>';
        continue;
      }

      // Ordered list
      if (/^\d+\.\s/.test(line)) {
        if (!inList || listType !== 'ol') {
          if (inList) html += '</' + listType + '>';
          html += '<ol>';
          inList = true;
          listType = 'ol';
        }
        html += '<li>' + inlineFormat(line.replace(/^\d+\.\s*/, '')) + '</li>';
        continue;
      }

      // Regular paragraph
      if (inList) { html += '</' + listType + '>'; inList = false; }
      html += '<p>' + inlineFormat(line) + '</p>';
    }

    if (inList) html += '</' + listType + '>';
    return html;
  }

  function inlineFormat(text) {
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/`(.+?)`/g, '<code>$1</code>');
    return text;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- PDF Download ----------
  downloadPdfBtn.addEventListener('click', function () {
    if (!currentAnalysisId) return;
    downloadPdfBtn.querySelector('svg') && (downloadPdfBtn.innerHTML = '<span>Generating...</span>');
    downloadPdfBtn.disabled = true;

    window.open('/api/pdf/' + currentAnalysisId, '_blank');

    setTimeout(function () {
      downloadPdfBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download PDF';
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
