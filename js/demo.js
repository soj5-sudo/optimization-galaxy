// demo.js: one button that runs the whole cycle end to end, in order, on camera.
// Opens a shared session, brings two teammates into it over the real join API,
// plans the cut, takes the cutting report back, files the DDS, prices the stone,
// then runs a second stone that must be blocked. Also writes the recording script.

const Demo = (() => {

  const wait = ms => new Promise(r => setTimeout(r, ms));
  let running = false;

  const STEPS = [
    { key: 'session', title: 'Open shared session', line: 'One record, one session. Anyone with the link is looking at the same stone.' },
    { key: 'plan', title: 'Plan the cut', line: 'The planner reads the rough scan and searches the placement space for the best recovery.' },
    { key: 'cut', title: 'Cutting agent returns the report', line: 'The plan goes to the factory. The cutting agent sends back what actually came off the wheel.' },
    { key: 'compliance', title: 'Compliance files the DDS', line: 'Three documents, every field cross-checked, then the filing customs now demands.' },
    { key: 'quote', title: 'Quote the stone', line: 'Yield from the plan, duty from the origin compliance just proved. Same record, so the price is right.' },
    { key: 'blocked', title: 'Block a bad stone', line: 'A sanctioned origin behind a clean invoice. The filing stops here, not at the border.' },
    { key: 'passport', title: 'Stone passport complete', line: 'Minutes, not seven to nine days, and every field carries the document it came from.' },
  ];

  function setStep(key, state) {
    const el = document.querySelector(`.demo-step[data-step="${key}"]`);
    if (el) el.dataset.state = state;
  }

  function narrate(text) {
    const el = document.getElementById('demo-narration');
    if (el) el.textContent = text;
  }

  // keep the camera on whatever is currently happening
  function focus(selector, block) {
    const el = document.querySelector(selector);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: block || 'center' });
  }

  async function joinTeammate(name) {
    // a real participant: same join endpoint any browser hits
    const id = Session.state.id;
    if (!id) return;
    const clientId = 'demo-' + Math.random().toString(36).slice(2, 9);
    await fetch(`/api/session/${id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, name }),
    });
    return clientId;
  }

  async function run(app, ui) {
    if (running) return;
    running = true;
    const btn = document.getElementById('demo-btn');
    btn.disabled = true;
    btn.textContent = 'Demo running';
    document.getElementById('demo-panel').hidden = false;
    for (const s of STEPS) setStep(s.key, 'pending');

    try {
      // ---- 1. session ----
      setStep('session', 'active');
      narrate(STEPS[0].line);
      ui.log('SESSION', 'Opening a shared session for this stone');
      if (!Session.state.id) {
        const id = await Session.create();
        await Session.join(id, 'Soham (Planning)');
      }
      const info = await Session.hostInfo();
      const urls = Session.shareUrls(Session.state.id, info);
      const linkEl = document.getElementById('demo-link');
      linkEl.textContent = urls[0];
      linkEl.parentElement.hidden = false;
      ui.log('SESSION', `Share link <span class="num">${urls[0]}</span>`);
      await wait(900);
      await joinTeammate('Riya (Cutting)');
      ui.log('SESSION', 'Riya from the cutting floor opened the link and joined');
      await wait(800);
      await joinTeammate('Amit (Compliance)');
      ui.log('SESSION', 'Amit from compliance joined the same session');
      setStep('session', 'done');
      await wait(700);

      // ---- 2. plan ----
      setStep('plan', 'active');
      narrate(STEPS[1].line);
      const roughBtn = document.querySelector('#samples button[data-src*="rough-327"]');
      if (roughBtn) { roughBtn.click(); await wait(700); }
      focus('.console-grid', 'start');
      await wait(700);
      await app.run(false, { noScroll: true });
      const record = app.record;
      if (!record || !record.plan) {
        setStep('plan', 'pending');
        narrate('The planner did not return a usable plan for this scan. Pick another scan and run the demo again.');
        ui.log('DEMO', 'Stopped: no plan on the record, so there is nothing for the other agents to act on');
        return;
      }
      setStep('plan', 'done');
      await wait(500);
      focus('.ba-grid', 'center');   // show the before and after
      await wait(2600);

      // ---- 3. cutting ----
      setStep('cut', 'active');
      narrate(STEPS[2].line);
      focus('#agent-cards', 'start');
      await wait(600);
      await Agents.cutting(record, ui);
      ui.renderCutting(record);
      setStep('cut', 'done');
      await wait(700);

      // ---- 4. compliance ----
      setStep('compliance', 'active');
      narrate(STEPS[3].line);
      await Agents.compliance(record, ui);
      ui.renderCompliance(record);
      setStep('compliance', 'done');
      await wait(700);

      // ---- 5. quote ----
      setStep('quote', 'active');
      narrate(STEPS[4].line);
      await Agents.quoting(record, ui);
      ui.renderQuote(record);
      setStep('quote', 'done');
      await wait(800);

      // ---- 6. the stone that must be blocked ----
      setStep('blocked', 'active');
      narrate(STEPS[5].line);
      ui.log('SESSION', 'Second stone on the same session: a 1.00 ct with a clean looking invoice');
      focus('#blocked-card', 'center');
      await wait(600);
      const bad = Records.create({
        scanName: 'GIA 7373304073',
        scanSource: 'lab report',
        docs: Records.SOURCES['GIA-7373304073'],
      });
      app.badRecord = bad;
      await Agents.compliance(bad, ui);
      ui.renderCompliance(bad, true);
      await Agents.quoting(bad, ui);
      setStep('blocked', 'done');
      await wait(700);

      // ---- 7. passport ----
      setStep('passport', 'active');
      narrate(STEPS[6].line);
      ui.renderPassport(record);
      await wait(400);
      focus('#passport', 'center');
      ui.log('RECORD', `Stone passport <span class="num">${record.id}</span> complete: plan, cutting report, filed DDS <span class="num">${record.compliance.ddsRef}</span>, quote. ${record.audit.length} audited actions on one record`);
      setStep('passport', 'done');
      narrate('Every field on that filing carries the document it came from. That is the whole cycle.');
    } catch (err) {
      // a demo that dies silently on camera is worse than one that says what broke
      narrate('The run stopped early. Reload and press Start demo again.');
      ui.log('DEMO', `Stopped: ${err && err.message ? err.message : 'unknown error'}`);
      console.error('Demo run failed', err);
    } finally {
      running = false;
      btn.disabled = false;
      btn.textContent = 'Start demo';
    }
  }

  // ---------- recording script ----------

  function scriptText(app) {
    const r = app.record;
    const L = [];
    const dash = '-'.repeat(70);
    L.push('OPTIMIZATION GALAXY, DEMO VIDEO SCRIPT');
    L.push('Runtime about 3 minutes. Press Start demo, then read the narration as it plays.');
    L.push(dash);
    L.push('');
    L.push('SETUP');
    L.push('  1. Run: node server.js   (or use the launch config)');
    L.push('  2. Open http://localhost:4610 full screen, hide bookmarks.');
    L.push('  3. Optional second device on the LAN link to show the session live.');
    L.push('  4. Start the screen recording, then press Start demo.');
    L.push('');
    L.push(dash);
    L.push('SHOT 1, THE PROBLEM  (0:00 to 0:20)');
    L.push('  On screen: the hero, then scroll to the cycle panel.');
    L.push('  Say: "Every diamond that crosses a border needs a passport. Today about ten');
    L.push('        people build that by hand over seven to nine days. Three jobs, three');
    L.push('        systems, and they disagree with each other. We run all three off one');
    L.push('        record per stone, and we build it in minutes."');
    L.push('');
    L.push('SHOT 2, SHARED SESSION  (0:20 to 0:40)');
    L.push('  On screen: share link appears, two teammates join, roster fills.');
    L.push('  Say: "It opens as a shared session. I send the link, the cutting floor and');
    L.push('        compliance are inside the same record with me. Nobody is emailing');
    L.push('        spreadsheets back and forth."');
    L.push('');
    L.push('SHOT 3, ROUGH CUT OPTIMIZATION  (0:40 to 1:15)');
    L.push('  On screen: the Galaxy rough scan loads, stages run, plan appears.');
    L.push('  Say: "This is a real Galaxy scan of a rough stone. The model segments the');
    L.push('        stone, maps every inclusion, and searches the placement space for the');
    L.push('        best recovery."');
    if (r && r.plan) {
      L.push(`  Numbers on screen: ${r.plan.rough.carats.toFixed(2)} ct rough, ${r.plan.stones.length} stones,`);
      L.push(`        ${r.plan.totalCarat.toFixed(2)} ct recovered, ${r.plan.yieldPct.toFixed(1)}% yield, largest stone`);
      L.push(`        ${r.plan.stones[0].carat.toFixed(2)} ct against the ${r.docs.lab.caratWeight.toFixed(2)} ct on the lab report for this stone.`);
    }
    L.push('  Say: "Across the industry only forty to forty two carats in a hundred survive as');
    L.push('        polished. The plan is what decides where you land in that range, so it');
    L.push('        quietly moves about five percent of a factory\'s production."');
    L.push('  If asked why this number is conservative: this is one view of the rough, so the');
    L.push('  depth is estimated. On the machine you plan against the full 3D model.');
    L.push('');
    L.push('SHOT 4, CUTTING AGENT  (1:15 to 1:35)');
    L.push('  On screen: cutting agent log, planned versus actual, report download.');
    L.push('  Say: "The plan goes to the floor. The cutting agent sends the report back into');
    L.push('        the same record, so planned against actual is on the stone forever."');
    if (r && r.cutting) {
      L.push(`  Numbers on screen: ${r.cutting.actualTotal.toFixed(2)} ct actual, ${r.cutting.variancePct.toFixed(1)}% against plan.`);
    }
    L.push('  Action: click Cutting report to show the file downloading.');
    L.push('');
    L.push('SHOT 5, COMPLIANCE  (1:35 to 2:15)');
    L.push('  On screen: three documents, checks passing one by one, DDS reference.');
    L.push('  Say: "Compliance never writes a filing from scratch. It pulls every field from');
    L.push('        the mining certificate, the lab report and the invoice, and checks all');
    L.push('        three against each other. Since January first, twenty twenty six, every');
    L.push('        natural polished diamond of half a carat or more entering the EU needs');
    L.push('        this filing."');
    if (r && r.compliance) {
      L.push(`  Numbers on screen: DDS ${r.compliance.ddsRef}, origin ${r.compliance.origin}.`);
    }
    L.push('  Action: click Due Diligence Statement to show the filed document.');
    L.push('');
    L.push('SHOT 6, QUOTING  (2:15 to 2:35)');
    L.push('  On screen: quote panel, duty driven by country of polish.');
    L.push('  Say: "Now the price. Yield comes from the plan, and where it was polished sets');
    L.push('        the import duty. That field came from the record compliance just proved,');
    L.push('        so the price cannot contradict the filing."');
    L.push('');
    L.push('SHOT 7, THE BLOCK  (2:35 to 3:00)');
    L.push('  On screen: second stone, red blocked checks.');
    L.push('  Say: "Here is the one that matters. Clean looking invoice, declares Botswana.');
    L.push('        The mining certificate says Russian Federation. Our side stops it. At the');
    L.push('        border that is up to forty percent of shipment value plus seizure, and on');
    L.push('        a sanctioned stone, three hundred seventy seven thousand seven hundred');
    L.push('        dollars per violation or twice the transaction value. One bad parcel costs');
    L.push('        more than years of the software."');
    L.push('');
    L.push('CLOSE  (3:00 to 3:15)');
    L.push('  On screen: the stone passport.');
    L.push('  Say: "Three jobs, one record per stone, minutes instead of days. Compliant,');
    L.push('        priced correctly, and cut for the highest yield."');
    L.push('');
    L.push(dash);
    L.push('CAPTIONS TO OVERLAY');
    L.push('  0:22  One shared session, everyone on the same record');
    L.push('  0:48  Real Galaxy rough scan, segmented in browser');
    if (r && r.plan) L.push(`  1:05  ${r.plan.yieldPct.toFixed(1)}% planned yield, ${r.plan.stones.length} stones off one rough`);
    L.push('  1:20  Cutting report returns to the same record');
    L.push('  1:50  Every field traced to its source document');
    L.push('  2:20  Origin sets the duty, so the price follows the filing');
    L.push('  2:40  Mismatch blocked before it reaches customs');
    L.push('');
    L.push('NOTE FOR THE ROOM');
    L.push('  Lab reports on screen are genuine IGI and GIA documents. Mining certificates,');
    L.push('  invoices, prices and duty rates are simulated for this demo build, and the');
    L.push('  model card figures are simulated. The scan analysis and the placement search');
    L.push('  run for real in the browser on every click.');
    return L.join('\n');
  }

  return { run, scriptText, STEPS };
})();
