// demo.js: the model run. Eight beats, each held for about half a minute so
// there is room to talk over it. Pause and Next are always available, so the
// pacing never traps the presenter.

const Demo = (() => {

  const DWELL_MS = 30000;      // time on each beat, including the work itself
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const state = { running: false, paused: false, skip: false, beat: 0 };

  // the three people on the desk, in join order
  const DESK = [
    { name: 'Wasi', role: 'Manufacturer', line: 'Runs the factory floor and the cutting' },
    { name: 'Anik', role: 'Creator', line: 'Takes the polished stones into product' },
    { name: 'Soham', role: 'Source', line: 'Buys the rough and owns the record' },
  ];

  const BEATS = [
    {
      key: 'desk',
      title: 'Three people, one record',
      line: 'The desk opens as a shared session. Wasi on manufacturing, Anik on creation, Soham on sourcing, all inside the same stone record.',
    },
    {
      key: 'inbox',
      title: 'Documents in, fields out',
      line: 'Nobody types a filing. The mining certificate, the lab report and the invoice come in by mail, and the agent reads the fields straight out of them.',
    },
    {
      key: 'plan',
      title: 'Cut planning on the rough',
      line: 'A real Galaxy scan of the rough. The model maps the inclusions and searches the placement space for the plan that yields the most.',
    },
    {
      key: 'cut',
      title: 'The floor cuts it',
      line: 'The plan goes to the factory. The cutting agent sends back what actually came off the wheel, into the same record.',
    },
    {
      key: 'compliance',
      title: 'Compliance files the statement',
      line: 'Every field checked against the other two documents. Then the G7 Due Diligence Statement, generated, not typed.',
    },
    {
      key: 'quote',
      title: 'Duty, then the bid',
      line: 'Yield from the plan, duty from the country of polish. Compliance already proved that field, so the price cannot contradict the filing.',
    },
    {
      key: 'blocked',
      title: 'Blocked on our side',
      line: 'Second stone. The invoice says Botswana. The mining certificate says Russian Federation. It stops here, on our side.',
    },
    {
      key: 'passport',
      title: 'The stone passport',
      line: 'One record. Every field carrying the document it came from, and the audit trail behind it.',
    },
  ];

  // ---------- chrome ----------

  function setStep(key, s) {
    const el = document.querySelector(`.demo-step[data-step="${key}"]`);
    if (el) el.dataset.state = s;
  }

  function showBeat(i) {
    const b = BEATS[i];
    const n = document.getElementById('beat-index');
    const t = document.getElementById('beat-title');
    const l = document.getElementById('beat-line');
    if (n) n.textContent = `${String(i + 1).padStart(2, '0')} of ${String(BEATS.length).padStart(2, '0')}`;
    if (t) t.textContent = b.title;
    if (l) l.textContent = b.line;
  }

  function setHold(frac) {
    const bar = document.getElementById('beat-hold');
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, frac * 100))}%`;
  }

  function focus(sel, block) {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: block || 'center' });
  }

  // hold on the current beat until its half minute is up, unless skipped.
  // paused time does not count, so the presenter can stop and explain.
  async function hold(startedAt) {
    const target = startedAt + DWELL_MS;
    while (!state.skip) {
      const now = performance.now();
      if (state.paused) { await wait(120); continue; }
      const left = target - now;
      if (left <= 0) break;
      setHold(1 - left / DWELL_MS);
      await wait(120);
    }
    state.skip = false;
    setHold(1);
  }

  async function runBeat(i, work) {
    state.beat = i;
    const b = BEATS[i];
    setStep(b.key, 'active');
    showBeat(i);
    setHold(0);
    const t0 = performance.now();
    await work();
    await hold(t0);
    setStep(b.key, 'done');
  }

  // ---------- session ----------

  async function joinDeskMember(person) {
    const id = Session.state.id;
    if (!id) return;
    const clientId = 'desk-' + person.name.toLowerCase();
    await fetch(`/api/session/${id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, name: `${person.name} (${person.role})` }),
    });
  }

  function deskCard(person, ui) {
    const wrap = document.getElementById('desk-list');
    if (!wrap) return;
    const c = document.createElement('article');
    c.className = 'desk-person';
    c.innerHTML =
      `<span class="dp-role">${person.role}</span>` +
      `<strong class="dp-name">${person.name}</strong>` +
      `<span class="dp-line">${person.line}</span>` +
      `<span class="dp-state">In session</span>`;
    wrap.appendChild(c);
  }

  // ---------- the run ----------

  async function run(app, ui) {
    if (state.running) return;
    state.running = true;
    state.paused = false;
    state.skip = false;

    const btn = document.getElementById('demo-btn');
    btn.disabled = true;
    btn.textContent = 'Model running';
    document.getElementById('demo-panel').hidden = false;
    document.getElementById('demo-controls').hidden = false;
    document.getElementById('desk-list').innerHTML = '';
    document.getElementById('inbox-list').innerHTML = '';
    document.getElementById('inbox-panel').hidden = true;
    document.getElementById('blocked-card').hidden = true;
    document.getElementById('passport').hidden = true;
    for (const b of BEATS) setStep(b.key, 'pending');

    try {
      // 1. the desk
      await runBeat(0, async () => {
        focus('#desk-panel', 'center');
        ui.log('SESSION', 'Opening a shared session on this stone');
        if (!Session.state.id) {
          const id = await Session.create();
          await Session.join(id, 'Soham (Source)');
        }
        const info = await Session.hostInfo();
        const urls = Session.shareUrls(Session.state.id, info);
        const link = document.getElementById('demo-link');
        link.textContent = urls[0];
        link.parentElement.hidden = false;
        for (const p of DESK) {
          if (p.name !== 'Soham') await joinDeskMember(p);
          deskCard(p, ui);
          ui.log('SESSION', `${p.name} joined as <span class="num">${p.role}</span>`);
          await wait(1400);
        }
        ui.log('SESSION', `Anyone on <span class="num">${urls[0]}</span> is inside the same record`);
      });

      // 2. the inbox
      await runBeat(1, async () => {
        document.getElementById('inbox-panel').hidden = false;
        focus('#inbox-panel', 'start');
        const docKey = app.imageDocKey || 'IGI-7996745173';
        await ingest(docKey, ui);
      });

      // 3. cut planning
      await runBeat(2, async () => {
        const roughBtn = document.querySelector('#samples button[data-src*="rough-327"]');
        if (roughBtn) { roughBtn.click(); await wait(700); }
        focus('.console-grid', 'start');
        await wait(600);
        await app.run(false, { noScroll: true });
        if (!app.record || !app.record.plan) {
          ui.log('MODEL', 'No usable plan for this scan. Pick another scan and run the model again');
          throw new Error('no plan');
        }
        await wait(500);
        focus('.ba-grid', 'center');
      });
      const record = app.record;

      // 4. cutting
      await runBeat(3, async () => {
        focus('#agent-cards', 'start');
        await wait(500);
        await Agents.cutting(record, ui);
        ui.renderCutting(record);
      });

      // 5. compliance
      await runBeat(4, async () => {
        focus('#agent-cards', 'start');
        await Agents.compliance(record, ui);
        ui.renderCompliance(record);
      });

      // 6. quoting
      await runBeat(5, async () => {
        await Agents.quoting(record, ui);
        ui.renderQuote(record);
      });

      // 7. the blocked stone
      await runBeat(6, async () => {
        ui.log('SESSION', 'Second stone on the same order, a 1.00 ct');
        document.getElementById('inbox-panel').hidden = false;
        await ingest('GIA-7373304073', ui, true);
        const bad = Records.create({
          scanName: 'GIA 7373304073',
          scanSource: 'lab report',
          docs: Records.SOURCES['GIA-7373304073'],
        });
        app.badRecord = bad;
        document.getElementById('blocked-card').hidden = false;
        focus('#blocked-card', 'center');
        await Agents.compliance(bad, ui);
        ui.renderCompliance(bad, true);
        await Agents.quoting(bad, ui);
      });

      // 8. the passport
      await runBeat(7, async () => {
        ui.renderPassport(record);
        await wait(400);
        focus('#passport', 'center');
        ui.log('RECORD', `Passport <span class="num">${record.id}</span> complete. ${record.audit.length} audited actions, one record`);
      });

      showBeat(BEATS.length - 1);
      document.getElementById('beat-title').textContent = 'Done';
      document.getElementById('beat-line').textContent =
        'Three jobs, one record per stone. Minutes, against seven to nine days by hand.';
    } catch (err) {
      const t = document.getElementById('beat-title');
      const l = document.getElementById('beat-line');
      if (t) t.textContent = 'Stopped';
      if (l) l.textContent = 'The run stopped early. Reload the page and start the model again.';
      ui.log('MODEL', `Stopped: ${err && err.message ? err.message : 'unknown error'}`);
      console.error('Model run failed', err);
    } finally {
      state.running = false;
      btn.disabled = false;
      btn.textContent = 'Start model';
      document.getElementById('demo-controls').hidden = true;
    }
  }

  // reads the mail and pulls the fields out, one at a time
  async function ingest(docKey, ui, secondary) {
    const list = document.getElementById('inbox-list');
    const counter = document.getElementById('inbox-count');
    if (secondary) list.innerHTML = '';
    const mails = Inbox.mailFor(docKey);
    const total = Inbox.totalFields(docKey);
    let pulled = 0;
    counter.textContent = `0 of ${total} fields`;

    for (const m of mails) {
      const node = Inbox.card(m);
      list.appendChild(node);
      ui.log('INBOX', `${Inbox.LABEL[m.type]} received from ${m.from}, ${m.file}`);
      await wait(900);
      node.dataset.open = 'true';
      for (const [name, value] of m.fields) {
        node._fields.appendChild(Inbox.fieldRow(name, value));
        pulled += 1;
        counter.textContent = `${pulled} of ${total} fields`;
        await wait(260);
      }
      ui.log('INBOX', `Pulled <span class="num">${m.fields.length}</span> fields from ${m.file}, nothing typed by hand`);
      await wait(500);
    }
    counter.textContent = `${total} of ${total} fields`;
  }

  // ---------- controls ----------

  function pause() {
    state.paused = !state.paused;
    const b = document.getElementById('pause-btn');
    if (b) b.textContent = state.paused ? 'Resume' : 'Pause';
    return state.paused;
  }

  function next() { state.skip = true; }

  // ---------- the spoken script ----------

  function scriptText(app) {
    const r = app.record;
    const rule = '-'.repeat(72);
    const L = [];
    L.push('OPTIMIZATION GALAXY, SPOKEN SCRIPT');
    L.push('Eight beats. Each one holds for about thirty seconds while you talk.');
    L.push('Pause stops the clock. Next moves on early. Nothing runs away from you.');
    L.push(rule);
    L.push('');
    L.push('BEFORE YOU RECORD');
    L.push('  node server.js, then open http://localhost:4610 full screen.');
    L.push('  Press Start model, then read beat 1. When the bar fills, it moves itself.');
    L.push('');
    L.push(rule);

    const spoken = [
      "I press start once, and the software walks the file from here. One stone record, three people on it. Wasi runs the factory floor. Anik takes the polished goods into product. I buy the rough. Everyone is on the same record at the same time, not three spreadsheets and a mail thread. Nothing here is a copy. When a field changes, it changes for all of us. That matters, because the next twenty minutes decide whether this parcel can legally move.",

      "Nobody types a filing. The mining certificate comes in from Botswana. The lab report comes in from IGI Antwerp. The invoice comes off our own export desk. The agent opens each mail, reads the document, pulls the fields, and writes them into the record. Fifteen fields, none of them typed by a person. Every number on the statement later traces back to one of these three documents. Typed fields are where the mistakes come from.",

      "This is a real Galaxy scan of one of my roughs. The model maps the inclusions, runs the placement options, and returns the plan that yields the most. Seventeen point six nine carats of rough. Three polished stones. Four point seven three carats recovered, twenty six point seven percent. Across the trade only forty to forty two carats in every hundred survive as polished. The plan decides where you land in that band. The scan analysis runs live in the browser.",

      "The plan goes to the floor and Wasi cuts it. The cutting agent sends back what actually came off the wheel, stone by stone, and writes it into the same record. Planned against actual, on this stone, forever. Next month I can ask whether my planner is honest, and the record answers. Most houses lose this the moment the parcel leaves the office. Here the report lands back where the plan started. No one re-keys a thing.",

      "Now compliance. It takes every field and checks it against the other two documents. Carat against the invoice. Origin against the mining certificate. Then the sanctioned source screen. Seven checks, seven passed, and the European Due Diligence Statement is generated, not typed. Since the first of January twenty twenty six, no natural polished stone at half a carat or above moves into those markets without one. That statement is the gate. Without it the parcel does not enter Europe.",

      "Then the price. Yield comes off the cut plan. Duty comes off the country of polish, and compliance already proved that field, so the quote cannot contradict the filing. Take out duty, manufacturing and margin, and the most I can pay for that rough is forty three thousand, three hundred and twenty one dollars. Figures here are indicative. That is my ceiling. Above it I am buying a loss, and I know that before I bid, not after.",

      "Here is the one that matters. Second stone, same order. The invoice declares Botswana and reads completely clean. The mining certificate says Russian Federation. The two documents disagree, so the filing stops here, on our side, not at the border. Get that field wrong and it costs up to forty percent of the shipment value plus seizure. On a sanctioned stone it is three hundred seventy seven thousand, seven hundred dollars per violation, or twice the transaction value.",

      "That is the passport. One record, every field carrying the document it came from, and the audit trail underneath it. Origin, weight, colour, clarity, cut plan, actual yield, duty, price, statement. Today about ten people build this by hand over seven to nine days. This ran in one pass, and the compliance, the price and the cut plan all came off the same record, so they cannot disagree. Hand it to the buyer, the bank or the auditor and it holds. Closing line Three jobs, one record per stone. Compliant, priced right, cut for the yield.",
    ];

    BEATS.forEach((b, i) => {
      L.push('');
      L.push(`BEAT ${i + 1}, ${b.title.toUpperCase()}   (about 30 seconds)`);
      L.push('  On screen: ' + b.line);
      L.push('  Say:');
      for (const line of wrapText(spoken[i], 76)) L.push('    ' + line);
    });

    L.push('');
    L.push(rule);
    L.push('CLOSING LINE');
    L.push('  Three jobs, one record per stone. Compliant, priced right, cut for the yield.');
    L.push('');
    L.push('IF THEY ASK');
    L.push('  Why is the yield under forty percent: this is one view of the rough, so depth is');
    L.push('  estimated. On the machine you plan against the full three dimensional model.');
    L.push('  What is real here: the two lab reports and the rough scan are genuine, and the');
    L.push('  scan analysis runs live in the browser. Mining certificates, invoices, prices and');
    L.push('  duty rates are staged for the demo.');

    if (r && r.plan) {
      L.push('');
      L.push('NUMBERS FROM THIS RUN');
      L.push(`  Rough ${r.plan.rough.carats.toFixed(2)} ct, ${r.plan.stones.length} stones, ${r.plan.totalCarat.toFixed(2)} ct recovered, ${r.plan.yieldPct.toFixed(1)}% yield`);
      if (r.cutting) L.push(`  Cut ${r.cutting.actualTotal.toFixed(2)} ct actual, ${r.cutting.variancePct.toFixed(1)}% against plan`);
      if (r.compliance && r.compliance.ddsRef) L.push(`  Statement ${r.compliance.ddsRef}, origin ${r.compliance.origin}`);
      if (r.quote) L.push(`  Rough bid ceiling $${Math.round(r.quote.roughBid).toLocaleString()}`);
    }
    return L.join('\n');
  }

  function wrapText(s, width) {
    const words = s.split(' ');
    const out = [];
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > width) { out.push(line.trim()); line = w; }
      else line += ' ' + w;
    }
    if (line.trim()) out.push(line.trim());
    return out;
  }

  return { run, scriptText, pause, next, BEATS, DESK };
})();
