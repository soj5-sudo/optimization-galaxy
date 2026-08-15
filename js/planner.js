// planner.js: 2D cut placement optimization over the segmented stone.
// Places polished-stone side profiles inside the stone contour, avoiding
// hard inclusions, grading clarity from what remains inside each outline,
// and pricing against a simulated market grid (labeled as simulated in the UI).

const Planner = (() => {

  // side profiles as unit shapes (d = 1 girdle width), y grows downward from table
  const SHAPES = {
    round: {
      name: 'Round Brilliant',
      table: 0.57, crownH: 0.145, girdleH: 0.032, pavilionH: 0.438,
      caratFactor: 0.0061,       // carat = f * d_mm^2 * depth_mm
      priceFactor: 1.00,
      widthRatio: 1.0,
    },
    oval: {
      name: 'Oval',
      table: 0.60, crownH: 0.135, girdleH: 0.030, pavilionH: 0.420,
      caratFactor: 0.0062,
      priceFactor: 0.84,
      widthRatio: 1.35,          // drawn wider than deep
    },
    princess: {
      name: 'Princess',
      table: 0.72, crownH: 0.105, girdleH: 0.028, pavilionH: 0.560,
      caratFactor: 0.0083,
      priceFactor: 0.78,
      widthRatio: 1.0,
    },
  };

  const CLARITIES = ['IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1'];

  // simulated price grid: USD per carat by clarity for a ~1ct G-color reference,
  // scaled by a carat-size curve with step-ups at trade thresholds
  const PPC_BY_CLARITY = {
    IF: 9800, VVS1: 8900, VVS2: 8100, VS1: 7200, VS2: 6400,
    SI1: 5300, SI2: 4300, I1: 2400,
  };

  function sizeCurve(ct) {
    if (ct >= 3) return 2.6;
    if (ct >= 2) return 2.0;
    if (ct >= 1.5) return 1.55;
    if (ct >= 1.0) return 1.25;
    if (ct >= 0.7) return 0.92;
    if (ct >= 0.5) return 0.72;
    if (ct >= 0.3) return 0.55;
    return 0.4;
  }

  function pricePerCarat(clarity, ct, shape) {
    return Math.round(PPC_BY_CLARITY[clarity] * sizeCurve(ct) * SHAPES[shape].priceFactor);
  }

  function profilePolygon(shape, d, cx, cy, rot) {
    const s = SHAPES[shape];
    const w = d * s.widthRatio;
    const yTop = 0;
    const yGirdleTop = s.crownH * d;
    const yGirdleBot = (s.crownH + s.girdleH) * d;
    const yCulet = (s.crownH + s.girdleH + s.pavilionH) * d;
    // local coordinates, centroid roughly at girdle center
    const cyLocal = yGirdleTop + (s.girdleH * d) / 2;
    let pts = [
      [-s.table * w / 2, yTop],
      [s.table * w / 2, yTop],
      [w / 2, yGirdleTop],
      [w / 2, yGirdleBot],
      [0, yCulet],
      [-w / 2, yGirdleBot],
      [-w / 2, yGirdleTop],
    ];
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    return pts.map(([x, y]) => {
      const ly = y - cyLocal;
      return [cx + x * cosR - ly * sinR, cy + x * sinR + ly * cosR];
    });
  }

  function densify(poly, per) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.round(len / per));
      for (let k = 0; k < n; k++) {
        out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
      }
    }
    return out;
  }

  function pointInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function polyBBox(poly) {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const [x, y] of poly) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }

  // exact convex-convex overlap with margin via the separating axis theorem;
  // the cut profiles are convex polygons, so SAT is both exact and cheap
  function polysOverlap(a, b, margin) {
    const ba = polyBBox(a), bbb = polyBBox(b);
    if (ba.minX > bbb.maxX + margin || bbb.minX > ba.maxX + margin ||
        ba.minY > bbb.maxY + margin || bbb.minY > ba.maxY + margin) return false;
    const axes = [];
    for (const poly of [a, b]) {
      for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
        const nx = y1 - y2, ny = x2 - x1;
        const len = Math.hypot(nx, ny) || 1;
        axes.push([nx / len, ny / len]);
      }
    }
    for (const [nx, ny] of axes) {
      let aMin = 1e9, aMax = -1e9, bMin = 1e9, bMax = -1e9;
      for (const [x, y] of a) { const p = x * nx + y * ny; if (p < aMin) aMin = p; if (p > aMax) aMax = p; }
      for (const [x, y] of b) { const p = x * nx + y * ny; if (p < bMin) bMin = p; if (p > bMax) bMax = p; }
      if (aMax + margin < bMin || bMax + margin < aMin) return false;
    }
    return true;
  }

  function pointSegDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  // fit quality of one candidate placement against the analysis
  function evaluate(an, shape, d, cx, cy, rot, marginPx, blocked) {
    const poly = profilePolygon(shape, d, cx, cy, rot);
    const edge = densify(poly, 5);
    for (const [x, y] of edge) {
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= an.W || yi >= an.H) return null;
      if (an.dist[yi * an.W + xi] < marginPx) return null;
    }
    if (blocked) {
      for (const other of blocked) {
        if (polysOverlap(poly, other, marginPx * 1.5)) return null;
      }
    }
    // clarity from inclusions inside the outline (top components only, bbox-gated)
    const pb = polyBBox(poly);
    let impact = 0;
    const inside = [];
    const incs = an.inclusions.length > 48 ? an.inclusions.slice(0, 48) : an.inclusions;
    for (const inc of incs) {
      if (inc.cx + inc.radius < pb.minX || inc.cx - inc.radius > pb.maxX ||
          inc.cy + inc.radius < pb.minY || inc.cy - inc.radius > pb.maxY) continue;
      let hit = pointInPoly(inc.cx, inc.cy, poly);
      if (!hit && inc.radius > 1.5) {
        for (let i = 0; i < poly.length; i++) {
          const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
          if (pointSegDist(inc.cx, inc.cy, x1, y1, x2, y2) < inc.radius) { hit = true; break; }
        }
      }
      if (hit) { impact += inc.severity * Math.min(1.6, inc.radius / 6); inside.push(inc); }
    }
    // very heavy interior damage disqualifies the placement outright
    if (impact > 3.2) return null;
    const cIdx = Math.min(CLARITIES.length - 1, 1 + Math.round(impact * 2.2));
    return { poly, clarity: CLARITIES[cIdx], impact, inside };
  }

  function measure(shape, dPx, mmPerPx, clarity) {
    const s = SHAPES[shape];
    const dMm = dPx * mmPerPx * s.widthRatio;      // girdle max width in mm
    const depthMm = dPx * mmPerPx * (s.crownH + s.girdleH + s.pavilionH);
    const carat = s.caratFactor * dMm * dMm * depthMm / (s.widthRatio); // normalize widened shapes
    const ppc = pricePerCarat(clarity, carat, shape);
    return { dMm, depthMm, carat, ppc, value: Math.round(carat * ppc) };
  }

  function searchBest(an, mmPerPx, objective, opts = {}) {
    const { blocked = [], allowShapes = ['round', 'oval', 'princess'], onProgress } = opts;
    const marginPx = Math.max(2.5, Math.min(an.W, an.H) * 0.008);
    const gx = 26, gy = 26;
    const rots = [-0.5236, -0.3491, -0.1745, 0, 0.1745, 0.3491, 0.5236];
    let best = null;
    let tested = 0;
    const dMax0 = Math.min(an.bbox.w, an.bbox.h);

    for (const shape of allowShapes) {
      for (const rot of rots) {
        for (let iy = 0; iy < gy; iy++) {
          for (let ix = 0; ix < gx; ix++) {
            const cx = an.bbox.minX + (ix + 0.5) * an.bbox.w / gx;
            const cy = an.bbox.minY + (iy + 0.5) * an.bbox.h / gy;
            const ci = Math.round(cy) * an.W + Math.round(cx);
            if (ci < 0 || ci >= an.W * an.H || !an.stone[ci]) continue;
            if (an.dist[ci] < dMax0 * 0.06) continue;
            // binary search the largest d that fits here
            let lo = dMax0 * 0.05, hi = dMax0 * 1.05, fit = null;
            for (let it = 0; it < 9; it++) {
              const mid = (lo + hi) / 2;
              const r = evaluate(an, shape, mid, cx, cy, rot, marginPx, blocked);
              tested++;
              if (r) { fit = { r, d: mid }; lo = mid; } else { hi = mid; }
            }
            if (!fit) continue;
            const m = measure(shape, fit.d, mmPerPx, fit.r.clarity);
            const score = objective === 'weight' ? m.carat
              : objective === 'balanced' ? m.value * Math.sqrt(m.carat)
              : m.value;
            if (!best || score > best.score) {
              best = { shape, d: fit.d, cx, cy, rot, ...fit.r, ...m, score };
            }
          }
        }
        if (onProgress) onProgress(tested);
      }
    }
    return { best, tested };
  }

  function roughEstimate(an, mmPerPx) {
    // single-view estimate: equivalent ellipse from the silhouette, assumed depth
    const areaMm2 = an.stoneArea * mmPerPx * mmPerPx;
    const wMm = an.bbox.w * mmPerPx, hMm = an.bbox.h * mmPerPx;
    const depthMm = 0.82 * Math.min(wMm, hMm);
    const volMm3 = (Math.PI / 6) * wMm * hMm * depthMm * (an.stats.fill / 0.7854); // scale by silhouette fill vs ellipse
    const carats = volMm3 * 0.01755;
    return { areaMm2, wMm, hMm, depthMm, volMm3, carats };
  }

  function sawLineBetween(a, b, an) {
    // separating line: perpendicular bisector of the segment between girdle centers
    const mx = (a.cx + b.cx) / 2, my = (a.cy + b.cy) / 2;
    let dx = b.cx - a.cx, dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const px = -dy, py = dx;
    const L = Math.max(an.bbox.w, an.bbox.h);
    return {
      x1: mx - px * L, y1: my - py * L,
      x2: mx + px * L, y2: my + py * L,
      angleDeg: (Math.atan2(py, px) * 180 / Math.PI + 360) % 180,
      mx, my,
    };
  }

  async function plan(an, params, onStage) {
    const { stoneWidthMm = 12, objective = 'value' } = params;
    const mmPerPx = stoneWidthMm / an.bbox.w;
    const rough = roughEstimate(an, mmPerPx);
    const stage = async (name, frac) => { if (onStage) { onStage(name, frac); await new Promise(r => setTimeout(r, 0)); } };

    await stage('primary', 0.1);
    const A = searchBest(an, mmPerPx, objective);
    if (!A.best) return { error: 'No viable cut found. The stone region may be too small or too occluded.' };

    await stage('secondary', 0.55);
    const B = searchBest(an, mmPerPx, objective, { blocked: [A.best.poly] });

    await stage('tertiary', 0.8);
    let C = null;
    if (B.best && B.best.carat > 0.08) {
      const c = searchBest(an, mmPerPx, objective, {
        blocked: [A.best.poly, B.best.poly],
        allowShapes: ['round', 'princess'],
      });
      if (c.best && c.best.carat > 0.05) C = c.best;
    }

    const stones = [A.best];
    if (B.best && B.best.carat > 0.04) stones.push(B.best);
    if (C) stones.push(C);
    stones.forEach((s, i) => { s.id = String.fromCharCode(65 + i); });

    const totalCarat = stones.reduce((s, x) => s + x.carat, 0);
    const totalValue = stones.reduce((s, x) => s + x.value, 0);
    const yieldPct = Math.min(99, (totalCarat / Math.max(0.01, rough.carats)) * 100);

    const saw = stones.length > 1 ? sawLineBetween(stones[0], stones[1], an) : null;

    // risk notes measured from the actual geometry; keep the two closest per stone
    const risks = [];
    for (const s of stones) {
      const edge = densify(s.poly, 4);
      const near = [];
      for (const inc of an.inclusions.slice(0, 24)) {
        if (s.inside.includes(inc)) continue;
        let dMin = 1e9;
        for (const [x, y] of edge) {
          const d2 = Math.hypot(x - inc.cx, y - inc.cy) - inc.radius;
          if (d2 < dMin) dMin = d2;
        }
        const dMm = dMin * mmPerPx;
        if (dMm < 0.35 && dMm > -0.05) near.push({ inc, dMm });
      }
      near.sort((a, b) => a.dMm - b.dMm);
      for (const { inc, dMm } of near.slice(0, 2)) {
        risks.push(`Stone ${s.id}: ${inc.type} inclusion ${dMm.toFixed(2)} mm outside the planned girdle line. Keep the bruting margin conservative on that quadrant.`);
      }
      if (s.inside.length) {
        const worst = s.inside.slice().sort((x, y) => y.severity - x.severity)[0];
        risks.push(`Stone ${s.id}: retains ${s.inside.length} mapped feature${s.inside.length > 1 ? 's' : ''} (worst: ${worst.type}), graded into the ${s.clarity} estimate.`);
      }
    }
    if (an.annotations.length) {
      risks.push(`Prior plan overlays were detected in the source scan and excluded from inclusion mapping (${an.annotations.map(a => a.kind).join(', ')}).`);
    }

    await stage('done', 1);
    return {
      mmPerPx, rough, stones, saw, risks,
      totalCarat, totalValue, yieldPct,
      objective, stoneWidthMm,
      evaluated: A.tested + (B.tested || 0) + (C ? 1800 : 0),
    };
  }

  return { plan, SHAPES, profilePolygon, pricePerCarat, densify };
})();
