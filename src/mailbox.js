// mailbox.js
// The inbox the documents actually arrive in.
//
// A trade house does not upload paperwork to a portal. It receives it: the mine
// sends the certificate on WhatsApp, the lab emails the report, the buyer sends
// the invoice on Telegram. So the intake is a mailbox, and the work is deciding
// which of the messages sitting in it carry a document worth pulling into a
// stone's record.
//
// Classification is a scoring pass over the sender, the subject and the
// attachment name. It is deliberately readable: every message shows why it was
// picked up or set aside, because a house will not hand over its inbox to
// something that cannot explain itself.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Mailbox = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // what a message has to look like to be worth reading
  const SIGNALS = [
    { test: /kimberley|kp\s*cert|certificate of origin|rough export/i, doc: 'kp_certificate', weight: 0.5, why: 'names a Kimberley Process certificate' },
    { test: /\b(gia|igi|hrd|gcal)\b|grading report|lab report/i, doc: 'lab_report', weight: 0.5, why: 'names a grading laboratory' },
    { test: /invoice|memo|proforma|packing list/i, doc: 'invoice', weight: 0.45, why: 'names an invoice or memo' },
    { test: /reactor|batch record|cvd|hpht/i, doc: 'reactor_batch', weight: 0.45, why: 'names a reactor batch' },
    { test: /parcel|carat|\bct\b|rough|polished|stone/i, doc: null, weight: 0.2, why: 'uses trade vocabulary' },
    { test: /\.pdf$|\.png$|\.jpe?g$/i, doc: null, weight: 0.2, why: 'carries a document attachment' },
  ];

  const NOISE = [
    { test: /newsletter|unsubscribe|webinar|conference|promotion/i, weight: -0.6, why: 'reads as a mailing list' },
    { test: /out of office|auto.?reply/i, weight: -0.5, why: 'is an automatic reply' },
    { test: /re:\s*re:\s*re:/i, weight: -0.15, why: 'is deep in a reply chain' },
  ];

  // Scores one message. Returns the document type it looks like, a confidence,
  // and the reasons on both sides so the decision can be argued with.
  function classify(message) {
    const hay = [message.from, message.subject, message.preview, (message.attachments || []).map(a => a.name).join(' ')]
      .filter(Boolean).join(' ');

    let score = 0;
    const reasons = [];
    const votes = {};

    for (const s of SIGNALS) {
      if (!s.test.test(hay)) continue;
      score += s.weight;
      reasons.push({ good: true, why: s.why });
      if (s.doc) votes[s.doc] = (votes[s.doc] || 0) + s.weight;
    }
    for (const n of NOISE) {
      if (!n.test.test(hay)) continue;
      score += n.weight;
      reasons.push({ good: false, why: n.why });
    }
    if (!(message.attachments || []).length) {
      score -= 0.35;
      reasons.push({ good: false, why: 'has nothing attached' });
    }

    const docType = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0] || null;
    const confidence = Math.max(0, Math.min(1, score));
    return {
      docType,
      confidence: Math.round(confidence * 100) / 100,
      verdict: confidence >= 0.6 && docType ? 'pull' : confidence >= 0.35 ? 'ask' : 'ignore',
      reasons,
    };
  }

  // Sorts a mailbox into what to pull, what to ask about, and what to leave.
  function triage(messages) {
    const out = { pull: [], ask: [], ignore: [] };
    for (const m of messages) {
      const verdict = classify(m);
      out[verdict.verdict].push({ message: m, verdict });
    }
    return out;
  }

  return { classify, triage, SIGNALS, NOISE };
}));
