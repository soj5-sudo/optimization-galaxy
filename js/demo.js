// demo.js: the model run. Eight beats, each held for about half a minute so
// there is room to talk over it. Pause and Next are always available, so the
// pacing never traps the presenter.

const Demo = (() => {

  const DWELL_MS = 10000;      // the film runs its own length, the rest hold ten seconds
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
      key: 'film',
      title: 'The X-ray comes off the machine',
      caption: 'This is how the scan is taken. The Galaxy machine X-rays the rough and maps what is inside it.',
      point: null,
    },
    {
      key: 'desk',
      title: 'Four companies, one record',
      caption: 'That parcel touches four companies in three countries. Today that runs on twenty WhatsApp threads. Here it is one record.',
      point: { sel: '#desk-list', label: 'One record, not twenty threads' },
    },
    {
      key: 'inbox',
      title: 'Documents in, fields out',
      caption: 'Nobody types a filing. Mining certificate, lab report, invoice. The agent reads each mail and pulls the fields out.',
      point: { sel: '#inbox-count', label: 'Pulled from the documents' },
    },
    {
      key: 'compliance',
      title: 'Origin first',
      caption: 'Origin is checked before anything else. Every field against the other two documents, then the statement customs demands.',
      point: { sel: '#body-compliance .verdict', label: 'Statement filed' },
    },
    {
      key: 'plan',
      title: 'The model runs on the rough',
      caption: 'Now the same X-ray you just watched. The model maps the inclusions and returns the plan that yields the most.',
      point: { sel: '#stat-row .stat:nth-child(4)', label: 'Yield off this rough' },
    },
    {
      key: 'cut',
      title: 'The floor cuts it',
      caption: 'The floor cuts it. What came off the wheel lands back in the same record, beside what was planned.',
      point: { sel: '#body-planning .plan-table', label: 'Planned against actual' },
    },
    {
      key: 'quote',
      title: 'Duty, then the bid',
      caption: 'Where it was polished sets the import duty. Compliance proved that field, so the price cannot contradict the filing.',
      point: { sel: '#body-quoting .kv div:last-child', label: 'The most I can pay' },
    },
    {
      key: 'blocked',
      title: 'Blocked at the desk',
      caption: 'Second stone. The invoice says Botswana. The certificate says Russian Federation. It stops at the desk, not the border.',
      point: { sel: '#body-blocked .verdict', label: 'Stopped before it ships' },
    },
    {
      key: 'passport',
      title: 'One record per stone',
      caption: 'Three jobs, one record per stone. Every field carrying the document it came from.',
      point: { sel: '#passport-table', label: 'Every field, its source' },
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
    if (n) n.textContent = `${String(i + 1).padStart(2, '0')} of ${String(BEATS.length).padStart(2, '0')}`;
    if (t) t.textContent = b.title;
    const l = document.getElementById('beat-line');
    if (l) l.textContent = b.caption;
    caption(b.caption);
  }

  // ---------- subtitles ----------

  function caption(text) {
    const bar = document.getElementById('caption-bar');
    const line = document.getElementById('caption-line');
    if (!bar || !line) return;
    bar.hidden = false;
    line.textContent = text || '';
  }

  function clearCaption() {
    const bar = document.getElementById('caption-bar');
    if (bar) bar.hidden = true;
  }

  // ---------- pointer ----------
  // parks a marker on the exact value being talked about

  function point(target) {
    const marker = document.getElementById('pointer');
    const label = document.getElementById('pointer-label');
    if (!marker || !target) return;
    const el = document.querySelector(target.sel);
    if (!el) { hidePoint(); return; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { hidePoint(); return; }
    const pad = 8;
    marker.hidden = false;
    marker.style.top = `${r.top + window.scrollY - pad}px`;
    marker.style.left = `${r.left + window.scrollX - pad}px`;
    marker.style.width = `${r.width + pad * 2}px`;
    marker.style.height = `${r.height + pad * 2}px`;
    label.textContent = target.label || '';
    label.hidden = !target.label;
  }

  function hidePoint() {
    const marker = document.getElementById('pointer');
    if (marker) marker.hidden = true;
  }

  function repoint() {
    const b = BEATS[state.beat];
    if (state.running && b && b.point) point(b.point);
  }
  window.addEventListener('scroll', () => { if (state.running) repoint(); }, { passive: true });
  window.addEventListener('resize', () => { if (state.running) repoint(); });

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
    hidePoint();
    showBeat(i);
    setHold(0);
    const t0 = performance.now();
    await work();
    if (b.point) { await wait(120); point(b.point); }
    await hold(t0);
    setStep(b.key, 'done');
  }

  // ---------- the film ----------
  // fails open: if the file will not play, the run carries on without it

  async function playFilm(ui) {
    const film = document.getElementById('film');
    const v = document.getElementById('film-video');
    if (!film || !v) return;
    film.hidden = false;
    ui.log('FACTORY', 'Galaxy machine scanning the rough, X-ray captured');

    const bail = msg => {
      film.hidden = true;
      ui.log('FACTORY', msg);
    };

    try {
      v.currentTime = 0;
      await v.play();
    } catch (e) {
      bail('Film skipped, the browser blocked playback');
      return;
    }

    // confirm it is actually advancing. A suspended or blocked video must not
    // hold the run behind a black screen.
    await wait(1200);
    if (v.paused || v.currentTime < 0.2) {
      bail('Film skipped, playback did not start');
      return;
    }

    await new Promise(done => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; done(); } };
      v.addEventListener('ended', finish, { once: true });
      v.addEventListener('error', finish, { once: true });
      const left = Math.max(1000, ((v.duration || 17) - v.currentTime) * 1000 + 1500);
      setTimeout(finish, left);
    });

    film.classList.add('out');
    await wait(420);
    film.hidden = true;
    film.classList.remove('out');
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
    document.body.classList.add('presenting');   // marketing chrome out, product surface only
    document.getElementById('demo-panel').hidden = false;
    document.getElementById('demo-controls').hidden = false;
    document.getElementById('desk-list').innerHTML = '';
    document.getElementById('inbox-list').innerHTML = '';
    document.getElementById('inbox-panel').hidden = true;
    document.getElementById('blocked-card').hidden = true;
    document.getElementById('passport').hidden = true;
    for (const b of BEATS) setStep(b.key, 'pending');

    try {
      // 0. the film: how the X-ray is taken
      await runBeat(0, async () => {
        await playFilm(ui);
        // the same scan the film ends on now lands on the record
        const roughBtn = document.querySelector('#samples button[data-src*="rough-327"]');
        if (roughBtn) { roughBtn.click(); await wait(500); }
        ui.log('RECORD', 'Scan 327.8 received from the factory, record opened');
      });

      // the record exists from here, so compliance can run before the plan
      const record = Records.create({
        scanName: app.imageName || 'Galaxy rough scan 327.8',
        scanSource: 'factory scan',
        docs: Records.SOURCES[app.imageDocKey || 'IGI-7996745173'],
      });
      app.record = record;

      // 1. the desk
      await runBeat(1, async () => {
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
          await wait(600);
        }
      });

      // 2. the documents
      await runBeat(2, async () => {
        document.getElementById('inbox-panel').hidden = false;
        focus('#inbox-panel', 'start');
        await ingest(app.imageDocKey || 'IGI-7996745173', ui);
      });

      // 3. compliance, before anything is planned or priced
      await runBeat(3, async () => {
        focus('.agent-desk', 'start');
        ui.working('compliance', 'Checking');
        await Agents.compliance(record, ui);
        ui.renderCompliance(record);
      });

      // 4. the model on the rough
      await runBeat(4, async () => {
        ui.working('planning', 'Scanning');
        focus('.console-grid', 'start');
        await wait(400);
        await app.run(false, { noScroll: true });
        if (!app.record || !app.record.plan) {
          ui.log('MODEL', 'No usable plan for this scan. Pick another scan and run the model again');
          throw new Error('no plan');
        }
        await wait(300);
        focus('.ba-grid', 'center');
      });

      // 5. the floor
      await runBeat(5, async () => {
        focus('.agent-desk', 'start');
        ui.working('planning', 'On the wheel');
        await wait(400);
        await Agents.cutting(record, ui);
        ui.renderCutting(record);
      });

      // 6. the price
      await runBeat(6, async () => {
        focus('.agent-desk', 'start');
        ui.working('quoting', 'Pricing');
        await Agents.quoting(record, ui);
        ui.renderQuote(record);
      });

      // 7. the stone that is stopped
      await runBeat(7, async () => {
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
      await runBeat(8, async () => {
        ui.renderPassport(record);
        await wait(300);
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
      hidePoint();
      document.body.classList.remove('presenting');
      setTimeout(clearCaption, 6000);
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
      await wait(420);
      node.dataset.open = 'true';
      for (const [name, value] of m.fields) {
        node._fields.appendChild(Inbox.fieldRow(name, value));
        pulled += 1;
        counter.textContent = `${pulled} of ${total} fields`;
        await wait(110);
      }
      ui.log('INBOX', `Pulled <span class="num">${m.fields.length}</span> fields from ${m.file}, nothing typed by hand`);
      await wait(220);
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
    L.push('Nine beats. The film runs seventeen seconds, the rest hold ten. Total about one minute forty.');
    L.push('The subtitle on screen is the short version. The lines below are what you say.');
    L.push('Pause stops the clock. Next moves on early. Nothing runs away from you.');
    L.push(rule);
    L.push('');
    L.push('BEFORE YOU RECORD');
    L.push('  node server.js, then open http://localhost:4610 full screen.');
    L.push('  Press Start model. The factory film opens it, then the run walks itself.');
    L.push('  Read beat 1 over the film. When the bar fills, it moves on by itself.');
    L.push('  Subtitles burn in at the bottom, so the recording carries the story on its own.');
    L.push('');
    L.push(rule);

    const spoken = [
      "That is our factory. The Galaxy machine X-rays the rough and maps every inclusion inside it. What you are watching is the scan being taken.",
      "That one parcel touches four companies in three countries. Today that runs on about twenty WhatsApp threads. We put all four on the same record.",
      "Nobody types a filing. Mining certificate, lab report, invoice. The agent reads each mail and pulls fifteen fields straight out of the documents.",
      "Origin first, always. Every field checked against the other two documents, then the Due Diligence Statement. Mandatory in the EU since January twenty twenty six.",
      "Now the same X-ray from the film. The model maps the inclusions and returns the plan that yields the most. Only forty carats in a hundred survive.",
      "The floor cuts it. What came off the wheel lands back on the same record, beside what was planned, so I can see the variance.",
      "Where it was polished sets the import duty. Compliance already proved that field, so the price and the filing cannot disagree. Forty three thousand is my ceiling.",
      "Second stone. The invoice says Botswana, the certificate says Russian Federation. Stopped at the desk. At the border that is forty percent of the shipment plus seizure.",
      "Three jobs, one record per stone. Compliance, price and cut plan off the same facts. Ten people do this by hand in nine days. That was ninety seconds.",
    ];

    BEATS.forEach((b, i) => {
      L.push('');
      L.push(`BEAT ${i + 1}, ${b.title.toUpperCase()}   (${b.key === 'film' ? 'about 17 seconds, the film' : 'about 10 seconds'})`);
      L.push('  Subtitle: ' + b.caption);
      if (b.point) L.push('  Pointer lands on: ' + b.point.label);
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
