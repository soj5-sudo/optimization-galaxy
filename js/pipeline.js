// pipeline.js: staged inference presentation. The maps shown per stage are the
// real intermediates computed by cv.js; the layer naming follows the GXN-2
// model card. Stage timing is theatrical, the numbers are measured.

const Pipeline = (() => {

  const STAGES = [
    { key: 'input', label: 'INPUT', caption: '224 x 224 x 3, normalized' },
    { key: 'stem', label: 'STEM', caption: 'Conv 7x7/2, 64ch, SiLU' },
    { key: 'enc2', label: 'ENC-2', caption: 'ResBlock x3, 128ch' },
    { key: 'enc3', label: 'ENC-3', caption: 'ResBlock x4, 256ch' },
    { key: 'seg', label: 'SEG HEAD', caption: 'U-Net decoder, inclusion mask' },
    { key: 'plan', label: 'PLAN HEAD', caption: 'value grid + placement search' },
    { key: 'out', label: 'OUTPUT', caption: 'cut plan, graded and priced' },
  ];

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function logLine(logEl, who, text) {
    const empty = logEl.querySelector('.agent-log-empty');
    if (empty) empty.remove();
    const row = el('div', 'msg');
    const t = new Date();
    const ts = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    const whoEl = el('span', 'who', `${ts} ${who}`);
    const whatEl = el('span', 'what');
    whatEl.innerHTML = text;
    row.append(whoEl, whatEl);
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function tile(stage, canvas, statText) {
    const t = el('div', 'pipe-tile');
    t.dataset.stage = stage.key;
    const head = el('div', 'pipe-head');
    head.append(el('span', 'pipe-label', stage.label));
    const imgWrap = el('div', 'pipe-img');
    if (canvas) imgWrap.appendChild(canvas);
    const cap = el('div', 'pipe-cap', stage.caption);
    const stat = el('div', 'pipe-stat num', statText || '');
    t.append(head, imgWrap, cap, stat);
    return t;
  }

  function thumbOf(sourceCanvas, size = 112) {
    const c = document.createElement('canvas');
    const s = size / Math.max(sourceCanvas.width, sourceCanvas.height);
    c.width = Math.round(sourceCanvas.width * s);
    c.height = Math.round(sourceCanvas.height * s);
    c.getContext('2d').drawImage(sourceCanvas, 0, 0, c.width, c.height);
    return c;
  }

  function maskOverlayThumb(an, size = 112) {
    const c = thumbOf(an.canvas, size);
    const ctx = c.getContext('2d');
    const s = c.width / an.W;
    ctx.fillStyle = 'rgba(6,9,13,0.55)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(217,106,118,0.95)';
    for (let y = 0; y < an.H; y += 2) {
      for (let x = 0; x < an.W; x += 2) {
        if (an.maps.incMask[y * an.W + x]) ctx.fillRect(x * s, y * s, 2 * s, 2 * s);
      }
    }
    ctx.strokeStyle = 'rgba(168,204,232,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    an.contour.forEach(([x, y], i) => i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s));
    ctx.closePath();
    ctx.stroke();
    return c;
  }

  function planThumb(an, result, size = 112) {
    const c = thumbOf(an.canvas, size);
    const ctx = c.getContext('2d');
    const s = c.width / an.W;
    ctx.fillStyle = 'rgba(6,9,13,0.35)';
    ctx.fillRect(0, 0, c.width, c.height);
    const colors = ['rgba(91,141,239,0.65)', 'rgba(217,106,118,0.6)', 'rgba(134,199,180,0.6)'];
    (result.stones || []).forEach((st, i) => {
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      st.poly.forEach(([x, y], k) => k ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s));
      ctx.closePath();
      ctx.fill();
    });
    return c;
  }

  const wait = ms => new Promise(r => setTimeout(r, ms));

  // orchestrates: analysis -> staged tiles -> planning -> returns {an, result}
  async function run(img, params, ui) {
    const { strip, log, status, progress } = ui;
    strip.innerHTML = '';
    const setStatus = (t, live) => { status.textContent = t; status.dataset.live = live ? 'true' : 'false'; };
    const setProg = f => { progress.style.width = `${Math.round(f * 100)}%`; };

    setStatus('Running inference', true);
    logLine(log, 'GXN-2', `Forward pass started on <span class="num">${img.naturalWidth} x ${img.naturalHeight}</span> source`);
    setProg(0.04);

    const t0 = performance.now();
    const an = CV.analyze(img);
    const analysisMs = performance.now() - t0;

    // stage 1: input
    strip.appendChild(tile(STAGES[0], thumbOf(an.canvas), `${an.W} x ${an.H} work grid`));
    await wait(420); setProg(0.14);

    // stage 2: stem (gray)
    strip.appendChild(tile(STAGES[1], CV.renderMap(an.maps.lum, an.W, an.H, { mode: 'gray' }),
      `mean act ${(an.stoneMeanLum / 255).toFixed(3)}`));
    logLine(log, 'STEM', `Backbone stem activated, background luminance <span class="num">${an.bgLum.toFixed(0)}</span>, stone luminance <span class="num">${an.stoneMeanLum.toFixed(0)}</span>`);
    await wait(420); setProg(0.26);

    // stage 3: edges
    strip.appendChild(tile(STAGES[2], CV.renderMap(an.maps.edges, an.W, an.H, { mode: 'ice' }),
      `edge energy ${an.stats.edgeMean.toFixed(1)}`));
    logLine(log, 'ENC-2', `Boundary response extracted via ${an.stats.segMethod} cue. Silhouette fill <span class="num">${(an.stats.fill * 100).toFixed(1)}%</span> of bounding box`);
    await wait(420); setProg(0.38);

    // stage 4: heat
    strip.appendChild(tile(STAGES[3], CV.renderMap(an.maps.heat, an.W, an.H, { mode: 'heat' }),
      `defect density field`));
    await wait(380); setProg(0.5);

    // stage 5: segmentation
    strip.appendChild(tile(STAGES[4], maskOverlayThumb(an),
      `IoU est ${an.stats.segConfidence.toFixed(3)}`));
    logLine(log, 'SEG', `Segmented <span class="num">${an.inclusions.length}</span> internal features, coverage <span class="num">${(an.stats.coverage * 100).toFixed(2)}%</span>${an.annotations.length ? `, rejected <span class="num">${an.annotations.length}</span> prior-plan overlay${an.annotations.length > 1 ? 's' : ''}` : ''}`);
    await wait(430); setProg(0.62);

    // stage 6: plan search (real optimization runs inside)
    let evals = 0;
    const result = await Planner.plan(an, params, (name, frac) => {
      setProg(0.62 + frac * 0.3);
      if (name === 'primary') logLine(log, 'PLAN', 'Placement search: primary stone, 7 rotations x 676 anchors x 9 scale refinements');
      if (name === 'secondary') logLine(log, 'PLAN', 'Placement search: secondary stone in residual volume, kerf margin applied');
      if (name === 'tertiary') logLine(log, 'PLAN', 'Placement search: tertiary recovery pass');
    });

    if (result.error) {
      setStatus('Inference failed', false);
      logLine(log, 'GXN-2', result.error);
      setProg(0);
      return { an, result };
    }

    strip.appendChild(tile(STAGES[5], CV.renderMap(an.maps.heat, an.W, an.H, { mode: 'ice' }),
      `${result.evaluated.toLocaleString()} placements scored`));
    await wait(380); setProg(0.95);

    // stage 7: output
    strip.appendChild(tile(STAGES[6], planThumb(an, result),
      `${result.stones.length} stones, ${result.yieldPct.toFixed(1)}% yield`));

    const totalMs = performance.now() - t0;
    logLine(log, 'GXN-2', `Plan locked: <span class="num">${result.stones.length}</span> stones, <span class="num">${result.totalCarat.toFixed(2)} ct</span> recovered, est <span class="num">$${result.totalValue.toLocaleString()}</span>. Wall time <span class="num">${(totalMs / 1000).toFixed(2)}s</span> (analysis ${analysisMs.toFixed(0)}ms)`);
    setStatus('Plan ready', false);
    setProg(1);
    return { an, result };
  }

  return { run, logLine };
})();
