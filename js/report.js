// report.js: renders the plan into human deliverables — before/after canvases,
// plan table, complete cutting instructions, risk notes, summary, and a
// downloadable text report.

const Report = (() => {

  const STONE_COLORS = [
    { fill: 'rgba(91,141,239,0.42)', line: '#5B8DEF' },
    { fill: 'rgba(217,106,118,0.38)', line: '#D96A76' },
    { fill: 'rgba(134,199,180,0.38)', line: '#86C7B4' },
  ];

  function fitCanvas(canvas, an) {
    const maxW = canvas.parentElement.clientWidth || 520;
    const s = Math.min(maxW / an.W, 460 / an.H);
    canvas.width = Math.round(an.W * s);
    canvas.height = Math.round(an.H * s);
    return s;
  }

  function drawBase(ctx, an, s, dim) {
    ctx.drawImage(an.canvas, 0, 0, an.W * s, an.H * s);
    if (dim) {
      ctx.fillStyle = `rgba(6,9,13,${dim})`;
      ctx.fillRect(0, 0, an.W * s, an.H * s);
    }
    // stone contour
    ctx.strokeStyle = 'rgba(168,204,232,0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    an.contour.forEach(([x, y], i) => i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s));
    ctx.closePath();
    ctx.stroke();
  }

  function drawBefore(canvas, an) {
    const s = fitCanvas(canvas, an);
    const ctx = canvas.getContext('2d');
    drawBase(ctx, an, s, 0.12);
    // detected inclusions: outline circles sized to the components
    for (const inc of an.inclusions) {
      const r = Math.max(2.5, inc.radius * s);
      ctx.strokeStyle = inc.type === 'carbon' ? 'rgba(232,238,244,0.75)' : 'rgba(120,220,150,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(inc.cx * s, inc.cy * s, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawAfter(canvas, an, result) {
    const s = fitCanvas(canvas, an);
    const ctx = canvas.getContext('2d');
    drawBase(ctx, an, s, 0.30);
    // planned stones
    result.stones.forEach((st, i) => {
      const c = STONE_COLORS[i % STONE_COLORS.length];
      ctx.fillStyle = c.fill;
      ctx.strokeStyle = c.line;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      st.poly.forEach(([x, y], k) => k ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // internal facet suggestion lines: table and girdle
      const p = st.poly;
      ctx.strokeStyle = c.line;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(p[6][0] * s, p[6][1] * s); ctx.lineTo(p[2][0] * s, p[2][1] * s);
      ctx.moveTo(p[5][0] * s, p[5][1] * s); ctx.lineTo(p[3][0] * s, p[3][1] * s);
      ctx.moveTo(p[0][0] * s, p[0][1] * s); ctx.lineTo(p[4][0] * s, p[4][1] * s);
      ctx.moveTo(p[1][0] * s, p[1][1] * s); ctx.lineTo(p[4][0] * s, p[4][1] * s);
      ctx.stroke();
      // label
      ctx.fillStyle = '#E8EEF4';
      ctx.font = '600 12px Inter, sans-serif';
      ctx.fillText(`${st.id}  ${st.carat.toFixed(2)} ct`, st.cx * s - 18, st.cy * s + 4);
    });
    // saw line
    if (result.saw) {
      ctx.strokeStyle = 'rgba(228,200,110,0.9)';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(result.saw.x1 * s, result.saw.y1 * s);
      ctx.lineTo(result.saw.x2 * s, result.saw.y2 * s);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function crownAngle(shape) {
    const sh = Planner.SHAPES[shape];
    return Math.atan(sh.crownH / ((1 - sh.table) / 2)) * 180 / Math.PI;
  }
  function pavilionAngle(shape) {
    const sh = Planner.SHAPES[shape];
    return Math.atan(sh.pavilionH / 0.5) * 180 / Math.PI;
  }

  function buildInstructions(an, result) {
    const steps = [];
    const r = result.rough;
    steps.push(`Intake: single-view silhouette measures ${r.wMm.toFixed(1)} x ${r.hMm.toFixed(1)} mm at the set scale, estimated rough weight ${r.carats.toFixed(2)} ct (assumed depth ${r.depthMm.toFixed(1)} mm).`);
    steps.push(`Orientation: hold the stone in the scanned pose. All coordinates below are in the scan frame, x to the right, y downward, origin at the top left of the crop.`);
    if (result.saw) {
      steps.push(`Saw: one separating cut along the dashed line through (${(result.saw.mx * result.mmPerPx).toFixed(1)}, ${(result.saw.my * result.mmPerPx).toFixed(1)}) mm at ${result.saw.angleDeg.toFixed(1)} deg from horizontal. Kerf allowance 0.15 mm. Green-laser pie sawing keeps the tension risk low on this line.`);
    } else {
      steps.push(`Saw: none required. The plan recovers a single stone from the full volume.`);
    }
    for (const st of result.stones) {
      steps.push(
        `Stone ${st.id} (${Planner.SHAPES[st.shape].name}): girdle ${st.dMm.toFixed(2)} mm, total depth ${st.depthMm.toFixed(2)} mm. ` +
        `Brute to the marked outline centered at (${(st.cx * result.mmPerPx).toFixed(1)}, ${(st.cy * result.mmPerPx).toFixed(1)}) mm, tilt ${(st.rot * 180 / Math.PI).toFixed(1)} deg. ` +
        `Target proportions: table ${(Planner.SHAPES[st.shape].table * 100).toFixed(0)}%, crown ${crownAngle(st.shape).toFixed(1)} deg, pavilion ${pavilionAngle(st.shape).toFixed(1)} deg, girdle ${(Planner.SHAPES[st.shape].girdleH * 100).toFixed(1)}% medium. ` +
        `Expected ${st.carat.toFixed(2)} ct, clarity estimate ${st.clarity}.`
      );
    }
    steps.push(`Finish: polish pavilions first, verify no mapped feature breaks a pavilion main, then crowns. Re-scan between stages if any girdle sits within 0.35 mm of a mapped feature.`);
    return steps;
  }

  function buildSummary(an, result) {
    const shapes = result.stones.map(s => `${s.id}: ${Planner.SHAPES[s.shape].name} ${s.carat.toFixed(2)} ct ${s.clarity}`).join(', ');
    return `From an estimated ${result.rough.carats.toFixed(2)} ct rough, the plan recovers ${result.stones.length} polished stone${result.stones.length > 1 ? 's' : ''} (${shapes}) ` +
      `for ${result.totalCarat.toFixed(2)} ct total, a ${result.yieldPct.toFixed(1)}% weight yield, at an estimated value of $${result.totalValue.toLocaleString()}. ` +
      `${an.inclusions.length} internal features were mapped and ${result.stones.reduce((n, s) => n + s.inside.length, 0)} remain inside planned outlines, reflected in the clarity estimates. ` +
      `Segmentation confidence ${(an.stats.segConfidence * 100).toFixed(1)}%.`;
  }

  function renderResults(an, result, els) {
    drawBefore(els.beforeCanvas, an);
    drawAfter(els.afterCanvas, an, result);

    // stat tiles
    const stats = [
      ['Rough est', `${result.rough.carats.toFixed(2)} ct`],
      ['Stones', String(result.stones.length)],
      ['Recovered', `${result.totalCarat.toFixed(2)} ct`],
      ['Yield', `${result.yieldPct.toFixed(1)}%`],
      ['Est value', `$${result.totalValue.toLocaleString()}`],
      ['Confidence', `${(an.stats.segConfidence * 100).toFixed(1)}%`],
    ];
    els.statRow.innerHTML = '';
    for (const [k, v] of stats) {
      const d = document.createElement('div');
      d.className = 'stat';
      d.innerHTML = `<dt>${k}</dt><dd class="num">${v}</dd>`;
      els.statRow.appendChild(d);
    }

    // plan table
    els.planBody.innerHTML = '';
    result.stones.forEach((st, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td><span class="swatch" style="background:${STONE_COLORS[i % 3].line}"></span>${st.id}</td>` +
        `<td>${Planner.SHAPES[st.shape].name}</td>` +
        `<td class="num">${st.dMm.toFixed(2)}</td>` +
        `<td class="num">${st.depthMm.toFixed(2)}</td>` +
        `<td class="num">${st.carat.toFixed(2)}</td>` +
        `<td>${st.clarity}</td>` +
        `<td class="num">$${st.ppc.toLocaleString()}</td>` +
        `<td class="num">$${st.value.toLocaleString()}</td>`;
      els.planBody.appendChild(tr);
    });

    // instructions, risks, summary
    const steps = buildInstructions(an, result);
    els.instructions.innerHTML = '';
    steps.forEach(s => {
      const li = document.createElement('li');
      li.textContent = s;
      els.instructions.appendChild(li);
    });

    els.risks.innerHTML = '';
    const risks = (result.risks && result.risks.length ? result.risks : collectRisks(result));
    if (risks.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No girdle-proximate features detected. Standard margins apply.';
      els.risks.appendChild(li);
    } else {
      risks.forEach(rk => {
        const li = document.createElement('li');
        li.textContent = rk;
        els.risks.appendChild(li);
      });
    }

    els.summary.textContent = buildSummary(an, result);
  }

  function collectRisks(result) { return result.risks || []; }

  function downloadReport(an, result, meta) {
    const lines = [];
    lines.push('OPTIMIZATION GALAXY, GXN-2 ROUGH PLAN REPORT');
    lines.push(`Source: ${meta.imageName || 'uploaded scan'}   Scale: girdle width set to ${result.stoneWidthMm} mm   Objective: ${result.objective}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('SUMMARY');
    lines.push(buildSummary(an, result));
    lines.push('');
    lines.push('PLAN');
    for (const st of result.stones) {
      lines.push(`  Stone ${st.id}: ${Planner.SHAPES[st.shape].name}, girdle ${st.dMm.toFixed(2)} mm, depth ${st.depthMm.toFixed(2)} mm, ${st.carat.toFixed(2)} ct, ${st.clarity}, $${st.ppc.toLocaleString()}/ct, $${st.value.toLocaleString()}`);
    }
    lines.push('');
    lines.push('CUTTING INSTRUCTIONS');
    buildInstructions(an, result).forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    lines.push('');
    lines.push('RISK NOTES');
    (result.risks || []).forEach(r => lines.push(`  - ${r}`));
    lines.push('');
    lines.push('Demo build. Prices and gradings are simulated; weight figures derive from a single-view scan and an assumed depth.');
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gxn2-rough-plan.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return { renderResults, downloadReport, drawBefore, drawAfter };
})();
