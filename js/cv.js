// cv.js: real image analysis for Galaxy-style rough scans.
// Everything here is computed from the actual pixels: stone segmentation,
// inclusion detection (green/red/dark layers), annotation rejection,
// edge maps, heat maps, and a chamfer distance transform used by the planner.

const CV = (() => {

  const WORK_MAX = 760; // long-side cap for the working resolution

  function analyze(img) {
    const scale = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const W = Math.max(8, Math.round(img.naturalWidth * scale));
    const H = Math.max(8, Math.round(img.naturalHeight * scale));
    const cnv = document.createElement('canvas');
    cnv.width = W; cnv.height = H;
    const ctx = cnv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    const N = W * H;

    // ---- luminance ----
    const lum = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }

    // ---- Sobel edge magnitude (used as a segmentation cue and a feature map) ----
    const edges = new Float32Array(N);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx = -lum[i - W - 1] - 2 * lum[i - 1] - lum[i + W - 1] + lum[i - W + 1] + 2 * lum[i + 1] + lum[i + W + 1];
        const gy = -lum[i - W - 1] - 2 * lum[i - W] - lum[i - W + 1] + lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1];
        edges[i] = Math.sqrt(gx * gx + gy * gy) / 8;
      }
    }

    // ---- background estimate from border ring ----
    const border = [];
    const ring = Math.max(2, Math.round(Math.min(W, H) * 0.015));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x < ring || y < ring || x >= W - ring || y >= H - ring) border.push(y * W + x);
      }
    }
    // backgrounds in these scans are often bimodal (dark field plus a light
    // margin or UI band), so model the border as up to two clusters
    const borderLums = border.map(i => lum[i]).sort((a, b) => a - b);
    const lumMedian = borderLums[borderLums.length >> 1];
    const clusters = [
      { sum: [0, 0, 0], n: 0 },
      { sum: [0, 0, 0], n: 0 },
    ];
    for (const i of border) {
      const c = lum[i] <= lumMedian ? clusters[0] : clusters[1];
      c.sum[0] += data[i * 4]; c.sum[1] += data[i * 4 + 1]; c.sum[2] += data[i * 4 + 2];
      c.n++;
    }
    const bgCenters = clusters
      .filter(c => c.n > border.length * 0.08)
      .map(c => c.sum.map(v => v / c.n));
    const bg = bgCenters[0] || [0, 0, 0];
    const bgLum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];

    const queue = new Int32Array(N);
    const scratch = new Uint8Array(N);
    const erodeOnce = src => {
      scratch.fill(0);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (src[i] && src[i - 1] && src[i + 1] && src[i - W] && src[i + W]) scratch[i] = 1;
        }
      }
      src.set(scratch);
    };
    const dilateOnce = src => {
      scratch.fill(0);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (src[i] || src[i - 1] || src[i + 1] || src[i - W] || src[i + W]) scratch[i] = 1;
        }
      }
      src.set(scratch);
    };

    const isColored = i => {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      return (g > 64 && g > 1.22 * r && g > 1.12 * b) ||
             (r > 76 && r > 1.35 * g && r > 1.25 * b) ||
             (b > 76 && b > 1.22 * r && b > 1.10 * g) ||
             (r > 96 && b > 84 && g < 0.72 * Math.min(r, b));
    };
    const isWhiteUIAt = i => data[i * 4] > 232 && data[i * 4 + 1] > 232 && data[i * 4 + 2] > 232;

    // candidate A: distance from the background clusters
    function maskFromBgDistance() {
      const m = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        if (isWhiteUIAt(i)) continue;
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        let isBg = false;
        for (const c of bgCenters) {
          if (Math.abs(r - c[0]) + Math.abs(g - c[1]) + Math.abs(b - c[2]) <= 52) { isBg = true; break; }
        }
        if (!isBg) m[i] = 1;
      }
      erodeOnce(m); erodeOnce(m);
      return m;
    }

    // candidate B: local texture (speckle) plus colored overlay. Rough stone
    // surfaces are heavily textured; smooth margins and fields are not.
    function maskFromTexture() {
      const win = 3; // 7x7 window via integral images
      const sat = new Float64Array((W + 1) * (H + 1));
      const sat2 = new Float64Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) {
        let row = 0, row2 = 0;
        for (let x = 0; x < W; x++) {
          const v = lum[y * W + x];
          row += v; row2 += v * v;
          sat[(y + 1) * (W + 1) + (x + 1)] = sat[y * (W + 1) + (x + 1)] + row;
          sat2[(y + 1) * (W + 1) + (x + 1)] = sat2[y * (W + 1) + (x + 1)] + row2;
        }
      }
      const variance = (x, y) => {
        const x0 = Math.max(0, x - win), y0 = Math.max(0, y - win);
        const x1 = Math.min(W - 1, x + win), y1 = Math.min(H - 1, y + win);
        const n = (x1 - x0 + 1) * (y1 - y0 + 1);
        const s = sat[(y1 + 1) * (W + 1) + (x1 + 1)] - sat[y0 * (W + 1) + (x1 + 1)] - sat[(y1 + 1) * (W + 1) + x0] + sat[y0 * (W + 1) + x0];
        const s2 = sat2[(y1 + 1) * (W + 1) + (x1 + 1)] - sat2[y0 * (W + 1) + (x1 + 1)] - sat2[(y1 + 1) * (W + 1) + x0] + sat2[y0 * (W + 1) + x0];
        return s2 / n - (s / n) * (s / n);
      };
      // adaptive threshold: comfortably above the border's own texture level
      let borderVar = 0;
      for (let k = 0; k < border.length; k += 7) {
        const i = border[k];
        borderVar += variance(i % W, (i / W) | 0);
      }
      borderVar /= Math.ceil(border.length / 7);
      const tau = Math.max(70, borderVar * 2.6);
      const m = new Uint8Array(N);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (isWhiteUIAt(i)) continue;
          if (isColored(i) || variance(x, y) > tau) m[i] = 1;
        }
      }
      // close aggressively so speckle becomes a solid blob, then trim back
      dilateOnce(m); dilateOnce(m); dilateOnce(m);
      erodeOnce(m); erodeOnce(m);
      return m;
    }

    function largestFilled(mask) {
      const compId = new Int32Array(N).fill(-1);
      let best = -1, bestSize = 0, nComp = 0;
      for (let s = 0; s < N; s++) {
        if (!mask[s] || compId[s] !== -1) continue;
        let head = 0, tail = 0, size = 0;
        queue[tail++] = s; compId[s] = nComp;
        while (head < tail) {
          const i = queue[head++]; size++;
          const x = i % W, y = (i / W) | 0;
          if (x > 0 && mask[i - 1] && compId[i - 1] === -1) { compId[i - 1] = nComp; queue[tail++] = i - 1; }
          if (x < W - 1 && mask[i + 1] && compId[i + 1] === -1) { compId[i + 1] = nComp; queue[tail++] = i + 1; }
          if (y > 0 && mask[i - W] && compId[i - W] === -1) { compId[i - W] = nComp; queue[tail++] = i - W; }
          if (y < H - 1 && mask[i + W] && compId[i + W] === -1) { compId[i + W] = nComp; queue[tail++] = i + W; }
        }
        if (size > bestSize) { bestSize = size; best = nComp; }
        nComp++;
      }
      const m = new Uint8Array(N);
      for (let i = 0; i < N; i++) m[i] = (mask[i] && compId[i] === best) ? 1 : 0;
      // hole fill from the border
      const outside = new Uint8Array(N);
      let head = 0, tail = 0;
      for (const i of border) if (!m[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i; }
      while (head < tail) {
        const i = queue[head++];
        const x = i % W, y = (i / W) | 0;
        if (x > 0 && !m[i - 1] && !outside[i - 1]) { outside[i - 1] = 1; queue[tail++] = i - 1; }
        if (x < W - 1 && !m[i + 1] && !outside[i + 1]) { outside[i + 1] = 1; queue[tail++] = i + 1; }
        if (y > 0 && !m[i - W] && !outside[i - W]) { outside[i - W] = 1; queue[tail++] = i - W; }
        if (y < H - 1 && !m[i + W] && !outside[i + W]) { outside[i + W] = 1; queue[tail++] = i + W; }
      }
      for (let i = 0; i < N; i++) if (!m[i] && !outside[i]) m[i] = 1;
      dilateOnce(m); dilateOnce(m);
      return m;
    }

    // candidate C: flood the background inward from the border; strong edges and
    // colored overlay act as barriers. Whatever the flood cannot reach is stone.
    function maskFromEdgeFlood() {
      let edgeSorted = [];
      for (let i = 0; i < N; i += 13) edgeSorted.push(edges[i]);
      edgeSorted.sort((a, b) => a - b);
      const medEdge = edgeSorted[edgeSorted.length >> 1];
      const tau = Math.max(8, medEdge * 3.2);
      const barrier = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        if (edges[i] > tau || isColored(i)) barrier[i] = 1;
      }
      dilateOnce(barrier);
      const visited = new Uint8Array(N);
      let head = 0, tail = 0;
      for (const i of border) {
        if (!barrier[i] && !visited[i]) { visited[i] = 1; queue[tail++] = i; }
      }
      while (head < tail) {
        const i = queue[head++];
        const x = i % W, y = (i / W) | 0;
        if (x > 0 && !visited[i - 1] && !barrier[i - 1]) { visited[i - 1] = 1; queue[tail++] = i - 1; }
        if (x < W - 1 && !visited[i + 1] && !barrier[i + 1]) { visited[i + 1] = 1; queue[tail++] = i + 1; }
        if (y > 0 && !visited[i - W] && !barrier[i - W]) { visited[i - W] = 1; queue[tail++] = i - W; }
        if (y < H - 1 && !visited[i + W] && !barrier[i + W]) { visited[i + W] = 1; queue[tail++] = i + W; }
      }
      const m = new Uint8Array(N);
      for (let i = 0; i < N; i++) m[i] = visited[i] ? 0 : 1;
      erodeOnce(m);
      return m;
    }

    // candidate D: brightest luminance cluster (k=3). Under scanner illumination
    // the stone body is usually the brightest broad region in the frame.
    function maskFromBrightness() {
      let centers = [0, 0, 0];
      const sample = [];
      for (let i = 0; i < N; i += 11) if (!isWhiteUIAt(i)) sample.push(lum[i]);
      sample.sort((a, b) => a - b);
      centers = [
        sample[Math.floor(sample.length * 0.1)],
        sample[Math.floor(sample.length * 0.5)],
        sample[Math.floor(sample.length * 0.9)],
      ];
      for (let it = 0; it < 8; it++) {
        const acc = [[0, 0], [0, 0], [0, 0]];
        for (const v of sample) {
          let k = 0, dBest = Math.abs(v - centers[0]);
          for (let j = 1; j < 3; j++) {
            const dj = Math.abs(v - centers[j]);
            if (dj < dBest) { dBest = dj; k = j; }
          }
          acc[k][0] += v; acc[k][1]++;
        }
        for (let j = 0; j < 3; j++) if (acc[j][1]) centers[j] = acc[j][0] / acc[j][1];
      }
      const bright = centers[2];
      const mid = centers[1];
      const cut = (bright + mid) / 2;
      const m = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        if (isWhiteUIAt(i)) continue;
        if (lum[i] > cut || isColored(i)) m[i] = 1;
      }
      dilateOnce(m); dilateOnce(m);
      erodeOnce(m);
      return m;
    }

    // plausibility: rough stones are compact central blobs that do not hug the frame
    function scoreMask(m) {
      let area = 0, bMinX = W, bMinY = H, bMaxX = 0, bMaxY = 0, touch = 0;
      for (let i = 0; i < N; i++) {
        if (!m[i]) continue;
        area++;
        const x = i % W, y = (i / W) | 0;
        if (x < bMinX) bMinX = x; if (x > bMaxX) bMaxX = x;
        if (y < bMinY) bMinY = y; if (y > bMaxY) bMaxY = y;
      }
      if (!area) return { score: -1, area };
      for (const i of border) if (m[i]) touch++;
      const fillRatio = area / ((bMaxX - bMinX + 1) * (bMaxY - bMinY + 1));
      const sizeFrac = area / N;
      const borderFrac = touch / border.length;
      const sFill = 1 - Math.min(1, Math.abs(0.72 - fillRatio) * 2.2);
      let sSize = 1 - Math.min(1, Math.abs(0.42 - sizeFrac) * 2.0);
      if (sizeFrac < 0.10) sSize = Math.min(sSize, sizeFrac * 3);
      const sBorder = 1 - Math.min(1, borderFrac * 3.5);
      return { score: sFill * 0.4 + sSize * 0.25 + sBorder * 0.35, area, fillRatio, sizeFrac, borderFrac };
    }

    const candidates = [
      { mask: largestFilled(maskFromEdgeFlood()), method: 'edge-flood' },
      { mask: largestFilled(maskFromBgDistance()), method: 'background' },
      { mask: largestFilled(maskFromTexture()), method: 'texture' },
      { mask: largestFilled(maskFromBrightness()), method: 'brightness' },
    ];
    for (const c of candidates) c.stats = scoreMask(c.mask);
    candidates.sort((a, b) => b.stats.score - a.stats.score);
    const stone = candidates[0].mask;
    const segMethod = candidates[0].method;
    if (window.__CV_DEBUG) {
      window.__cvLast = { candidates, segMethod, W, H };
    }

    let stoneArea = 0, sumLum = 0;
    let minX = W, minY = H, maxX = 0, maxY = 0;
    for (let i = 0; i < N; i++) {
      if (!stone[i]) continue;
      stoneArea++; sumLum += lum[i];
      const x = i % W, y = (i / W) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const stoneMeanLum = stoneArea ? sumLum / stoneArea : 128;
    const bbox = { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };

    // ---- color layers inside the stone ----
    const layer = new Uint8Array(N); // 0 none, 1 green, 2 red, 3 blue, 4 yellow, 5 magenta, 6 dark
    for (let i = 0; i < N; i++) {
      if (!stone[i]) continue;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      if (g > 64 && g > 1.22 * r && g > 1.12 * b) layer[i] = 1;
      else if (r > 96 && g > 84 && b < 0.62 * Math.min(r, g)) layer[i] = 4;
      else if (r > 96 && b > 84 && g < 0.72 * Math.min(r, b)) layer[i] = 5;
      else if (r > 76 && r > 1.35 * g && r > 1.25 * b) layer[i] = 2;
      else if (b > 76 && b > 1.22 * r && b > 1.10 * g) layer[i] = 3;
      else if (lum[i] < Math.max(24, stoneMeanLum - 55)) layer[i] = 6;
    }

    // ---- connected components per layer ----
    function components(match, minPx, maxPx) {
      const seen = new Uint8Array(N);
      const out = [];
      for (let s = 0; s < N; s++) {
        if (seen[s] || !match(s)) continue;
        let h2 = 0, t2 = 0;
        queue[t2++] = s; seen[s] = 1;
        let size = 0, sx = 0, sy = 0;
        let cMinX = W, cMinY = H, cMaxX = 0, cMaxY = 0;
        while (h2 < t2) {
          const i = queue[h2++]; size++;
          const x = i % W, y = (i / W) | 0;
          sx += x; sy += y;
          if (x < cMinX) cMinX = x; if (x > cMaxX) cMaxX = x;
          if (y < cMinY) cMinY = y; if (y > cMaxY) cMaxY = y;
          const nb = [i - 1, i + 1, i - W, i + W];
          for (const j of nb) {
            if (j < 0 || j >= N || seen[j]) continue;
            const jx = j % W;
            if ((i % W === 0 && j === i - 1) || (i % W === W - 1 && j === i + 1)) continue;
            if (match(j)) { seen[j] = 1; queue[t2++] = j; }
          }
        }
        if (size >= minPx && size <= maxPx) {
          out.push({
            size, cx: sx / size, cy: sy / size,
            bbox: { minX: cMinX, minY: cMinY, maxX: cMaxX, maxY: cMaxY },
            radius: Math.sqrt(size / Math.PI),
          });
        }
      }
      return out;
    }

    const minBlob = Math.max(3, Math.round(stoneArea * 0.00004));
    const annotArea = stoneArea * 0.02;

    const greenComps = components(i => layer[i] === 1, minBlob, N);
    const redComps = components(i => layer[i] === 2, minBlob, N);
    const blueComps = components(i => layer[i] === 3, minBlob, N);
    const magentaComps = components(i => layer[i] === 5, minBlob, N);
    const yellowComps = components(i => layer[i] === 4, minBlob, N);
    const darkComps = components(i => layer[i] === 6, Math.max(3, minBlob), Math.round(stoneArea * 0.01));

    // annotation rejection: large coherent colored polygons are prior plan overlays, not inclusions
    const annotations = [];
    const inclusions = [];
    for (const c of blueComps) {
      if (c.size > annotArea) annotations.push({ ...c, kind: 'plan-overlay', color: 'blue' });
    }
    for (const c of magentaComps) {
      if (c.size > annotArea * 0.3) annotations.push({ ...c, kind: 'plan-wireframe', color: 'magenta' });
    }
    for (const c of yellowComps) {
      if (c.size > minBlob * 4) annotations.push({ ...c, kind: 'saw-line', color: 'yellow' });
    }
    for (const c of redComps) {
      if (c.size > annotArea) annotations.push({ ...c, kind: 'plan-overlay', color: 'red' });
      else inclusions.push({ ...c, type: 'pique', severity: sev(c, bbox) });
    }
    for (const c of greenComps) {
      // green is the Galaxy convention for mapped internal inclusions, at any size
      inclusions.push({ ...c, type: c.size > stoneArea * 0.004 ? 'crystal' : 'cloud', severity: sev(c, bbox) });
    }
    for (const c of darkComps) {
      if (c.size < stoneArea * 0.004) inclusions.push({ ...c, type: 'carbon', severity: sev(c, bbox) * 0.8 });
    }
    inclusions.sort((a, b) => b.size - a.size);

    function sev(c, bb) {
      // severity grows with size and centrality; both matter for clarity impact
      const nx = (c.cx - bb.minX) / bb.w - 0.5, ny = (c.cy - bb.minY) / bb.h - 0.5;
      const centrality = 1 - Math.min(1, Math.hypot(nx, ny) * 2);
      const sizeScore = Math.min(1, c.size / (stoneArea * 0.01));
      return 0.25 + 0.45 * sizeScore + 0.30 * centrality;
    }

    // ---- inclusion mask + heat map (box blurred severity field) ----
    const incMask = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (layer[i] === 1 || (layer[i] === 6 && stone[i])) incMask[i] = 1;
    }
    for (const c of redComps) {
      if (c.size <= annotArea) {
        // stamp small red piques into the mask
        const r = Math.ceil(c.radius);
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const x = Math.round(c.cx + dx), y = Math.round(c.cy + dy);
          if (x >= 0 && x < W && y >= 0 && y < H) incMask[y * W + x] = 1;
        }
      }
    }
    const heat = boxBlur(incMask, W, H, Math.max(4, Math.round(Math.min(W, H) / 48)));

    // ---- edge sharpness stat over the chosen stone region ----
    let edgeSum = 0, edgeCount = 0;
    for (let i = 0; i < N; i++) {
      if (stone[i]) { edgeSum += edges[i]; edgeCount++; }
    }
    const edgeMean = edgeCount ? edgeSum / edgeCount : 0;

    // ---- chamfer distance transform: distance to outside of stone, in px ----
    const dist = new Float32Array(N);
    const BIG = 1e7;
    for (let i = 0; i < N; i++) dist[i] = stone[i] ? BIG : 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!dist[i]) continue;
        let d = dist[i];
        if (x > 0) d = Math.min(d, dist[i - 1] + 1);
        if (y > 0) d = Math.min(d, dist[i - W] + 1);
        if (x > 0 && y > 0) d = Math.min(d, dist[i - W - 1] + 1.4142);
        if (x < W - 1 && y > 0) d = Math.min(d, dist[i - W + 1] + 1.4142);
        dist[i] = d;
      }
    }
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        if (!dist[i]) continue;
        let d = dist[i];
        if (x < W - 1) d = Math.min(d, dist[i + 1] + 1);
        if (y < H - 1) d = Math.min(d, dist[i + W] + 1);
        if (x < W - 1 && y < H - 1) d = Math.min(d, dist[i + W + 1] + 1.4142);
        if (x > 0 && y < H - 1) d = Math.min(d, dist[i + W - 1] + 1.4142);
        dist[i] = d;
      }
    }

    // ---- contour polygon (Moore boundary trace, then simplification) ----
    const contour = traceContour(stone, W, H, bbox);

    // ---- stats and per-run confidence, derived from the actual image ----
    const incArea = inclusions.reduce((s, c) => s + c.size, 0);
    const coverage = stoneArea ? incArea / stoneArea : 0;
    const fill = stoneArea / (bbox.w * bbox.h || 1);
    const segConfidence = clamp(0.965 - coverage * 0.35 - Math.max(0, 0.30 - fill) * 0.2 + Math.min(0.02, edgeMean / 900), 0.84, 0.985);

    return {
      W, H, scale, canvas: cnv,
      stone, dist, contour, bbox,
      stoneArea, stoneMeanLum, bgLum,
      inclusions, annotations,
      maps: { lum, edges, incMask, heat, layer },
      stats: {
        coverage, edgeMean, fill,
        inclusionCount: inclusions.length,
        annotationCount: annotations.length,
        segConfidence,
        segMethod,
      },
    };
  }

  function boxBlur(src, W, H, r) {
    const tmp = new Float32Array(W * H);
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[y * W + clamp(x, 0, W - 1)];
      for (let x = 0; x < W; x++) {
        tmp[y * W + x] = acc / (2 * r + 1);
        acc += src[y * W + clamp(x + r + 1, 0, W - 1)] - src[y * W + clamp(x - r, 0, W - 1)];
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, H - 1) * W + x];
      for (let y = 0; y < H; y++) {
        out[y * W + x] = acc / (2 * r + 1);
        acc += tmp[clamp(y + r + 1, 0, H - 1) * W + x] - tmp[clamp(y - r, 0, H - 1) * W + x];
      }
    }
    return out;
  }

  function traceContour(stone, W, H, bbox) {
    // find a start pixel on the boundary
    let start = -1;
    outer:
    for (let y = bbox.minY; y <= bbox.maxY; y++) {
      for (let x = bbox.minX; x <= bbox.maxX; x++) {
        if (stone[y * W + x]) { start = y * W + x; break outer; }
      }
    }
    if (start < 0) return [];
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const pts = [];
    let cx = start % W, cy = (start / W) | 0;
    let dir = 6; // entered heading up
    const maxSteps = 10 * (bbox.w + bbox.h) + 4000;
    for (let step = 0; step < maxSteps; step++) {
      pts.push([cx, cy]);
      let found = false;
      for (let k = 0; k < 8; k++) {
        const nd = (dir + 6 + k) % 8; // turn right-first (Moore tracing)
        const nx = cx + dirs[nd][0], ny = cy + dirs[nd][1];
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && stone[ny * W + nx]) {
          cx = nx; cy = ny; dir = nd; found = true; break;
        }
      }
      if (!found) break;
      if (cx === start % W && cy === ((start / W) | 0) && pts.length > 8) break;
    }
    return simplify(pts, 2.2);
  }

  function simplify(pts, eps) {
    if (pts.length < 4) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let maxD = 0, idx = -1;
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps && idx > 0) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    const out = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // render a scalar field or mask to a small tinted canvas (the "feature map" tiles)
  function renderMap(field, W, H, opts = {}) {
    const { size = 112, mode = 'gray' } = opts;
    const cnv = document.createElement('canvas');
    const s = size / Math.max(W, H);
    cnv.width = Math.round(W * s); cnv.height = Math.round(H * s);
    const ctx = cnv.getContext('2d');
    const im = ctx.createImageData(cnv.width, cnv.height);
    let max = 1e-6;
    for (let i = 0; i < W * H; i++) if (field[i] > max) max = field[i];
    for (let y = 0; y < cnv.height; y++) {
      for (let x = 0; x < cnv.width; x++) {
        const sx = Math.min(W - 1, Math.round(x / s)), sy = Math.min(H - 1, Math.round(y / s));
        const v = field[sy * W + sx] / max;
        const o = (y * cnv.width + x) * 4;
        if (mode === 'heat') {
          im.data[o] = Math.round(28 + 200 * v);
          im.data[o + 1] = Math.round(28 + 60 * v);
          im.data[o + 2] = Math.round(52 + 40 * (1 - v));
        } else if (mode === 'ice') {
          im.data[o] = Math.round(8 + 188 * v);
          im.data[o + 1] = Math.round(9 + 190 * v);
          im.data[o + 2] = Math.round(11 + 194 * v);
        } else {
          const g = Math.round(12 + 220 * v);
          im.data[o] = g; im.data[o + 1] = g; im.data[o + 2] = g;
        }
        im.data[o + 3] = 255;
      }
    }
    ctx.putImageData(im, 0, 0);
    return cnv;
  }

  return { analyze, renderMap, clamp };
})();
