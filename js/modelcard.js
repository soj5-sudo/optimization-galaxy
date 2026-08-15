// modelcard.js: the GXN-2 model card. Training curves and validation figures
// are simulated for this demo build and labeled as such in the UI.

const ModelCard = (() => {

  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function curves(epochs = 64, seed = 7) {
    const rnd = mulberry32(seed);
    const trainLoss = [], valLoss = [], valIoU = [];
    for (let e = 1; e <= epochs; e++) {
      const t = e / epochs;
      trainLoss.push(0.62 * Math.exp(-3.1 * t) + 0.028 + rnd() * 0.012);
      valLoss.push(0.66 * Math.exp(-2.6 * t) + 0.042 + rnd() * 0.02 + (t > 0.8 ? 0.004 : 0));
      valIoU.push(Math.min(0.945, 0.55 + 0.42 * (1 - Math.exp(-3.4 * t)) + rnd() * 0.012 - 0.006));
    }
    return { trainLoss, valLoss, valIoU };
  }

  function drawChart(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.parentElement.clientWidth - 2;
    const cssH = 260;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const { trainLoss, valLoss, valIoU } = curves();
    const n = trainLoss.length;
    const padL = 44, padR = 44, padT = 18, padB = 30;
    const w = cssW - padL - padR, h = cssH - padT - padB;

    ctx.clearRect(0, 0, cssW, cssH);

    // gridlines
    ctx.strokeStyle = 'rgba(232,238,244,0.07)';
    ctx.lineWidth = 1;
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = '#8CA0B3';
    for (let i = 0; i <= 4; i++) {
      const y = padT + h * i / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
      ctx.fillText((0.7 - 0.7 * i / 4).toFixed(2), 8, y + 3);
      ctx.fillText((1 - i / 4 * 0.5).toFixed(2), padL + w + 8, y + 3);
    }
    for (let e = 0; e <= 64; e += 16) {
      const x = padL + w * e / 64;
      ctx.fillText(String(e), x - 4, cssH - 10);
    }

    const plot = (series, yMap, color, dash) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      series.forEach((v, i) => {
        const x = padL + w * i / (n - 1);
        const y = padT + h * yMap(v);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };
    plot(trainLoss, v => 1 - v / 0.7, 'rgba(140,160,179,0.9)');
    plot(valLoss, v => 1 - v / 0.7, 'rgba(217,106,118,0.85)', [5, 4]);
    plot(valIoU, v => 1 - (v - 0.5) / 0.5, '#7FA8C9');

    // legend
    const legend = [
      ['train loss', 'rgba(140,160,179,0.9)'],
      ['val loss', 'rgba(217,106,118,0.85)'],
      ['val IoU', '#7FA8C9'],
    ];
    let lx = padL + 8;
    for (const [name, color] of legend) {
      ctx.fillStyle = color;
      ctx.fillRect(lx, padT + 4, 14, 2);
      ctx.fillStyle = '#8CA0B3';
      ctx.fillText(name, lx + 18, padT + 8);
      lx += 18 + ctx.measureText(name).width + 20;
    }
  }

  function init() {
    const canvas = document.getElementById('training-chart');
    if (!canvas) return;
    drawChart(canvas);
    let raf = null;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => drawChart(canvas));
    });
  }

  return { init };
})();
