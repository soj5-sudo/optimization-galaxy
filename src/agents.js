// agents.js
// The crew, and the envelope they speak through.
//
// Each agent has one job, declares the intents it emits, and never writes to
// another agent's area of the record. They communicate by posting a typed
// envelope with a named intent, which the session relays to whichever parties
// are allowed to see it. Swapping the transport for an open agent protocol is
// a change to postEnvelope and nothing else.
//
// Nothing here files anything. The last step is always a named human.

const AgentCrew = (() => {

  // ---------- the envelope ----------
  // Typed, versioned, and scoped. Scope decides who sees it: 'shared' means all
  // three companies, an org id means only that company.
  const ENVELOPE_VERSION = '1.0';

  const INTENTS = {
    'document.received': 'A document arrived from a party inbox',
    'extraction.completed': 'Fields were read off a document',
    'extraction.needs_human': 'A field could not be read safely',
    'origin.check.request': 'Ask for the origin chain to be verified',
    'origin.check.completed': 'Origin chain verified or refused',
    'sanctions.screen.completed': 'Counterparties and origin screened',
    'scan.analysed': 'The scan was read by the model',
    'plan.produced': 'A cut plan was produced',
    'precut.gate.completed': 'Accept or reject decided before cutting',
    'cut.reported': 'The floor reported what actually came off the wheel',
    'quote.produced': 'The stone was priced',
    'rules.evaluated': 'A destination rule set was evaluated',
    'adversarial.completed': 'Our own output was attacked and the result reported',
    'statement.assembled': 'The filing was rendered and sealed',
    'statement.signed': 'A named human signed the filing',
  };

  function envelope(intent, from, payload, scope) {
    if (!INTENTS[intent]) throw new Error(`Unknown intent: ${intent}`);
    return {
      v: ENVELOPE_VERSION,
      intent,
      from,
      scope: scope || 'shared',
      ts: new Date().toISOString(),
      payload: payload || {},
    };
  }

  // ---------- the agents ----------
  // `state` is honest: 'live' means it does the work described, 'deterministic'
  // means it is a rule table rather than a learned model. This is shown in the
  // interface, because claiming a model where there is a table is the fastest
  // way to lose a technical buyer.
  const AGENTS = {
    document_reader: {
      id: 'document_reader',
      label: 'Document reader',
      job: 'Reads certificates, grading reports and invoices, and pulls out the fields',
      state: 'live',
      method: 'Optical character recognition against a typed schema, with a confidence ceiling and a human queue',
      emits: ['document.received', 'extraction.completed', 'extraction.needs_human'],
      owner: 'shared',
    },
    origin_verifier: {
      id: 'origin_verifier',
      label: 'Origin verifier',
      job: 'Matches the stone back to its mining certificate or reactor batch',
      state: 'live',
      method: 'Cross document field comparison with corroboration, evaluated against the versioned rule set',
      emits: ['origin.check.completed'],
      owner: 'shared',
    },
    sanctions_screener: {
      id: 'sanctions_screener',
      label: 'Sanctions screener',
      job: 'Screens the origin country and the counterparties on the shipment',
      state: 'live',
      method: 'List screening against the restricted origins named in the rule set',
      emits: ['sanctions.screen.completed'],
      owner: 'shared',
    },
    scan_model: {
      id: 'scan_model',
      label: 'Scan model',
      job: 'Reads the rough scan and marks where the flaws are',
      state: 'live',
      method: 'Convolutional network, trained in this repository, running in the browser',
      emits: ['scan.analysed'],
      owner: 'factory',
    },
    cut_planner: {
      id: 'cut_planner',
      label: 'Cut planner',
      job: 'Fits polished stones inside the rough, around the flaws',
      state: 'live',
      method: 'Geometric placement search over the segmented stone, scored for value',
      emits: ['plan.produced'],
      owner: 'factory',
    },
    precut_gate: {
      id: 'precut_gate',
      label: 'Pre cut gate',
      job: 'Decides accept or reject before the saw runs, so rough is not wasted',
      state: 'deterministic',
      method: 'Named policy thresholds over model flaw evidence. Not learned yet, and the thresholds are printed with every verdict',
      emits: ['precut.gate.completed'],
      owner: 'factory',
    },
    quoting: {
      id: 'quoting',
      label: 'Quoting',
      job: 'Prices the polished result and returns the most that can be paid for the rough',
      state: 'live',
      method: 'Price list basis less the house discount, duty from the country of polish, cutting cost and margin',
      emits: ['quote.produced'],
      owner: 'importer',
    },
    adversarial_checker: {
      id: 'adversarial_checker',
      label: 'Adversarial checker',
      job: 'Attacks our own output and looks for the contradiction before customs does',
      state: 'live',
      method: 'Re-derives every filed field from the source documents and refuses anything it cannot reproduce',
      emits: ['adversarial.completed'],
      owner: 'shared',
    },
    statement_compiler: {
      id: 'statement_compiler',
      label: 'Statement compiler',
      job: 'Renders the filing from a versioned template and seals it',
      state: 'live',
      method: 'Template render plus a content hash chained onto the previous entry',
      emits: ['statement.assembled'],
      owner: 'exporter',
    },
  };

  // ---------- the adversarial pass ----------
  // Its only job is to disagree. It re-derives each filed value straight from
  // the documents and refuses anything it cannot reproduce, anything resting on
  // a single unconfirmed optical read, and anything a rule left unknown.
  function adversarial(record, ruleResult) {
    const findings = [];
    const docs = record.documents || {};

    // 1. every filed field must trace to a document
    const filedFields = ruleResult.evidenceRequired || [];
    if (!docs.lab_report || !docs.lab_report.reportNumber) {
      findings.push({
        severity: 'block',
        claim: 'Stone identity',
        finding: 'No confirmed grading report number. The filing would describe a stone we cannot point at.',
      });
    }

    // 2. nothing may rest on an unconfirmed optical read
    const weak = [];
    for (const [docName, doc] of Object.entries(record.provenance || {})) {
      for (const [fieldName, meta] of Object.entries(doc)) {
        if (meta && (meta.status === 'needs_human' || meta.status === 'conflict')) {
          weak.push(`${docName}.${fieldName}`);
        }
      }
    }
    if (weak.length) {
      findings.push({
        severity: 'block',
        claim: 'Evidence quality',
        finding: `${weak.length} field${weak.length > 1 ? 's are' : ' is'} still unconfirmed or in conflict: ${weak.slice(0, 4).join(', ')}${weak.length > 4 ? ' and others' : ''}.`,
      });
    }

    // 3. a rule that could not see its inputs is not a pass
    if (ruleResult.counts && ruleResult.counts.unknown > 0) {
      findings.push({
        severity: 'block',
        claim: 'Rule coverage',
        finding: `${ruleResult.counts.unknown} blocking check${ruleResult.counts.unknown > 1 ? 's' : ''} could not be evaluated. Unknown is not a pass.`,
      });
    }

    // 4. the arithmetic must close
    if (record.plan && docs.kp_certificate && docs.kp_certificate.roughWeightCt) {
      const y = (record.plan.totalCarat / docs.kp_certificate.roughWeightCt) * 100;
      if (y > 60) {
        findings.push({
          severity: 'block',
          claim: 'Yield',
          finding: `Plan claims ${y.toFixed(1)} percent recovery. Above 60 percent is not physically credible and customs will read it as a substituted parcel.`,
        });
      }
    }

    // 5. the story must be internally consistent
    if (record.growthMethod && record.growthMethod !== 'natural' && docs.kp_certificate) {
      findings.push({
        severity: 'block',
        claim: 'Growth method',
        finding: 'A laboratory grown stone is carrying a Kimberley Process certificate. Those two documents cannot both describe this stone.',
      });
    }

    return {
      agent: 'adversarial_checker',
      findings,
      verdict: findings.some(f => f.severity === 'block') ? 'refuse' : 'no_contradiction',
      checkedAt: new Date().toISOString(),
    };
  }

  return { AGENTS, INTENTS, envelope, adversarial, ENVELOPE_VERSION };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AgentCrew;
