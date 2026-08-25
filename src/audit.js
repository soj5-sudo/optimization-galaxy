// audit.js
// A tamper evident log, and the sealed statement that comes out of it.
//
// Every meaningful act on a record is appended as an entry whose hash covers
// both its own content and the hash before it. Change any earlier entry and
// every hash after it stops matching, which is detectable by recomputing the
// chain. That is the whole mechanism, and it is deliberately simple enough to
// re-verify with a few lines of code in any language.
//
// SHA-256 comes from the platform: SubtleCrypto in the browser, the node crypto
// module on the server. No dependency, and the same digest either way.

const Audit = (() => {

  const GENESIS = '0'.repeat(64);

  async function sha256Hex(text) {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      const bytes = new TextEncoder().encode(text);
      const digest = await window.crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    const nodeCrypto = require('crypto');
    return nodeCrypto.createHash('sha256').update(text, 'utf8').digest('hex');
  }

  // The basis is what the hash actually covers. Serialised with sorted keys so
  // the same content always produces the same digest.
  function basisOf(entry) {
    const stable = obj => {
      if (obj === null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(stable);
      return Object.keys(obj).sort().reduce((acc, k) => { acc[k] = stable(obj[k]); return acc; }, {});
    };
    return JSON.stringify({
      seq: entry.seq,
      ts: entry.ts,
      actor: entry.actor,
      action: entry.action,
      detail: entry.detail,
      data: stable(entry.data || {}),
      prev: entry.prev,
    });
  }

  async function append(chain, { actor, action, detail, data }) {
    const prev = chain.length ? chain[chain.length - 1].hash : GENESIS;
    const entry = {
      seq: chain.length,
      ts: new Date().toISOString(),
      actor,
      action,
      detail: detail || null,
      data: data || {},
      prev,
    };
    entry.basis = basisOf(entry);
    entry.hash = await sha256Hex(entry.basis);
    chain.push(entry);
    return entry;
  }

  // Recompute every hash and confirm each entry still points at the one before.
  async function verify(chain) {
    const problems = [];
    let prev = GENESIS;
    for (const entry of chain) {
      if (entry.prev !== prev) {
        problems.push({ seq: entry.seq, problem: 'Broken link. This entry does not follow the one before it.' });
      }
      const recomputed = await sha256Hex(basisOf(entry));
      if (recomputed !== entry.hash) {
        problems.push({ seq: entry.seq, problem: 'Content changed after it was written. The recomputed hash does not match.' });
      }
      prev = entry.hash;
    }
    return {
      entries: chain.length,
      intact: problems.length === 0,
      problems,
      head: chain.length ? chain[chain.length - 1].hash : GENESIS,
      checkedAt: new Date().toISOString(),
    };
  }

  // ---------- the statement ----------
  // Rendered from the rule set's own evidence list, so the document cannot
  // drift away from the regulation it is meant to satisfy.
  async function compile(record, ruleResult, signer) {
    const docs = record.documents || {};
    const lab = docs.lab_report || {};
    const inv = docs.invoice || {};
    const kp = docs.kp_certificate || {};
    const batch = docs.reactor_batch || {};
    const growth = record.growthMethod || 'natural';

    const lines = [];
    lines.push(ruleResult.statement.toUpperCase());
    lines.push(ruleResult.instrument);
    lines.push(`Rule set ${ruleResult.ruleSet} version ${ruleResult.version}`);
    lines.push('');
    lines.push('1. IMPORTER');
    lines.push(`   ${inv.buyer || 'Not set'}`);
    lines.push(`   EORI: ${inv.eori || 'Not set'}`);
    lines.push('');
    lines.push('2. GOODS');
    lines.push(`   HS code: ${growth === 'natural' ? '7102.39' : '7104.91'}`);
    lines.push(`   Description: ${growth === 'natural' ? 'Natural' : 'Laboratory grown'} polished diamond, ${lab.shape || 'Not set'}`);
    lines.push(`   Pieces: 1    Carats: ${lab.caratWeight != null ? Number(lab.caratWeight).toFixed(2) : 'Not set'}`);
    lines.push(`   Customs value: ${inv.value != null ? '$' + Number(inv.value).toLocaleString() : 'Not set'}`);
    lines.push(`   Grading report: ${lab.authority || ''} ${lab.reportNumber || 'Not set'}`);
    lines.push('');
    lines.push('3. ORIGIN');
    if (growth === 'natural') {
      lines.push(`   Country of mining origin: ${kp.countryOfOrigin || 'Not set'}`);
      lines.push(`   Kimberley Process certificate: ${kp.kpCertificate || 'Not set'}`);
      lines.push(`   Mine: ${kp.mine || 'Not set'}`);
    } else {
      lines.push(`   Growth method: ${growth.toUpperCase()}`);
      lines.push(`   Producing facility: ${batch.facility || 'Not set'}`);
      lines.push(`   Reactor batch: ${batch.batchId || 'Not set'}`);
      lines.push(`   Country of production: ${batch.countryOfOrigin || 'Not set'}`);
    }
    lines.push(`   Country of polishing: ${inv.countryOfPolish || 'Not set'}`);
    lines.push('');
    lines.push('4. DECLARATIONS');
    if (growth === 'natural') {
      lines.push('   The goods described are not of Russian Federation origin and were not');
      lines.push('   mined, processed or produced in the Russian Federation.');
      lines.push('   Reasonable steps were taken to establish the origin of the goods and no');
      lines.push('   aggregation exemption is relied upon.');
    } else {
      lines.push('   The goods described are laboratory grown and are disclosed as such at');
      lines.push('   every point of sale. No representation of mined origin is made.');
    }
    lines.push('');
    lines.push('5. EVIDENCE ON FILE');
    for (const item of ruleResult.evidenceRequired) lines.push(`   - ${item}`);
    lines.push('');
    lines.push('6. CHECKS');
    for (const c of ruleResult.checks) {
      const mark = c.status === 'pass' ? 'PASS' : c.status === 'fail' ? 'FAIL' : c.status === 'info' ? 'INFO' : 'OPEN';
      lines.push(`   ${mark.padEnd(5)} ${c.label}: ${c.detail}`);
    }
    lines.push('');
    lines.push('7. SIGNATURE');
    lines.push(`   Signed by: ${signer.name}, ${signer.role}`);
    lines.push(`   For and on behalf of: ${signer.company}`);
    lines.push(`   Place and date: ${signer.place}, ${new Date().toISOString().slice(0, 10)}`);
    lines.push('');
    lines.push('   The company named above attests to the statements made here. The');
    lines.push('   software assembled the evidence and showed its work; it does not attest.');

    const body = lines.join('\n');
    const contentHash = await sha256Hex(body);

    return {
      body,
      contentHash,
      ruleSet: ruleResult.ruleSet,
      ruleVersion: ruleResult.version,
      signer,
      sealedAt: new Date().toISOString(),
      reference: `${ruleResult.ruleSet.toUpperCase()}-${contentHash.slice(0, 8).toUpperCase()}`,
    };
  }

  return { append, verify, compile, sha256Hex, GENESIS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Audit;
