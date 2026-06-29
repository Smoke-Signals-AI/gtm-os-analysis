// ============================================
// GTM OS — Frontend Application
// ============================================

(function () {
  'use strict';

  // DOM Elements
  const heroScreen = document.getElementById('heroScreen');
  const gateScreen = document.getElementById('gateScreen');
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
  const shareReportBtn = document.getElementById('shareReportBtn');
  const shareReportBtnMobile = document.getElementById('shareReportBtnMobile');
  const resultsDomain = document.getElementById('resultsDomain');
  const companyLogo = document.getElementById('companyLogo');

  // Survey elements
  const surveyThanks = document.getElementById('surveyThanks');
  const surveySection = document.getElementById('surveySection');
  let flushSurvey = function () {}; // set by setupSurvey; flushed on results render

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
  let lastFlush = 0;           // throttle transcript re-render (see scheduleFlush)
  let currentAbort = null;     // AbortController for the in-flight analysis stream

  // One-time-setup guards so a re-render never double-binds listeners/observers.
  let conversionSetup = false;
  let sidebarSetup = false;
  let chatPollFails = 0;

  // Chat state
  let chatPollTimer = null;
  let lastChatTs = 0;
  let chatStarted = false;

  // ---------- Screen Management ----------
  function showScreen(screen) {
    [heroScreen, gateScreen, loadingScreen, errorScreen, resultsScreen].forEach(s => {
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
    scheduleFlush();
  }

  // Re-rendering the whole transcript through markdown on every token is O(n^2)
  // over the generation and janks low-end devices. Coalesce to at most ~4x/sec.
  function scheduleFlush() {
    if (streamRenderQueued) return;
    streamRenderQueued = true;
    const wait = Math.max(0, 250 - (Date.now() - lastFlush));
    setTimeout(function () {
      streamRenderQueued = false;
      lastFlush = Date.now();
      flushTranscript();
    }, wait);
  }

  function flushTranscript() {
    streamRenderQueued = false;
    if (!streamTranscript) return;
    // Hide the micro-app JSON spec from the human-facing transcript.
    const cleaned = accumulatedText.replace(/```microapp[\s\S]*?(```|$)/g, '');
    streamTranscript.innerHTML = formatMarkdown(cleaned);
    streamTranscript.scrollTop = streamTranscript.scrollHeight;
  }

  // ---------- Survey (auto-capture, no submit button) ----------
  function setupSurvey() {
    let saveTimer = null;
    let confirmed = false;

    function autosave() {
      const tools = Array.from(surveySection.querySelectorAll('input[name="tools"]:checked')).map(c => c.value);
      const capture = Array.from(surveySection.querySelectorAll('input[name="capture"]:checked')).map(c => c.value);
      if (!tools.length && !capture.length) return;
      if (currentEmail) {
        fetch('/api/survey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: currentEmail, tools, capture })
        }).catch(function () {});
      }
      if (!confirmed && surveyThanks) { confirmed = true; surveyThanks.style.display = 'block'; }
    }

    // Selections are captured as they are made. No submit step.
    surveySection.querySelectorAll('.chip').forEach(function (chip) {
      const cb = chip.querySelector('input[type="checkbox"]');
      if (!cb) return;
      chip.addEventListener('click', function (e) {
        e.preventDefault();
        cb.checked = !cb.checked;
        chip.classList.toggle('selected', cb.checked);
        clearTimeout(saveTimer);
        saveTimer = setTimeout(autosave, 700); // debounce
      });
    });

    // Final flush when results render (the contact definitely exists by then).
    flushSurvey = autosave;
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
    // Supersede any previous in-flight run (retry/resubmit) so two streams can't
    // race on shared state. The superseded run exits silently (see catch below).
    if (currentAbort) { try { currentAbort._superseded = true; currentAbort.abort(); } catch (e) {} }
    const ac = new AbortController();
    currentAbort = ac;

    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, website }),
      signal: ac.signal
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Request failed. Please try again.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let gotResult = false;

    // Watchdog: if no event arrives for a while the stream has stalled. Abort and
    // surface an error instead of leaving the prospect on a frozen progress bar.
    let watchdog = null;
    function armWatchdog() {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(function () { try { ac.abort(); } catch (e) {} }, 45000);
    }

    // Process one "data: {json}" line. Returns true when the terminal result
    // arrived. Heartbeats (": ping") and partial/non-JSON lines are ignored.
    function handleLine(line) {
      if (!line.startsWith('data: ')) return false;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) return false;
      let event;
      try { event = JSON.parse(jsonStr); } catch (e) { return false; }
      if (event.type === 'progress') {
        updateProgress(event.stage, event.message);
      } else if (event.type === 'delta') {
        onStreamDelta(event.text || '');
      } else if (event.type === 'result') {
        gotResult = true;
        animateProgress(100);
        setTimeout(function () { renderResults(event.data); }, 400);
        return true;
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
      return false;
    }

    armWatchdog();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armWatchdog();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep the trailing partial line
        for (const line of lines) {
          if (handleLine(line)) return;
        }
      }
      // Flush trailing bytes + any final buffered line: the result frame can land
      // in the tail without a closing newline, and was previously dropped here.
      buffer += decoder.decode();
      if (buffer && handleLine(buffer)) return;
    } catch (err) {
      if (err && err.name === 'AbortError') {
        if (ac._superseded) return;            // replaced by a newer run: stay silent
        throw new Error('This took longer than expected. Please try again.');
      }
      throw err;
    } finally {
      if (watchdog) clearTimeout(watchdog);
      if (currentAbort === ac) currentAbort = null;
    }

    // The stream ended without a terminal result event. The report was not saved
    // server-side (the save happens just before the result is sent), so a retry
    // is the honest path rather than leaving the user stranded.
    if (!gotResult) {
      throw new Error('The analysis ended before it finished. Please try again.');
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

    // Personalize the intro: by first name if known, else by company name, else generic.
    const introEl = document.querySelector('.overview-intro');
    if (introEl) {
      const firstName = currentPerson && currentPerson.firstName ? currentPerson.firstName : '';
      const companyKnown = companyName && companyName !== domain;
      const line = 'alpha signals are proprietary indicators of buying intent you can detect before competitors do.';
      if (firstName) {
        introEl.textContent = firstName + ', ' + line + ' Below is a sample of the GTM operating system Smoke Signals would build for ' + companyName + '.';
      } else if (companyKnown) {
        introEl.textContent = companyName + ', ' + line + ' Below is a sample of the GTM operating system Smoke Signals would build for you.';
      } else {
        introEl.textContent = 'Alpha signals are proprietary indicators of buying intent you can detect before competitors do. Below is a sample of the GTM operating system Smoke Signals would build for ' + companyName + '.';
      }
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

    // Setup sidebar scroll tracking + concierge chat + conversion mechanics
    setupSidebarNav();
    setupChat();
    setupConversion(companyName);
    flushSurvey(); // capture any final survey selections now the contact exists
  }

  // ---------- Conversion mechanics (CTA personalization, sticky bar, progress, chat/calendar) ----------
  function setupConversion(companyName) {
    const co = companyName || 'your company';
    document.querySelectorAll('.cta-company').forEach(function (el) { el.textContent = co; });

    // Listeners/observer are global and must be wired once, even if results render
    // more than once (e.g. via the share-link gate).
    if (conversionSetup) return;
    conversionSetup = true;

    const spb = document.getElementById('scrollProgressBar');
    const sp = document.getElementById('scrollProgress');
    const sticky = document.getElementById('stickyCta');
    const ctaSection = document.getElementById('cta-section');
    if (sp) sp.classList.add('active');

    let ctaInView = false;

    function onScroll() {
      if (spb) {
        const h = document.documentElement.scrollHeight - window.innerHeight;
        const pct = h > 0 ? (window.scrollY / h) * 100 : 0;
        spb.style.width = Math.max(0, Math.min(100, pct)) + '%';
      }
      if (sticky) sticky.hidden = !(window.scrollY > 500 && !ctaInView);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // When the booking calendar is in view: hide the sticky bar (redundant) and
    // the chat widget (so it never covers the time-slot buttons).
    if (ctaSection && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        ctaInView = entries[0].isIntersecting;
        if (sticky && ctaInView) sticky.hidden = true;
        if (chatWidget) chatWidget.classList.toggle('chat-hidden', ctaInView);
        onScroll();
      }, { threshold: 0.12 }).observe(ctaSection);
    }
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
      el.innerHTML = '<p style="color:var(--text-caption)">This section was not available for this report. Try regenerating your analysis.</p>';
    }
  }

  // ---------- Alpha Signal + Micro-App ----------
  function renderSignalSection(content) {
    if (!content) return;

    // Extract micro-app JSON if present. Tolerant of fence formatting drift: the
    // inner newlines are optional, so a single-line or EOF-terminated fence still
    // parses (otherwise the whole interactive app silently disappears).
    const microAppMatch = content.match(/```microapp\s*([\s\S]*?)```/i);
    let microAppSpec = null;
    let textContent = content;

    if (microAppMatch) {
      textContent = content.replace(/```microapp\s*[\s\S]*?```/i, '').trim();
      try {
        microAppSpec = JSON.parse(microAppMatch[1].trim());
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

    // Handle submit. Never show an error state in front of the prospect: fall
    // back to a clean illustrative result if anything goes wrong.
    submitBtn.addEventListener('click', function () {
      try {
        generateMicroAppResults(results, spec);
      } catch (e) {
        results.innerHTML = '<h4>' + escapeHtml(spec.resultTitle || 'Your Score') + '</h4>' +
          '<div class="micro-app-score"><div class="score-circle">62</div><div class="score-label">out of 100</div></div>' +
          '<div class="micro-app-cta"><a href="#cta-section" data-book>Want one of these built for your funnel? Let us map it &rarr;</a></div>';
        results.classList.add('visible');
      }
    });
  }

  // Deterministic scoring driven by the visitor's actual inputs and the model's
  // scoring spec. The same answers always produce the same score. No randomness.
  function generateMicroAppResults(resultsEl, spec) {
    let scored;
    try { scored = computeMicroAppScores(spec); } catch (e) { scored = { overall: 62, metrics: [] }; }
    const totalScore = (scored && typeof scored.overall === 'number') ? scored.overall : 62;
    const metrics = (scored && Array.isArray(scored.metrics)) ? scored.metrics : [];

    let html = '<h4>' + escapeHtml(spec.resultTitle || 'Your Results') + '</h4>';
    html += '<div class="micro-app-score"><div class="score-circle">' + totalScore + '</div><div class="score-label">out of 100</div></div>';

    metrics.forEach(function (m) {
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

    // The app supports the booking, it is not the conversion step itself.
    html += '<div class="micro-app-cta"><a href="#cta-section" data-book>Want one of these built for your funnel? Let us map it &rarr;</a></div>';

    resultsEl.innerHTML = html;
    resultsEl.classList.add('visible');
    try { resultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
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

    const delays = ['Day 0', 'Day 3', 'Day 7', 'Day 12', 'Day 18', 'Day 25'];

    emails.forEach(function (email, i) {
      // Connector
      html += '<div class="seq-connector" data-delay="' + (delays[i] || 'Day ' + (7 + (i - 2) * 5)) + '"></div>';

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
    // Split on an "Email N" header, tolerant of how it's marked up: "### Email 1:",
    // "#### Email 1", or "**Email 1**". Without this, a minor formatting drift made
    // the whole section fall back to a flat markdown dump.
    const emailBlocks = text
      .split(/(?:^|\n)\s*(?:#{2,4}\s*)?\*{0,2}\s*Email\s*\d+\b\*{0,2}[:.\s-]*/i)
      .filter(function (b) { return b && b.trim(); });

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
    if (sidebarSetup) return; // bind scroll-spy + nav handlers once
    sidebarSetup = true;
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
    let inFence = false;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      let line = raw.trim();

      // Fenced code block: toggle on ``` and render the inner lines verbatim so a
      // stray fence never leaks literal backticks into the rendered section.
      if (/^```/.test(line)) {
        if (inList) { html += '</' + listType + '>'; inList = false; }
        if (!inFence) { inFence = true; html += '<pre class="md-code">'; }
        else { inFence = false; html += '</pre>'; }
        continue;
      }
      if (inFence) { html += escapeHtml(raw) + '\n'; continue; }

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
      // Generic level-2 heading (a non-"Section N" "## Heading"); otherwise the
      // literal "##" leaks into a paragraph.
      if (line.startsWith('## ')) {
        if (inList) { html += '</' + listType + '>'; inList = false; }
        html += '<h3>' + inlineFormat(line.slice(3)) + '</h3>';
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
    if (inFence) html += '</pre>';
    return html;
  }

  function inlineFormat(text) {
    // Links first so the quote text can be a hyperlink to the source post.
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
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
    const original = downloadPdfBtn.innerHTML;
    downloadPdfBtn.innerHTML = '<span>Opening...</span>';
    downloadPdfBtn.disabled = true;

    window.open('/api/pdf/' + currentAnalysisId, '_blank');

    // Restore when the user returns to this tab, not on a blind timer that lies
    // about completion. Fallback timeout in case 'focus' never fires.
    let restored = false;
    function restore() {
      if (restored) return;
      restored = true;
      window.removeEventListener('focus', restore);
      downloadPdfBtn.innerHTML = original;
      downloadPdfBtn.disabled = false;
    }
    window.addEventListener('focus', restore);
    setTimeout(restore, 4000);
  });

  // ---------- Share Report ----------
  // Build the shareable results link and hand it off: native share sheet on
  // devices that support it (mobile), clipboard copy elsewhere, prompt as a
  // last resort. Visitors who open the link hit the email gate (see below).
  // Bound to both entry points: the sidebar button (desktop) and the overview
  // button (mobile, where the sidebar is hidden). Feedback lands on whichever
  // button was clicked by swapping its contents and restoring them.
  function flashCopied(btn) {
    if (!btn) return;
    const original = btn.innerHTML;
    const icon = btn.querySelector('svg');
    btn.innerHTML = (icon ? icon.outerHTML + ' ' : '') + 'Link copied';
    setTimeout(function () { btn.innerHTML = original; }, 2500);
  }

  async function onShareClick(e) {
    const btn = e.currentTarget;
    if (!currentAnalysisId) return;
    const url = window.location.origin + '/?report=' + encodeURIComponent(currentAnalysisId);

    if (navigator.share) {
      try {
        await navigator.share({ title: 'Your GTM OS report', url: url });
        return;
      } catch (err) {
        // User dismissed the share sheet (or it is unavailable): fall through to copy.
        if (err && err.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      flashCopied(btn);
    } catch (err) {
      window.prompt('Copy this link to share your report:', url);
    }
  }

  [shareReportBtn, shareReportBtnMobile].forEach(function (btn) {
    if (btn) btn.addEventListener('click', onShareClick);
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
    // Cancel any still-running stream and clear stale streaming state so the next
    // run starts clean (no flash of the previous attempt's transcript).
    if (currentAbort) { try { currentAbort._superseded = true; currentAbort.abort(); } catch (e) {} currentAbort = null; }
    stopPrincipleRotation();
    accumulatedText = '';
    streamingStarted = false;
    if (streamPanel) streamPanel.hidden = true;
    if (streamTranscript) streamTranscript.innerHTML = '';
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
        chatPollFails = 0;
        (data.messages || []).forEach(function (m) {
          if (m.ts > lastChatTs) lastChatTs = m.ts;
          if (m.role === 'team') {
            addChatMessage('team', m.text);
            if (chatPanel.hidden) chatWidget.classList.add('has-unread');
          }
        });
      })
      .catch(function () {
        // Stop hammering a persistently failing endpoint every 4s forever.
        chatPollFails++;
        if (chatPollFails >= 5) stopChatPolling();
      });
  }

  // ---------- Deep link: /?report=<id> gates a shared report behind an email ----------
  // A visitor opening someone's share link is shown the email gate. On submit we
  // unlock the report (capturing them in HubSpot) and render it. The owner who
  // generated the report reaches it directly via the analysis flow, not here.
  (function setupSharedReportGate() {
    var params = new URLSearchParams(window.location.search);
    var reportId = params.get('report');
    if (!reportId || !gateScreen) return;

    var gateForm = document.getElementById('gateForm');
    var gateEmail = document.getElementById('gateEmail');
    var gateSubmitBtn = document.getElementById('gateSubmitBtn');
    var gateError = document.getElementById('gateError');

    function showGateError(msg) {
      if (!gateError) return;
      gateError.textContent = msg;
      gateError.classList.add('visible');
    }

    showScreen(gateScreen);
    if (!gateForm) return;

    gateForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (gateError) gateError.classList.remove('visible');

      var email = (gateEmail.value || '').trim();
      if (!validateEmail(email)) {
        showGateError('Please enter a valid email address.');
        gateEmail.focus();
        return;
      }

      gateSubmitBtn.disabled = true;
      gateSubmitBtn.textContent = 'Unlocking...';

      fetch('/api/analysis/' + encodeURIComponent(reportId) + '/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      })
        .then(function (r) {
          if (r.status === 404) return Promise.reject(new Error('This report was not found. It may have expired.'));
          if (!r.ok) return Promise.reject(new Error('Something went wrong. Please try again.'));
          return r.json();
        })
        .then(function (data) {
          currentEmail = email; // so the concierge chat + survey attach to this visitor
          renderResults(data);
        })
        .catch(function (err) {
          gateSubmitBtn.disabled = false;
          gateSubmitBtn.textContent = 'Unlock the Report';
          showGateError(err.message || 'Something went wrong. Please try again.');
        });
    });
  })();

})();
