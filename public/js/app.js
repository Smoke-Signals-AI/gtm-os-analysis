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

  // Loading / signal-lifecycle elements
  const signalPrinciple = document.getElementById('signalPrinciple');
  const lifecycle = document.getElementById('lifecycle');
  const streamPanel = document.getElementById('streamPanel');
  const streamTranscript = document.getElementById('streamTranscript');

  // Chat widget elements
  const chatWidget = document.getElementById('chatWidget');
  const chatLauncher = document.getElementById('chatLauncher');
  const chatPanel = document.getElementById('chatPanel');
  const chatClose = document.getElementById('chatClose');
  const chatMessages = document.getElementById('chatMessages');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');

  // State
  let currentAnalysisId = null;
  let currentEmail = null;
  let currentPerson = null;
  let progressPercent = 0;

  // Streaming + loading state
  let accumulatedText = '';
  let streamRenderQueued = false;
  let principleTimer = null;
  let streamingStarted = false;

  // Chat state
  let chatPollTimer = null;
  let lastChatTs = 0;
  let chatStarted = false;

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

  // ---------- Loading: Signal Lifecycle ----------
  // Lines drawn from the Smoke Signals manifesto. No exclamation points, no em dashes.
  const MANIFESTO_LINES = [
    'If it does not start at signal creation, it is not a motion. It is noise.',
    'Intent data is dead. Alpha signals are not.',
    'Tools masquerading as strategy is the problem. Orchestration is the answer.',
    'We detect buying intent before your competitors can see it.',
    'Signal, then capture, then activation. In that order.'
  ];

  // Each backend stage maps to a lifecycle phase, a status line, and the manifesto reason behind it.
  const statusMessages = {
    start:      { text: 'Tuning in to your market', sub: 'Reading the smoke before anyone else can', phase: 'creation', pct: 8 },
    research:   { text: 'Reading the market', sub: 'Scanning your site for positioning and gaps', phase: 'creation', pct: 22 },
    crm:        { text: 'Found your profile', sub: 'Pulling what we already know about you', phase: 'creation', pct: 32 },
    enrichment: { text: 'Mapping the landscape', sub: 'Cross-referencing your tech stack and competitors', phase: 'creation', pct: 42 },
    signals:    { text: 'Reading your public signals', sub: 'Your posts and open roles are buying signals', phase: 'creation', pct: 54 },
    analysis:   { text: 'Creating your alpha signal', sub: 'Designing an indicator your competitors are not watching', phase: 'capture', pct: 68 },
    saving:     { text: 'Activating across channels', sub: 'Outbound, content, and LinkedIn, working as one system', phase: 'activation', pct: 94 }
  };

  const PHASE_ORDER = ['creation', 'capture', 'activation'];

  function setPhase(phase) {
    if (!lifecycle) return;
    const idx = PHASE_ORDER.indexOf(phase);
    lifecycle.querySelectorAll('.phase').forEach(function (el) {
      const p = PHASE_ORDER.indexOf(el.getAttribute('data-phase'));
      el.classList.toggle('active', p === idx);
      el.classList.toggle('done', p < idx);
    });
  }

  function updateProgress(stage, message) {
    const preset = statusMessages[stage];
    if (preset) {
      loadingStatus.textContent = preset.text;
      loadingSubstatus.textContent = preset.sub;
      if (preset.phase) setPhase(preset.phase);
      animateProgress(preset.pct);
    } else if (message) {
      loadingStatus.textContent = message;
    }
  }

  function animateProgress(target) {
    progressPercent = target;
    loadingBar.style.width = target + '%';
  }

  function startPrincipleRotation() {
    if (!signalPrinciple) return;
    stopPrincipleRotation();
    let i = 0;
    principleTimer = setInterval(function () {
      i = (i + 1) % MANIFESTO_LINES.length;
      signalPrinciple.style.opacity = '0';
      setTimeout(function () {
        signalPrinciple.textContent = MANIFESTO_LINES[i];
        signalPrinciple.style.opacity = '1';
      }, 400);
    }, 4200);
  }

  function stopPrincipleRotation() {
    if (principleTimer) { clearInterval(principleTimer); principleTimer = null; }
  }

  // ---------- Streaming transcript ----------
  function onStreamDelta(text) {
    if (!streamingStarted) {
      streamingStarted = true;
      if (streamPanel) streamPanel.hidden = false;
      setPhase('capture');
    }
    accumulatedText += text;
    if (!streamRenderQueued) {
      streamRenderQueued = true;
      requestAnimationFrame(flushTranscript);
    }
  }

  function flushTranscript() {
    streamRenderQueued = false;
    if (!streamTranscript) return;
    // Hide the micro-app JSON spec from the human-facing transcript.
    const cleaned = accumulatedText.replace(/```microapp[\s\S]*?(```|$)/g, '');
    streamTranscript.innerHTML = formatMarkdown(cleaned);
    streamTranscript.scrollTop = streamTranscript.scrollHeight;
  }

  // ---------- Survey ----------
  function setupSurvey() {
    let surveyDone = false;

    // Drive selection in JS so it never depends on native label/checkbox quirks
    // or CSS stacking. Clicking a chip toggles its checkbox and a .selected class.
    surveySection.querySelectorAll('.chip').forEach(function (chip) {
      const cb = chip.querySelector('input[type="checkbox"]');
      if (!cb) return;
      chip.addEventListener('click', function (e) {
        e.preventDefault();
        if (surveyDone) return;
        cb.checked = !cb.checked;
        chip.classList.toggle('selected', cb.checked);
        surveySubmitBtn.disabled = !surveySection.querySelector('input[type="checkbox"]:checked');
      });
    });

    surveySubmitBtn.addEventListener('click', async () => {
      const tools = Array.from(surveySection.querySelectorAll('input[name="tools"]:checked')).map(c => c.value);
      const capture = Array.from(surveySection.querySelectorAll('input[name="capture"]:checked')).map(c => c.value);

      surveyDone = true;
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

    // Reset loading + streaming state
    accumulatedText = '';
    streamingStarted = false;
    if (streamPanel) streamPanel.hidden = true;
    if (streamTranscript) streamTranscript.innerHTML = '';
    setPhase('creation');
    if (signalPrinciple) signalPrinciple.textContent = MANIFESTO_LINES[0];
    startPrincipleRotation();

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
          } else if (event.type === 'delta') {
            onStreamDelta(event.text || '');
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
    stopPrincipleRotation();
    setPhase('activation');
    currentAnalysisId = data.analysisId;
    currentPerson = data.person || null;

    const domain = data.domain || 'your company';
    const companyName = data.companyName || domain;
    resultsDomain.textContent = companyName;

    // Personalize the intro with the reader's first name and the real company name.
    const introEl = document.querySelector('.overview-intro');
    if (introEl) {
      const greet = currentPerson && currentPerson.firstName ? currentPerson.firstName + ', ' : '';
      introEl.textContent = greet + 'alpha signals are proprietary indicators of buying intent you can detect before competitors do. Below is a sample of the GTM operating system Smoke Signals would build for ' + companyName + '.';
    }

    // Company logo: LinkedIn (Anysite) -> Clearbit -> favicon -> hide.
    setCompanyLogo(data.companyLogoUrl, domain);

    // Render sections
    renderSection('section1Body', data.sections.icpProfile);
    renderSection('section2Body', data.sections.uspAnalysis);
    renderSignalSection(data.sections.alphaSignal);
    renderSequence(data.sections.outboundSequence);
    renderSection('section5Body', data.sections.contentStrategy);

    showScreen(resultsScreen);

    // Setup sidebar scroll tracking + concierge chat
    setupSidebarNav();
    setupChat();
  }

  // Try the LinkedIn logo, then Clearbit, then Google's favicon service (which
  // nearly always returns something), then hide. Steps through on each error.
  function setCompanyLogo(url, domain) {
    if (!companyLogo) return;
    const candidates = [];
    if (url) candidates.push(url);
    if (domain) {
      candidates.push('https://logo.clearbit.com/' + domain);
      candidates.push('https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=128');
    }
    let i = 0;
    function tryNext() {
      if (i >= candidates.length) { companyLogo.style.display = 'none'; return; }
      companyLogo.src = candidates[i++];
    }
    companyLogo.style.display = '';
    companyLogo.onerror = tryNext;
    tryNext();
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
    const eyebrow = document.getElementById('microAppEyebrow');
    if (eyebrow) eyebrow.hidden = false;

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

  // Deterministic scoring driven by the visitor's actual inputs and the model's
  // scoring spec. The same answers always produce the same score. No randomness.
  function generateMicroAppResults(resultsEl, spec) {
    const scored = computeMicroAppScores(spec);
    const totalScore = scored.overall;

    let html = '<h4>' + escapeHtml(spec.resultTitle || 'Your Results') + '</h4>';
    html += '<div class="micro-app-score"><div class="score-circle">' + totalScore + '</div><div class="score-label">out of 100</div></div>';

    scored.metrics.forEach(function (m) {
      const color = m.score >= 65 ? 'green' : m.score >= 45 ? 'yellow' : 'red';
      html += '<div class="metric-bar">' +
        '<span class="metric-bar-label">' + escapeHtml(m.label) + '</span>' +
        '<div class="metric-bar-track"><div class="metric-bar-fill ' + color + '" style="width:' + m.score + '%"></div></div>' +
        '<span class="metric-bar-val">' + m.score + '</span>' +
        '</div>';
      if (m.description) {
        html += '<p class="metric-bar-desc">' + escapeHtml(m.description) + '</p>';
      }
    });

    if (spec.benchmark) {
      html += '<div class="micro-app-benchmark">' + escapeHtml(spec.benchmark).replace('{score}', String(totalScore)) + '</div>';
    }

    resultsEl.innerHTML = html;
    resultsEl.classList.add('visible');
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clampScore(n) { return Math.max(0, Math.min(100, Math.round(n))); }

  function readMicroInputValue(input) {
    if (input.type === 'yesno') {
      const sel = document.querySelector('.yesno-btn.selected[data-field="' + input.id + '"]');
      return sel ? sel.dataset.value : null;
    }
    const el = document.getElementById('ma-' + input.id);
    if (!el) return null;
    return el.value;
  }

  function scoreSingleInput(input) {
    const val = readMicroInputValue(input);
    if (val === null || val === '' || typeof val === 'undefined') return null;
    if (input.type === 'select') {
      if (input.scores && typeof input.scores[val] === 'number') return clampScore(input.scores[val]);
      return null;
    }
    if (input.type === 'range') {
      const min = Number(input.min || 0), max = Number(input.max || 100);
      if (max === min) return null;
      let pct = ((Number(val) - min) / (max - min)) * 100;
      if (input.scoreDirection === 'lower') pct = 100 - pct;
      return clampScore(pct);
    }
    if (input.type === 'yesno') {
      if (input.score && typeof input.score[val] === 'number') return clampScore(input.score[val]);
      return val === 'yes' ? 100 : 30;
    }
    return null; // text inputs are context only
  }

  function computeMicroAppScores(spec) {
    const inputs = spec.inputs || [];
    const byId = {};
    inputs.forEach(function (i) { byId[i.id] = i; });

    const scoredIds = inputs.filter(function (x) { return x.type !== 'text'; }).map(function (x) { return x.id; });

    // Prefer the model's metric groupings; fall back to legacy resultMetrics, then one metric.
    let metricDefs;
    if (spec.scoring && Array.isArray(spec.scoring.metrics) && spec.scoring.metrics.length) {
      metricDefs = spec.scoring.metrics;
    } else if (Array.isArray(spec.resultMetrics) && spec.resultMetrics.length) {
      metricDefs = spec.resultMetrics.map(function (m) {
        return { label: m.label, description: m.description, inputs: scoredIds };
      });
    } else {
      metricDefs = [{ label: 'Signal Strength', description: '', inputs: scoredIds }];
    }

    const metrics = metricDefs.map(function (m) {
      const vals = [];
      (m.inputs || []).forEach(function (id) {
        const inp = byId[id];
        if (!inp) return;
        const s = scoreSingleInput(inp);
        if (s !== null) vals.push(s);
      });
      const score = vals.length ? Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : 50;
      return { label: m.label || 'Metric', description: m.description || '', score: score };
    });

    const overallVals = metrics.map(function (m) { return m.score; });
    const overall = overallVals.length ? Math.round(overallVals.reduce(function (a, b) { return a + b; }, 0) / overallVals.length) : 50;

    return { overall: overall, metrics: metrics };
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
    stopPrincipleRotation();
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

  // ---------- Concierge Chat (AI + Slack handoff) ----------
  function setupChat() {
    if (!chatWidget || !currentAnalysisId) return;
    chatWidget.hidden = false;

    if (!chatStarted) {
      chatStarted = true;
      chatLauncher.addEventListener('click', function () { openChat(true); });
      chatClose.addEventListener('click', closeChat);
      chatForm.addEventListener('submit', onChatSubmit);

      const name = currentPerson && currentPerson.firstName ? currentPerson.firstName : '';
      addChatMessage('assistant', (name ? name + ', ' : '') + 'this report is a sample of what we build. Ask me anything about your alpha signal, the sequence, or how a signal-based program would run for you.');

      // Open by default on desktop (offer help up front); mobile shows just the launcher.
      if (window.innerWidth > 768) openChat(false);
    }
  }

  function openChat(focus) {
    chatWidget.classList.add('open');
    chatPanel.hidden = false;
    chatWidget.classList.remove('has-unread');
    if (focus !== false) chatInput.focus();
    chatMessages.scrollTop = chatMessages.scrollHeight;
    startChatPolling();
  }

  function closeChat() {
    chatWidget.classList.remove('open');
    chatPanel.hidden = true;
    stopChatPolling();
  }

  function onChatSubmit(e) {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !currentAnalysisId) return;
    chatInput.value = '';
    addChatMessage('visitor', text);
    const typing = addTyping();

    fetch('/api/chat/' + currentAnalysisId + '/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        removeTyping(typing);
        if (data.reply) {
          addChatMessage('assistant', data.reply);
          if (data.ts) lastChatTs = Math.max(lastChatTs, data.ts);
        } else if (data.error) {
          addChatMessage('assistant', data.error);
        }
        startChatPolling();
      })
      .catch(function () {
        removeTyping(typing);
        addChatMessage('assistant', 'Something went wrong sending that. The team has been pinged and will follow up.');
      });
  }

  function addChatMessage(role, text) {
    const el = document.createElement('div');
    el.className = 'chat-msg chat-msg-' + role;
    if (role === 'team') {
      el.innerHTML = '<span class="chat-msg-tag">Smoke Signals team</span>';
      const body = document.createElement('span');
      body.textContent = text;
      el.appendChild(body);
    } else {
      el.textContent = text;
    }
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function addTyping() {
    const el = document.createElement('div');
    el.className = 'chat-msg chat-msg-assistant chat-typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return el;
  }

  function removeTyping(el) { if (el && el.parentNode) el.parentNode.removeChild(el); }

  function startChatPolling() {
    stopChatPolling();
    chatPollTimer = setInterval(pollChat, 4000);
  }

  function stopChatPolling() {
    if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  }

  // Poll for team replies that arrived from Slack. AI replies are shown inline on
  // send, so we only surface 'team' messages here.
  function pollChat() {
    if (!currentAnalysisId) return;
    fetch('/api/chat/' + currentAnalysisId + '/messages?since=' + lastChatTs)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        (data.messages || []).forEach(function (m) {
          if (m.ts > lastChatTs) lastChatTs = m.ts;
          if (m.role === 'team') {
            addChatMessage('team', m.text);
            if (chatPanel.hidden) chatWidget.classList.add('has-unread');
          }
        });
      })
      .catch(function () {});
  }

  // ---------- Deep link: /?report=<id> opens a specific stored report ----------
  (function loadSharedReport() {
    var params = new URLSearchParams(window.location.search);
    var reportId = params.get('report');
    if (!reportId) return;
    fetch('/api/analysis/' + encodeURIComponent(reportId))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (data) { renderResults(data); })
      .catch(function () { /* report missing or expired: leave the hero screen up */ });
  })();

})();
