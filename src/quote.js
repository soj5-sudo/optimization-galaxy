// quote.js
// Prices a stone the way the trade prices one.
//
// The list is a published weekly sheet of asking prices per carat by shape,
// size, colour and clarity. Nobody pays list. Stones trade at a discount to
// it, quoted as a percentage back of list, and that discount is negotiated per
// trading house. So the same stone is worth different money to two importers,
// and the quote has to know which house is asking.
//
// The rates below are the demo's own table, marked as such in the interface.
// In deployment this module reads the subscribed list feed and the house terms
// from the importer's private area of the record; the shape of the calculation
// does not change.

const Quote = (() => {

  const BASIS = {
    source: 'demo price table',
    modelled: true,
    note: 'Indicative. Replace with the subscribed list feed in deployment.',
  };

  // asking price per carat at a one carat reference, by clarity
  const LIST_PER_CT = {
    FL: 11200, IF: 9800, VVS1: 8900, VVS2: 8100, VS1: 7200, VS2: 6400,
    SI1: 5300, SI2: 4300, I1: 2400, I2: 1500, I3: 900,
  };

  // size multiplier, stepped at the trade thresholds where price jumps
  function sizeCurve(ct) {
    if (ct >= 5) return 3.4;
    if (ct >= 3) return 2.6;
    if (ct >= 2) return 2.0;
    if (ct >= 1.5) return 1.55;
    if (ct >= 1.0) return 1.25;
    if (ct >= 0.7) return 0.92;
    if (ct >= 0.5) return 0.72;
    if (ct >= 0.3) return 0.55;
    return 0.4;
  }

  const SHAPE_FACTOR = { round: 1.0, oval: 0.84, princess: 0.78, cushion: 0.8, emerald: 0.82, pear: 0.83 };

  // Lab grown does not trade off the natural list at all. It is priced against
  // its own much lower reference, and the gap has widened every year, so the
  // two are kept as separate bases rather than one with a fudge factor.
  const GROWN_PER_CT = {
    FL: 1100, IF: 950, VVS1: 850, VVS2: 780, VS1: 700, VS2: 640,
    SI1: 540, SI2: 450, I1: 280, I2: 190, I3: 120,
  };

  // Terms negotiated per importer. Deeper discount means the house pays less.
  const HOUSE_TERMS = {
    'antwerp-dt': { label: 'Antwerp Diamond Trading', naturalBackPct: 33, grownBackPct: 62, paymentDays: 60 },
    'kama-schachter': { label: 'Kama Schachter Jewelry', naturalBackPct: 30, grownBackPct: 58, paymentDays: 120 },
    'mj-diamonds': { label: 'MJ Diamonds', naturalBackPct: 36, grownBackPct: 65, paymentDays: 90 },
    default: { label: 'Standard terms', naturalBackPct: 32, grownBackPct: 60, paymentDays: 30 },
  };

  // duty is set by where the stone was polished, not where it was mined
  const DUTY_BY_POLISH = {
    India: 10.0, China: 20.0, Israel: 0.0, Belgium: 0.0, 'United States': 0.0, Botswana: 0.0, Thailand: 5.0,
  };

  const CUTTING_COST_PER_ROUGH_CT = 120;
  const TARGET_MARGIN_PCT = 22;

  function perCarat(clarity, ct, shape, growth, houseId) {
    const grown = growth && growth !== 'natural';
    const table = grown ? GROWN_PER_CT : LIST_PER_CT;
    const key = String(clarity || 'SI2').toUpperCase();
    const base = table[key] || table.SI2;
    const shapeF = SHAPE_FACTOR[String(shape || 'round').toLowerCase()] || 0.8;
    const list = Math.round(base * sizeCurve(ct) * shapeF);
    const terms = HOUSE_TERMS[houseId] || HOUSE_TERMS.default;
    const backPct = grown ? terms.grownBackPct : terms.naturalBackPct;
    const net = Math.round(list * (1 - backPct / 100));
    return { list, backPct, net, terms, basis: grown ? 'lab grown reference' : 'natural list' };
  }

  // What the importer will pay for the finished goods, and working back from
  // that, the most the factory can pay for the rough and still make its margin.
  function price(record, opts = {}) {
    const houseId = opts.houseId || 'default';
    const growth = record.growthMethod || 'natural';
    const docs = record.documents || {};
    const plan = record.plan;
    const lab = docs.lab_report || {};
    const invoice = docs.invoice || {};

    if (!plan || !plan.stones || !plan.stones.length) {
      return { error: 'No cut plan yet, so there is nothing to price.' };
    }

    // price each planned stone
    const lines = plan.stones.map(s => {
      const p = perCarat(s.clarity, s.carat, s.shape, growth, houseId);
      return {
        id: s.id,
        carat: s.carat,
        clarity: s.clarity,
        shape: s.shape,
        listPerCt: p.list,
        backPct: p.backPct,
        netPerCt: p.net,
        value: Math.round(p.net * s.carat),
      };
    });

    const revenue = lines.reduce((a, l) => a + l.value, 0);

    // the graded stone from the lab report, priced the same way, as the anchor
    const anchor = lab.caratWeight
      ? (() => {
          const p = perCarat(lab.clarityGrade, lab.caratWeight, lab.shape, growth, houseId);
          return { carat: lab.caratWeight, clarity: lab.clarityGrade, ...p, value: Math.round(p.net * lab.caratWeight) };
        })()
      : null;

    // duty follows the country of polish, which compliance proved
    const polish = invoice.countryOfPolish;
    const dutyPct = polish && DUTY_BY_POLISH[polish] !== undefined ? DUTY_BY_POLISH[polish] : null;
    const duty = dutyPct === null ? 0 : Math.round(revenue * (dutyPct / 100));

    const roughCt = (docs.kp_certificate && docs.kp_certificate.roughWeightCt)
      || (docs.reactor_batch && docs.reactor_batch.roughWeightCt) || 0;
    const cutting = Math.round(roughCt * CUTTING_COST_PER_ROUGH_CT);
    const margin = Math.round(revenue * (TARGET_MARGIN_PCT / 100));
    const roughBid = Math.max(0, revenue - duty - cutting - margin);

    return {
      houseId,
      house: (HOUSE_TERMS[houseId] || HOUSE_TERMS.default).label,
      paymentDays: (HOUSE_TERMS[houseId] || HOUSE_TERMS.default).paymentDays,
      growth,
      basis: lines.length ? (growth === 'natural' ? 'natural list' : 'lab grown reference') : null,
      anchor,
      lines,
      revenue,
      dutyPct,
      dutyCountry: polish || null,
      duty,
      cutting,
      cuttingRate: CUTTING_COST_PER_ROUGH_CT,
      margin,
      marginPct: TARGET_MARGIN_PCT,
      roughBid,
      roughCt,
      balances: Math.abs((roughBid + duty + cutting + margin) - revenue) < 2,
      modelled: BASIS,
      // what the importer keeps private, and what the factory keeps private,
      // are separated here so the session can route them correctly
      partition: {
        shared: ['lines', 'revenue', 'dutyPct', 'duty', 'growth', 'basis'],
        factory: ['cutting', 'roughBid'],
        importer: ['houseId', 'house', 'backPct', 'paymentDays'],
        exporter: ['margin', 'marginPct'],
      },
    };
  }

  return { price, perCarat, HOUSE_TERMS, LIST_PER_CT, GROWN_PER_CT, DUTY_BY_POLISH, BASIS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Quote;
