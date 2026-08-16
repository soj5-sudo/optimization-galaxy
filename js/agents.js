// agents.js: the three jobs, run as agents against one shared stone record.
//
//   optimization -> plans the cut and the expected yield
//   cutting      -> executes the plan and returns the cutting report
//   compliance   -> cross-checks mining cert, lab report and invoice, files the DDS
//   quoting      -> prices off yield plus the origin data compliance already proved
//
// Compliance blocks on our side rather than at the border: any field that
// disagrees across the three documents stops the filing.

const Agents = (() => {

  const SANCTIONED_ORIGINS = ['Russian Federation', 'Russia', 'Belarus'];

  // EU filing rule the demo is built around
  const EU_DDS = {
    effectiveFrom: '2026-01-01',
    minCaratNatural: 0.5,
    penaltyPctOfShipment: 40,
    perViolationUsd: 377700,
  };

  // Simulated import duty by country of polish. Demo figures, not tax advice.
  const TARIFF_BY_POLISH = {
    India: 10.0,
    Israel: 0.0,
    Belgium: 0.0,
    'United States': 0.0,
    Botswana: 0.0,
    China: 20.0,
  };

  const wait = ms => new Promise(r => setTimeout(r, ms));

  function money(n) { return `$${Math.round(n).toLocaleString()}`; }

  // ---------- compliance ----------

  function runChecks(record, opts = {}) {
    const d = record.docs;
    const checks = [];
    const push = (name, ok, detail, severity) =>
      checks.push({ name, ok, detail, severity: severity || (ok ? 'info' : 'block') });

    // 1. carat weight agrees between lab report and invoice
    const caratDelta = Math.abs(d.lab.caratWeight - d.invoice.caratWeight);
    push('Weight matches',
      caratDelta < 0.005,
      caratDelta < 0.005
        ? `${d.lab.caratWeight.toFixed(2)} ct on ${d.lab.authority} ${d.lab.reportNumber} matches invoice ${d.invoice.number}`
        : `${d.lab.authority} says ${d.lab.caratWeight.toFixed(2)} ct, invoice ${d.invoice.number} says ${d.invoice.caratWeight.toFixed(2)} ct`);

    // 2. lab report number on the invoice points at the report we hold
    push('Lab report matches',
      d.lab.reportNumber === d.invoice.labReportNumber,
      d.lab.reportNumber === d.invoice.labReportNumber
        ? `${d.lab.authority} report ${d.lab.reportNumber} is the one the invoice names`
        : `Invoice names ${d.invoice.labReportNumber}, but the report we hold is ${d.lab.reportNumber}`);

    // 3. shape agrees
    push('Shape matches',
      d.lab.shape === d.invoice.shape,
      `${d.lab.shape} on both the report and the invoice`);

    // 4. declared origin matches the mining certificate. This is the field that
    //    carries the 40% penalty when it is wrong.
    const originMatch = d.mining.countryOfOrigin === d.invoice.declaredOrigin;
    push('Origin matches the certificate',
      originMatch,
      originMatch
        ? `Both say ${d.mining.countryOfOrigin}, certificate ${d.mining.kpCertificate}`
        : `Invoice declares ${d.invoice.declaredOrigin}. KP certificate ${d.mining.kpCertificate} states ${d.mining.countryOfOrigin}`);

    // 5. sanctioned source screen
    const sanctioned = SANCTIONED_ORIGINS.includes(d.mining.countryOfOrigin);
    push('Not a sanctioned country',
      !sanctioned,
      sanctioned
        ? `${d.mining.countryOfOrigin} is sanctioned. ${money(EU_DDS.perViolationUsd)} per violation, or twice the sale, whichever is greater`
        : `${d.mining.countryOfOrigin} is not a sanctioned source`);

    // 6. rough weight can physically contain everything recovered from the parcel
    const recovered = record.plan ? record.plan.totalCarat : d.lab.caratWeight;
    const yieldPct = (recovered / d.mining.roughWeightCt) * 100;
    push('Weights make sense',
      recovered <= d.mining.roughWeightCt && yieldPct <= 60,
      record.plan
        ? `${recovered.toFixed(2)} ct of polished out of ${d.mining.roughWeightCt.toFixed(2)} ct of rough, ${yieldPct.toFixed(1)}%`
        : `${d.lab.caratWeight.toFixed(2)} ct polished from ${d.mining.roughWeightCt.toFixed(2)} ct rough, ${yieldPct.toFixed(1)}% yield`);

    // 7. does the filing apply at all
    const needsFiling = d.lab.description.includes('Natural') && d.lab.caratWeight >= EU_DDS.minCaratNatural;
    push('Filing needed',
      true,
      needsFiling
        ? `Natural and over ${EU_DDS.minCaratNatural} ct, so the EU has required this filing since January 2026`
        : `Below the ${EU_DDS.minCaratNatural} ct threshold, filing not required`,
      'info');

    if (opts.injectMismatch) {
      checks.push({
        name: 'Operator override attempt',
        ok: false,
        detail: 'Manual edit to the origin field rejected. Fields are written from source documents only.',
        severity: 'block',
      });
    }

    const blockers = checks.filter(c => !c.ok && c.severity === 'block');
    return { checks, blockers, needsFiling };
  }

  async function compliance(record, ui, opts = {}) {
    const say = t => ui.log('COMPLIANCE', t);
    const d = record.docs;
    say(`Opening record <span class="num">${record.id}</span>, reading the three documents`);
    await wait(225);
    say(`Mining: KP certificate <span class="num">${d.mining.kpCertificate}</span>, ${d.mining.countryOfOrigin}, ${d.mining.mine}`);
    await wait(171);
    say(`Lab: ${d.lab.authority} report <span class="num">${d.lab.reportNumber}</span>, ${d.lab.caratWeight.toFixed(2)} ct ${d.lab.colorGrade} ${d.lab.clarityGrade}`);
    await wait(171);
    say(`Invoice: <span class="num">${d.invoice.number}</span>, declared origin ${d.invoice.declaredOrigin}, polished in ${d.invoice.countryOfPolish}`);
    await wait(189);
    say('Checking every field against the other two documents');
    await wait(252);

    const { checks, blockers, needsFiling } = runChecks(record, opts);
    for (const c of checks) {
      await wait(108);
      if (c.ok) say(`Pass: ${c.name}. ${c.detail}`);
      else say(`<span class="bad">Blocked: ${c.name}. ${c.detail}</span>`);
      if (ui.onCheck) ui.onCheck(c);
    }

    const passed = blockers.length === 0;
    const ddsRef = passed ? `DDS-EU-${d.lab.reportNumber.slice(-6)}` : null;
    record.compliance = {
      status: passed ? 'filed' : 'blocked',
      checks, blockers, needsFiling, ddsRef,
      filedAt: passed ? new Date().toISOString() : null,
      origin: d.mining.countryOfOrigin,
      countryOfPolish: d.invoice.countryOfPolish,
      rule: EU_DDS,
    };
    Records.log(record, 'compliance', passed ? 'DDS filed' : 'Filing blocked',
      passed ? ddsRef : `${blockers.length} blocking mismatch${blockers.length > 1 ? 'es' : ''}`);

    await wait(189);
    if (passed) {
      say(`Statement <span class="num">${ddsRef}</span> filed with the export papers. Origin ${d.mining.countryOfOrigin}, backed by three documents that agree`);
    } else {
      say(`<span class="bad">Stopped here. At the border this costs up to ${EU_DDS.penaltyPctOfShipment}% of the shipment plus seizure</span>`);
    }
    return record.compliance;
  }

  // ---------- quoting ----------

  const CUTTING_COST_PER_ROUGH_CT = 120;   // simulated manufacturing cost
  const TARGET_MARGIN_PCT = 22;

  async function quoting(record, ui) {
    const say = t => ui.log('QUOTING', t);
    const d = record.docs;
    const c = record.compliance;
    if (!c) { say('Waiting on compliance. A price without proven origin is not a price'); return null; }

    say('Taking the yield from the plan and the origin from the record');
    await wait(207);

    const plan = record.plan;
    const planCarat = plan ? plan.totalCarat : d.lab.caratWeight;
    const planYield = plan ? plan.yieldPct : (d.lab.caratWeight / d.mining.roughWeightCt) * 100;

    // the graded stone anchors the model against a real lab report, priced the
    // way the trade prices: off the Rapaport list, at a discount to it
    const rap = Planner.rapQuote(d.lab.clarityGrade, d.lab.caratWeight, 'round');
    const ppc = rap.net;
    const gradedValue = ppc * d.lab.caratWeight;
    say(`Rapaport list for ${d.lab.caratWeight.toFixed(2)} ct ${d.lab.colorGrade} ${d.lab.clarityGrade}: <span class="num">${money(rap.list)}</span> per carat`);
    await wait(180);
    say(`Trades at <span class="num">${rap.discountPct}%</span> back of the list, so <span class="num">${money(ppc)}</span> per carat, <span class="num">${money(gradedValue)}</span> for the stone`);
    await wait(189);

    // revenue is the whole planned output, not just the graded stone
    const revenue = plan ? plan.totalValue : gradedValue;
    if (plan) {
      say(`Planned output across <span class="num">${plan.stones.length}</span> stones, ${planCarat.toFixed(2)} ct, revenue <span class="num">${money(revenue)}</span>`);
      await wait(180);
    }

    const tariffPct = TARIFF_BY_POLISH[d.invoice.countryOfPolish];
    const tariffKnown = tariffPct !== undefined;
    const duty = tariffKnown ? revenue * tariffPct / 100 : 0;
    say(`Polished in ${d.invoice.countryOfPolish}, so import duty is <span class="num">${tariffKnown ? tariffPct.toFixed(1) + '%' : 'Not set'}</span>, <span class="num">${money(duty)}</span>. Compliance already proved that field`);
    await wait(207);

    const roughCt = d.mining.roughWeightCt;
    const manufacturing = roughCt * CUTTING_COST_PER_ROUGH_CT;
    const margin = revenue * TARGET_MARGIN_PCT / 100;
    const roughBid = Math.max(0, revenue - duty - manufacturing - margin);
    say(`Take off cutting cost <span class="num">${money(manufacturing)}</span> and a ${TARGET_MARGIN_PCT}% margin: the most I can pay for this rough is <span class="num">${money(roughBid)}</span>`);

    record.quote = {
      rapList: rap.list, discountPct: rap.discountPct,
      ppc, gradedValue, revenue,
      tariffPct: tariffKnown ? tariffPct : null, duty,
      manufacturing, margin, roughBid,
      planCarat, planYield,
      blocked: c.status !== 'filed',
      quotedAt: new Date().toISOString(),
    };
    Records.log(record, 'quoting', 'Quote produced', `${money(roughBid)} rough ceiling, duty ${tariffKnown ? tariffPct + '%' : 'unknown'}`);

    await wait(135);
    if (c.status !== 'filed') {
      say('<span class="bad">Quote held. Compliance has not cleared this record, so the price cannot be released</span>');
    }
    return record.quote;
  }

  // ---------- cutting ----------

  async function cutting(record, ui) {
    const say = t => ui.log('CUTTING', t);
    const plan = record.plan;
    if (!plan) { say('No plan on the record yet'); return null; }

    say(`Plan received: <span class="num">${plan.stones.length}</span> stones, ${plan.totalCarat.toFixed(2)} ct to cut`);
    await wait(207);
    say(plan.saw ? `Setting the saw at ${plan.saw.angleDeg.toFixed(1)} degrees` : 'One piece, no sawing needed');
    await wait(234);

    // executed weights land slightly off plan, as they do on a real bench
    const executed = plan.stones.map((s, i) => {
      const drift = 1 - (0.004 + (i * 0.0032));
      return { id: s.id, shape: s.shape, planned: s.carat, actual: +(s.carat * drift).toFixed(3), clarity: s.clarity };
    });
    const actualTotal = executed.reduce((a, s) => a + s.actual, 0);

    for (const s of executed) {
      await wait(135);
      say(`Stone ${s.id} off the wheel at <span class="num">${s.actual.toFixed(2)} ct</span>, planned ${s.planned.toFixed(2)} ct`);
    }

    const varPct = ((actualTotal - plan.totalCarat) / plan.totalCarat) * 100;
    record.cutting = {
      status: 'complete',
      factory: 'Jewel Labs Manufacturing, Surat',
      executed,
      actualTotal,
      variancePct: varPct,
      completedAt: new Date().toISOString(),
    };
    Records.log(record, 'cutting', 'Cutting complete', `${actualTotal.toFixed(2)} ct actual, ${varPct.toFixed(1)}% vs plan`);

    await wait(162);
    say(`Report back to the record: <span class="num">${actualTotal.toFixed(2)} ct</span>, <span class="num">${varPct.toFixed(1)}%</span> against plan`);
    return record.cutting;
  }

  // ---------- deliverables ----------

  function cuttingReportText(record) {
    const c = record.cutting, p = record.plan;
    const L = [];
    L.push('CUTTING AGENT REPORT');
    L.push(`Record ${record.id}   Factory ${c.factory}   Completed ${c.completedAt}`);
    L.push('');
    L.push('PLANNED VS ACTUAL');
    for (const s of c.executed) {
      L.push(`  Stone ${s.id}  ${Planner.SHAPES[s.shape].name.padEnd(16)} planned ${s.planned.toFixed(2)} ct   actual ${s.actual.toFixed(2)} ct   ${s.clarity}`);
    }
    L.push(`  Total          planned ${p.totalCarat.toFixed(2)} ct   actual ${c.actualTotal.toFixed(2)} ct   variance ${c.variancePct.toFixed(2)}%`);
    L.push('');
    L.push(`Rough estimate ${p.rough.carats.toFixed(2)} ct, plan yield ${p.yieldPct.toFixed(1)}%`);
    L.push('');
    L.push('Demo build. Executed weights are simulated against the planned outcome.');
    return L.join('\n');
  }

  function ddsText(record) {
    const d = record.docs, c = record.compliance, q = record.quote;
    const L = [];
    L.push('DUE DILIGENCE STATEMENT');
    L.push(c.status === 'filed' ? `Reference ${c.ddsRef}` : 'NOT FILED, BLOCKED ON INTERNAL CHECK');
    L.push(`Record ${record.id}   Generated ${new Date().toISOString()}`);
    L.push(`Rule: EU filing in force from ${c.rule.effectiveFrom} for natural polished at or above ${c.rule.minCaratNatural} ct`);
    L.push('');
    L.push('DECLARED FIELDS AND THEIR SOURCE');
    for (const row of Records.fieldTable(record)) {
      L.push(`  ${row.field.padEnd(24)} ${String(row.value).padEnd(28)} from ${row.source}`);
    }
    L.push('');
    L.push('VERIFICATION');
    for (const ck of c.checks) {
      L.push(`  [${ck.ok ? 'PASS' : 'BLOCK'}] ${ck.name}: ${ck.detail.replace(/<[^>]+>/g, '')}`);
    }
    L.push('');
    if (q) {
      L.push('COMMERCIAL');
      L.push(`  Rapaport list       ${money(q.rapList)} per carat`);
      L.push(`  Discount            ${q.discountPct}% back of list, net ${money(q.ppc)} per carat`);
      L.push(`  Graded stone        ${money(q.gradedValue)}`);
      L.push(`  Planned revenue     ${money(q.revenue)} across the full plan`);
      L.push(`  Country of polish   ${d.invoice.countryOfPolish}, duty ${q.tariffPct === null ? 'Not set' : q.tariffPct.toFixed(1) + '%'}, ${money(q.duty)}`);
      L.push(`  Manufacturing       ${money(q.manufacturing)}`);
      L.push(`  Target margin       ${money(q.margin)}`);
      L.push(`  Rough bid ceiling   ${money(q.roughBid)}`);
      L.push('');
    }
    L.push('AUDIT TRAIL');
    for (const a of record.audit) {
      L.push(`  ${a.at}  ${a.agent.padEnd(12)} ${a.action}${a.detail ? '  (' + a.detail + ')' : ''}`);
    }
    L.push('');
    L.push('Demo build. Source documents are the bundled lab reports plus simulated mining and invoice records.');
    L.push('Not a legal filing and not tax advice.');
    return L.join('\n');
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return { compliance, quoting, cutting, runChecks, cuttingReportText, ddsText, download, EU_DDS, TARIFF_BY_POLISH };
})();
