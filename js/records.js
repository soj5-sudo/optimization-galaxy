// records.js: the stone record. One record per stone, written by every agent.
// Compliance, quoting and cut planning all read the same fields, which is why a
// price can never disagree with an origin and a filing can never disagree with a lab report.

const Records = (() => {

  // Source documents for the demo stones. Lab fields are transcribed from the
  // actual IGI and GIA reports bundled in assets/docs.
  const SOURCES = {
    'IGI-7996745173': {
      lab: {
        authority: 'IGI',
        reportNumber: '7996745173',
        reportDate: '2026-05-14',
        description: 'Natural Diamond',
        shape: 'Round Brilliant',
        measurementsMm: '9.17 - 9.24 x 5.74',
        caratWeight: 3.01,
        colorGrade: 'F',
        clarityGrade: 'SI2',
        cutGrade: 'Excellent',
        polish: 'Excellent',
        symmetry: 'Excellent',
        fluorescence: 'Very Slight',
        inscription: 'IGI 7996745173',
        documentUrl: 'assets/docs/igi-7996745173.png',
      },
      mining: {
        authority: 'Kimberley Process',
        kpCertificate: 'BW-2025-114872',
        countryOfOrigin: 'Botswana',
        mine: 'Jwaneng',
        parcelId: 'PRC-88231',
        roughWeightCt: 17.69,   // matches the scanned rough at its measured scale
        exportDate: '2025-11-08',
      },
      invoice: {
        number: 'INV-2026-0431',
        seller: 'Jewel Labs Manufacturing, Surat',
        buyer: 'Antwerp Diamond Trading NV',
        caratWeight: 3.01,
        shape: 'Round Brilliant',
        labReportNumber: '7996745173',
        declaredOrigin: 'Botswana',
        countryOfPolish: 'India',
        transactionValueUsd: 36900,
        incoterms: 'CIP Antwerp',
      },
    },
    'GIA-7373304073': {
      lab: {
        authority: 'GIA',
        reportNumber: '7373304073',
        reportDate: '2021-01-22',
        description: 'Natural Diamond',
        shape: 'Round Brilliant',
        measurementsMm: '6.20 - 6.32 x 3.96',
        caratWeight: 1.00,
        colorGrade: 'G',
        clarityGrade: 'I2',
        cutGrade: 'Very Good',
        polish: 'Excellent',
        symmetry: 'Good',
        fluorescence: 'None',
        inscription: 'Not set',
        documentUrl: 'assets/docs/gia-7373304073.png',
      },
      mining: {
        authority: 'Kimberley Process',
        kpCertificate: 'RU-2020-330914',
        countryOfOrigin: 'Russian Federation',
        mine: 'Udachnaya',
        parcelId: 'PRC-44017',
        roughWeightCt: 2.48,
        exportDate: '2020-09-30',
      },
      invoice: {
        number: 'INV-2026-0432',
        seller: 'Third party consignment',
        buyer: 'Antwerp Diamond Trading NV',
        caratWeight: 1.00,
        shape: 'Round Brilliant',
        labReportNumber: '7373304073',
        declaredOrigin: 'Botswana',
        countryOfPolish: 'India',
        transactionValueUsd: 3150,
        incoterms: 'CIP Antwerp',
      },
    },
  };

  let seq = 0;

  function create(meta) {
    seq += 1;
    const stamp = meta.now || new Date().toISOString();
    return {
      id: meta.id || `JL-${stamp.slice(0, 4)}-${String(seq).padStart(4, '0')}`,
      openedAt: stamp,
      scan: { file: meta.scanName || 'Not set', source: meta.scanSource || 'Not set' },
      docs: meta.docs || null,       // { lab, mining, invoice }
      plan: null,                    // optimization agent
      cutting: null,                 // cutting agent
      compliance: null,              // compliance agent
      quote: null,                   // quoting agent
      audit: [],
    };
  }

  function log(record, agent, action, detail) {
    record.audit.push({
      at: new Date().toISOString(),
      agent, action,
      detail: detail || '',
    });
    return record;
  }

  function fieldTable(record) {
    // every field that appears on the filing, with the document it came from
    const d = record.docs;
    if (!d) return [];
    return [
      { field: 'Country of origin', value: d.mining.countryOfOrigin, source: `KP certificate ${d.mining.kpCertificate}` },
      { field: 'Country of polish', value: d.invoice.countryOfPolish, source: `Invoice ${d.invoice.number}` },
      { field: 'Carat weight', value: `${d.lab.caratWeight.toFixed(2)} ct`, source: `${d.lab.authority} ${d.lab.reportNumber}` },
      { field: 'Shape', value: d.lab.shape, source: `${d.lab.authority} ${d.lab.reportNumber}` },
      { field: 'Color', value: d.lab.colorGrade, source: `${d.lab.authority} ${d.lab.reportNumber}` },
      { field: 'Clarity', value: d.lab.clarityGrade, source: `${d.lab.authority} ${d.lab.reportNumber}` },
      { field: 'Rough parcel', value: `${d.mining.parcelId}, ${d.mining.roughWeightCt.toFixed(2)} ct`, source: `KP certificate ${d.mining.kpCertificate}` },
      { field: 'Transaction value', value: `$${d.invoice.transactionValueUsd.toLocaleString()}`, source: `Invoice ${d.invoice.number}` },
    ];
  }

  return { SOURCES, create, log, fieldTable };
})();
