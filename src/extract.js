// extract.js
// Pulls typed fields out of the text of a trade document.
//
// The rule this file exists to enforce: a degraded read must never pass as a
// clean one. Optical character recognition on a photographed or faxed
// certificate is unreliable, so every field carries a confidence, every field
// is validated against the shape it must have, and anything that does not
// clear the bar comes back null with a reason. Filing a wrong origin is worse
// than filing nothing.
//
// Confidence is capped for anything read optically. Only a field that is
// confirmed by a human, or that satisfies a checksum, is allowed to exceed it.

const Extract = (() => {

  const OCR_CONFIDENCE_CEILING = 0.62;   // an optical read is never "certain"
  const ACCEPT_THRESHOLD = 0.55;         // below this, a human is asked

  // Identity fields are the ones where a single wrong character changes which
  // stone or which sale you are talking about. A report number that is one
  // digit out still has a perfectly valid shape, so no validator can catch it.
  // These are therefore never accepted from a single optical read: they need a
  // second document that agrees, or a person. This is deliberate, and it is the
  // difference between a system that misfiles quietly and one that stops.
  const IDENTITY_FIELDS = new Set(['reportNumber', 'number', 'assayNumber', 'kpCertificate', 'batchId']);

  // ---------- helpers ----------

  // OCR routinely swaps these. Used only when a field must be numeric, so the
  // substitution cannot invent a digit in free text.
  const DIGIT_CONFUSIONS = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', '|': '1', S: '5', s: '5', B: '8', g: '9', G: '6', Z: '2', T: '7' };

  function digitsOnly(s) {
    return String(s).split('').map(ch => (/[0-9]/.test(ch) ? ch : (DIGIT_CONFUSIONS[ch] || ''))).join('');
  }

  function norm(text) {
    return String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  }

  // find a value on the same line as a label, or on the line after it
  function nearLabel(text, labelPatterns, valuePattern) {
    const lines = norm(text).split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const lp of labelPatterns) {
        if (!lp.test(lines[i])) continue;
        const here = lines[i].replace(lp, ' ');
        let m = here.match(valuePattern);
        if (m) return { value: m[0], line: i, distance: 0 };
        if (i + 1 < lines.length) {
          m = lines[i + 1].match(valuePattern);
          if (m) return { value: m[0], line: i + 1, distance: 1 };
        }
      }
    }
    return null;
  }

  function anywhere(text, valuePattern) {
    const m = norm(text).match(valuePattern);
    return m ? { value: m[0], line: -1, distance: 3 } : null;
  }

  // a field result carries its own evidence
  function field(name, value, confidence, source, note) {
    const identity = IDENTITY_FIELDS.has(name) && source === 'ocr';
    const ok = value !== null && value !== undefined && confidence >= ACCEPT_THRESHOLD && !identity;
    return {
      name,
      value: ok ? value : null,
      confidence: value === null ? 0 : Math.round(confidence * 100) / 100,
      source: source || 'ocr',
      status: ok ? 'read' : 'needs_human',
      candidate: (!ok && value !== null && value !== undefined) ? value : null,
      note: note || (ok ? null
        : identity
          ? 'Read optically as "' + value + '". A single wrong character here changes which stone this is, so it is held until a second document agrees or a person confirms it.'
          : 'Not read with enough confidence. A person must confirm this field.'),
    };
  }

  // ---------- validators ----------
  // A validator either raises confidence (the value has the right shape) or
  // rejects it outright.

  const VALID = {
    reportNumber: v => /^[0-9]{8,12}$/.test(v),
    carat: v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 && n < 3000; },
    colour: v => /^(D|E|F|G|H|I|J|K|L|M|N|O|P|Q|R|S|T|U|V|W|X|Y|Z)$/i.test(v),
    clarity: v => /^(FL|IF|VVS1|VVS2|VS1|VS2|SI1|SI2|SI3|I1|I2|I3)$/i.test(v),
    shape: v => /round|princess|oval|cushion|emerald|pear|marquise|radiant|asscher|heart/i.test(v),
    money: v => { const n = parseFloat(String(v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n >= 0; },
    country: v => /^[A-Za-z ]{3,40}$/.test(v),
    fineness: v => { const n = parseInt(v, 10); return n >= 300 && n <= 1000; },
  };

  // ---------- parsers, one per document type ----------

  function parseLabReport(text) {
    const t = norm(text);
    const out = {};
    const authority = /\bGIA\b/i.test(t) ? 'GIA' : (/\bIGI\b|INTERNATIONAL\s+GEMO/i.test(t) ? 'IGI' : null);
    out.authority = field('authority', authority, authority ? 0.6 : 0, 'ocr');

    // report number: 8 to 12 digits, near a "report number" label if possible
    let hit = nearLabel(t, [/report\s*(number|no\.?|#)/i, /\bIGI\s*R(e|c)port/i], /[0-9OoIlSsBgGZT|]{8,12}/);
    if (!hit) hit = anywhere(t, /\b[0-9]{8,12}\b/);
    if (hit) {
      const cleaned = digitsOnly(hit.value);
      const okShape = VALID.reportNumber(cleaned);
      // proximity to the label matters: a number found anywhere is weaker
      const base = hit.distance === 0 ? 0.58 : hit.distance === 1 ? 0.5 : 0.42;
      out.reportNumber = field('reportNumber', okShape ? cleaned : null,
        okShape ? Math.min(base, OCR_CONFIDENCE_CEILING) : 0, 'ocr',
        okShape ? 'Digits are individually unreliable on a scan. Verify against the issuing lab.' : null);
    } else {
      out.reportNumber = field('reportNumber', null, 0, 'ocr');
    }

    // carat weight
    let cw = nearLabel(t, [/carat\s*weight/i, /\bcat\s*weg/i, /\bweight\b/i], /[0-9][.,][0-9]{1,2}/);
    if (!cw) cw = anywhere(t, /\b[0-9]\.[0-9]{2}\s*(ct|carat)/i);
    if (cw) {
      const v = parseFloat(String(cw.value).replace(',', '.').replace(/[^0-9.]/g, ''));
      const ok = VALID.carat(v);
      out.caratWeight = field('caratWeight', ok ? v : null,
        ok ? Math.min(cw.distance === 0 ? 0.58 : 0.46, OCR_CONFIDENCE_CEILING) : 0, 'ocr');
    } else {
      out.caratWeight = field('caratWeight', null, 0, 'ocr');
    }

    // colour and clarity: single tokens, very easy to misread, so held low
    const colHit = nearLabel(t, [/colou?r\s*grade/i], /\b[D-Z]\b/);
    out.colourGrade = colHit && VALID.colour(colHit.value)
      ? field('colourGrade', colHit.value.toUpperCase(), 0.5, 'ocr')
      : field('colourGrade', null, 0, 'ocr');

    const claHit = nearLabel(t, [/clarity\s*grade/i, /clarity/i], /\b(FL|IF|VVS1|VVS2|VS1|VS2|SI1|SI2|SI3|I1|I2|I3)\b/i);
    out.clarityGrade = claHit && VALID.clarity(claHit.value)
      ? field('clarityGrade', claHit.value.toUpperCase(), 0.5, 'ocr')
      : field('clarityGrade', null, 0, 'ocr');

    const shapeHit = anywhere(t, /round\s*brill?ia\w*|princess|oval|cushion|emerald\s*cut|pear|marquise|radiant|asscher/i);
    out.shape = shapeHit
      ? field('shape', /round/i.test(shapeHit.value) ? 'Round Brilliant' : shapeHit.value, 0.56, 'ocr')
      : field('shape', null, 0, 'ocr');

    // growth method: labs state this explicitly for grown stones
    const grown = /laborator(y|ies)\s*grown|lab\s*grown|cvd|hpht|chemical\s*vapou?r/i.test(t);
    const natural = /natural\s*diamond/i.test(t);
    out.growthMethod = field('growthMethod',
      grown ? (/hpht/i.test(t) ? 'hpht' : 'cvd') : (natural ? 'natural' : null),
      grown || natural ? 0.57 : 0, 'ocr');

    return { docType: 'lab_report', fields: out };
  }

  function parseInvoice(text) {
    const t = norm(text);
    const out = {};

    let num = nearLabel(t, [/invoice\s*(number|no\.?|#)/i, /\bmemo\b/i], /[A-Z0-9][A-Z0-9\-\/]{2,20}/i);
    out.number = num
      ? field('number', num.value.trim(), Math.min(0.52, OCR_CONFIDENCE_CEILING), 'ocr')
      : field('number', null, 0, 'ocr');

    // totals: the largest money-looking number on the page is usually the total
    const monies = (t.match(/\b[0-9]{1,3}(,[0-9]{3})*\.[0-9]{2}\b/g) || [])
      .map(s => parseFloat(s.replace(/,/g, '')))
      .filter(n => Number.isFinite(n));
    const total = monies.length ? Math.max(...monies) : null;
    out.value = total !== null
      ? field('value', total, 0.5, 'ocr', 'Taken as the largest amount on the page. Confirm against the total line.')
      : field('value', null, 0, 'ocr');

    const seller = t.split('\n').map(l => l.trim()).find(l => /\b(inc\.?|ltd\.?|llc|nv|bv|pvt|gmbh|jewelry|jewellery|diamonds?)\b/i.test(l) && l.length < 60);
    out.seller = seller ? field('seller', seller, 0.48, 'ocr') : field('seller', null, 0, 'ocr');

    const origin = nearLabel(t, [/country\s*of\s*origin/i, /origin/i], /[A-Za-z ]{3,30}/);
    out.declaredOrigin = origin && VALID.country(origin.value.trim())
      ? field('declaredOrigin', origin.value.trim(), 0.5, 'ocr')
      : field('declaredOrigin', null, 0, 'ocr');

    // The System of Warranties sentence is the spine of the invoice chain.
    const warranty = /warrant|conflict[- ]free|kimberley|united nations resolutions/i.test(t);
    out.warrantyClause = field('warrantyClause', warranty ? 'present' : null, warranty ? 0.6 : 0, 'ocr',
      warranty ? null : 'No System of Warranties wording found. Every invoice in the chain must carry it.');

    return { docType: 'invoice', fields: out };
  }

  function parseAssay(text) {
    const t = norm(text);
    const out = {};
    const metal = /\bgold\b|\bau\b/i.test(t) ? 'gold' : (/\bsilver\b|\bag\b/i.test(t) ? 'silver' : (/platinum|\bpt\b/i.test(t) ? 'platinum' : null));
    out.metal = field('metal', metal, metal ? 0.58 : 0, 'ocr');
    const fine = anywhere(t, /\b(999|958|950|925|916|900|850|800|750|585|375)\b/);
    out.fineness = fine && VALID.fineness(fine.value)
      ? field('fineness', parseInt(fine.value, 10), 0.55, 'ocr')
      : field('fineness', null, 0, 'ocr');
    const num = nearLabel(t, [/assay|certificate\s*(number|no)/i], /[A-Z0-9][A-Z0-9\-]{3,20}/i);
    out.assayNumber = num ? field('assayNumber', num.value, 0.5, 'ocr') : field('assayNumber', null, 0, 'ocr');
    return { docType: 'assay_certificate', fields: out };
  }

  // ---------- entry point ----------

  function classify(text) {
    const t = norm(text);
    if (/grading\s*report|gemological|gemmological|\bGIA\b|\bIGI\b|clarity\s*grade/i.test(t)) return 'lab_report';
    if (/assay|fineness|hallmark/i.test(t)) return 'assay_certificate';
    if (/invoice|memo|bill to|ship to|total/i.test(t)) return 'invoice';
    if (/kimberley|rough\s*diamond|parcel/i.test(t)) return 'kp_certificate';
    if (/reactor|batch|deposition|plasma|press/i.test(t)) return 'reactor_batch';
    return 'unknown';
  }

  function run(text, hintType) {
    const docType = hintType && hintType !== 'auto' ? hintType : classify(text);
    let parsed;
    if (docType === 'lab_report') parsed = parseLabReport(text);
    else if (docType === 'invoice') parsed = parseInvoice(text);
    else if (docType === 'assay_certificate') parsed = parseAssay(text);
    else parsed = { docType, fields: {} };

    const fields = parsed.fields;
    const names = Object.keys(fields);
    const read = names.filter(n => fields[n].status === 'read');
    const needsHuman = names.filter(n => fields[n].status === 'needs_human');
    const meanConf = read.length ? read.reduce((s, n) => s + fields[n].confidence, 0) / read.length : 0;

    return {
      docType: parsed.docType,
      fields,
      summary: {
        total: names.length,
        read: read.length,
        needsHuman: needsHuman.length,
        needsHumanFields: needsHuman,
        meanConfidence: Math.round(meanConf * 100) / 100,
        ceiling: OCR_CONFIDENCE_CEILING,
        verdict: names.length === 0 ? 'unreadable' : (needsHuman.length === 0 ? 'complete' : 'human_review'),
      },
    };
  }

  // A human confirming a field is the only way past the optical ceiling, and
  // the correction is what the extractor learns from.
  function confirm(result, fieldName, value) {
    if (!result.fields[fieldName]) return result;
    const prior = result.fields[fieldName];
    result.fields[fieldName] = {
      ...prior,
      value,
      confidence: 1,
      source: 'human',
      status: 'confirmed',
      note: null,
      correctedFrom: prior.value,
    };
    const names = Object.keys(result.fields);
    const needsHuman = names.filter(n => result.fields[n].status === 'needs_human');
    result.summary.needsHuman = needsHuman.length;
    result.summary.needsHumanFields = needsHuman;
    result.summary.verdict = needsHuman.length === 0 ? 'complete' : 'human_review';
    return result;
  }

  // Two documents from different parties that read the same value is real
  // evidence, and it is the only automatic route past the identity hold.
  function corroborate(result, fieldName, otherValue, otherSource) {
    const f = result.fields[fieldName];
    if (!f) return result;
    const candidate = f.value !== null ? f.value : f.candidate;
    if (candidate === null || candidate === undefined) return result;
    const same = String(candidate).replace(/\s+/g, '').toUpperCase()
              === String(otherValue).replace(/\s+/g, '').toUpperCase();
    if (!same) {
      result.fields[fieldName] = {
        ...f, value: null, status: 'conflict', confidence: 0,
        note: 'This document reads "' + candidate + '" but ' + otherSource + ' says "' + otherValue + '". They do not agree, so nothing is filed until a person resolves it.',
      };
    } else {
      result.fields[fieldName] = {
        ...f, value: candidate, status: 'corroborated', confidence: 0.95,
        source: 'ocr + ' + otherSource,
        note: 'Read optically and confirmed by ' + otherSource + '. Two independent documents agree.',
      };
    }
    const names = Object.keys(result.fields);
    const unresolved = names.filter(n => result.fields[n].status === 'needs_human' || result.fields[n].status === 'conflict');
    result.summary.needsHuman = unresolved.length;
    result.summary.needsHumanFields = unresolved;
    result.summary.verdict = names.length === 0 ? 'unreadable' : (unresolved.length === 0 ? 'complete' : 'human_review');
    return result;
  }

  return { run, confirm, corroborate, classify, OCR_CONFIDENCE_CEILING, ACCEPT_THRESHOLD, IDENTITY_FIELDS, VALID };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Extract;
