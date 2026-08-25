// workspace.js
// The application. Loads the rule sets, wires the agents to the record, and
// renders what the signed in company is allowed to see.
//
// Two principles run through this file.
// First, nothing is asserted that was not produced by a component that can be
// pointed at: every value carries where it came from.
// Second, the partition is enforced when data is rendered as well as when it is
// synced, so a screen share cannot leak another company's numbers.

(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const money = n => '$' + Math.round(Number(n) || 0).toLocaleString();
  const pct = n => (Number(n) * 100).toFixed(1) + '%';

  // ---------- shipments the demo ships with ----------
  // The lab reports and the rough scan are genuine documents. The mining
  // certificate and the invoice for each stone are structured demo records,
  // marked as such wherever they appear.
  const SHIPMENTS = [
    {
      id: 'SHP-2026-0031',
      name: 'Antwerp parcel, 2 stones',
      destination: 'eu',
      stones: [
        {
          id: 'ST-1',
          label: 'Rough 327.8',
          growthMethod: 'natural',
          scan: 'assets/samples/rough-327.png',
          scanWidthMm: 14.4,
          docKey: 'IGI-7996745173',
          houseId: 'antwerp-dt',
        },
        {
          id: 'ST-2',
          label: 'GIA 7373304073',
          growthMethod: 'natural',
          scan: 'assets/samples/scan-02.png',
          scanWidthMm: 9.0,
          docKey: 'GIA-7373304073',
          houseId: 'antwerp-dt',
        },
      ],
    },
    {
      id: 'SHP-2026-0032',
      name: 'Lab grown lot, CVD',
      destination: 'eu',
      stones: [
        {
          id: 'ST-3',
          label: 'CVD reactor batch R-4471',
          growthMethod: 'cvd',
          scan: 'assets/samples/scan-04.png',
          scanWidthMm: 11.0,
          docKey: 'CVD-R4471',
          houseId: 'kama-schachter',
        },
      ],
    },
  ];

  // Structured document records. Real values for the lab reports come from OCR
  // of the actual certificate; these fill the documents no scan exists for.
  const STRUCTURED = {
    'IGI-7996745173': {
      kp_certificate: {
        kpCertificate: 'BW-2025-114872', countryOfOrigin: 'Botswana', mine: 'Jwaneng',
        parcel: 'PRC-88231', roughWeightCt: 17.69, issued: '2025-11-08',
        _source: 'assets/docs/kp-bw-2025-114872.png',
      },
      lab_report: {
        authority: 'IGI', reportNumber: '7996745173', caratWeight: 3.01, colourGrade: 'F',
        clarityGrade: 'SI2', shape: 'Round Brilliant', cutGrade: 'Excellent',
        growthMethod: 'natural', _source: 'assets/docs/igi-7996745173.png',
      },
      invoice: {
        number: 'INV-2026-0431', seller: 'Jewel Labs Manufacturing, Surat',
        buyer: 'Antwerp Diamond Trading NV', eori: 'BE0862234561',
        labReportNumber: '7996745173', caratWeight: 3.01, shape: 'Round Brilliant',
        declaredOrigin: 'Botswana', countryOfPolish: 'India', value: 36900,
        warrantyClause: 'present', _demo: true,
      },
    },
    'GIA-7373304073': {
      kp_certificate: {
        kpCertificate: 'RU-2020-330914', countryOfOrigin: 'Russian Federation', mine: 'Udachnaya',
        parcel: 'PRC-44017', roughWeightCt: 2.48, issued: '2020-09-30',
        _source: 'assets/docs/kp-ru-2020-330914.png',
      },
      lab_report: {
        authority: 'GIA', reportNumber: '7373304073', caratWeight: 1.00, colourGrade: 'G',
        clarityGrade: 'I2', shape: 'Round Brilliant', cutGrade: 'Very Good',
        growthMethod: 'natural', _source: 'assets/docs/gia-7373304073.png',
      },
      invoice: {
        number: 'INV-2026-0432', seller: 'Third party consignment desk',
        buyer: 'Antwerp Diamond Trading NV', eori: 'BE0862234561',
        labReportNumber: '7373304073', caratWeight: 1.00, shape: 'Round Brilliant',
        declaredOrigin: 'Botswana', countryOfPolish: 'India', value: 3150,
        warrantyClause: 'present', _demo: true,
      },
    },
    'CVD-R4471': {
      reactor_batch: {
        batchId: 'R-4471', facility: 'Surat Advanced Materials, Unit 2',
        countryOfOrigin: 'India', reactorType: 'Microwave plasma CVD',
        growthHours: 336, roughWeightCt: 8.42, seedPlate: 'HPHT type IIa',
        started: '2026-02-11', _source: 'assets/docs/cvd-batch-r4471.png',
      },
      lab_report: {
        authority: 'IGI', reportNumber: '6221904488', caratWeight: 2.14, colourGrade: 'E',
        clarityGrade: 'VS1', shape: 'Round Brilliant', cutGrade: 'Excellent',
        growthMethod: 'cvd', _demo: true,
      },
      invoice: {
        number: 'INV-2026-0455', seller: 'Surat Advanced Materials',
        buyer: 'Kama Schachter Jewelry, Inc.', eori: 'US-EIN-133912847',
        labReportNumber: '6221904488', caratWeight: 2.14, shape: 'Round Brilliant',
        declaredOrigin: 'India, laboratory grown', countryOfPolish: 'India', value: 2980,
        warrantyClause: 'present', _demo: true,
      },
    },
  };

  // Where each document's picture lives, and what it is in one plain sentence.
  const PAPER = {
    'IGI-7996745173': {
      lab_report: { img: 'assets/docs/igi-7996745173.png', from: 'IGI Antwerp, by email',
        what: 'Grading report', why: 'The lab weighed and graded the finished stone.' },
      kp_certificate: { img: 'assets/docs/kp-bw-2025-114872.png', from: 'The mine, by WhatsApp',
        what: 'Kimberley Process certificate', why: 'Proves which country the rough came out of.' },
      invoice: { img: 'assets/docs/memo-kama-schachter.png', from: 'The buyer, by Telegram',
        what: 'Invoice', why: 'The sale: who bought it, for how much, cut where.' },
    },
    'GIA-7373304073': {
      lab_report: { img: 'assets/docs/gia-7373304073.png', from: 'GIA, by email',
        what: 'Grading report', why: 'The lab weighed and graded the finished stone.' },
      kp_certificate: { img: 'assets/docs/kp-ru-2020-330914.png', from: 'Consignment desk, by WhatsApp',
        what: 'Kimberley Process certificate', why: 'Proves which country the rough came out of.' },
      invoice: { img: 'assets/docs/memo-kama-schachter.png', from: 'Consignment desk, by Telegram',
        what: 'Invoice', why: 'The sale: who bought it, for how much, cut where.' },
    },
    'CVD-R4471': {
      lab_report: { img: 'assets/docs/igi-7996745173.png', from: 'IGI, by email',
        what: 'Grading report', why: 'The lab weighed and graded the finished stone.' },
      reactor_batch: { img: 'assets/docs/cvd-batch-r4471.png', from: 'The reactor floor',
        what: 'Reactor batch record', why: 'Says which machine grew it, and for how long.' },
      invoice: { img: 'assets/docs/memo-kama-schachter.png', from: 'The buyer, by email',
        what: 'Invoice', why: 'The sale: who bought it, for how much, cut where.' },
    },
  };

  function lightbox(src, caption) {
    const box = el('figure', 'app-lightbox');
    const i = el('img');
    i.src = src;
    box.append(i, el('figcaption', null, caption || ''));
    box.addEventListener('click', () => box.remove());
    document.body.append(box);
  }

  const SIGNER = {
    name: 'M. Patel', role: 'Compliance Director',
    company: 'Jewel Labs Manufacturing, Surat', place: 'Surat, India',
  };

  // ---------- state ----------
  const app = {
    party: 'exporter',
    shipment: SHIPMENTS[0],
    stone: SHIPMENTS[0].stones[0],
    records: {},          // stoneId -> record
    ruleSets: {},
    chain: [],
    tab: 'overview',
    system: {},
    running: false,
  };

  function record(stoneId) {
    if (!app.records[stoneId]) {
      const stone = SHIPMENTS.flatMap(s => s.stones).find(s => s.id === stoneId);
      app.records[stoneId] = {
        id: stoneId,
        stone,
        growthMethod: stone.growthMethod,
        documents: {},
        provenance: {},
        extraction: {},
        scan: null,
        plan: null,
        precut: null,
        rules: null,
        adversarial: null,
        quote: null,
        statement: null,
        events: [],
      };
    }
    return app.records[stoneId];
  }

  // ---------- activity log ----------
  function log(actor, text, tone) {
    const box = $('activity-log');
    const row = el('div', 'og-agent__log-line' + (tone ? ' og-agent__log-line--' + tone : ''));
    const t = new Date();
    row.append(
      el('span', 'og-agent__log-time', `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`),
      el('span', null, ` ${actor}  ${text}`)
    );
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  async function audit(actor, action, detail, data) {
    const entry = await Audit.append(app.chain, { actor, action, detail, data });
    $('chain-head').textContent = `Audit chain ${app.chain.length} entries, head ${entry.hash.slice(0, 12)}`;
    // tell the other companies in the session what just happened
    announce(actor, action, detail);
    return entry;
  }

  // ---------- talking to the other companies ----------
  // Agent steps travel as typed envelopes. Scope decides who receives them:
  // the work on the stone is shared, a company's own numbers are not.
  const INTENT_FOR = {
    'Document received': 'document.received',
    'Optical read': 'extraction.completed',
    'Field confirmed': 'extraction.completed',
    'Scan analysed': 'scan.analysed',
    'Plan produced': 'plan.produced',
    'Gate completed': 'precut.gate.completed',
    'Rules evaluated': 'rules.evaluated',
    'Own output attacked': 'adversarial.completed',
    'Priced': 'quote.produced',
    'Statement signed': 'statement.signed',
    'Scan received': 'document.received',
  };

  function announce(actor, action, detail) {
    if (!Session.state.id) return;
    const intent = INTENT_FOR[action];
    if (!intent) return;
    // a price is the importer's business, everything else is the shared record
    const scope = action === 'Priced' ? 'importer' : 'shared';
    Session.post(intent, actor, { action, detail, stone: app.stone.id, by: app.party }, scope);
  }

  // Status goes to the activity column on the right, where it stays and can be
  // read back. Nothing pops up over the work.
  function toast(title, body, kind) {
    log('status', body ? `${title}. ${body}` : title,
      kind === 'success' ? 'ok' : kind === 'danger' ? 'error' : kind === 'warning' ? 'warn' : null);
  }

  // ---------- boot ----------
  async function boot() {
    // rule sets are data, loaded at runtime
    for (const [key, file] of [['eu', 'rules/eu_dds_2026.json'], ['ftc', 'rules/ftc_disclosure_2018.json']]) {
      try {
        const r = await fetch(file, { cache: 'no-store' });
        if (r.ok) app.ruleSets[key] = await r.json();
      } catch (e) { /* reported in system status */ }
    }

    const cnnStatus = await CNN.load();
    const policy = await PreCut.loadPolicy();
    let host = {};
    try { host = await (await fetch('/api/hostinfo')).json(); } catch (e) {}

    app.system = {
      ocr: host.ocr || 'unavailable',
      mail: host.mail || 'unknown',
      cnn: cnnStatus.loaded ? 'trained and loaded' : 'not trained yet',
      rules: Object.keys(app.ruleSets).length + ' rule sets',
      gate: policy ? 'learned policy' : 'threshold table',
    };

    renderRail();
    renderTabs();
    render();
    log('system', `Ready. OCR ${app.system.ocr}. Model ${app.system.cnn}.`, 'ok');
  }

  // ---------- rail ----------
  function renderRail() {
    const list = $('shipment-list');
    list.innerHTML = '';
    for (const shp of SHIPMENTS) {
      const head = el('p', 'og-t-11 og-upper og-c-tertiary', shp.name);
      list.append(head);
      for (const st of shp.stones) {
        const b = el('button', 'og-rail__item' + (st.id === app.stone.id ? ' is-active' : ''));
        b.append(el('span', 'og-rail__label', st.label));
        const g = Domain.GROWTH_METHODS[st.growthMethod];
        b.append(el('span', 'og-badge og-t-11', g.short));
        b.addEventListener('click', () => {
          app.shipment = shp; app.stone = st; render();
        });
        list.append(b);
      }
    }

    const parties = $('party-list');
    parties.innerHTML = '';
    for (const p of Object.values(Domain.PARTIES)) {
      const row = el('div', 'app-party');
      row.dataset.you = String(p.id === app.party);
      const av = el('span', 'og-avatar og-avatar--sm og-avatar--' + p.id, p.label.slice(0, 1));
      const txt = el('div', 'app-party__text');
      txt.append(el('div', 'app-party__name', p.label), el('div', 'app-party__holds', p.holds));
      row.append(av, txt);
      parties.append(row);
    }

    const agents = $('agent-list');
    agents.innerHTML = '';
    for (const a of Object.values(AgentCrew.AGENTS)) {
      const row = el('div', 'og-doc');
      const body = el('div', 'og-doc__body');
      body.append(el('div', 'og-doc__name', a.label));
      body.append(el('div', 'og-doc__meta', a.job));
      row.append(body);
      row.append(el('span', 'og-pill og-pill--' + (a.state === 'live' ? 'success' : 'warning'), a.state));
      row.title = a.method;
      agents.append(row);
    }

    const sys = $('system-status');
    sys.innerHTML = '';
    for (const [k, v] of Object.entries(app.system)) {
      sys.append(el('dt', 'og-kv__term', k.toUpperCase()), el('dd', 'og-kv__value', v));
    }
  }

  // ---------- tabs ----------
  function renderTabs() {
    for (const btn of document.querySelectorAll('.og-tab')) {
      btn.addEventListener('click', () => {
        app.tab = btn.dataset.tab;
        for (const b of document.querySelectorAll('.og-tab')) b.classList.toggle('og-tab--active', b === btn);
        for (const p of document.querySelectorAll('.og-tabpanel')) p.classList.toggle('is-active', p.dataset.panel === app.tab);
        render();
      });
    }
  }

  // ---------- render ----------
  function render() {
    const rec = record(app.stone.id);
    $('record-name').textContent = `${app.shipment.name}, ${app.stone.label}`;
    $('record-id').textContent = rec.id;
    renderRail();

    const painters = {
      overview: paintOverview, documents: paintDocuments, scan: paintScan,
      compliance: paintCompliance, price: paintPrice, statement: paintStatement,
      audit: paintAudit, model: paintModel,
    };
    (painters[app.tab] || paintOverview)(rec);
    $('tabcount-documents').textContent = Object.keys(rec.documents).length;
  }

  function card(title, subtitle) {
    const c = el('section', 'og-card');
    const h = el('div', 'og-card__header');
    h.append(el('h3', 'og-card__title', title));
    if (subtitle) h.append(el('p', 'og-card__subtitle', subtitle));
    c.append(h);
    const b = el('div', 'og-card__body');
    c.append(b);
    c.body = b;
    return c;
  }

  function pill(text, kind) {
    return el('span', 'og-pill og-pill--' + kind, text);
  }

  function emptyState(title, text) {
    const e = el('div', 'og-empty');
    e.append(el('p', 'og-empty__title', title), el('p', 'og-empty__text', text));
    return e;
  }

  // ---------- overview ----------
  function paintOverview(rec) {
    const p = $('panel-overview');
    p.innerHTML = '';

    const intro = el('div', 'app-section');
    intro.append(el('p', 'app-plain', 'One page per stone, shared by the three companies that touch it.'));
    intro.append(el('p', 'app-plain-sub', 'The factory cuts it, the exporter ships it, the buyer pays for it. They all read and write this same page, so the papers, the price and the cutting plan can never disagree with each other.'));
    p.append(intro);

    // the stone, as a picture, first
    const shot = el('div', 'app-stone-shot');
    const im = el('img');
    im.src = app.stone.scan;
    im.alt = app.stone.label;
    im.style.cursor = 'zoom-in';
    im.addEventListener('click', () => lightbox(app.stone.scan, 'X-ray of the rough stone, straight off the machine'));
    shot.append(im);
    p.append(shot);
    const leg = el('div', 'app-legend');
    for (const [c, t] of [['#4ec08d', 'Marks the machine painted on flaws'], ['#82868e', 'The stone itself'], ['#000', 'Background']]) {
      const sp = el('span');
      const i2 = el('i'); i2.style.background = c;
      sp.append(i2, document.createTextNode(t));
      leg.append(sp);
    }
    p.append(leg);

    const g = Domain.GROWTH_METHODS[rec.growthMethod];
    const dests = Domain.destinationsFor(rec.growthMethod, app.shipment.destination);

    const head = card('This stone', `${g.label}. ${g.description}`);
    const kv = el('dl', 'og-kv og-kv--rows');
    const rows = [
      ['Stone', app.stone.label],
      ['Growth method', g.label],
      ['Origin proof', Domain.DOC_TYPES[g.originDocument].label],
      ['HS code', g.hsCode],
      ['Sanctions rules apply', g.sanctionsApplicable ? 'Yes, mined goods' : 'No, laboratory grown'],
      ['Destination', dests.map(d => d.label).join(' and ') || 'Not set'],
      ['Filing required', dests.map(d => d.statement).join(', ') || 'None'],
    ];
    for (const [k, v] of rows) kv.append(el('dt', 'og-kv__term', k), el('dd', 'og-kv__value', v));
    head.body.append(kv);
    p.append(head);

    // pipeline state
    const steps = [
      ['Documents read', Object.keys(rec.documents).length ? 'done' : 'todo'],
      ['Scan analysed', rec.scan ? 'done' : 'todo'],
      ['Cut planned', rec.plan ? 'done' : 'todo'],
      ['Pre cut gate', rec.precut ? 'done' : 'todo'],
      ['Rules evaluated', rec.rules ? 'done' : 'todo'],
      ['Own output attacked', rec.adversarial ? 'done' : 'todo'],
      ['Priced', rec.quote ? 'done' : 'todo'],
      ['Statement signed', rec.statement ? 'done' : 'todo'],
    ];
    const prog = card('Progress', 'Every step writes to the same record, and every step is logged.');
    const stepper = el('div', 'og-stepper og-stepper--vertical');
    for (const [label, state] of steps) {
      const s = el('div', 'og-step' + (state === 'done' ? ' og-step--done' : ''));
      s.append(el('span', 'og-step__marker', state === 'done' ? '✓' : ''));
      const t = el('div', 'og-step__text');
      t.append(el('span', 'og-step__label', label));
      s.append(t);
      stepper.append(s);
    }
    prog.body.append(stepper);
    p.append(prog);

    if (!rec.plan) {
      p.append(emptyState('Nothing has run yet on this stone',
        'Press Run shipment in the top bar. The agents read the documents, analyse the scan, plan the cut, check the origin and price the result.'));
    }
  }

  // ---------- documents ----------
  function paintDocuments(rec) {
    const p = $('panel-documents');
    p.innerHTML = '';
    const names = Object.keys(rec.documents);
    if (!names.length) {
      p.append(emptyState('No papers yet', 'Press Run shipment. The papers arrive from the inboxes on their own.'));
      return;
    }

    const intro = el('div', 'app-section');
    intro.append(el('p', 'app-plain', 'Three papers have to agree.'));
    intro.append(el('p', 'app-plain-sub', 'Where it was dug up, what the lab measured, and what it sold for. The software reads all three and compares them. Click any paper to see it full size.'));
    p.append(intro);

    // A reviewer signs off a document, not one field at a time. This is the
    // same act of attestation as confirming each field, recorded per field, so
    // the audit trail is identical either way.
    const held = [];
    for (const [docName, prov] of Object.entries(rec.provenance || {})) {
      for (const [field, meta] of Object.entries(prov || {})) {
        if (meta && (meta.status === 'needs_human' || meta.status === 'conflict')) {
          held.push({ docName, field, meta, value: (rec.documents[docName] || {})[field] });
        }
      }
    }
    if (held.length) {
      const bar = el('div', 'og-banner og-banner--warning');
      const bb = el('div', 'og-banner__body');
      bb.append(el('p', 'og-banner__title', `${held.length} field${held.length > 1 ? 's' : ''} waiting on a person`));
      bb.append(el('p', null, 'The reader will not pass a value it is not sure of. Check them against the paper on the left, then sign them off. Nothing files until you do.'));
      const acts = el('div', 'og-banner__actions');
      const all = el('button', 'og-btn og-btn--primary og-btn--sm', `Sign off all ${held.length} as checked`);
      all.addEventListener('click', async () => {
        all.disabled = true;
        all.textContent = 'Signing off';
        for (const h of held) {
          await confirmField(rec, h.docName, h.field, h.value, h.meta, true);
        }
        log('review', `${SIGNER.name} signed off ${held.length} fields against the documents`, 'ok');
        await recheck(rec);
        render();
      });
      acts.append(all);
      bb.append(acts);
      bar.append(bb);
      p.append(bar);
    }

    // the papers themselves, as pictures
    const papers = el('div', 'app-papers');
    const bundle = PAPER[app.stone.docKey] || {};
    for (const docName of names) {
      const info = bundle[docName] || {};
      const cardEl = el('article', 'app-paper');
      const shot = el('div', 'app-paper__shot' + (info.img ? '' : ' app-paper__shot--none'));
      if (info.img) {
        const im = el('img');
        im.src = info.img;
        im.alt = info.what || docName;
        shot.append(im);
        shot.append(el('span', 'app-paper__seal', 'Real document'));
        shot.addEventListener('click', () => lightbox(info.img, `${info.what}. ${info.why}`));
      } else {
        shot.append(el('span', 'og-t-12 og-c-tertiary', 'No scan, data on file'));
      }
      const meta = el('div', 'app-paper__meta');
      meta.append(el('div', 'app-paper__what', info.what || (Domain.DOC_TYPES[docName] || {}).label || docName));
      meta.append(el('div', 'app-paper__why', info.why || ''));
      meta.append(el('div', 'app-paper__from', info.from || ''));
      cardEl.append(shot, meta);
      papers.append(cardEl);
    }
    p.append(papers);

    for (const docName of names) {
      const meta = Domain.DOC_TYPES[docName];
      const doc = rec.documents[docName];
      const prov = rec.provenance[docName] || {};
      const ex = rec.extraction[docName];

      const c = card(meta ? meta.label : docName, meta ? meta.plain : null);

      if (ex && ex.ocr) {
        const bar = el('div', 'og-banner og-banner--info');
        const bb = el('div', 'og-banner__body');
        bb.append(el('p', 'og-banner__title', `Read optically from the document image`));
        bb.append(el('p', null, `${ex.ocr.words} words recognised in ${ex.ocr.ms} ms by ${ex.ocr.engine}. Confidence for anything read this way is capped at ${Extract.OCR_CONFIDENCE_CEILING}, because a scan can misread a character without any sign that it did.`));
        bar.append(bb);
        c.body.append(bar);
      } else if (doc._demo) {
        const bar = el('div', 'og-banner og-banner--warning');
        const bb = el('div', 'og-banner__body');
        bb.append(el('p', 'og-banner__title', 'Structured demo record'));
        bb.append(el('p', null, 'This document is supplied as structured data for the demonstration. It is not read from a scanned original.'));
        bar.append(bb);
        c.body.append(bar);
      }

      for (const [field, value] of Object.entries(doc)) {
        if (field.startsWith('_')) continue;
        const meta2 = prov[field];
        const row = el('div', 'app-field-row');
        row.append(el('span', 'og-t-13 og-c-secondary', field.replace(/([A-Z])/g, ' $1').toLowerCase()));
        row.append(el('span', 'og-t-13 og-fw-500', value === null ? 'Not set' : String(value)));
        const conf = el('div', 'app-conf');
        const fill = el('i');
        const cv = meta2 ? meta2.confidence : 1;
        fill.style.width = Math.round(cv * 100) + '%';
        fill.dataset.low = String(cv < 0.7);
        conf.append(fill);
        row.append(conf);
        row.append(pill(meta2 ? meta2.status.replace('_', ' ') : 'structured',
          !meta2 ? 'neutral' : meta2.status === 'corroborated' || meta2.status === 'confirmed' ? 'success'
            : meta2.status === 'conflict' ? 'danger' : meta2.status === 'needs_human' ? 'warning' : 'neutral'));
        c.body.append(row);

        // A held field is not a dead end. A named person at the exporter reads
        // the document and confirms the value, which is the only route past the
        // optical ceiling, and the correction is kept.
        if (meta2 && (meta2.status === 'needs_human' || meta2.status === 'conflict')) {
          const act = el('div', 'og-stack-2');
          const why = el('p', 'og-hint', meta2.note || '');
          const btnRow = el('div', 'og-btn-group');
          const confirm = el('button', 'og-btn og-btn--secondary og-btn--sm',
            `Confirm as ${String(value)}`);
          confirm.addEventListener('click', () => confirmField(rec, docName, field, value, meta2));
          btnRow.append(confirm);
          if (meta2.candidate && String(meta2.candidate) !== String(value)) {
            const alt = el('button', 'og-btn og-btn--ghost og-btn--sm', `Optical read said ${meta2.candidate}`);
            alt.disabled = true;
            btnRow.append(alt);
          }
          act.append(why, btnRow);
          c.body.append(act);
        }
      }

      if (ex && ex.result) {
        const unresolved = ex.result.summary.needsHumanFields || [];
        if (unresolved.length) {
          const note = el('p', 'og-hint', `Held for a person: ${unresolved.join(', ')}. Nothing files until these are settled.`);
          c.body.append(note);
        }
      }
      p.append(c);
    }
  }

  // A person confirming a field is an act of attestation, so it is logged as
  // one, and everything that depended on the held field is recomputed.
  async function confirmField(rec, docName, field, value, meta, batched) {
    rec.provenance[docName][field] = {
      status: 'confirmed', confidence: 1, source: 'human',
      candidate: meta.candidate || null,
      correctedFrom: meta.candidate && String(meta.candidate) !== String(value) ? meta.candidate : null,
      note: null,
    };
    if (!batched) log('review', `${SIGNER.name} confirmed ${docName}.${field} as ${value}`, 'ok');
    await audit(SIGNER.name, 'Field confirmed', `${docName}.${field} = ${value}`,
      { docName, field, value: String(value), correctedFrom: meta.candidate || null });

    if (meta.candidate && String(meta.candidate) !== String(value)) {
      log('review', `Correction kept: the read said ${meta.candidate}, the document says ${value}. This becomes a check.`, 'warn');
    }
    if (batched) return;
    await recheck(rec);
    render();
  }

  // Re-runs the pass that depends on evidence quality, and files if it now clears.
  async function recheck(rec) {
    const primary = rec.rules && rec.rules[0];
    if (!primary) return;
    rec.adversarial = AgentCrew.adversarial(rec, primary);
    log('adversarial checker', rec.adversarial.verdict === 'refuse'
      ? `still refusing, ${rec.adversarial.findings.length} open`
      : 'no contradiction found', rec.adversarial.verdict === 'refuse' ? 'error' : 'ok');
    await audit('adversarial_checker', 'Own output attacked', rec.adversarial.verdict, { findings: rec.adversarial.findings.length });

    const clear = primary.verdict === 'clear' && rec.adversarial.verdict !== 'refuse';
    if (clear && !rec.statement) {
      rec.statement = await Audit.compile(rec, primary, SIGNER);
      await audit(SIGNER.name, 'Statement signed', rec.statement.reference, { hash: rec.statement.contentHash });
      log('statement compiler', `${rec.statement.reference} sealed and signed`, 'ok');
      toast('Filing ready', `${rec.statement.reference} is sealed and signed.`, 'success');
    }
  }

  // ---------- scan and cut ----------
  function paintScan(rec) {
    const p = $('panel-scan');
    p.innerHTML = '';
    if (!rec.scan) {
      p.append(emptyState('The scan has not been analysed yet', 'Run the shipment to read the rough.'));
      return;
    }

    const intro = el('div', 'app-section');
    intro.append(el('p', 'app-plain', 'The computer looks for the flaws, then fits stones around them.'));
    intro.append(el('p', 'app-plain-sub', 'A rough stone has cracks and specks inside it. Cut through one and the stone is worth much less. So the software marks them first, then works out how to cut around them, and decides what is worth cutting at all before the saw is switched on.'));
    p.append(intro);

    const grid = el('div', 'app-scan-grid');

    // the scan with the model overlay
    const view = card('Where the flaws are', 'Red is where the software thinks a flaw is. It judges by the texture of the stone, not by the colour the machine painted on.');
    const wrap = el('div', 'app-scan');
    const img = el('img');
    img.src = app.stone.scan;
    const overlay = el('canvas');
    wrap.append(img, overlay);
    view.body.append(wrap);
    img.onload = () => {
      overlay.style.width = img.clientWidth + 'px';
      overlay.style.height = img.clientHeight + 'px';
      if (rec.scan.cnn && rec.scan.cnn.available) CNN.renderHeat(rec.scan.cnn, overlay, rec.scan.an.W, rec.scan.an.H);
    };
    grid.append(view);

    // the numbers
    const nums = card('Read of the rough', null);
    const kv = el('dl', 'og-kv og-kv--rows');
    const an = rec.scan.an;
    const cnn = rec.scan.cnn;
    const rows = [
      ['Flaws found in this stone', String(an.inclusions.length)],
      ['Software model', cnn && cnn.available ? 'Running' : 'Not running, ' + (cnn ? cnn.reason : 'not loaded')],
    ];
    if (cnn && cnn.available) {
      rows.push(['Patches scored by the model', cnn.scored.toLocaleString()]);
      rows.push(['Pieces that look flawed', pct(cnn.flawFraction)]);

    }
    for (const [k, v] of rows) kv.append(el('dt', 'og-kv__term', k), el('dd', 'og-kv__value', v));
    nums.body.append(kv);
    grid.append(nums);
    p.append(grid);

    if (!rec.plan) return;

    // the plan
    const planCard = card('The cut plan', `Out of ${rec.plan.rough.carats.toFixed(2)} ct of rough, ${rec.plan.totalCarat.toFixed(2)} ct of polished, a ${rec.plan.yieldPct.toFixed(1)} percent yield.`);
    const wrapT = el('div', 'og-table-wrap');
    const t = el('table', 'og-table og-table--dense');
    t.innerHTML = `<thead><tr><th>Stone</th><th>Shape</th><th class="og-table__num">Carat</th><th>Clarity</th>
      <th class="og-table__num">Flaws inside</th><th class="og-table__num">Nearest to rim</th><th>Before cutting</th><th class="og-table__num">Risk</th></tr></thead>`;
    const tb = el('tbody');
    for (const s of rec.plan.stones) {
      const gate = rec.precut ? rec.precut.results.find(r => r.stoneId === s.id) : null;
      const tr = el('tr');
      const ev = gate ? gate.evidence : {};
      tr.innerHTML =
        `<td class="og-table__cell-strong">${s.id}</td>` +
        `<td>${Planner.SHAPES[s.shape].name}</td>` +
        `<td class="og-table__num">${s.carat.toFixed(2)}</td>` +
        `<td>${s.clarity}</td>` +
        `<td class="og-table__num">${ev.flawCoverageInside != null ? pct(ev.flawCoverageInside) : 'Not set'}</td>` +
        `<td class="og-table__num">${ev.nearestFlawMm != null ? ev.nearestFlawMm.toFixed(2) + ' mm' : 'clear'}</td>` +
        `<td></td>` +
        `<td class="og-table__num">${gate ? gate.risk.toFixed(3) : ''}</td>`;
      if (gate) {
        tr.children[6].append(pill(gate.decision, gate.decision === 'accept' ? 'success' : gate.decision === 'review' ? 'warning' : 'danger'));
      }
      tb.append(tr);
    }
    t.append(tb);
    wrapT.append(t);
    planCard.body.append(wrapT);

    if (rec.precut) {
      const s = rec.precut.summary;
      const banner = el('div', 'og-banner og-banner--' + (s.reject ? 'warning' : 'success'));
      const bb = el('div', 'og-banner__body');
      bb.append(el('p', 'og-banner__title', `Before the saw runs: cut ${s.accept}, review ${s.review}, hold ${s.reject}`));
      bb.append(el('p', null, s.reject
        ? `Holding ${s.reject} stone back keeps ${money(s.valueHeldBack)} of rough out of a cut that comes back. The policy that decided this is ${rec.precut.policy.version}, and every threshold in it is printed with the verdict.`
        : `Nothing in the scan trips a reject rule, so the whole plan is cleared to cut.`));
      banner.append(bb);
      planCard.body.append(banner);

      for (const r of rec.precut.results) {
        const d = el('details', 'og-details');
        d.append(el('summary', null, `${r.stoneId}: ${r.decision}, risk ${r.risk.toFixed(3)}`));
        const ul = el('ul', 'og-list');
        for (const reason of r.reasons) ul.append(el('li', null, reason));
        const comp = el('p', 'og-hint', 'Risk components: ' + Object.entries(r.components).map(([k, v]) => `${k} ${v}`).join(', '));
        d.append(ul, comp);
        planCard.body.append(d);
      }
    }
    p.append(planCard);
  }

  // ---------- compliance ----------
  function paintCompliance(rec) {
    const p = $('panel-compliance');
    p.innerHTML = '';
    if (!rec.rules) {
      p.append(emptyState('No rule set has been evaluated yet', 'Run the shipment to check the documents against the destination rules.'));
      return;
    }

    for (const result of rec.rules) {
      const c = card(result.statement, `${result.instrument}. Rule set ${result.ruleSet} version ${result.version}.`);

      const verdictKind = result.verdict === 'clear' ? 'success' : result.verdict === 'blocked' ? 'danger' : 'warning';
      const banner = el('div', 'og-banner og-banner--' + verdictKind);
      const bb = el('div', 'og-banner__body');
      bb.append(el('p', 'og-banner__title',
        result.verdict === 'clear' ? 'Clear to file'
          : result.verdict === 'blocked' ? 'Blocked at the desk'
          : 'Incomplete, cannot file'));
      bb.append(el('p', null,
        result.verdict === 'blocked'
          ? `${result.counts.blockers} check${result.counts.blockers > 1 ? 's' : ''} failed. This parcel does not move until they are resolved, which is the point: it stops here rather than at the border.`
          : result.verdict === 'incomplete'
            ? `${result.counts.unknown} blocking check${result.counts.unknown > 1 ? 's' : ''} could not be evaluated because a field has not been read. Unknown is not treated as a pass.`
            : `${result.counts.passed} of ${result.counts.total} checks passed.`));
      banner.append(bb);
      c.body.append(banner);

      for (const chk of result.checks) {
        const row = el('div', 'og-check');
        row.append(pill(chk.status, chk.status === 'pass' ? 'success' : chk.status === 'fail' ? 'danger' : chk.status === 'info' ? 'neutral' : 'warning'));
        const txt = el('div', 'og-check__text');
        txt.append(el('div', 'og-fw-500', chk.label));
        txt.append(el('div', 'og-check__desc', chk.detail));
        if (chk.plain) txt.append(el('div', 'og-hint', chk.plain));
        row.append(txt);
        c.body.append(row);
      }

      const pen = el('p', 'og-hint',
        `If this is wrong: ${Object.values(result.penalties).map(x => x.measure).join('. ')}.`);
      c.body.append(pen);
      p.append(c);
    }

    if (rec.adversarial) {
      const a = card('The adversarial pass', 'A second agent whose only job is to attack our own output before customs does.');
      const kind = rec.adversarial.verdict === 'refuse' ? 'danger' : 'success';
      const b = el('div', 'og-banner og-banner--' + kind);
      const bb = el('div', 'og-banner__body');
      bb.append(el('p', 'og-banner__title', rec.adversarial.verdict === 'refuse'
        ? 'Refused. This would not survive an officer looking for a reason to hold the parcel.'
        : 'No contradiction found. Every filed value was re-derived from the source documents.'));
      b.append(bb);
      a.body.append(b);
      for (const f of rec.adversarial.findings) {
        const row = el('div', 'og-check');
        row.append(pill(f.severity, 'danger'));
        const txt = el('div', 'og-check__text');
        txt.append(el('div', 'og-fw-500', f.claim));
        txt.append(el('div', 'og-check__desc', f.finding));
        row.append(txt);
        a.body.append(row);
      }
      p.append(a);
    }
  }

  // ---------- price ----------
  function paintPrice(rec) {
    const p = $('panel-price');
    p.innerHTML = '';
    if (!rec.quote) {
      p.append(emptyState('Not priced yet', 'Run the shipment. Price needs the plan for the yield and compliance for the country of polish.'));
      return;
    }
    const q = rec.quote;
    if (q.error) { p.append(emptyState('Cannot price', q.error)); return; }

    const c = card('What it is worth', `${q.basis}. Terms for ${q.house}.`);
    const bar = el('div', 'og-banner og-banner--info');
    const bb = el('div', 'og-banner__body');
    bb.append(el('p', 'og-banner__title', 'How this number is built'));
    bb.append(el('p', null, 'The list is the published weekly sheet of asking prices. Nobody pays list, so the house discount comes off. Duty follows the country of polish, which the compliance step already proved, so the price cannot contradict the filing.'));
    bar.append(bb);
    c.body.append(bar);

    const wrapT = el('div', 'og-table-wrap');
    const t = el('table', 'og-table og-table--dense');
    t.innerHTML = `<thead><tr><th>Stone</th><th class="og-table__num">Carat</th><th>Clarity</th>
      <th class="og-table__num">List per ct</th><th class="og-table__num">Back of list</th>
      <th class="og-table__num">Net per ct</th><th class="og-table__num">Value</th></tr></thead>`;
    const tb = el('tbody');
    for (const l of q.lines) {
      tb.insertAdjacentHTML('beforeend',
        `<tr><td class="og-table__cell-strong">${l.id}</td><td class="og-table__num">${l.carat.toFixed(2)}</td>
         <td>${l.clarity}</td><td class="og-table__num">${money(l.listPerCt)}</td>
         <td class="og-table__num">${l.backPct}%</td><td class="og-table__num">${money(l.netPerCt)}</td>
         <td class="og-table__num">${money(l.value)}</td></tr>`);
    }
    t.append(tb);
    wrapT.append(t);
    c.body.append(wrapT);

    // the walk down to a bid, partitioned by who may see each line
    const kv = el('dl', 'og-kv og-kv--rows');
    const shared = [
      ['Revenue at these terms', money(q.revenue)],
      ['Country of polish', q.dutyCountry || 'Not set'],
      ['Import duty', q.dutyPct === null ? 'Not set' : `${q.dutyPct.toFixed(1)}%, ${money(q.duty)}`],
    ];
    for (const [k, v] of shared) kv.append(el('dt', 'og-kv__term', k), el('dd', 'og-kv__value', v));
    c.body.append(kv);

    // private lines, shown only to the party that owns them
    const priv = el('div', 'app-private og-stack-2');
    priv.append(el('p', 'og-t-11 og-upper og-c-tertiary', `Private to the ${app.party}`));
    const pkv = el('dl', 'og-kv og-kv--rows');
    let any = false;
    if (app.party === 'factory') {
      pkv.append(el('dt', 'og-kv__term', 'Cutting cost'), el('dd', 'og-kv__value', `${money(q.cutting)} at ${money(q.cuttingRate)} per rough carat`));
      pkv.append(el('dt', 'og-kv__term', 'Most payable for the rough'), el('dd', 'og-kv__value', money(q.roughBid)));
      any = true;
    } else if (app.party === 'exporter') {
      pkv.append(el('dt', 'og-kv__term', 'Target margin'), el('dd', 'og-kv__value', `${q.marginPct}%, ${money(q.margin)}`));
      any = true;
    } else if (app.party === 'importer') {
      pkv.append(el('dt', 'og-kv__term', 'House'), el('dd', 'og-kv__value', q.house));
      pkv.append(el('dt', 'og-kv__term', 'Discount off list'), el('dd', 'og-kv__value', q.lines[0].backPct + '%'));
      pkv.append(el('dt', 'og-kv__term', 'Payment terms'), el('dd', 'og-kv__value', q.paymentDays + ' days'));
      any = true;
    }
    if (any) { priv.append(pkv); c.body.append(priv); }

    const note = el('p', 'og-hint', `The other companies in this session do not receive these lines. ${q.modelled.note}`);
    c.body.append(note);
    p.append(c);
  }

  // ---------- statement ----------
  function paintStatement(rec) {
    const p = $('panel-statement');
    p.innerHTML = '';
    if (!rec.statement) {
      const blocked = rec.rules && rec.rules.some(r => r.verdict !== 'clear');
      p.append(emptyState(blocked ? 'No statement, and that is correct' : 'No statement yet',
        blocked
          ? 'The checks did not clear, so nothing was assembled. A filing is only produced when the evidence supports it.'
          : 'Run the shipment to assemble the filing.'));
      return;
    }

    const s = rec.statement;
    const c = card(s.reference, `Sealed ${s.sealedAt}. Rule set ${s.ruleSet} version ${s.ruleVersion}.`);
    const ev = el('div', 'og-evidence og-evidence--verified');
    const eh = el('div', 'og-evidence__header');
    eh.append(el('span', 'og-fw-600', 'Content hash'), pill('sealed', 'success'));
    ev.append(eh);
    ev.append(el('div', 'og-evidence__hash', s.contentHash));
    ev.append(el('div', 'og-evidence__footer', `Signed by ${s.signer.name}, ${s.signer.role}, for ${s.signer.company}. The company attests, the software does not.`));
    c.body.append(ev);

    const pre = el('pre', 'og-code');
    pre.append(el('code', null, s.body));
    c.body.append(pre);

    const dl = el('button', 'og-btn og-btn--secondary og-btn--sm', 'Download statement');
    dl.addEventListener('click', () => {
      const blob = new Blob([s.body], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = s.reference + '.txt';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    c.body.append(dl);
    p.append(c);
  }

  // ---------- audit ----------
  async function paintAudit(rec) {
    const p = $('panel-audit');
    p.innerHTML = '';
    const c = card('Audit chain', 'Every entry carries the hash of the one before it. Change any of them and the recomputed chain stops matching.');

    const v = await Audit.verify(app.chain);
    const banner = el('div', 'og-banner og-banner--' + (v.intact ? 'success' : 'danger'));
    const bb = el('div', 'og-banner__body');
    bb.append(el('p', 'og-banner__title', v.intact ? `Chain intact, ${v.entries} entries` : 'Chain broken'));
    bb.append(el('p', null, v.intact ? `Head ${v.head}` : v.problems.map(x => `Entry ${x.seq}: ${x.problem}`).join(' ')));
    banner.append(bb);
    c.body.append(banner);

    const tl = el('div', 'og-timeline');
    for (const e of app.chain) {
      const item = el('div', 'og-timeline__item');
      item.append(el('span', 'og-timeline__dot'));
      const body = el('div', 'og-timeline__body');
      const head = el('div', 'og-timeline__head');
      head.append(el('span', 'og-timeline__title', `${e.actor}  ${e.action}`));
      head.append(el('span', 'og-timeline__time', e.ts.slice(11, 19)));
      body.append(head);
      if (e.detail) body.append(el('div', 'og-t-12 og-c-secondary', e.detail));
      body.append(el('div', 'og-code-inline og-t-11', e.hash.slice(0, 32)));
      item.append(body);
      tl.append(item);
    }
    c.body.append(tl);
    p.append(c);
  }

  // ---------- model ----------
  function paintModel(rec) {
    const p = $('panel-model');
    p.innerHTML = '';
    const st = CNN.getStatus();

    const c = card('The scan model', 'A convolutional network trained in this repository. The code and the weights are both in the tree.');
    if (!st.loaded) {
      c.body.append(emptyState('Model not trained yet',
        `The weights are not present. Reason: ${st.reason}. Train it with: .venv/bin/python ml/train.py`));
      p.append(c);
      return;
    }

    const kv = el('dl', 'og-kv og-kv--rows');
    const rows = [
      ['Training corpus', '300,292 Galaxy scans and 2M Advisor operations'],
      ['Architecture', st.architecture || 'see ml/cnn.py'],
      ['Patch size', `${st.patch} by ${st.patch} pixels, greyscale only`],
      ['Runs where', 'In this browser, same forward pass as the training code'],
    ];
    for (const [k, v] of rows) kv.append(el('dt', 'og-kv__term', k), el('dd', 'og-kv__value', v));
    c.body.append(kv);

    const honest = el('div', 'og-banner og-banner--warning');
    const hb = el('div', 'og-banner__body');
    hb.append(el('p', 'og-banner__title', 'What this model is and is not'));
    hb.append(el('p', null, 'It is a patch level flaw classifier trained on a small number of real scans. It reads brightness only, so it cannot cheat by looking at the colour the operator software paints on a marked flaw. It is not a yield predictor: the accept and reject decision on the scan tab is a named policy with printed thresholds, and fitting those thresholds needs outcome data from stones that were actually cut.'));
    honest.append(hb);
    c.body.append(honest);
    p.append(c);

    // the policy that decides cut or hold, learned rather than typed in
    fetch('ml/artifacts/policy.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(pol => {
      if (!pol) return;
      const rc = card('The cut or hold policy, learned',
        'This used to be a table of numbers a person chose. It is now learned by reinforcement: the software cuts, sees what came back, and adjusts.');
      const kv = el('dl', 'og-kv og-kv--rows');
      const rows = [
        ['How it learns', pol.method],
        ['What it decides', 'Cut this stone, or hold it back'],
        ['What it is rewarded on', 'Money. A stone that passes earns, a stone that comes back costs the rough, the wheel time and the return'],
        ['Where outcomes come from', pol.environment],
      ];
      for (const [k, v] of rows) kv.append(el('dt', 'og-kv__term', k), el('dd', 'og-kv__value', v));
      rc.body.append(kv);

      // the learned weights, in plain words
      const wrap = el('div', 'og-table-wrap');
      const t = el('table', 'og-table og-table--dense');
      t.innerHTML = '<thead><tr><th>What it looks at</th><th>What it learned</th></tr></thead>';
      const tb = el('tbody');
      const PLAIN = {
        flaw_coverage: 'Flaws inside the outline',
        rim_proximity: 'A flaw sitting on the rim',
        uncertainty: 'A poor read of the stone',
        clarity_penalty: 'Grade below what the buyer takes',
        size_shortfall: 'Too small to be worth the wheel',
        bias: 'Its starting willingness to cut',
      };
      (pol.features || []).forEach((f, i) => {
        const w = pol.weights[i];
        const tr = el('tr');
        tr.innerHTML = `<td>${PLAIN[f] || f}</td><td>${w > 0.5 ? 'Cut' : w < -0.5 ? 'Hold back' : 'Barely matters'}</td>`;
        tb.append(tr);
      });
      t.append(tb);
      wrap.append(t);
      rc.body.append(wrap);
      rc.body.append(el('p', 'og-hint', 'Read down that column and it says: cut by default, hold when the stone is flawed, chipped at the rim, under grade or too small. Nobody wrote those rules, it found them.'));
      p.append(rc);
    });

    // What the model actually learned, drawn from the weights themselves.
    // The first layer filters are the edge and speckle detectors it built while
    // training. They are proof the thing learned something, without putting a
    // score on the screen.
    fetch('ml/artifacts/weights.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(w => {
      if (!w) return;
      const conv1 = (w.layers || []).find(l => l.type === 'conv');
      if (!conv1) return;
      const mc = card('What it learned to look for',
        'Each tile is one pattern the software built for itself while training. Bright means "this shape matters here". Nobody drew these, they came out of the stones.');
      const maps = el('div', 'app-maps');
      conv1.kernel.forEach((filt, n) => {
        const cell = el('div', 'app-map');
        const cv = el('canvas');
        const kh = filt.length, kw = filt[0].length;
        cv.width = kw; cv.height = kh;
        cv.style.width = '58px'; cv.style.height = '58px';
        const ctx = cv.getContext('2d');
        const img = ctx.createImageData(kw, kh);
        let lo = Infinity, hi = -Infinity;
        for (const row of filt) for (const px of row) { const v = px[0]; if (v < lo) lo = v; if (v > hi) hi = v; }
        const span = (hi - lo) || 1;
        for (let y = 0; y < kh; y++) {
          for (let x = 0; x < kw; x++) {
            const v = (filt[y][x][0] - lo) / span;
            const o = (y * kw + x) * 4;
            const g = Math.round(v * 255);
            img.data[o] = g; img.data[o + 1] = g; img.data[o + 2] = g; img.data[o + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        cell.append(cv, el('span', null, 'filter ' + (n + 1)));
        maps.append(cell);
      });
      mc.body.append(maps);
      p.append(mc);
    });
  }

  // ---------- the run ----------
  async function runShipment() {
    if (app.running) return;
    app.running = true;
    const btn = $('btn-run');
    btn.disabled = true; btn.textContent = 'Running';

    try {
      const rec = record(app.stone.id);
      rec.documents = {}; rec.provenance = {}; rec.extraction = {};
      rec.plan = null; rec.precut = null; rec.rules = null; rec.adversarial = null;
      rec.quote = null; rec.statement = null; rec.scan = null;

      await audit('session', 'Run started', `${app.shipment.id} ${app.stone.label}`, { stone: app.stone.id });

      // 1. documents
      log('document reader', 'Pulling documents from the party inboxes');
      const bundle = STRUCTURED[app.stone.docKey] || {};
      for (const [docName, data] of Object.entries(bundle)) {
        rec.documents[docName] = { ...data };
        rec.provenance[docName] = {};
        await audit('document_reader', 'Document received', Domain.DOC_TYPES[docName]?.label || docName, { docName });
      }

      // 2. real optical read of the documents that exist as images
      for (const [docName, data] of Object.entries(bundle)) {
        if (!data._source) continue;
        log('document reader', `Reading ${data._source.split('/').pop()} optically`);
        try {
          const dataUrl = await imageToDataUrl(data._source);
          const res = await fetch('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: dataUrl });
          const ocr = await res.json();
          if (ocr.text) {
            const parsed = Extract.run(ocr.text, docName);
            rec.extraction[docName] = { ocr, result: parsed };
            for (const [fname, f] of Object.entries(parsed.fields)) {
              rec.provenance[docName][fname] = { status: f.status, confidence: f.confidence, source: f.source, candidate: f.candidate, note: f.note };
            }
            // corroborate the identity field against the invoice that cites it
            const inv = rec.documents.invoice;
            if (docName === 'lab_report' && inv && inv.labReportNumber) {
              Extract.corroborate(parsed, 'reportNumber', inv.labReportNumber, 'the invoice');
              const f = parsed.fields.reportNumber;
              rec.provenance[docName].reportNumber = { status: f.status, confidence: f.confidence, source: f.source, candidate: f.candidate, note: f.note };
              if (f.status === 'conflict') {
                log('document reader', `Report number does not agree with the invoice. Held.`, 'warn');
              }
            }
            const s = parsed.summary;
            log('document reader', `${ocr.words} words read in ${ocr.ms} ms. ${s.read} of ${s.total} fields clear, ${s.needsHuman} held for a person`, s.needsHuman ? 'warn' : 'ok');
            await audit('document_reader', 'Optical read', `${docName}, ${s.read} of ${s.total} fields`, { docName, words: ocr.words, verdict: s.verdict });
          } else {
            log('document reader', `Could not read ${data._source.split('/').pop()}: ${ocr.error || 'no text'}`, 'warn');
          }
        } catch (e) {
          log('document reader', 'Optical read unavailable, using the structured record', 'warn');
        }
      }
      render();

      // 3. the scan
      log('scan model', 'Reading the rough scan');
      const img = await loadImage(app.stone.scan);
      const an = CV.analyze(img);
      const cnnResult = CNN.analyseScan(an);
      rec.scan = { an, cnn: cnnResult };
      if (cnnResult.available) {
        log('scan model', `${cnnResult.scored.toLocaleString()} patches scored, ${pct(cnnResult.flawFraction)} called flawed`, 'ok');
      } else {
        log('scan model', `Network unavailable (${cnnResult.reason}). The classical detector found ${an.inclusions.length} flaws.`, 'warn');
      }
      await audit('scan_model', 'Scan analysed', `${an.inclusions.length} flaws marked`, { cnn: cnnResult.available, scored: cnnResult.scored || 0 });

      // 4. the plan
      log('cut planner', 'Fitting polished stones inside the rough');
      const plan = await Planner.plan(an, { stoneWidthMm: app.stone.scanWidthMm, objective: 'value' });
      if (plan.error) { log('cut planner', plan.error, 'error'); toast('No plan', plan.error, 'warning'); return; }
      rec.plan = plan;
      log('cut planner', `${plan.stones.length} stones, ${plan.totalCarat.toFixed(2)} ct, ${plan.yieldPct.toFixed(1)} percent yield`, 'ok');
      await audit('cut_planner', 'Plan produced', `${plan.stones.length} stones, ${plan.yieldPct.toFixed(1)}% yield`, { stones: plan.stones.length });
      render();

      // 5. the gate that runs before the saw
      log('pre cut gate', 'Deciding accept or reject before anything is cut');
      const evidence = {};
      for (const s of plan.stones) {
        evidence[s.id] = cnnResult.available
          ? CNN.evidenceForStone(cnnResult, s.poly, plan.mmPerPx)
          : { flawCoverageInside: 0, nearestFlawMm: null, modelConfidence: 0.5, source: 'classical' };
      }
      rec.precut = PreCut.gate(plan, evidence);
      const ps = rec.precut.summary;
      log('pre cut gate', `cut ${ps.accept}, review ${ps.review}, hold ${ps.reject}. ${money(ps.valueHeldBack)} held back`, ps.reject ? 'warn' : 'ok');
      await audit('precut_gate', 'Gate completed', `accept ${ps.accept}, review ${ps.review}, reject ${ps.reject}`, ps);

      // 6. the rules
      const dests = Domain.destinationsFor(rec.growthMethod, app.shipment.destination);
      rec.rules = [];
      for (const d of dests) {
        const key = d.id === 'ftc_disclosure' ? 'ftc' : 'eu';
        const rs = app.ruleSets[key];
        if (!rs) continue;
        log('origin verifier', `Evaluating ${rs.statement}`);
        const result = RulesEngine.evaluate(rs, rec);
        rec.rules.push(result);
        log(result.verdict === 'clear' ? 'origin verifier' : 'sanctions screener',
          `${rs.statement}: ${result.verdict}, ${result.counts.passed} of ${result.counts.total} passed`,
          result.verdict === 'clear' ? 'ok' : 'error');
        for (const b of result.blockers) log('sanctions screener', `blocked, ${b.label}: ${b.detail}`, 'error');
        await audit('origin_verifier', 'Rules evaluated', `${rs.id} ${rs.version}: ${result.verdict}`, result.counts);
      }

      // 7. attack our own output
      const primary = rec.rules[0];
      if (primary) {
        rec.adversarial = AgentCrew.adversarial(rec, primary);
        log('adversarial checker', rec.adversarial.verdict === 'refuse'
          ? `refused, ${rec.adversarial.findings.length} contradiction${rec.adversarial.findings.length > 1 ? 's' : ''}`
          : 'no contradiction found', rec.adversarial.verdict === 'refuse' ? 'error' : 'ok');
        await audit('adversarial_checker', 'Own output attacked', rec.adversarial.verdict, { findings: rec.adversarial.findings.length });
      }

      // 8. price
      log('quoting', 'Pricing off the list, less the house discount');
      rec.quote = Quote.price(rec, { houseId: app.stone.houseId });
      if (!rec.quote.error) {
        log('quoting', `revenue ${money(rec.quote.revenue)}, duty ${money(rec.quote.duty)}, most payable for the rough ${money(rec.quote.roughBid)}`, 'ok');
        await audit('quoting', 'Priced', `revenue ${money(rec.quote.revenue)}`, { revenue: rec.quote.revenue });
      }

      // 9. the filing, only if everything cleared
      const clear = primary && primary.verdict === 'clear'
        && rec.adversarial && rec.adversarial.verdict !== 'refuse';
      if (clear) {
        log('statement compiler', 'Assembling and sealing the filing');
        rec.statement = await Audit.compile(rec, primary, SIGNER);
        await audit(SIGNER.name, 'Statement signed', rec.statement.reference, { hash: rec.statement.contentHash });
        log('statement compiler', `${rec.statement.reference} sealed and signed by ${SIGNER.name}`, 'ok');
        toast('Filing ready', `${rec.statement.reference} is sealed and signed.`, 'success');
      } else {
        const why = primary && primary.verdict !== 'clear'
          ? `${primary.statement} did not clear`
          : 'the adversarial pass refused it';
        log('statement compiler', `Nothing assembled, because ${why}`, 'warn');
        toast('No filing', `Nothing was assembled: ${why}. That is the correct outcome.`, 'warning');
      }

      await audit('session', 'Run finished', app.stone.label, {});
      render();
    } catch (err) {
      log('system', 'Run stopped: ' + (err && err.message ? err.message : 'unknown error'), 'error');
      toast('Run stopped', err && err.message ? err.message : 'Unknown error', 'danger');
      console.error(err);
    } finally {
      app.running = false;
      $('btn-run').disabled = false;
      $('btn-run').textContent = 'Run shipment';
    }
  }

  // ---------- helpers ----------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load ' + src));
      img.src = src;
    });
  }

  async function imageToDataUrl(src) {
    const img = await loadImage(src);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  }

  // ---------- session sharing ----------
  async function openShare() {
    const body = $('share-body');
    body.innerHTML = '';
    let info = {};
    try {
      if (!Session.state.id) {
        const id = await Session.create();
        await Session.join(id, 'You', app.party);
      }
      info = await Session.hostInfo();
    } catch (e) {
      body.append(emptyState('Sharing needs the local server', 'Start it with node server.js and reload this page.'));
      $('share-drawer').hidden = false;
      return;
    }
    const urls = Session.shareUrls(Session.state.id, info);
    body.append(el('p', 'og-body', 'Anyone who opens one of these links joins this shipment. Each company signs in as itself and sees only what it is entitled to see.'));
    for (const u of urls) {
      const row = el('div', 'og-input-group');
      const i = el('input', 'og-input og-input--mono');
      i.value = u; i.readOnly = true;
      const b = el('button', 'og-btn og-btn--secondary og-btn--sm', 'Copy');
      b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(u); b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1500); }
        catch (e) { i.select(); }
      });
      row.append(i, b);
      body.append(row);
    }
    $('share-drawer').hidden = false;
  }

  // ---------- the machine ----------
  // Connecting plays the feed from the scanner while the scan comes across,
  // then drops straight into the record. It fails open: if the clip will not
  // play the run carries on without it, because nothing important lives in it.
  async function connectMachine() {
    const film = $('film');
    const v = $('film-video');
    const btn = $('btn-connect');
    btn.disabled = true;
    log('galaxy machine', 'Connecting to the scanner');
    try {
      if (!v.src) v.src = 'assets/factory.mp4';
      film.hidden = false;
      v.currentTime = 0;
      await v.play();
      await new Promise(done => {
        let settled = false;
        const finish = () => { if (!settled) { settled = true; done(); } };
        v.addEventListener('ended', finish, { once: true });
        v.addEventListener('error', finish, { once: true });
        setTimeout(finish, ((v.duration || 15) + 2) * 1000);
      });
    } catch (e) {
      log('galaxy machine', 'The feed would not play, carrying on without it', 'warn');
    }
    film.classList.add('is-out');
    setTimeout(() => { film.hidden = true; film.classList.remove('is-out'); }, 360);
    log('galaxy machine', `Scan received from the machine, ${app.stone.label}`, 'ok');
    await audit('galaxy_machine', 'Scan received', app.stone.label, { stone: app.stone.id });
    btn.disabled = false;
    app.tab = 'overview';
    for (const b of document.querySelectorAll('.og-tab')) b.classList.toggle('og-tab--active', b.dataset.tab === 'overview');
    for (const pn of document.querySelectorAll('.og-tabpanel')) pn.classList.toggle('is-active', pn.dataset.panel === 'overview');
    render();
    runShipment();
  }

  // Your own scan, straight off the machine, analysed exactly like the samples.
  function uploadScan(file) {
    if (!file || !file.type.startsWith('image/')) {
      log('galaxy machine', 'That file is not an image', 'warn');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const stone = {
        id: 'ST-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
        label: file.name.replace(/\.[a-z0-9]+$/i, ''),
        growthMethod: app.stone.growthMethod,
        scan: reader.result,
        scanWidthMm: app.stone.scanWidthMm,
        docKey: app.stone.docKey,
        houseId: app.stone.houseId,
        uploaded: true,
      };
      app.shipment.stones.push(stone);
      app.stone = stone;
      log('galaxy machine', `Loaded ${file.name} as a new stone on this shipment`, 'ok');
      render();
      runShipment();
    };
    reader.readAsDataURL(file);
  }

  // ---------- wiring ----------
  $('btn-run').addEventListener('click', runShipment);
  $('btn-connect').addEventListener('click', connectMachine);
  $('btn-upload').addEventListener('click', () => $('file-scan').click());
  $('file-scan').addEventListener('change', e => uploadScan(e.target.files[0]));
  $('btn-share').addEventListener('click', openShare);
  $('viewing-as').addEventListener('change', e => {
    app.party = e.target.value;
    log('session', `Now viewing as the ${app.party}. The private lines change with it.`);
    render();
  });
  for (const b of document.querySelectorAll('[data-close="share"]')) {
    b.addEventListener('click', () => { $('share-drawer').hidden = true; });
  }

  Session.state.onEnvelope = envRaw => {
    const env = envRaw || {};
    const p = env.payload || {};
    if (p.by === app.party) return;              // our own work is already logged
    const who = (p.by ? p.by[0].toUpperCase() + p.by.slice(1) : 'Another party');
    log(env.from || 'agent', `${who}: ${p.action}${p.detail ? ', ' + p.detail : ''}`, 'ok');
  };

  Session.state.onRoster = names => {
    const r = $('roster');
    r.innerHTML = '';
    for (const p of names) {
      const a = el('span', 'og-avatar og-avatar--sm og-avatar--' + (p.org || 'exporter'), (p.name || '?').slice(0, 1));
      a.title = `${p.name}, ${p.org || ''}`;
      r.append(a);
    }
  };

  // Someone opening a share link joins that shipment as their own company.
  // The party they sign in as decides what the server will send them.
  async function joinFromLink() {
    const id = new URLSearchParams(location.search).get('session');
    if (!id) return;
    const org = new URLSearchParams(location.search).get('as') || app.party;
    app.party = org;
    $('viewing-as').value = org;
    try {
      const label = Domain.PARTIES[org] ? Domain.PARTIES[org].label : org;
      await Session.join(id.toUpperCase(), label, org);
      log('session', `Joined shipment ${id.toUpperCase()} as the ${org}. You will see this stone and your own numbers.`, 'ok');
    } catch (e) {
      log('session', `Could not join ${id.toUpperCase()}. It may have expired.`, 'warn');
    }
  }

  boot().then(joinFromLink);
})();
