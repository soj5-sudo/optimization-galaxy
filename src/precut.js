// precut.js
// The gate that runs before the saw does.
//
// Cutting is irreversible. Once a 17 carat crystal is sawn, a bad plan cannot
// be undone, so the question worth answering is: if we cut to this plan, does
// the result get accepted or sent back?
//
// Two things feed the answer. The learned part is the flaw evidence from the
// scan, produced by the convolutional model in ml/. The decision part is a
// deterministic policy: named thresholds, applied the same way every time and
// printed alongside the verdict. The policy is deliberately not learned,
// because a factory manager has to be able to read the reason and argue with
// it. When outcome data from real cut stones exists, the policy thresholds are
// the first thing to fit; the seam is `POLICY` below and nothing else changes.

const PreCut = (() => {

  // Reject reasons a polished stone actually comes back for, and the tolerance
  // each carries. These are the levers a factory tunes per buyer.
  const POLICY = {
    version: 'precut.policy.2026.01',
    clarityFloor: 'SI2',            // below this the buyer sends it back
    minCarat: 0.30,                 // smaller than this is not worth the wheel
    maxFlawCoverageInside: 0.055,   // fraction of the outline that may be flawed
    girdleClearanceMm: 0.35,        // a flaw nearer than this to the rim risks a chip
    maxRiskToAccept: 0.35,          // overall risk above this is a reject
    reviewBand: [0.22, 0.35],       // between these, a person decides
  };

  const CLARITY_ORDER = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1', 'I2', 'I3'];

  function clarityRank(g) {
    const i = CLARITY_ORDER.indexOf(String(g).toUpperCase());
    return i === -1 ? CLARITY_ORDER.length - 1 : i;
  }

  // Risk is assembled from named, separately reported components so the number
  // can always be taken apart and explained.
  function assess(stone, evidence, opts = {}) {
    const policy = { ...POLICY, ...(opts.policy || {}) };
    const reasons = [];
    const components = {};

    // 1. clarity against the floor
    const rank = clarityRank(stone.clarity);
    const floorRank = clarityRank(policy.clarityFloor);
    const clarityOver = Math.max(0, rank - floorRank);
    components.clarity = Math.min(0.5, clarityOver * 0.17);
    if (clarityOver > 0) {
      reasons.push(`Clarity ${stone.clarity} is ${clarityOver} grade${clarityOver > 1 ? 's' : ''} below the ${policy.clarityFloor} floor this buyer accepts.`);
    }

    // 2. flaw coverage inside the planned outline, from the model
    const coverage = Number(evidence.flawCoverageInside || 0);
    components.coverage = Math.min(0.35, (coverage / policy.maxFlawCoverageInside) * 0.2);
    if (coverage > policy.maxFlawCoverageInside) {
      reasons.push(`Flaws cover ${(coverage * 100).toFixed(1)} percent inside the outline, over the ${(policy.maxFlawCoverageInside * 100).toFixed(1)} percent limit.`);
    }

    // 3. anything sitting on the rim.
    // A null here means the model found nothing near the outline, which is the
    // best case. It must not be coerced to zero millimetres, which would read
    // as a flaw sitting exactly on the rim.
    const hasNearest = evidence.nearestFlawMm !== null && evidence.nearestFlawMm !== undefined && evidence.nearestFlawMm !== '';
    const nearest = hasNearest ? Number(evidence.nearestFlawMm) : NaN;
    if (hasNearest && Number.isFinite(nearest)) {
      const tight = Math.max(0, policy.girdleClearanceMm - nearest);
      components.girdle = Math.min(0.3, (tight / policy.girdleClearanceMm) * 0.3);
      if (tight > 0) {
        reasons.push(`A flaw sits ${nearest.toFixed(2)} mm from the rim, inside the ${policy.girdleClearanceMm} mm clearance. Chipping risk while bruting.`);
      }
    } else {
      components.girdle = 0;
    }

    // 4. size
    components.size = stone.carat < policy.minCarat ? 0.25 : 0;
    if (stone.carat < policy.minCarat) {
      reasons.push(`At ${stone.carat.toFixed(2)} ct this is under the ${policy.minCarat} ct minimum worth polishing.`);
    }

    // 5. how sure the model is about what it saw. Low confidence is itself a
    // risk, because it means we are deciding on a poor read of the stone.
    const hasConf = evidence.modelConfidence !== null && evidence.modelConfidence !== undefined;
    const conf = hasConf ? Number(evidence.modelConfidence) : NaN;
    components.uncertainty = Number.isFinite(conf) ? Math.min(0.2, (1 - conf) * 0.4) : 0.1;
    if (Number.isFinite(conf) && conf < 0.7) {
      reasons.push(`The scan read is weak (model confidence ${(conf * 100).toFixed(0)} percent). Re-scan before committing the saw.`);
    }

    const risk = Math.min(1, Object.values(components).reduce((a, b) => a + b, 0));

    let decision;
    if (risk >= policy.maxRiskToAccept) decision = 'reject';
    else if (risk >= policy.reviewBand[0]) decision = 'review';
    else decision = 'accept';

    // what the factory saves by not cutting a stone that comes back
    const valueAtRisk = Math.round((stone.value || 0) * risk);

    return {
      stoneId: stone.id,
      decision,
      risk: Math.round(risk * 1000) / 1000,
      components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
      reasons: reasons.length ? reasons : ['Nothing in the scan or the plan trips a reject rule.'],
      policyVersion: policy.version,
      valueAtRisk,
      evidence: {
        flawCoverageInside: coverage,
        nearestFlawMm: Number.isFinite(nearest) ? Math.round(nearest * 100) / 100 : null,
        modelConfidence: Number.isFinite(conf) ? Math.round(conf * 100) / 100 : null,
        source: evidence.source || 'unknown',
      },
    };
  }

  // Runs the gate over a whole plan and says what to cut and what to hold.
  function gate(plan, evidenceByStone, opts = {}) {
    const results = (plan.stones || []).map(s =>
      assess(s, (evidenceByStone && evidenceByStone[s.id]) || {}, opts));

    const accept = results.filter(r => r.decision === 'accept');
    const review = results.filter(r => r.decision === 'review');
    const reject = results.filter(r => r.decision === 'reject');

    const caratAccepted = accept.reduce((s, r) => {
      const st = plan.stones.find(x => x.id === r.stoneId);
      return s + (st ? st.carat : 0);
    }, 0);
    const savedValue = reject.reduce((s, r) => s + r.valueAtRisk, 0);

    return {
      results,
      summary: {
        stones: results.length,
        accept: accept.length,
        review: review.length,
        reject: reject.length,
        caratAccepted: Math.round(caratAccepted * 100) / 100,
        valueHeldBack: savedValue,
        verdict: reject.length === 0 && review.length === 0 ? 'cut_all'
          : accept.length === 0 ? 'cut_none'
          : 'cut_partial',
      },
      policy: { ...POLICY, ...(opts.policy || {}) },
    };
  }

  return { assess, gate, POLICY, CLARITY_ORDER };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PreCut;
