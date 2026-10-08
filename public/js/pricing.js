// ===== LEGENDS SHOOTOUT INSTANT — PRICING & RNG =====
// Moved unchanged from the prototype. Depends on data.js (SHOTS, AREAS, SAVES, SELECTIONS).

// ===== PRICING MODEL (swappable) =====
// Every price comes from ONE joint distribution over 15 atomic outcomes
// (10 goal = shot type x target area, 5 no-goal = save type), and the RNG
// draws from that same distribution. Every selection therefore returns
// exactly RTP before rounding; odds are rounded DOWN to 2dp.
//
// PLACEHOLDER PARAMETERS from Working Spec v0.04, until the certified
// OddsGenerator v1.3.0.0 maths is located. Replace the values below only.
const PRICING = {
  rtp: 0.90,
  // log5 league baseline. 0.50 reproduces the spec formula
  // F(1-G) / [F(1-G) + (1-F)G] exactly. ~0.31 (league shootout rate)
  // is the corrected version.
  baseline: 0.50,
  shotType: { F: 0.80, B: 0.20 },
  areaGivenShot: {
    F: { TL: 0.25, TR: 0.25, BL: 0.20, BR: 0.20, FH: 0.10 },
    B: { TL: 0.20, TR: 0.20, BL: 0.10, BR: 0.10, FH: 0.40 },
  },
  saveType: { G: 0.275, B: 0.225, P: 0.225, S: 0.175, M: 0.10 },
  minOdds: 1.01, // a selection priced below this is suspended
};

function pGoalFor(shooter, goalie, params = PRICING) {
  const odds = p => p / (1 - p);
  const q = 1 - goalie.PSP; // rate the goalie concedes
  const o = odds(shooter.F) * odds(q) / odds(params.baseline);
  return o / (1 + o);
}

function atomicOutcomes(shooter, goalie, params = PRICING) {
  const pg = pGoalFor(shooter, goalie, params);
  const out = [];
  for (const s of SHOTS) for (const a of AREAS) {
    out.push({ key: s + a, goal: true, shot: s, area: a, save: null,
      p: pg * params.shotType[s] * params.areaGivenShot[s][a] });
  }
  for (const v of SAVES) {
    out.push({ key: 'N' + v, goal: false, shot: null, area: null, save: v,
      p: (1 - pg) * params.saveType[v] });
  }
  return out;
}

function selectionWins(m, sel, o) {
  switch (m) {
    case 'MR':  return sel === 'G' ? o.goal : !o.goal;
    case 'SST': return o.goal && o.shot === sel;
    case 'SSL': return o.goal && o.area === sel;
    case 'GST': return !o.goal && o.save === sel;
    case 'STL': return o.goal && (o.shot + o.area) === sel;
  }
  return false;
}

function buildBook(shooter, goalie, params = PRICING) {
  const outcomes = atomicOutcomes(shooter, goalie, params);
  const book = {};
  for (const m of Object.keys(SELECTIONS)) {
    book[m] = {};
    for (const sel of SELECTIONS[m]) {
      const p = outcomes.filter(o => selectionWins(m, sel, o)).reduce((s, o) => s + o.p, 0);
      const odds = Math.floor((params.rtp / p) * 100 + 1e-9) / 100;
      book[m][sel] = { p, odds, suspended: odds < params.minOdds };
    }
  }
  return { pGoal: pGoalFor(shooter, goalie, params), outcomes, book };
}

// Cryptographic uniform on [0, 1)
function rngUniform() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
}

function drawOutcome(outcomes) {
  const u = rngUniform();
  let c = 0;
  for (const o of outcomes) { c += o.p; if (u < c) return o; }
  return outcomes[outcomes.length - 1];
}
