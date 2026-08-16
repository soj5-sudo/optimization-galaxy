// demo.js: the model run. Eight beats, each held for about half a minute so
// there is room to talk over it. Pause and Next are always available, so the
// pacing never traps the presenter.

const Demo = (() => {

  const DWELL_MS = 12000;      // floor for a beat, so nothing flashes past
  // a subtitle card holds long enough to read at an unhurried pace, about 130
  // words a minute, with a floor for very short lines
  const cardMs = text => Math.max(4000, Math.min(7000, 2500 + text.split(' ').length * 280));
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
      title: 'The scan is taken',
      stage: null,
      cards: [
        "This machine takes an X-ray of a rough diamond.",
        "It shows every crack and speck hidden inside the stone.",
      ],
    },
    {
      key: 'rough',
      title: 'The rough, as scanned',
      stage: '#scan-stage',
      cards: [
        "This is that X-ray.",
        "Grey is the diamond. The coloured marks are the flaws inside it.",
      ],
    },
    {
      key: 'read',
      title: 'The computer reads it',
      stage: '#analyzer',
      cards: [
        "The computer looks at the same picture.",
        "It finds the edge of the stone and marks every flaw.",
      ],
    },
    {
      key: 'plan',
      title: 'Planning the cut',
      stage: '#results',
      cards: [
        "Now it works out how to cut it.",
        "It fits finished diamonds inside, going around the flaws, not through them.",
        "Out of 100 carats of rough, only about 40 come out as finished stones.",
      ],
    },
    {
      key: 'cut',
      title: 'The floor cuts it',
      stage: '.agent-desk',
      cards: [
        "The factory cuts the stone to that plan.",
        "What really came out is written next to what we expected.",
      ],
    },
    {
      key: 'inbox',
      title: 'The paperwork arrives',
      stage: '#inbox-panel',
      cards: [
        "The papers turn up on email, WhatsApp and Telegram.",
        "Where it was mined. What the lab measured. Who bought it.",
        "The software reads them. Nobody types anything in.",
      ],
    },
    {
      key: 'compliance',
      title: 'Proving where it came from',
      stage: '.agent-desk',
      cards: [
        "Every diamond needs proof of where it came from.",
        "The software checks all three papers say the same thing.",
        "They match, so the legal form is filled in and filed.",
      ],
    },
    {
      key: 'quote',
      title: 'What it is worth',
      stage: '.agent-desk',
      cards: [
        "There is one price list the whole diamond trade uses.",
        "Nobody pays full price. Take off the discount, the tax, the cutting cost.",
        "What is left is the most we can pay for the rough stone.",
      ],
    },
    {
      key: 'blocked',
      title: 'The one we stop',
      stage: '#blocked-card',
      cards: [
        "Another stone. The bill says it came from Botswana.",
        "The mine paper says Russia, which is banned. We stop it here.",
      ],
    },
    {
      key: 'passport',
      title: 'One record per stone',
      stage: '#passport',
      cards: [
        "One page per stone, from rough stone to sale.",
        "Every number showing which paper it came from.",
      ],
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
    if (l) l.textContent = b.cards[0];
    runCards(b.cards);
  }

  // steps the subtitle through a beat's cards, pausing with the run
  let cardTimer = null;
  function runCards(cards) {
    clearTimeout(cardTimer);
    let i = 0;
    caption(cards[0]);
    const step = () => {
      if (!state.running) return;
      if (state.paused) { cardTimer = setTimeout(step, 200); return; }
      i += 1;
      if (i >= cards.length) return;
      caption(cards[i]);
      cardTimer = setTimeout(step, cardMs(cards[i]));
    };
    if (cards.length > 1) cardTimer = setTimeout(step, cardMs(cards[0]));
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

  // ---------- the stage ----------
  // One panel on screen at a time, held in a fixed frame. The page never
  // scrolls during a run, so nothing can drift out of place.

  let staged = null, slot = null;

  function showStage(sel) {
    const frame = document.getElementById('stage');
    if (!frame) return;
    if (staged && slot && slot.parentNode) {
      slot.parentNode.replaceChild(staged, slot);   // put the previous panel back
    }
    staged = null; slot = null;
    const el = sel ? document.querySelector(sel) : null;
    if (!el) return;
    slot = document.createComment('staged');
    el.parentNode.replaceChild(slot, el);
    frame.appendChild(el);
    staged = el;
    // canvases size themselves off their container, so let them re-fit
    window.dispatchEvent(new Event('resize'));
  }

  function clearStage() { showStage(null); }

  // the header height changes with the title, so the stage is placed from a
  // measurement rather than a fixed guess
  function fitStage() {
    const panel = document.getElementById('demo-panel');
    if (!panel || panel.hidden) return;
    const bottom = panel.getBoundingClientRect().bottom;
    document.documentElement.style.setProperty('--stage-top', `${Math.round(bottom + 24)}px`);
  }
  window.addEventListener('resize', () => { if (state.running) fitStage(); });

  function setHold(frac) {
    const bar = document.getElementById('beat-hold');
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, frac * 100))}%`;
  }

  // hold on the current beat until its half minute is up, unless skipped.
  // paused time does not count, so the presenter can stop and explain.
  async function hold(startedAt, cards) {
    const reading = (cards || []).reduce((n, c) => n + cardMs(c), 0);
    const needed = Math.max(DWELL_MS, reading + 800);
    const target = startedAt + needed;
    while (!state.skip) {
      const now = performance.now();
      if (state.paused) { await wait(120); continue; }
      const left = target - now;
      if (left <= 0) break;
      setHold(1 - left / needed);
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
    fitStage();
    if (b.stage !== undefined) showStage(b.stage);
    setHold(0);
    const t0 = performance.now();
    await work();
    await hold(t0, b.cards);
    setStep(b.key, 'done');
  }

  // opens the shared session and puts the desk on screen before the film runs
  async function openSession(ui) {
    if (!Session.state.id) {
      const id = await Session.create();
      await Session.join(id, 'Soham (Source)');
    }
    const info = await Session.hostInfo();
    const urls = Session.shareUrls(Session.state.id, info);
    const link = document.getElementById('demo-link');
    if (link) { link.textContent = urls[0]; link.parentElement.hidden = false; }
    for (const p of DESK) {
      if (p.name !== 'Soham') await joinDeskMember(p);
      deskCard(p, ui);
    }
    ui.log('SESSION', 'Wasi, Anik and Soham are on this record together');
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
      // 0. the film: how the scan is taken
      await runBeat(0, async () => {
        await playFilm(ui);
        const roughBtn = document.querySelector('#samples button[data-src*="rough-327"]');
        if (roughBtn) { roughBtn.click(); await wait(500); }
        ui.log('RECORD', 'Scan 327.8 received from the factory, record opened');
      });

      const record = Records.create({
        scanName: app.imageName || 'Galaxy rough scan 327.8',
        scanSource: 'factory scan',
        docs: Records.SOURCES[app.imageDocKey || 'IGI-7996745173'],
      });
      app.record = record;

      // 1. the rough itself, big enough to look at
      await runBeat(1, async () => {});

      // 2. the computer reads it
      await runBeat(2, async () => {
        ui.working('planning', 'Reading the scan');
        await wait(400);
        await app.run(false, { noScroll: true });
        if (!app.record || !app.record.plan) {
          ui.log('MODEL', 'No usable plan for this scan. Pick another scan and start again');
          throw new Error('no plan');
        }
      });

      // 3. the plan
      await runBeat(3, async () => {});

      // 4. the floor
      await runBeat(4, async () => {
        ui.working('planning', 'On the wheel');
        await wait(400);
        await Agents.cutting(record, ui);
        ui.renderCutting(record);
      });

      // 5. the paperwork, however it arrives
      await runBeat(5, async () => {
        document.getElementById('inbox-panel').hidden = false;
        await ingest(app.imageDocKey || 'IGI-7996745173', ui);
      });

      // 6. proving the origin
      await runBeat(6, async () => {
        ui.working('compliance', 'Checking');
        await Agents.compliance(record, ui);
        ui.renderCompliance(record);
      });

      // 7. what it is worth
      await runBeat(7, async () => {
        ui.working('quoting', 'Pricing');
        await Agents.quoting(record, ui);
        ui.renderQuote(record);
      });

      // 8. the one we stop
      await runBeat(8, async () => {
        ui.log('SESSION', 'Second stone on the same order, a 1.00 ct');
        const bad = Records.create({
          scanName: 'GIA 7373304073',
          scanSource: 'lab report',
          docs: Records.SOURCES['GIA-7373304073'],
        });
        app.badRecord = bad;
        document.getElementById('blocked-card').hidden = false;
        showStage('#blocked-card');
        await Agents.compliance(bad, ui);
        ui.renderCompliance(bad, true);
        await Agents.quoting(bad, ui);
      });

      // 9. the passport
      await runBeat(9, async () => {
        ui.renderPassport(record);
        showStage('#passport');
        ui.log('RECORD', `Record ${record.id} complete, ${record.audit.length} steps, all on one sheet`);
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
    L.push('Nine beats. The film opens it, the rest hold long enough to read. About two minutes ten.');
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
      "That is our factory. This machine takes an X-ray of a rough diamond and shows every crack and speck hidden inside it.",
      "This is that X-ray. The grey part is the diamond itself, and the coloured marks are the flaws trapped inside it.",
      "The computer looks at the same picture, finds the edge of the stone, and marks every flaw it can see inside.",
      "Now it works out how to cut it, fitting finished diamonds inside the rough and going around the flaws. Out of a hundred carats, only about forty survive.",
      "The factory cuts the stone to that plan, and what really came out is written down next to what we expected.",
      "The papers turn up on email, WhatsApp and Telegram. Where it was mined, what the lab measured, who bought it. The software reads them all.",
      "Every diamond needs proof of where it came from. The software checks all three papers say the same thing, then fills in the legal form and files it.",
      "There is one price list the whole trade uses. Nobody pays full price. Take off the discount, the tax and the cutting cost, and that is our limit.",
      "Another stone. The bill says Botswana, the mine paper says Russia, which is banned. We stop it here, before it ever ships.",
      "One page per stone, from rough stone to sale, and every number shows which paper it came from. Ten people do this by hand in nine days.",
    ];

    BEATS.forEach((b, i) => {
      L.push('');
      L.push(`BEAT ${i + 1}, ${b.title.toUpperCase()}   (${b.key === 'film' ? 'the film, 15 seconds' : b.cards.length + ' subtitle cards'})`);
      b.cards.forEach(c => L.push('  Subtitle: ' + c));
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
