// inbox.js: where the record actually comes from. Nobody types a filing.
// The documents arrive by email, the agent reads them, and every field on the
// statement is pulled out of one of them.

const Inbox = (() => {

  const MAIL = {
    'IGI-7996745173': [
      {
        type: 'mining',
        channel: 'WhatsApp',
        from: 'Kagiso Sebina',
        addr: '+267 71 4xx xxx',
        subject: 'Parcel PRC-88231, certificate attached',
        received: '08 Nov 2025, 09:14',
        preview: 'Attached is the Kimberley Process certificate and the export paperwork for parcel PRC-88231, 17.69 ct rough from Jwaneng. Cleared for shipment.',
        file: 'KP-BW-2025-114872.pdf',
        fields: [
          ['KP certificate', 'BW-2025-114872'],
          ['Country of origin', 'Botswana'],
          ['Mine', 'Jwaneng'],
          ['Parcel', 'PRC-88231'],
          ['Rough weight', '17.69 ct'],
        ],
      },
      {
        type: 'lab',
        channel: 'Email',
        from: 'IGI Antwerp',
        addr: 'reports@igi.org',
        subject: 'Report 7996745173 issued',
        received: '14 May 2026, 16:02',
        preview: 'Grading is complete for the stone submitted under job 88231-A. The full report is attached and is verifiable on our site.',
        file: 'IGI-7996745173.pdf',
        fields: [
          ['Report number', '7996745173'],
          ['Carat weight', '3.01 ct'],
          ['Colour', 'F'],
          ['Clarity', 'SI2'],
          ['Shape', 'Round Brilliant'],
        ],
      },
      {
        type: 'invoice',
        channel: 'Telegram',
        from: 'Antwerp buyer',
        addr: '@antwerp_dt',
        subject: 'Invoice INV-2026-0431 for the Antwerp order',
        received: '02 Aug 2026, 11:47',
        preview: 'Invoice raised against the Antwerp order, CIP Antwerp. Polished in Surat. Please file the statement before the parcel moves.',
        file: 'INV-2026-0431.pdf',
        fields: [
          ['Invoice number', 'INV-2026-0431'],
          ['Buyer', 'Antwerp Diamond Trading NV'],
          ['Declared origin', 'Botswana'],
          ['Country of polish', 'India'],
          ['Transaction value', '$36,900'],
        ],
      },
    ],
    'GIA-7373304073': [
      {
        type: 'mining',
        channel: 'WhatsApp',
        from: 'Consignment desk',
        addr: '+971 50 3xx xxx',
        subject: 'Consignment parcel PRC-44017, certificate attached',
        received: '30 Sep 2020, 08:31',
        preview: 'Certificate and export record for the consignment parcel, 2.48 ct rough. Held in stock since 2020.',
        file: 'KP-RU-2020-330914.pdf',
        fields: [
          ['KP certificate', 'RU-2020-330914'],
          ['Country of origin', 'Russian Federation'],
          ['Mine', 'Udachnaya'],
          ['Parcel', 'PRC-44017'],
          ['Rough weight', '2.48 ct'],
        ],
      },
      {
        type: 'lab',
        channel: 'Email',
        from: 'GIA',
        addr: 'reports@gia.edu',
        subject: 'Report 7373304073',
        received: '22 Jan 2021, 10:05',
        preview: 'Grading report attached for the 1.00 ct round brilliant submitted under this account.',
        file: 'GIA-7373304073.pdf',
        fields: [
          ['Report number', '7373304073'],
          ['Carat weight', '1.00 ct'],
          ['Colour', 'G'],
          ['Clarity', 'I2'],
          ['Shape', 'Round Brilliant'],
        ],
      },
      {
        type: 'invoice',
        channel: 'Telegram',
        from: 'Consignment desk',
        addr: '@consign_desk',
        subject: 'Invoice INV-2026-0432',
        received: '03 Aug 2026, 15:20',
        preview: 'Invoice for the 1.00 ct against the same Antwerp order. Origin Botswana. Ready to ship with the rest of the parcel.',
        file: 'INV-2026-0432.pdf',
        fields: [
          ['Invoice number', 'INV-2026-0432'],
          ['Buyer', 'Antwerp Diamond Trading NV'],
          ['Declared origin', 'Botswana'],
          ['Country of polish', 'India'],
          ['Transaction value', '$3,150'],
        ],
      },
    ],
  };

  const LABEL = { mining: 'Mining certificate', lab: 'Lab report', invoice: 'Invoice' };
  const MEANS = {
    mining: 'Says which mine and country the rough came from',
    lab: 'The stone\u2019s identity: carat, colour, clarity, graded by the lab',
    invoice: 'The sale: who bought it, for how much, polished where',
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function mailFor(docKey) { return MAIL[docKey] || MAIL['IGI-7996745173']; }

  function totalFields(docKey) {
    return mailFor(docKey).reduce((n, m) => n + m.fields.length, 0);
  }

  // renders one email card, closed. Returns the node so the caller can open it.
  function card(mail) {
    const c = el('article', 'mail');
    c.dataset.type = mail.type;
    const head = el('div', 'mail-head');
    const who = el('span', 'mail-from', mail.from);
    const chan = el('span', 'mail-channel', mail.channel);
    chan.dataset.channel = mail.channel;
    head.append(who, chan);
    const subj = el('p', 'mail-subject', mail.subject);
    const att = el('div', 'mail-att');
    att.append(el('span', 'mail-clip', 'PDF'), el('span', 'mail-file', mail.file), el('span', 'mail-kind', LABEL[mail.type]));
    const means = el('p', 'mail-means', MEANS[mail.type]);
    const fields = el('div', 'mail-fields');
    c.append(head, subj, means, att, fields);
    c._fields = fields;
    return c;
  }

  function fieldRow(name, value) {
    const r = el('div', 'mfield');
    r.append(el('span', 'mf-name', name), el('span', 'mf-value', value));
    return r;
  }

  return { mailFor, totalFields, card, fieldRow, LABEL };
})();
