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
  };

  const app = {
    img: null,            // HTMLImageElement currently loaded
    imageName: null,
    imageRef: null,       // synced reference: {kind:'sample',src} | {kind:'data',dataURL}
    an: null,
    result: null,
    running: false,
    runId: 0,
    applyingRemote: false,
  };

  // ---------- image intake ----------

  function loadFromRef(ref, name, then) {
    const img = new Image();
    img.onload = () => {
      app.img = img;
      app.imageName = name;
      app.imageRef = ref;
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
      loadFromRef({ kind: 'sample', src: btn.dataset.src }, btn.dataset.name, syncInputs);
      els.samples.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ---------- run ----------

  function setStatus(text, live) {
    els.status.textContent = text;
    els.status.dataset.live = live ? 'true' : 'false';
  }

  async function run(fromRemote) {
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
        if (!fromRemote) {
          requestAnimationFrame(() => els.results.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        }
      }
    } finally {
      app.running = false;
      els.runBtn.disabled = false;
      els.runBtn.textContent = 'Run model';
    }
  }

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

  // ---------- multiplayer ----------

  function syncInputs(extra) {
    if (app.applyingRemote || !Session.state.id) return;
    const patch = {
      image: app.imageRef,
      imageName: app.imageName,
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
        });
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

  ModelCard.init();

  // preload the "before" sample so the demo starts one click from ready
  const first = els.samples.querySelector('button[data-src]');
  if (first && !sessionId) first.click();
})();
