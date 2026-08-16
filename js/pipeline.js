// pipeline.js: staged inference presentation. The maps shown per stage are the
// real intermediates computed by cv.js; the layer naming follows the GXN-2
// model card. Stage timing is theatrical, the numbers are measured.

const Pipeline = (() => {

  const STAGES = [
    { key: 'input', label: 'THE SCAN', caption: 'The X-ray, as it came off the machine' },
    { key: 'stem', label: 'LIGHT', caption: 'Where the stone is, and where it is not' },
    { key: 'enc2', label: 'EDGES', caption: 'The outline of the rough' },
    { key: 'enc3', label: 'FLAW HEAT', caption: 'Where the flaws cluster' },
    { key: 'seg', label: 'FLAWS FOUND', caption: 'Every flaw marked, one by one' },
    { key: 'plan', label: 'FIT SEARCH', caption: 'Trying millions of ways to cut it' },
    { key: 'out', label: 'THE PLAN', caption: 'The stones we can get out' },
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
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(224,85,95,0.95)';
    for (let y = 0; y < an.H; y += 2) {
      for (let x = 0; x < an.W; x += 2) {
        if (an.maps.incMask[y * an.W + x]) ctx.fillRect(x * s, y * s, 2 * s, 2 * s);
      }
    }
    ctx.strokeStyle = 'rgba(233,236,242,0.85)';
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
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, c.width, c.height);
    const colors = ['rgba(233,236,242,0.6)', 'rgba(196,198,202,0.5)', 'rgba(130,134,142,0.45)'];
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
    logLine(log, 'MODEL', `Reading the scan, <span class="num">${img.naturalWidth} x ${img.naturalHeight}</span>`);
    setProg(0.04);

    const t0 = performance.now();
    const an = CV.analyze(img);
    const analysisMs = performance.now() - t0;

    // stage 1: input
    strip.appendChild(tile(STAGES[0], thumbOf(an.canvas), `${an.W} x ${an.H} work grid`));
    await wait(420); setProg(0.14);

    // stage 2: stem (gray)
    strip.appendChild(tile(STAGES[1], CV.renderMap(an.maps.lum, an.W, an.H, { mode: 'gray' }),
      ''));
    logLine(log, 'MODEL', 'Separating the stone from the background');
    await wait(420); setProg(0.26);

    // stage 3: edges
    strip.appendChild(tile(STAGES[2], CV.renderMap(an.maps.edges, an.W, an.H, { mode: 'ice' }),
      ''));
    logLine(log, 'MODEL', `Outline traced, the rough fills <span class="num">${(an.stats.fill * 100).toFixed(1)}%</span> of the frame`);
    await wait(420); setProg(0.38);

    // stage 4: heat
    strip.appendChild(tile(STAGES[3], CV.renderMap(an.maps.heat, an.W, an.H, { mode: 'heat' }),
      ''));
    await wait(380); setProg(0.5);

    // stage 5: segmentation
    strip.appendChild(tile(STAGES[4], maskOverlayThumb(an),
      `${an.inclusions.length} flaws`));
    logLine(log, 'MODEL', `Found <span class="num">${an.inclusions.length}</span> flaws inside the stone`);
    await wait(430); setProg(0.62);

    // stage 6: plan search (real optimization runs inside)
    let evals = 0;
    const result = await Planner.plan(an, params, (name, frac) => {
      setProg(0.62 + frac * 0.3);
      if (name === 'primary') logLine(log, 'MODEL', 'Searching for the biggest stone that misses the flaws');
      if (name === 'secondary') logLine(log, 'MODEL', 'Now the second stone, from what is left over');
      if (name === 'tertiary') logLine(log, 'MODEL', 'And a third, if the offcut is worth cutting');
    });

    if (result.error) {
      setStatus('Inference failed', false);
      logLine(log, 'GXN-2', result.error);
      setProg(0);
      return { an, result };
    }

    strip.appendChild(tile(STAGES[5], CV.renderMap(an.maps.heat, an.W, an.H, { mode: 'ice' }),
      `${result.evaluated.toLocaleString()} options tried`));
    await wait(380); setProg(0.95);

    // stage 7: output
    strip.appendChild(tile(STAGES[6], planThumb(an, result),
      `${result.stones.length} stones, ${result.yieldPct.toFixed(1)}% yield`));

    const totalMs = performance.now() - t0;
    logLine(log, 'MODEL', `Plan ready: <span class="num">${result.stones.length}</span> stones, <span class="num">${result.totalCarat.toFixed(2)} ct</span> out of the rough, in <span class="num">${(totalMs / 1000).toFixed(1)}s</span>`);
    setStatus('Plan ready', false);
    setProg(1);
    return { an, result };
  }

  return { run, logLine };
})();
