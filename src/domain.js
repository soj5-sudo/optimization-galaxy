// domain.js
// The vocabulary of the trade, in one place: growth methods, document types,
// destination rule sets, and the shape of a stone record.
//
// Every value that is modelled rather than measured is marked `modelled: true`
// so the interface can label it. Nothing in this file invents a fact about a
// real shipment.

const Domain = (() => {

  // ---------- how the stone was made ----------
  // Origin proof means different things per growth method. A mined stone needs
  // a Kimberley Process chain. A grown stone needs a reactor batch record and
  // the producing facility, and it is never subject to the Russian sanctions
  // question, but it does carry mandatory disclosure obligations.
  const GROWTH_METHODS = {
    natural: {
      id: 'natural',
      label: 'Natural',
      short: 'Mined',
      description: 'Mined from the ground. Origin is proved through the Kimberley Process chain.',
      originDocument: 'kp_certificate',
      sanctionsApplicable: true,
      disclosureRequired: false,
      hsCode: '7102.39',
      requiredDocs: ['kp_certificate', 'lab_report', 'invoice'],
    },
    cvd: {
      id: 'cvd',
      label: 'Lab grown, CVD',
      short: 'CVD',
      description: 'Chemical vapour deposition. Carbon grown onto a seed plate in a microwave plasma reactor.',
      originDocument: 'reactor_batch',
      sanctionsApplicable: false,
      disclosureRequired: true,
      hsCode: '7104.91',
      requiredDocs: ['reactor_batch', 'lab_report', 'invoice'],
      subTypes: ['Microwave plasma CVD', 'Hot filament CVD', 'DC arc jet CVD'],
    },
    hpht: {
      id: 'hpht',
      label: 'Lab grown, HPHT',
      short: 'HPHT',
      description: 'High pressure high temperature. Grown in a press that reproduces mantle conditions.',
      originDocument: 'reactor_batch',
      sanctionsApplicable: false,
      disclosureRequired: true,
      hsCode: '7104.91',
      requiredDocs: ['reactor_batch', 'lab_report', 'invoice'],
      subTypes: ['Belt press', 'Cubic press (BARS)', 'Split sphere'],
    },
  };

  // ---------- what a document is and who normally holds it ----------
  const DOC_TYPES = {
    kp_certificate: {
      label: 'Kimberley Process certificate',
      plain: 'Says which country the rough came out of',
      heldBy: 'factory',
      keyFields: ['kpCertificate', 'countryOfOrigin', 'mine', 'parcel', 'roughWeightCt'],
    },
    reactor_batch: {
      label: 'Reactor batch record',
      plain: 'Says which reactor grew it, when, and under what recipe',
      heldBy: 'factory',
      keyFields: ['batchId', 'facility', 'countryOfOrigin', 'reactorType', 'growthHours', 'roughWeightCt'],
    },
    lab_report: {
      label: 'Grading report',
      plain: 'The lab measured it: weight, colour, clarity, cut',
      heldBy: 'exporter',
      keyFields: ['reportNumber', 'authority', 'caratWeight', 'colourGrade', 'clarityGrade', 'shape', 'growthMethod'],
    },
    invoice: {
      label: 'Invoice or memo',
      plain: 'The sale: who bought it, for how much, cut where',
      heldBy: 'importer',
      keyFields: ['number', 'seller', 'buyer', 'declaredOrigin', 'countryOfPolish', 'value', 'warrantyClause'],
    },
    assay_certificate: {
      label: 'Metal assay certificate',
      plain: 'For the mount: the fineness of the gold or silver, assayed',
      heldBy: 'factory',
      keyFields: ['assayNumber', 'metal', 'fineness', 'assayOffice', 'grossWeightG'],
    },
  };

  // Precious metal fineness, for mounted goods travelling on the same shipment.
  const METALS = {
    gold: { label: 'Gold', finenesses: [999, 916, 750, 585, 375], hallmarkUnit: 'parts per thousand' },
    silver: { label: 'Silver', finenesses: [999, 958, 925, 800], hallmarkUnit: 'parts per thousand' },
    platinum: { label: 'Platinum', finenesses: [999, 950, 900, 850], hallmarkUnit: 'parts per thousand' },
  };

  // ---------- destination rule sets ----------
  // The regulation is data, not code, so a change is a diff rather than a
  // rewrite. Effective dates and thresholds are the published ones; the
  // penalty figures are the published maxima.
  const DESTINATIONS = {
    eu: {
      id: 'eu',
      label: 'European Union',
      instrument: 'Council Regulation (EU) 833/2014, as amended by 2023/2878',
      statement: 'Due Diligence Statement',
      effectiveFrom: '2026-01-01',
      appliesTo: ['natural'],
      minCaratNatural: 0.5,
      requiresTraceability: true,
      penalties: {
        wrongOriginPctOfShipment: 40,
        sanctionedPerViolationUsd: 377700,
        alsoTwiceTransactionValue: true,
      },
      requiredEvidence: [
        'Importer identity and EORI',
        'Goods line, HS code, count, carats, value',
        'Country of mining origin',
        'Declaration that the goods are not of Russian origin',
        'Declaration that reasonable steps were taken and no aggregation applies',
        'Named authorised signatory, place and date of signing',
      ],
    },
    us: {
      id: 'us',
      label: 'United States',
      instrument: 'Executive Order 14068, CBP self certification',
      statement: 'Importer self certification',
      effectiveFrom: '2024-03-01',
      appliesTo: ['natural'],
      minCaratNatural: 1.0,
      requiresTraceability: true,
      status: 'next destination, not yet end to end',
      penalties: {
        wrongOriginPctOfShipment: 30,
        sanctionedPerViolationUsd: 377700,
        alsoTwiceTransactionValue: true,
      },
      requiredEvidence: [
        'Importer of record and EIN',
        'HTSUS classification and entered value',
        'Country of mining origin and country of substantial transformation',
        'Certification that no Russian origin diamond is present',
      ],
    },
    ftc_disclosure: {
      id: 'ftc_disclosure',
      label: 'Lab grown disclosure',
      instrument: 'FTC Jewelry Guides, 16 CFR 23.12',
      statement: 'Growth method disclosure',
      effectiveFrom: '2018-07-24',
      appliesTo: ['cvd', 'hpht'],
      requiresTraceability: false,
      requiredEvidence: [
        'Clear and conspicuous disclosure that the stone is laboratory grown',
        'Growth method and producing facility',
        'No use of an implication that the stone is mined',
      ],
    },
  };

  // which rule set applies to a stone
  function destinationsFor(growthMethod, destination) {
    const out = [];
    const dest = DESTINATIONS[destination];
    if (dest && dest.appliesTo.includes(growthMethod)) out.push(dest);
    if (GROWTH_METHODS[growthMethod] && GROWTH_METHODS[growthMethod].disclosureRequired) {
      out.push(DESTINATIONS.ftc_disclosure);
    }
    return out;
  }

  // ---------- the three companies on a shipment ----------
  const PARTIES = {
    factory: {
      id: 'factory',
      label: 'Factory',
      holds: 'The stone, the scan, the growth or mining paperwork',
      privateFields: ['roughCost', 'cuttingCost', 'machineTime'],
    },
    exporter: {
      id: 'exporter',
      label: 'Exporter',
      holds: 'The grading reports and the export paperwork. Signs the statement.',
      privateFields: ['sellingPrice', 'marginPct'],
    },
    importer: {
      id: 'importer',
      label: 'Importer',
      holds: 'The purchase order, the invoice, the duty position',
      privateFields: ['landedCost', 'retailMarkup', 'houseDiscountPct'],
    },
  };

  return {
    GROWTH_METHODS, DOC_TYPES, METALS, DESTINATIONS, PARTIES,
    destinationsFor,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Domain;
