// rules.js
// Evaluates a versioned rule set against a stone record.
//
// The regulation lives in rules/*.json as data. This file is only the
// interpreter, so when the text of a regulation changes we diff a document
// instead of rewriting logic. Every verdict carries the rule id and the rule
// set version that produced it, which is what makes an old filing auditable
// years later.

const RulesEngine = (() => {

  // read a dotted path like "lab_report.caratWeight" out of the record
  function read(record, path) {
    if (!path) return undefined;
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), record.documents || {});
  }

  function present(v) {
    return v !== undefined && v !== null && v !== '' && v !== 'Not set';
  }

  function sameText(a, b) {
    return String(a).trim().replace(/\s+/g, ' ').toUpperCase()
        === String(b).trim().replace(/\s+/g, ' ').toUpperCase();
  }

  // a check that cannot see its inputs is not a pass, it is unknown
  function unknown(check, why) {
    return {
      id: check.id,
      label: check.label,
      plain: check.plain,
      status: 'unknown',
      severity: check.on_fail || 'warn',
      detail: why,
    };
  }

  function evaluateCheck(check, record) {
    // 1. compare two document fields
    if (Array.isArray(check.compare)) {
      const [pa, pb] = check.compare;
      const a = read(record, pa), b = read(record, pb);
      if (!present(a) || !present(b)) {
        return unknown(check, `Cannot compare yet. ${!present(a) ? pa : pb} has not been read.`);
      }
      let ok;
      if (typeof check.tolerance === 'number') {
        ok = Math.abs(Number(a) - Number(b)) <= check.tolerance;
      } else {
        ok = sameText(a, b);
      }
      return {
        id: check.id, label: check.label, plain: check.plain,
        status: ok ? 'pass' : 'fail',
        severity: check.on_fail || 'block',
        detail: ok
          ? `Both say ${a}.`
          : `${pa.split('.')[0].replace(/_/g, ' ')} says ${a}. ${pb.split('.')[0].replace(/_/g, ' ')} says ${b}.`,
        values: { a, b },
      };
    }

    // 2. field must not be in a list (sanctions)
    if (check.not_in) {
      const v = read(record, check.field);
      if (!present(v)) return unknown(check, `${check.field} has not been read.`);
      const hit = check.not_in.some(x => sameText(x, v));
      return {
        id: check.id, label: check.label, plain: check.plain,
        status: hit ? 'fail' : 'pass',
        severity: check.on_fail || 'block',
        detail: hit ? `${v} is on the sanctions list.` : `${v} is not on the sanctions list.`,
        values: { v },
      };
    }

    // 3. field must be in a list
    if (check.in) {
      const v = read(record, check.field);
      if (!present(v)) return unknown(check, `${check.field} has not been read.`);
      const ok = check.in.some(x => sameText(x, v));
      return {
        id: check.id, label: check.label, plain: check.plain,
        status: ok ? 'pass' : 'fail',
        severity: check.on_fail || 'block',
        detail: ok ? `Stated as ${v}.` : `Value ${v} is not one of ${check.in.join(', ')}.`,
      };
    }

    // 4. field must equal a constant
    if (check.equals !== undefined) {
      const v = read(record, check.field);
      if (!present(v)) return unknown(check, `${check.field} has not been read.`);
      const ok = sameText(v, check.equals);
      return {
        id: check.id, label: check.label, plain: check.plain,
        status: ok ? 'pass' : 'fail',
        severity: check.on_fail || 'block',
        detail: ok ? `Present.` : `Expected ${check.equals}, found ${v}.`,
      };
    }

    // 5. field must simply exist
    if (check.present) {
      const v = read(record, check.field);
      return {
        id: check.id, label: check.label, plain: check.plain,
        status: present(v) ? 'pass' : 'fail',
        severity: check.on_fail || 'block',
        detail: present(v) ? String(v) : 'Missing.',
      };
    }

    // 6. field must not match a pattern
    if (check.not_matching) {
      const v = read(record, check.field);
      if (!present(v)) return unknown(check, `${check.field} has not been read.`);
      const bad = new RegExp(check.not_matching, 'i').test(String(v));
      return {
        id: check.id, label: check.label, plain: check.plain,
        status: bad ? 'fail' : 'pass',
        severity: check.on_fail || 'block',
        detail: bad ? `Wording implies a mined origin: ${v}` : `No mined implication in ${v}.`,
      };
    }

    // 7. named expressions, kept explicit rather than eval'd
    if (check.expression) {
      const plan = record.plan || {};
      const growth = record.growthMethod;
      const carat = read(record, 'lab_report.caratWeight');

      if (check.id === 'yield_plausible') {
        const roughCt = read(record, 'kp_certificate.roughWeightCt') || read(record, 'reactor_batch.roughWeightCt');
        const recovered = plan.totalCarat;
        if (!present(roughCt) || !present(recovered)) return unknown(check, 'No plan or no rough weight yet.');
        const yieldPct = (recovered / roughCt) * 100;
        const ok = recovered <= roughCt && yieldPct <= 60;
        return {
          id: check.id, label: check.label, plain: check.plain,
          status: ok ? 'pass' : 'fail',
          severity: check.on_fail || 'block',
          detail: `${recovered.toFixed(2)} ct of polished out of ${Number(roughCt).toFixed(2)} ct of rough, ${yieldPct.toFixed(1)} percent.`,
        };
      }

      if (check.id === 'threshold') {
        if (!present(carat) || !present(growth)) return unknown(check, 'Weight or growth method not known yet.');
        const applies = growth === 'natural' && Number(carat) >= 0.5;
        return {
          id: check.id, label: check.label, plain: check.plain,
          status: 'info',
          severity: 'info',
          detail: applies
            ? `Natural and ${Number(carat).toFixed(2)} ct, so this filing is required.`
            : `Not in scope for this rule set at ${Number(carat).toFixed(2)} ct.`,
        };
      }

      if (check.id === 'batch_traceable') {
        const roughCt = read(record, 'reactor_batch.roughWeightCt');
        if (!present(roughCt) || !present(carat)) return unknown(check, 'Batch weight or graded weight not read yet.');
        const ok = Number(carat) <= Number(roughCt);
        return {
          id: check.id, label: check.label, plain: check.plain,
          status: ok ? 'pass' : 'fail',
          severity: check.on_fail || 'warn',
          detail: `${Number(carat).toFixed(2)} ct graded from a ${Number(roughCt).toFixed(2)} ct grown crystal.`,
        };
      }

      return unknown(check, 'No interpreter for this expression.');
    }

    return unknown(check, 'Rule shape not recognised.');
  }

  function evaluate(ruleSet, record) {
    const checks = ruleSet.checks.map(c => evaluateCheck(c, record));
    const blockers = checks.filter(c => c.status === 'fail' && c.severity === 'block');
    const warnings = checks.filter(c => c.status === 'fail' && c.severity === 'warn');
    const unknowns = checks.filter(c => c.status === 'unknown' && c.severity === 'block');
    const passed = checks.filter(c => c.status === 'pass');

    // Unknown is not a pass. If a blocking check cannot see its inputs, the
    // filing waits. That is the whole point of the system.
    const verdict = blockers.length ? 'blocked'
      : unknowns.length ? 'incomplete'
      : 'clear';

    return {
      ruleSet: ruleSet.id,
      version: ruleSet.version,
      instrument: ruleSet.instrument,
      statement: ruleSet.statement,
      checks,
      counts: {
        total: checks.length,
        passed: passed.length,
        blockers: blockers.length,
        warnings: warnings.length,
        unknown: unknowns.length,
      },
      blockers,
      unknowns,
      verdict,
      evidenceRequired: ruleSet.evidence_required,
      penalties: ruleSet.penalties,
    };
  }

  return { evaluate, evaluateCheck };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RulesEngine;
