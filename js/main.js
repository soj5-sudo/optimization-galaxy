// main.js: wiring. Image intake (upload, drop, paste, samples), run flow,
// results rendering, multiplayer share, model card, nav.

(() => {
  const $ = id => document.getElementById(id);

  const els = {
    dropzone: $('dropzone'),
    dropHint: $('drop-hint'),
    preview: $('preview-canvas'),
    fileInput: $('file-input'),
    samples: $('samples'),
    widthInput: $('stone-width'),
    objective: $('objective'),
    runBtn: $('run-btn'),
    status: $('console-status'),
    progress: $('progress-fill'),
    strip: $('pipeline-strip'),
    log: $('inference-log'),
    results: $('results'),
    statRow: $('stat-row'),
    beforeCanvas: $('before-canvas'),
    afterCanvas: $('after-canvas'),
    planBody: $('plan-body'),
    instructions: $('instructions'),
    risks: $('risks'),
    summary: $('summary'),
    downloadBtn: $('download-btn'),
    shareBtn: $('share-btn'),
    shareModal: $('share-modal'),
    shareUrls: $('share-urls'),
    shareClose: $('share-close'),
    participants: $('participants'),
    nav: $('nav'),
    demoBtn: $('demo-btn'),
    demoSteps: $('demo-steps'),
    cycleLog: $('cycle-log'),
    passport: $('passport'),
    passportId: $('passport-id'),
    passportBody: $('passport-body'),
    scriptBtn: $('script-btn'),
    dlCutting: $('dl-cutting'),
    dlDds: $('dl-dds'),
    dlPlan: $('dl-plan'),
  };

  const app = {
    img: null,            // HTMLImageElement currently loaded
    imageName: null,
    imageRef: null,       // synced reference: {kind:'sample',src} | {kind:'data',dataURL}
    imageDocKey: null,    // which source-document bundle this scan belongs to
    an: null,
    result: null,
    record: null,         // the one record per stone
    badRecord: null,
    running: false,
    runId: 0,
    applyingRemote: false,
  };

  // ---------- image intake ----------

  function loadFromRef(ref, name, then, docKey) {
    const img = new Image();
    img.onload = () => {
      app.img = img;
      app.imageName = name;
      app.imageRef = ref;
      app.imageDocKey = docKey || null;
      drawPreview(img);
      els.runBtn.disabled = false;
      setStatus(`Loaded ${name}. Ready`, false);
      if (then) then();
    };
    img.onerror = () => setStatus('Could not read that image', false);
    img.src = ref.kind === 'data' ? ref.dataURL : ref.src;
  }

  function drawPreview(img) {
    const c = els.preview;
    const boxW = els.dropzone.clientWidth - 4;
    const boxH = 320;
    const s = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    els.dropzone.classList.add('has-image');
  }

  function acceptFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      setStatus('That file is not an image', false);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // downscale for session sync and consistent processing
      const probe = new Image();
      probe.onload = () => {
        const MAX = 1400;
        const s = Math.min(1, MAX / Math.max(probe.naturalWidth, probe.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(probe.naturalWidth * s);
        c.height = Math.round(probe.naturalHeight * s);
        c.getContext('2d').drawImage(probe, 0, 0, c.width, c.height);
        const dataURL = c.toDataURL('image/jpeg', 0.88);
        loadFromRef({ kind: 'data', dataURL }, file.name, syncInputs);
      };
      probe.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  els.fileInput.addEventListener('change', e => acceptFile(e.target.files[0]));
  els.dropzone.addEventListener('click', e => {
    if (e.target.closest('canvas') || !app.img) els.fileInput.click();
    else els.fileInput.click();
  });
  els.dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
  });
  ['dragover', 'dragenter'].forEach(ev => els.dropzone.addEventListener(ev, e => {
    e.preventDefault();
    els.dropzone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(ev => els.dropzone.addEventListener(ev, e => {
    e.preventDefault();
    els.dropzone.classList.remove('dragging');
  }));
  els.dropzone.addEventListener('drop', e => acceptFile(e.dataTransfer.files[0]));
  window.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) acceptFile(item.getAsFile());
  });

  // samples
  els.samples.querySelectorAll('button[data-src]').forEach(btn => {
    btn.addEventListener('click', () => {
      // samples carry the scale they were measured at, so weights match their lab report
      if (btn.dataset.width) els.widthInput.value = btn.dataset.width;
      loadFromRef({ kind: 'sample', src: btn.dataset.src }, btn.dataset.name, syncInputs, btn.dataset.doc);
      els.samples.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ---------- run ----------

  function setStatus(text, live) {
    els.status.textContent = text;
    els.status.dataset.live = live ? 'true' : 'false';
  }

  async function run(fromRemote, opts = {}) {
    if (!app.img || app.running) return;
    app.running = true;
    els.runBtn.disabled = true;
    els.runBtn.textContent = 'Running';
    if (!fromRemote) {
      app.runId += 1;
      syncInputs({ runId: app.runId });
    }
    try {
      const params = {
        stoneWidthMm: Number(els.widthInput.value) || 12,
        objective: els.objective.value,
      };
      const { an, result } = await Pipeline.run(app.img, params, {
        strip: els.strip, log: els.log, status: els.status, progress: els.progress,
      });
      if (!result.error) {
        app.an = an; app.result = result;
        els.results.hidden = false;
        Report.renderResults(an, result, els);

        // open the record for this stone and write the plan onto it
        app.record = Records.create({
          scanName: app.imageName,
          scanSource: app.imageRef && app.imageRef.kind === 'sample' ? 'bundled scan' : 'uploaded scan',
          docs: app.imageDocKey ? Records.SOURCES[app.imageDocKey] : Records.SOURCES['IGI-7996745173'],
        });
        app.record.plan = result;
        Records.log(app.record, 'optimization', 'Cut plan produced',
          `${result.stones.length} stones, ${result.totalCarat.toFixed(2)} ct, ${result.yieldPct.toFixed(1)}% yield`);
        cycleLog('PLANNER', `Plan written to record <span class="num">${app.record.id}</span>: ${result.stones.length} stones, <span class="num">${result.totalCarat.toFixed(2)} ct</span>, <span class="num">${result.yieldPct.toFixed(1)}%</span> yield`);
        refreshAgentCards();

        if (!fromRemote && !opts.noScroll) {
          requestAnimationFrame(() => els.results.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        }
      }
    } finally {
      app.running = false;
      els.runBtn.disabled = false;
      els.runBtn.textContent = 'Run model';
    }
  }
  app.run = run;

  els.runBtn.addEventListener('click', () => run(false));
  els.downloadBtn.addEventListener('click', () => {
    if (app.an && app.result) Report.downloadReport(app.an, app.result, { imageName: app.imageName });
  });

  [els.widthInput, els.objective].forEach(el => el.addEventListener('change', () => syncInputs()));

  window.addEventListener('resize', () => {
    if (app.an && app.result) {
      Report.drawBefore(els.beforeCanvas, app.an);
      Report.drawAfter(els.afterCanvas, app.an, app.result);
    }
  });

  // ---------- the cycle: agents, passport, demo ----------

  function cycleLog(who, html) {
    Pipeline.logLine(els.cycleLog, who, html);
  }

  function setAgentState(agent, text, tone) {
    const el = $(`state-${agent}`);
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone || 'idle';
  }

  function refreshAgentCards() {
    const r = app.record;
    if (r && r.plan && !r.cutting) {
      $('body-cutting').innerHTML = `<p class="muted-line">Plan on record. ${r.plan.stones.length} stones, ${r.plan.totalCarat.toFixed(2)} ct queued for the floor.</p>`;
      setAgentState('cutting', 'Ready', 'idle');
    }
  }

  function renderCompliance(record, isSecondary) {
    const c = record.compliance;
    const passed = c.status === 'filed';
    const rows = c.checks.map(ck =>
      `<li class="chk ${ck.ok ? 'ok' : 'bad'}"><span class="chk-mark">${ck.ok ? 'Pass' : 'Block'}</span>
        <span><strong>${ck.name}</strong><br>${ck.detail.replace(/<[^>]+>/g, '')}</span></li>`).join('');
    const verdict = `<p class="verdict ${passed ? 'ok' : 'bad'}">${passed
      ? `DDS filed, reference ${c.ddsRef}. Origin ${c.origin}.`
      : `Filing blocked. ${c.blockers.length} mismatch${c.blockers.length > 1 ? 'es' : ''} caught before the border.`}</p>`;

    // the second stone gets its own card so the cleared record stays on screen
    if (isSecondary) {
      $('blocked-card').hidden = false;
      $('body-blocked').innerHTML =
        `<p class="rec-line">${record.docs.lab.authority} ${record.docs.lab.reportNumber}, ${record.docs.lab.caratWeight.toFixed(2)} ct.
          Invoice declares ${record.docs.invoice.declaredOrigin}, mining certificate says ${record.docs.mining.countryOfOrigin}.</p>` +
        verdict + `<ul class="chk-list">${rows}</ul>`;
      setAgentState('blocked', 'Blocked', 'bad');
      return;
    }

    $('body-compliance').innerHTML =
      `<p class="rec-line">Record ${record.id}, ${record.docs.lab.authority} ${record.docs.lab.reportNumber}</p>` +
      verdict + `<ul class="chk-list">${rows}</ul>`;
    setAgentState('compliance', passed ? 'Filed' : 'Blocked', passed ? 'ok' : 'bad');
  }

  function renderQuote(record) {
    const q = record.quote, d = record.docs;
    if (!q) return;
    const money = n => `$${Math.round(n).toLocaleString()}`;
    $('body-quoting').innerHTML =
      `<dl class="kv">
        <div><dt>Graded stone</dt><dd class="num">${money(q.gradedValue)}</dd></div>
        <div><dt>Planned revenue</dt><dd class="num">${money(q.revenue)}</dd></div>
        <div><dt>Country of polish</dt><dd>${d.invoice.countryOfPolish}</dd></div>
        <div><dt>Import duty</dt><dd class="num">${q.tariffPct === null ? 'Not set' : q.tariffPct.toFixed(1) + '%'}, ${money(q.duty)}</dd></div>
        <div><dt>Manufacturing</dt><dd class="num">${money(q.manufacturing)}</dd></div>
        <div><dt>Rough bid ceiling</dt><dd class="num">${money(q.roughBid)}</dd></div>
      </dl>` +
      (q.blocked ? `<p class="verdict bad">Held. Compliance has not cleared this record.</p>` : '');
    setAgentState('quoting', q.blocked ? 'Held' : 'Quoted', q.blocked ? 'bad' : 'ok');
  }

  function renderCutting(record) {
    const c = record.cutting;
    if (!c) return;
    const rows = c.executed.map(s =>
      `<tr><td>${s.id}</td><td>${Planner.SHAPES[s.shape].name}</td><td class="num">${s.planned.toFixed(2)}</td><td class="num">${s.actual.toFixed(2)}</td></tr>`).join('');
    $('body-cutting').innerHTML =
      `<p class="rec-line">${c.factory}</p>
       <div class="table-scroll"><table class="plan-table mini">
         <thead><tr><th>Stone</th><th>Shape</th><th class="num">Plan ct</th><th class="num">Actual ct</th></tr></thead>
         <tbody>${rows}</tbody></table></div>
       <p class="verdict ok">Report returned: ${c.actualTotal.toFixed(2)} ct, ${c.variancePct.toFixed(1)}% against plan.</p>`;
    setAgentState('cutting', 'Report sent', 'ok');
  }

  function renderPassport(record) {
    els.passport.hidden = false;
    els.passportId.textContent = record.id;
    const rows = Records.fieldTable(record);
    const extra = [];
    if (record.plan) extra.push({ field: 'Planned recovery', value: `${record.plan.totalCarat.toFixed(2)} ct, ${record.plan.yieldPct.toFixed(1)}% yield`, source: 'Optimization agent' });
    if (record.cutting) extra.push({ field: 'Actual recovery', value: `${record.cutting.actualTotal.toFixed(2)} ct`, source: 'Cutting agent report' });
    if (record.compliance && record.compliance.ddsRef) extra.push({ field: 'DDS reference', value: record.compliance.ddsRef, source: 'Compliance agent filing' });
    if (record.quote) extra.push({ field: 'Rough bid ceiling', value: `$${Math.round(record.quote.roughBid).toLocaleString()}`, source: 'Quoting agent' });
    els.passportBody.innerHTML = [...rows, ...extra].map(r =>
      `<tr><td>${r.field}</td><td>${r.value}</td><td class="src">${r.source}</td></tr>`).join('');
  }

  const cycleUI = {
    log: cycleLog,
    renderCompliance, renderQuote, renderCutting, renderPassport,
  };

  // build the beat list
  Demo.BEATS.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'demo-step';
    d.dataset.step = s.key;
    d.dataset.state = 'pending';
    d.innerHTML = `<span class="ds-index num">${String(i + 1).padStart(2, '0')}</span><span class="ds-title">${s.title}</span>`;
    els.demoSteps.appendChild(d);
  });

  els.demoBtn.addEventListener('click', () => {
    document.getElementById('cycle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    Demo.run(app, cycleUI);
  });

  $('pause-btn').addEventListener('click', () => Demo.pause());
  $('next-btn').addEventListener('click', () => Demo.next());

  els.scriptBtn.addEventListener('click', () => {
    Agents.download('spoken-script.txt', Demo.scriptText(app));
  });

  els.dlCutting.addEventListener('click', () => {
    if (app.record && app.record.cutting) Agents.download('cutting-agent-report.txt', Agents.cuttingReportText(app.record));
  });
  els.dlDds.addEventListener('click', () => {
    if (app.record && app.record.compliance) Agents.download('due-diligence-statement.txt', Agents.ddsText(app.record));
  });
  els.dlPlan.addEventListener('click', () => {
    if (app.an && app.result) Report.downloadReport(app.an, app.result, { imageName: app.imageName });
  });

  // ---------- multiplayer ----------

  function syncInputs(extra) {
    if (app.applyingRemote || !Session.state.id) return;
    const patch = {
      image: app.imageRef,
      imageName: app.imageName,
      imageDocKey: app.imageDocKey,
      stoneWidthMm: Number(els.widthInput.value) || 12,
      objective: els.objective.value,
      ...(extra || {}),
    };
    Session.push(patch);
  }

  Session.state.onRoster = names => {
    els.participants.innerHTML = '';
    for (const n of names) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = n;
      els.participants.appendChild(chip);
    }
    els.participants.hidden = names.length === 0;
  };

  Session.state.onRemoteState = (patch, { initial }) => {
    app.applyingRemote = true;
    try {
      if (patch.stoneWidthMm) els.widthInput.value = patch.stoneWidthMm;
      if (patch.objective) els.objective.value = patch.objective;
      const wantRun = patch.runId && patch.runId > app.runId;
      if (wantRun) app.runId = patch.runId;
      const sameImage = JSON.stringify(patch.image) === JSON.stringify(app.imageRef);
      if (patch.image && !sameImage) {
        loadFromRef(patch.image, patch.imageName || 'shared scan', () => {
          app.applyingRemote = false;
          if (wantRun) run(true);
        }, patch.imageDocKey);
        return;
      }
      if (wantRun) run(true);
    } finally {
      app.applyingRemote = false;
    }
  };

  async function openShare() {
    els.shareBtn.disabled = true;
    try {
      if (!Session.state.id) {
        const id = await Session.create();
        await Session.join(id, myName());
        syncInputs();
      }
      const info = await Session.hostInfo();
      const urls = Session.shareUrls(Session.state.id, info);
      els.shareUrls.innerHTML = '';
      for (const u of urls) {
        const row = document.createElement('div');
        row.className = 'share-row';
        const code = document.createElement('code');
        code.textContent = u;
        const btn = document.createElement('button');
        btn.className = 'btn btn-ghost btn-small';
        btn.textContent = 'Copy';
        btn.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(u); btn.textContent = 'Copied'; }
          catch (e) { btn.textContent = 'Select and copy'; }
          setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
        });
        row.append(code, btn);
        els.shareUrls.appendChild(row);
      }
      els.shareModal.hidden = false;
    } catch (e) {
      setStatus('Share failed. Is the local server running?', false);
    } finally {
      els.shareBtn.disabled = false;
    }
  }

  function myName() {
    const n = Math.floor(Math.random() * 90) + 10;
    return `Guest ${n}`;
  }

  els.shareBtn.addEventListener('click', openShare);
  els.shareClose.addEventListener('click', () => { els.shareModal.hidden = true; });
  els.shareModal.addEventListener('click', e => {
    if (e.target === els.shareModal) els.shareModal.hidden = true;
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !els.shareModal.hidden) els.shareModal.hidden = true;
  });

  // join via ?session=
  const sessionId = new URLSearchParams(location.search).get('session');
  if (sessionId) {
    Session.join(sessionId.toUpperCase(), myName()).then(() => {
      setStatus(`Joined session ${sessionId.toUpperCase()}`, true);
    }).catch(() => setStatus('Session not found or expired', false));
  }

  // ---------- chrome ----------

  window.addEventListener('scroll', () => {
    els.nav.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });

  document.querySelectorAll('.reveal').forEach((el, i) => {
    el.style.transitionDelay = `${Math.min(i * 60, 240)}ms`;
  });
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  // fail open: entrance animation must never be able to hide content
  setTimeout(() => document.querySelectorAll('.reveal').forEach(el => el.classList.add('in')), 1500);

  ModelCard.init();

  // preload the "before" sample so the demo starts one click from ready
  const first = els.samples.querySelector('button[data-src]');
  if (first && !sessionId) first.click();
})();
