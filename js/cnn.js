// cnn.js
// Browser side of the convolutional model.
//
// This runs the identical forward pass as ml/cnn.py, reading the weights that
// training produced. It is deliberately a straight transcription rather than a
// clever one: the same layer order, the same padding, the same normalisation
// constants, so a number produced here can be reproduced in Python and argued
// about.
//
// If the weights are missing the model reports itself unavailable and the rest
// of the system falls back to the classical detector. It never silently
// substitutes one for the other, because a buyer is entitled to know which
// component produced a number.

const CNN = (() => {

  let model = null;
  let status = { loaded: false, reason: 'not loaded yet' };

  async function load(url = 'ml/artifacts/weights.json') {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) { status = { loaded: false, reason: `weights not found (${res.status})` }; return status; }
      const w = await res.json();
      model = w;
      status = {
        loaded: true,
        reason: null,
        architecture: w.architecture || w.layers?.map(l => l.type).join(' -> '),
        patch: w.preprocessing?.patch_size || w.patch_size || 24,
        trainedOn: w.trained_on || null,
        accuracy: w.test_accuracy || null,
        version: w.version || null,
      };
      return status;
    } catch (e) {
      status = { loaded: false, reason: 'weights failed to load' };
      return status;
    }
  }

  function getStatus() { return status; }

  // ---------- layer primitives ----------
  // Layout is CHW, the same as the Python, and convolutions are padded the same
  // way. Any deviation here would mean the browser quietly computes something
  // different from the thing that was trained, which is the kind of bug that
  // survives a demo and fails in front of a customer.

  function conv2d(t, kernel, kh, kw, outC, bias, pad) {
    const { data, H, W, C } = t;
    const outH = H + 2 * pad - kh + 1;
    const outW = W + 2 * pad - kw + 1;
    const out = new Float32Array(outC * outH * outW);
    for (let oc = 0; oc < outC; oc++) {
      const b = bias ? bias[oc] : 0;
      const kern = kernel[oc];                       // [kh][kw][inC]
      for (let oy = 0; oy < outH; oy++) {
        for (let ox = 0; ox < outW; ox++) {
          let sum = b;
          for (let ky = 0; ky < kh; ky++) {
            const iy = oy + ky - pad;
            if (iy < 0 || iy >= H) continue;
            for (let kx = 0; kx < kw; kx++) {
              const ix = ox + kx - pad;
              if (ix < 0 || ix >= W) continue;
              const krow = kern[ky][kx];
              for (let c = 0; c < C; c++) {
                sum += data[c * H * W + iy * W + ix] * krow[c];
              }
            }
          }
          out[oc * outH * outW + oy * outW + ox] = sum;
        }
      }
    }
    return { data: out, H: outH, W: outW, C: outC };
  }

  function relu(t) {
    for (let i = 0; i < t.data.length; i++) if (t.data[i] < 0) t.data[i] = 0;
    return t;
  }

  function maxPool2(t) {
    const outH = Math.floor(t.H / 2), outW = Math.floor(t.W / 2);
    const out = new Float32Array(t.C * outH * outW);
    for (let c = 0; c < t.C; c++) {
      for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
          let m = -Infinity;
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const v = t.data[c * t.H * t.W + (y * 2 + dy) * t.W + (x * 2 + dx)];
              if (v > m) m = v;
            }
          }
          out[c * outH * outW + y * outW + x] = m;
        }
      }
    }
    return { data: out, H: outH, W: outW, C: t.C };
  }

  // numpy reshape on a CHW block is already channel major, so the flat vector
  // is exactly the buffer we hold
  function flatten(t) {
    return { data: t.data, H: 1, W: 1, C: t.data.length };
  }

  function dense(vec, weights, bias) {
    const outN = bias.length;
    const out = new Float32Array(outN);
    for (let o = 0; o < outN; o++) {
      let sum = bias[o];
      for (let i = 0; i < vec.length; i++) sum += vec[i] * weights[i][o];
      out[o] = sum;
    }
    return out;
  }

  function softmax(v) {
    let max = -Infinity;
    for (const x of v) if (x > max) max = x;
    let sum = 0;
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) { out[i] = Math.exp(v[i] - max); sum += out[i]; }
    for (let i = 0; i < out.length; i++) out[i] /= sum;
    return out;
  }

  // ---------- forward ----------
  function forward(patch, p) {
    if (!model) return null;
    let t = { data: Float32Array.from(patch), H: p, W: p, C: 1 };
    for (const layer of model.layers) {
      if (layer.type === 'conv') {
        t = conv2d(t, layer.kernel, layer.kh, layer.kw, layer.out_channels, layer.bias, layer.pad || 0);
      } else if (layer.type === 'relu') {
        t = relu(t);
      } else if (layer.type === 'maxpool') {
        t = maxPool2(t);
      } else if (layer.type === 'flatten') {
        t = flatten(t);
      } else if (layer.type === 'dense') {
        t = { data: dense(t.data, layer.weights, layer.bias), H: 1, W: 1, C: layer.bias.length };
      } else if (layer.type === 'softmax') {
        t = { data: softmax(t.data), H: 1, W: 1, C: t.data.length };
      }
    }
    return t.data;
  }

  // ---------- scan level inference ----------
  // Slides the classifier over the stone and returns a probability map plus the
  // aggregate numbers the pre cut gate needs.
  function analyseScan(an, opts = {}) {
    if (!model) return { available: false, reason: status.reason };
    const p = (model.preprocessing && model.preprocessing.patch_size) || model.patch_size || 24;
    const stride = opts.stride || Math.max(4, Math.round(p / 3));

    const W = an.W, H = an.H;
    const lum = an.maps.lum;
    const stone = an.stone;
    const half = Math.floor(p / 2);

    const gridW = Math.floor((W - p) / stride) + 1;
    const gridH = Math.floor((H - p) / stride) + 1;
    const probs = new Float32Array(gridW * gridH);
    const inside = new Uint8Array(gridW * gridH);

    const patch = new Float32Array(p * p);
    let scored = 0, flawy = 0, confSum = 0;

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const x0 = gx * stride, y0 = gy * stride;
        const cx = x0 + half, cy = y0 + half;
        // only score inside the stone
        if (!stone[cy * W + cx]) continue;
        // standardise the patch against itself, exactly as dataset.py does
        let sum = 0;
        for (let y = 0; y < p; y++) {
          for (let x = 0; x < p; x++) {
            const v = lum[(y0 + y) * W + (x0 + x)];
            patch[y * p + x] = v;
            sum += v;
          }
        }
        const mu = sum / (p * p);
        let varSum = 0;
        for (let i = 0; i < patch.length; i++) { const d = patch[i] - mu; varSum += d * d; }
        const sd = Math.max(Math.sqrt(varSum / (p * p)), 1e-3 * 255);
        for (let i = 0; i < patch.length; i++) patch[i] = (patch[i] - mu) / sd;
        const out = forward(patch, p);
        if (!out) continue;
        const pFlaw = out.length > 1 ? out[1] : out[0];
        probs[gy * gridW + gx] = pFlaw;
        inside[gy * gridW + gx] = 1;
        scored++;
        confSum += Math.max(pFlaw, 1 - pFlaw);   // how decisive the call was
        if (pFlaw > 0.5) flawy++;
      }
    }

    return {
      available: true,
      probs, inside, gridW, gridH, stride, patch: p,
      scored,
      flawFraction: scored ? flawy / scored : 0,
      meanConfidence: scored ? confSum / scored : 0,
      version: model.version || null,
      accuracy: model.test_accuracy || null,
    };
  }

  // fraction of a planned outline that the model marks as flawed, plus the
  // closest flaw to that outline in millimetres
  function evidenceForStone(scanResult, stonePoly, mmPerPx) {
    if (!scanResult || !scanResult.available) return {};
    const { probs, inside, gridW, gridH, stride, patch } = scanResult;
    const half = Math.floor(patch / 2);

    const pointInPoly = (px, py, poly) => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };

    let insideCells = 0, flawCells = 0, nearest = Infinity, confSum = 0;
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const idx = gy * gridW + gx;
        if (!inside[idx]) continue;
        const cx = gx * stride + half, cy = gy * stride + half;
        const pFlaw = probs[idx];
        const isIn = pointInPoly(cx, cy, stonePoly);
        if (isIn) {
          insideCells++;
          confSum += Math.max(pFlaw, 1 - pFlaw);
          if (pFlaw > 0.5) flawCells++;
        } else if (pFlaw > 0.5) {
          // distance from this flaw cell to the nearest edge of the outline
          for (let i = 0; i < stonePoly.length; i++) {
            const [x1, y1] = stonePoly[i], [x2, y2] = stonePoly[(i + 1) % stonePoly.length];
            const dx = x2 - x1, dy = y2 - y1;
            const t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / (dx * dx + dy * dy || 1)));
            const d = Math.hypot(cx - (x1 + t * dx), cy - (y1 + t * dy));
            if (d < nearest) nearest = d;
          }
        }
      }
    }

    return {
      flawCoverageInside: insideCells ? flawCells / insideCells : 0,
      nearestFlawMm: Number.isFinite(nearest) ? nearest * mmPerPx : null,
      modelConfidence: insideCells ? confSum / insideCells : scanResult.meanConfidence,
      source: 'cnn',
      cellsInside: insideCells,
    };
  }

  // paints the probability map over the scan so a person can see what the model saw
  function renderHeat(scanResult, canvas, W, H) {
    if (!scanResult || !scanResult.available) return;
    const ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    const { probs, inside, gridW, gridH, stride, patch } = scanResult;
    const half = Math.floor(patch / 2);
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const idx = gy * gridW + gx;
        if (!inside[idx]) continue;
        const v = probs[idx];
        if (v < 0.5) continue;
        const a = Math.min(0.55, (v - 0.5) * 1.1);
        ctx.fillStyle = `rgba(217, 45, 32, ${a})`;
        ctx.fillRect(gx * stride + half - stride / 2, gy * stride + half - stride / 2, stride, stride);
      }
    }
  }

  return { load, getStatus, forward, analyseScan, evidenceForStone, renderHeat };
})();
