// ===== LEGENDS SHOOTOUT INSTANT — GAME LOGIC =====
// Shell (betslip, stake pad, Auto Play, history, result overlay) carried over
// from iHockey game.js. Match/market/settlement logic is for a single penalty
// shot resolved by drawOutcome() in pricing.js.
//
// Round flow: playGame/runAutoplayRound -> startRound (stake + RNG draw)
//   -> showInGame: Intro sting over the shooter's ShotClip -> freeze-frame
//      reveal of the drawn outcome (revealOutcome credits) -> showResult
//   Clips are cut before the puck reaches the net, so the footage never
//   contradicts the result. If a clip can't play, the reveal runs over its poster.

const PLAY_BTN_HTML = 'PLAY <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
const SCORE_MARKETS = ['SST', 'SSL', 'STL'];
const MULTI_MARKETS = ['SSL', 'STL', 'GST']; // multi-select up to N-1
const HISTORY_KEY = 'legends_history';
const BALANCE_KEY = 'legends_balance';
const AUTO_NEXT_DELAY = 2600;

const state = {
  balance: 1000,
  stake: 1,
  bets: [],
  shooterIdx: 0,
  goalieIdx: 0,
  priced: null,          // { pGoal, outcomes, book }
  params: { ...PRICING },
  isPlaying: false,
  selectorRole: null,
  stakeInput: '1',
  tab: 'score',
  history: [],
  round: null,           // the round in progress / last settled
  autoplay: { rounds: 10, lossLimit: 10, winLimit: 'none', skipResults: false, active: false, roundsLeft: 0, net: 0, timer: null },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const shooter = () => SHOOTERS[state.shooterIdx];
const goalie = () => GOALIES[state.goalieIdx];
const lastName = (p) => p.name.split(' ').slice(1).join(' ') || p.name;
const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const randInt = (n) => Math.floor(Math.random() * n);
const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const store = {
  get(key, fallback) { try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
  set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked */ } },
};

// Dev hook: ?force=<outcome key> (FTL, BFH, NG, NB, NP, NS, NM ...) fixes the
// next draws so every animation can be reviewed. Never enabled in production
// builds that strip query strings.
const FORCED = new URLSearchParams(location.search).get('force');

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  // Remove player <img> that fail to load so the initials fallback shows through
  document.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG' && e.target.closest('.lg-player, .lg-avatar, .lg-pick-card')) e.target.remove();
  }, true);

  state.history = store.get(HISTORY_KEY, []);
  const savedBalance = store.get(BALANCE_KEY, null);
  if (typeof savedBalance === 'number' && savedBalance >= 0) state.balance = savedBalance;

  buildComboGrid();
  state.shooterIdx = randInt(SHOOTERS.length);
  state.goalieIdx = randInt(GOALIES.length);
  loadMatch();
  bindEvents();
  updateBalance();
  updateSoundButton();
  positionBetslip();
  window.addEventListener('resize', positionBetslip);
  preloadArt();
  setTimeout(shimmerBets, 450);
});

// Warm the cache so swaps, the selector and the intro never pop in
function preloadArt() {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 600));
  idle(() => {
    const hi = (window.devicePixelRatio || 1) > 1.2;
    [...SHOOTERS, ...GOALIES].forEach(p => { const i = new Image(); i.decoding = 'async'; i.src = artSrc(p, hi); });
  });
}

// ===== PLAYER ART =====
const initialsOf = (p) => p.name.split(/[\s-]+/).map(w => w[0]).join('').slice(0, 3);

function imgTag(p, hi = false) {
  const src = artSrc(p, hi);
  const srcset = hi ? '' : ` srcset="${artSrc(p)} 1x, ${artSrc(p, true)} 2x"`;
  return `<img src="${src}"${srcset} alt="${p.name}" decoding="async" draggable="false">`;
}

// Full-body cut-out (face-off stage, intro, result hero)
function playerHTML(p, { hi = false, num = true } = {}) {
  return `<span class="lg-player" style="--accent:${p.accent}">
    <span class="lg-player-glow"></span>
    ${num ? `<span class="lg-player-num">${p.num}</span>` : ''}
    <span class="lg-player-shadow"></span>
    ${imgTag(p, hi)}<span class="lg-player-initials">${initialsOf(p)}</span>
  </span>`;
}

// Small full-body figure with the name beneath (in-game bar, result bar, banner)
function miniHTML(p, role = null) {
  const text = role ? `<span class="lg-mini-text"><span class="lg-mini-name">${p.name}</span><span class="lg-mini-role">${role}</span></span>` : '';
  return `<span class="lg-mini" style="--accent:${p.accent}">
    <span class="lg-mini-fig"><span class="lg-mini-glow"></span>${imgTag(p)}<span class="lg-player-initials">${initialsOf(p)}</span></span>${text}
  </span>`;
}

// Circular head crop
function avatarHTML(p) {
  return `<span class="lg-avatar" style="--accent:${p.accent};--hx:${p.head.x}%;--hy:${p.head.y}%">${imgTag(p)}<span class="lg-avatar-initials">${initialsOf(p)}</span></span>`;
}

// ===== MATCH SETUP =====
function loadMatch({ keepBets = false } = {}) {
  state.isPlaying = false;
  reprice();
  if (!keepBets) { state.bets = []; }
  resetViews();
  renderMatch();
  renderOdds();
  syncSelections();
  updateBetslip();
}

// One view state on <main>; the stylesheet decides what each breakpoint shows
// (mobile swaps whole screens, desktop keeps viewer + face-off on the left).
const VIEWS = ['idle', 'ingame', 'result'];
function setView(view) {
  const main = $('#mainContent');
  VIEWS.forEach(v => main.classList.toggle(`view-${v}`, v === view));
}
const inView = (view) => $('#mainContent').classList.contains(`view-${view}`);
const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;

// Soft glint across every odds button, staggered by position on screen
let shimmerTimer = null;
function shimmerBets() {
  if (reduceMotion()) return;
  const main = $('#mainContent');
  const btns = [...main.querySelectorAll('#matchHeader .odd-btn, .markets-section .lg-panel.active .odd-btn, .markets-section .lg-panel.active .lg-zone')];
  if (!btns.length) return;
  const top = Math.min(...btns.map(b => b.getBoundingClientRect().top));
  btns.forEach(b => {
    const r = b.getBoundingClientRect();
    b.style.setProperty('--sd', `${Math.round((r.top - top) * 0.9 + r.left * 0.25)}ms`);
  });
  main.classList.remove('lg-shimmer'); void main.offsetWidth;
  main.classList.add('lg-shimmer');
  clearTimeout(shimmerTimer);
  shimmerTimer = setTimeout(() => main.classList.remove('lg-shimmer'), 2600);
}

function resetViews() {
  setView('idle');
  $('#resultOverlay').classList.remove('visible');
  Intro.reset();
  ShotClip.stop();
  clearTimeout(revealTimer);
  clearTimeout(outcomeSoundTimer);
  $('#ingameVideoWrap').classList.remove('frozen');
  Outcome.reset();
  ResultFx.stop();
  cancelResAmountAnimation();
}

function reprice() {
  state.priced = buildBook(shooter(), goalie(), state.params);
  // Re-price anything already on the slip; drop selections that became suspended
  state.bets = state.bets
    .map(b => ({ ...b, odds: oddsOf(b.market, b.selection), label: getBetLabel(b.market, b.selection) }))
    .filter(b => !isSuspended(b.market, b.selection));
}

const oddsOf = (m, s) => state.priced.book[m][s].odds;
const isSuspended = (m, s) => state.priced.book[m][s].suspended;

function newRandomMatchup() {
  state.shooterIdx = randInt(SHOOTERS.length);
  state.goalieIdx = randInt(GOALIES.length);
  loadMatch();
  animateStages(['shooter', 'goalie']);
  if (!state.autoplay.active) setTimeout(shimmerBets, 300);
}

function cycle(role, dir) {
  if (state.isPlaying) return;
  if (role === 'shooter') state.shooterIdx = (state.shooterIdx + dir + SHOOTERS.length) % SHOOTERS.length;
  else state.goalieIdx = (state.goalieIdx + dir + GOALIES.length) % GOALIES.length;
  loadMatch({ keepBets: true });
  animateStages([role]);
  Sfx.play('swap');
}

function animateStages(roles) {
  for (const role of roles) {
    const el = $(`#${role}Stage`);
    el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
  }
}

// ===== RENDER =====
function renderMatch() {
  const s = shooter(), g = goalie();
  const mh = $('#matchHeader');
  mh.style.setProperty('--shooter-accent', s.accent);
  mh.style.setProperty('--goalie-accent', g.accent);
  const chip = '<span class="lg-stage-chip" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg></span>';
  $('#shooterStage').innerHTML = playerHTML(s) + chip;
  $('#goalieStage').innerHTML = playerHTML(g) + chip;
  $('#shooterStage').setAttribute('aria-label', `Shooter: ${s.name}. Choose shooter`);
  $('#goalieStage').setAttribute('aria-label', `Goalie: ${g.name}. Choose goalie`);
  $('#shooterName').textContent = s.name;
  $('#goalieName').textContent = g.name;
  $('#shooterStat').innerHTML = `Shootout success <strong>${Math.round(s.F * 100)}%</strong>`;
  $('#goalieStat').innerHTML = `Penalty save <strong>${(g.PSP * 100).toFixed(1)}%</strong>`;
  $('#mrGoalLabel').textContent = `${lastName(s)} scores`;
  $('#mrSaveLabel').textContent = `${lastName(g)} saves`;
  ShotClip.prepare(s); // buffer the shooter's clip before Play
}

function renderOdds() {
  $$('[data-odds]').forEach(el => {
    const [m, s] = el.dataset.odds.split('.');
    const q = state.priced.book[m][s];
    const text = q.suspended ? '—' : q.odds.toFixed(2);
    if (el.textContent && el.textContent !== text && !reduceMotion()) {
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    }
    el.textContent = text;
    const btn = el.closest('[data-market]');
    if (btn) {
      btn.classList.toggle('suspended', q.suspended);
      btn.disabled = q.suspended;
    }
  });
  $('#helpRtp').textContent = `${+(state.params.rtp * 100).toFixed(2)}%`;
}

function buildComboGrid() {
  const heads = ['Top left', 'Top right', 'Bottom left', 'Bottom right', 'Five hole'];
  let html = '<span></span>' + heads.map(h => `<span class="lg-combo-head">${h.replace(' ', '<br>')}</span>`).join('');
  for (const s of SHOTS) {
    html += `<span class="lg-combo-row">${LABELS.shot[s]}</span>`;
    for (const a of AREAS) {
      html += `<button class="odd-btn" data-market="STL" data-selection="${s}${a}" aria-label="${LABELS.shot[s]} + ${LABELS.area[a]}"><span class="odd-value" data-odds="STL.${s}${a}"></span></button>`;
    }
  }
  $('#comboGrid').innerHTML = html;
}

function syncSelections() {
  $$('[data-market][data-selection]').forEach(btn => {
    const on = state.bets.some(b => b.market === btn.dataset.market && b.selection === btn.dataset.selection);
    btn.classList.toggle('selected', on);
    btn.setAttribute('aria-pressed', on);
  });
  // bet counts on tabs
  const counts = { score: 0, save: 0 };
  for (const b of state.bets) {
    if (SCORE_MARKETS.includes(b.market)) counts.score++;
    if (b.market === 'GST') counts.save++;
  }
  $$('.lg-tab').forEach(t => {
    const n = counts[t.dataset.tab];
    const label = t.dataset.tab === 'score' ? 'Score bets' : 'Save bets';
    const html = n ? `${label}<span class="lg-tab-count">${n}</span>` : label;
    if (t.innerHTML !== html) t.innerHTML = html;
  });
}

function setTab(tab) {
  if (state.tab !== tab) Sfx.play('tick');
  state.tab = tab;
  $$('.lg-tab').forEach(t => {
    const on = t.dataset.tab === tab;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  $$('.lg-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
}

// ===== PLAYER SELECTOR =====
function openSelector(role) {
  if (state.isPlaying) return;
  state.selectorRole = role;
  const list = role === 'shooter' ? SHOOTERS : GOALIES;
  const current = role === 'shooter' ? state.shooterIdx : state.goalieIdx;
  $('#playerSelectorTitle').textContent = role === 'shooter' ? 'Choose shooter' : 'Choose goalie';
  const grid = $('#playerSelectorGrid');
  grid.classList.toggle('goalies', role === 'goalie');
  grid.innerHTML = list.map((p, i) => `
    <button class="lg-pick ${i === current ? 'active' : ''}" data-index="${i}" style="--i:${i}">
      <span class="lg-pick-card" style="--accent:${p.accent};--hx:${p.head.x}%;--hy:${p.head.y}%">${imgTag(p, true)}<span class="lg-avatar-initials">${initialsOf(p)}</span></span>
      <span class="lg-pick-name">${p.name}</span>
      <span class="lg-pick-stat">${role === 'shooter' ? Math.round(p.F * 100) + '% success' : (p.PSP * 100).toFixed(1) + '% saves'}</span>
    </button>`).join('');
  grid.querySelectorAll('.lg-pick').forEach(btn => btn.addEventListener('click', () => pickPlayer(+btn.dataset.index)));
  const el = $('#playerSelector');
  el.style.top = `${$('#matchHeader').offsetTop + 8}px`;
  el.classList.add('visible');
  Sfx.play('tick');
}

function closeSelector() {
  $('#playerSelector').classList.remove('visible');
  state.selectorRole = null;
}

function pickPlayer(i) {
  const role = state.selectorRole;
  if (role === 'shooter') state.shooterIdx = i; else state.goalieIdx = i;
  closeSelector();
  loadMatch({ keepBets: true });
  animateStages([role]);
  Sfx.play('swap');
}

// ===== BETTING =====
function handleBetToggle(btn) {
  if (state.isPlaying) return;
  const market = btn.dataset.market, selection = btn.dataset.selection;
  if (isSuspended(market, selection)) return;
  const idx = state.bets.findIndex(b => b.market === market && b.selection === selection);

  if (idx > -1) {
    state.bets.splice(idx, 1);
    Sfx.play('deselect');
  } else {
    if (MULTI_MARKETS.includes(market)) {
      const n = SELECTIONS[market].length;
      if (state.bets.filter(b => b.market === market).length >= n - 1) return; // N-1 rule
    } else {
      state.bets = state.bets.filter(b => b.market !== market); // single pick
    }
    state.bets.push({ market, selection, odds: oddsOf(market, selection), label: getBetLabel(market, selection), description: MARKETS[market].name });
    Sfx.play('select');
  }
  syncSelections();
  updateBetslip();
}

function getBetLabel(m, sel) {
  switch (m) {
    case 'MR':  return sel === 'G' ? `${lastName(shooter())} scores` : `${lastName(goalie())} saves`;
    case 'SST': return LABELS.shot[sel];
    case 'SSL': return LABELS.area[sel];
    case 'GST': return LABELS.save[sel];
    case 'STL': return `${LABELS.shot[sel[0]]} + ${LABELS.area[sel.slice(1)]}`;
  }
  return sel;
}

function evaluateBets(outcome) {
  return state.bets.map(bet => {
    const win = selectionWins(bet.market, bet.selection, outcome);
    return { ...bet, win, payout: win ? bet.odds * state.stake : 0 };
  });
}

function describeOutcome(o, s, g, variant) {
  if (o.goal) return { cls: 'goal', who: s.name, what: 'Goal', head: 'Scores!', how: `${LABELS.shot[o.shot]}, ${LABELS.area[o.area].toLowerCase()}` };
  if (o.save === 'M') return { cls: 'save', who: s.name, what: 'Miss', head: variant === 'post' ? 'Off the iron!' : 'Misses!', how: variant === 'post' ? 'Rang off the post' : 'Shot missed the net' };
  return { cls: 'save', who: g.name, what: 'Save', head: 'Saves!', how: `${LABELS.save[o.save]} save` };
}

// ===== BETSLIP =====
function updateBetslip() {
  const count = state.bets.length;
  const totalStake = count * state.stake;
  const maxPay = state.bets.reduce((sum, b) => sum + b.odds * state.stake, 0);

  $('#betCount').textContent = `${count} BET${count !== 1 ? 'S' : ''}`;
  $('#betTotalStake').textContent = `$${+totalStake.toFixed(2)} TOTAL STAKE`;
  $('#betMaxPay').textContent = `$${maxPay.toFixed(2)}`;
  $('#stakeDisplay').textContent = `$${state.stake}`;
  $('#btnPlay').disabled = count === 0 || state.autoplay.active;
  $('#betslip').classList.toggle('visible', count > 0);
  $('#mainContent').classList.toggle('has-bets', count > 0);
  positionBetslip();

  $('#betslipBets').innerHTML = state.bets.map((bet, i) => `
    <div class="bet-item">
      <div class="bet-item-info">
        <span class="bet-item-market">${bet.description}</span>
        <span class="bet-item-selection">${bet.label}</span>
      </div>
      <div class="bet-item-right">
        <div>
          <div class="bet-item-odds">${bet.odds.toFixed(2)}</div>
          <div class="bet-item-pay">Pay: $${(bet.odds * state.stake).toFixed(2)}</div>
        </div>
        <button type="button" class="bet-item-remove" data-bet-index="${i}" aria-label="Remove bet">×</button>
      </div>
    </div>`).join('');

  $$('.bet-item-remove').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.bets.splice(+btn.dataset.betIndex, 1);
    Sfx.play('deselect');
    syncSelections();
    updateBetslip();
  }));
}

// ===== ROUND =====
function drawRoundOutcome() {
  if (FORCED) {
    const o = state.priced.outcomes.find(x => x.key === FORCED.toUpperCase());
    if (o) return o;
  }
  return drawOutcome(state.priced.outcomes);
}

// Takes the stake and draws the outcome. Returns the round, or null if it can't be played.
function startRound() {
  const cost = state.bets.length * state.stake;
  if (!state.bets.length || cost > state.balance) return null;
  state.isPlaying = true;
  state.balance -= cost;
  updateBalance();
  closeSelector();
  $('#stakePanel').classList.remove('open');

  const outcome = drawRoundOutcome();
  const results = evaluateBets(outcome);
  state.round = {
    id: `${1000000 + randInt(9000000)}`,
    outcome, results, cost, variant: null,
    payout: results.reduce((sum, r) => sum + r.payout, 0),
    shooter: shooter(), goalie: goalie(), stake: state.stake, credited: false,
  };
  return state.round;
}

function playGame() {
  if (state.isPlaying || state.autoplay.active) return;
  const round = startRound();
  if (!round) { shakePlay(); return; }
  $('#btnPlay').disabled = true;
  $('#btnPlay').textContent = 'PLAYING...';
  showInGame(round);
}

function shakePlay() {
  const b = $('#btnPlay');
  b.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 240 });
}

// ===== IN-GAME =====
let finishTimer = null, revealTimer = null, outcomeSoundTimer = null;
const REVEAL_HOLD = 3200;   // how long the outcome card stays up before the result screen

function showInGame(round) {
  const s = round.shooter, g = round.goalie;
  $('#ingameShooterMini').innerHTML = miniHTML(s, 'Shooter');
  $('#ingameGoalieMini').innerHTML = miniHTML(g, 'Goalie');
  const mb = $('#ingameMatchbar');
  mb.style.setProperty('--shooter-accent', s.accent);
  mb.style.setProperty('--goalie-accent', g.accent);
  $('#ingameRound').textContent = `#${round.id}`;

  $('#ingameMarkets').innerHTML = round.results.map((bet, i) => `
    <div class="res-bet-card igm-bet-card" data-i="${i}" style="--i:${i}">
      <div class="res-bet-info">
        <span class="res-bet-placed-label">Bet placed</span>
        <span class="res-bet-type">${bet.description}: ${bet.label}</span>
        <span class="res-bet-stake">Stake: $${round.stake.toFixed(2)}</span>
      </div>
      <div class="res-bet-outcome"><span class="res-bet-odds">${bet.odds.toFixed(2)}</span></div>
    </div>`).join('');

  closeSelector();
  $('#mainContent').classList.remove('has-bets');
  $('#mainContent').scrollTop = 0;
  setView('ingame');
  updateAutoChip();

  const wrap = $('#ingameVideoWrap');
  wrap.classList.remove('frozen');
  Outcome.reset();
  Outcome.prepare(s, g);

  // The intro plays over the start of the clip. When the clip ends (just
  // before the puck reaches the net) the frame freezes and the drawn outcome
  // is stamped over it. If the clip can't play, the same reveal runs over the
  // poster once the intro is done.
  let introDone = false, revealed = false, pending = false;
  const freezeAndReveal = () => {
    if (revealed || round !== state.round) return;
    revealed = true;
      ShotClip.stop();
    Sfx.play(round.outcome.shot === 'B' ? 'snap' : 'slap');
    void wrap.offsetWidth;
    wrap.classList.add('frozen');
    revealTimer = setTimeout(() => {
      revealOutcome(round);
      finishTimer = setTimeout(finishIngame, REVEAL_HOLD);
    }, reduceMotion() ? 0 : 380);
  };

  // The clip's commentary and arena sound carry the build-up
  ShotClip.play(s, {
    onEnd: freezeAndReveal,
    onFail: () => { if (introDone) freezeAndReveal(); else pending = true; },
  });

  // Timer-driven (not rAF) so a round still settles in a background tab
  Intro.play({
    shooterHTML: playerHTML(s, { hi: true, num: false }),
    goalieHTML: playerHTML(g, { hi: true, num: false }),
    shooterName: s.name, goalieName: g.name,
    shooterAccent: s.accent, goalieAccent: g.accent,
    onDone: () => { introDone = true; if (pending) freezeAndReveal(); },
  });
}

// Outcome sounds that used to come from the canvas scene
function playOutcomeSound(o, variant) {
  if (o.goal) {
    Sfx.play('net');
    setTimeout(() => Sfx.play('horn'), 140);
    Sfx.play('crowdCheer');
  } else {
    Sfx.play({ G: 'glove', B: 'pad', P: 'pad', S: 'stick', M: variant === 'post' ? 'post' : 'boards' }[o.save]);
    Sfx.play('crowdOoh');
  }
}

function revealOutcome(round, { silent = false } = {}) {
  if (round !== state.round || round.credited) return;
  // half of all misses ring off the iron (cosmetic only)
  round.variant = round.outcome.save === 'M' && Math.random() < 0.5 ? 'post' : null;
  const d = describeOutcome(round.outcome, round.shooter, round.goalie, round.variant);
  Outcome.show({ outcome: round.outcome, variant: round.variant, d, shooter: round.shooter, goalie: round.goalie });
  if (!silent) {
    // goals and misses wait for the puck to reach the net on the card
    const delay = round.outcome.goal || round.outcome.save === 'M' ? Outcome.IMPACT_MS : 250;
    outcomeSoundTimer = setTimeout(() => playOutcomeSound(round.outcome, round.variant), reduceMotion() ? 0 : delay);
  }

  round.results.forEach((r, i) => {
    const card = document.querySelector(`#ingameMarkets .igm-bet-card[data-i="${i}"]`);
    if (!card) return;
    card.classList.add(r.win ? 'igm-winning' : 'igm-losing');
    card.querySelector('.res-bet-placed-label').textContent = r.win ? `Winning · $${r.payout.toFixed(2)}` : 'No win';
  });
  creditPayout(round);
}

function creditPayout(round) {
  if (round.credited) return;
  round.credited = true;
  state.balance += round.payout;
  updateBalance(round.payout > 0);
}

function skipIngame() {
  clearTimeout(finishTimer);
  clearTimeout(revealTimer);
  Intro.reset();
  ShotClip.stop();
  finishIngame();
}

function finishIngame() {
  clearTimeout(finishTimer);
  if (!inView('ingame')) return;
  const round = state.round;
  clearTimeout(revealTimer);
  Intro.reset();
  ShotClip.stop();
  if (!round.credited) revealOutcome(round, { silent: true });
  showResult(round);
  saveToHistory(round);
  afterAutoplayRound(round);
}

function updateBalance(win = false) {
  const el = $('#balanceDisplay');
  el.textContent = money(state.balance);
  store.set(BALANCE_KEY, Math.round(state.balance * 100) / 100);
  if (win && !reduceMotion()) {
    el.animate([{ color: '#4ade80', transform: 'scale(1.12)' }, { color: '#ffffff', transform: 'scale(1)' }], { duration: 700, easing: 'ease-out' });
  }
}

// ===== RESULT =====
let resAmountAnimFrame = null;
function cancelResAmountAnimation() {
  if (resAmountAnimFrame != null) { cancelAnimationFrame(resAmountAnimFrame); resAmountAnimFrame = null; }
}

function animateResAmount(target, duration = 1400) {
  const el = $('#resAmount');
  cancelResAmountAnimation();
  if (target <= 0) { el.textContent = ''; return; }
  const start = performance.now();
  const ease = (t) => 1 - (1 - t) ** 3;
  const tick = (now) => {
    const p = Math.min((now - start) / duration, 1);
    el.textContent = money(target * ease(p));
    if (p < 1) resAmountAnimFrame = requestAnimationFrame(tick);
    else { el.textContent = money(target); resAmountAnimFrame = null; }
  };
  el.textContent = '$0.00';
  resAmountAnimFrame = requestAnimationFrame(tick);
}

function showResult(round) {
  const { outcome, results, payout } = round;
  setView('result');

  const won = payout > 0;
  const d = describeOutcome(outcome, round.shooter, round.goalie, round.variant);
  const heroIsShooter = outcome.goal || outcome.save === 'M';
  const hero = heroIsShooter ? round.shooter : round.goalie;

  const heroEl = $('#resHero');
  heroEl.classList.toggle('win', won);
  heroEl.classList.toggle('loss', !won);
  heroEl.classList.toggle('side-l', heroIsShooter);
  heroEl.classList.toggle('side-r', !heroIsShooter);
  heroEl.style.setProperty('--accent', hero.accent);
  $('#resHeroPlayer').innerHTML = playerHTML(hero, { hi: true });

  $('#resEyebrow').textContent = won ? 'CONGRATULATIONS!' : `${d.what.toUpperCase()} · ${lastName(hero).toUpperCase()}`;
  $('#resHeadline').textContent = won ? 'YOU WIN' : 'BETTER LUCK\nNEXT SHOT';
  $('#resHeadline').style.whiteSpace = won ? '' : 'pre-line';
  if (won) animateResAmount(payout); else { cancelResAmountAnimation(); $('#resAmount').textContent = ''; }

  // restart entrance animations
  const overlay = $('#resultOverlay');
  overlay.classList.remove('visible'); void overlay.offsetWidth;
  overlay.classList.add('visible');
  ResultFx.stop();
  if (won) {
    Sfx.play('win');
    if (!reduceMotion()) requestAnimationFrame(() => {
      const hr = heroEl.getBoundingClientRect(), or = overlay.getBoundingClientRect();
      const x = hr.left - or.left + hr.width * (heroIsShooter ? 0.68 : 0.32);
      ResultFx.burst({ x, y: hr.top - or.top + hr.height * 0.55, colors: [hero.accent, '#ffffff', '#22c55e', '#f5a623', '#80e8df'] });
    });
  } else {
    Sfx.play('lose');
  }

  $('#resShooterThumb').innerHTML = miniHTML(round.shooter, 'Shooter');
  $('#resGoalieThumb').innerHTML = miniHTML(round.goalie, 'Goalie');
  $('#resWho').textContent = d.who;
  $('#resWhat').textContent = d.what;
  $('#resWhat').className = `lg-res-what ${d.cls}`;
  $('#resHow').textContent = d.how;

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  $('#resBetslip').innerHTML = results.map((r, i) => `
    <div class="res-bet-card ${r.win ? 'win' : ''}" style="--i:${i}">
      <div class="res-bet-info">
        <span class="res-bet-placed-label">Bet placed</span>
        <span class="res-bet-type">${r.description}: ${r.label}</span>
        <span class="res-bet-stake">${dateStr}, ${timeStr} &nbsp;·&nbsp; Stake: $${round.stake.toFixed(2)}</span>
      </div>
      <div class="res-bet-outcome">
        <span class="res-bet-odds">${r.odds.toFixed(2)}</span>
        <span class="res-bet-result ${r.win ? 'won' : 'lost'}">${r.win ? 'Won: $' + r.payout.toFixed(2) : 'No Win'}</span>
      </div>
    </div>`).join('');
  $('#resBetslip').scrollTop = 0;
  updateAutoChip();
}

// ===== HISTORY (session) =====
function saveToHistory(round) {
  const now = new Date();
  const d = describeOutcome(round.outcome, round.shooter, round.goalie, round.variant);
  state.history.unshift({
    id: `RND${round.id}`,
    date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    shooterId: round.shooter.id, goalieId: round.goalie.id,
    shooter: round.shooter.name, goalie: round.goalie.name, outcome: d,
    bets: round.results.map(r => ({ description: r.description, label: r.label, odds: r.odds, win: r.win, payout: r.payout })),
    stake: round.stake, totalPayout: round.payout,
  });
  if (state.history.length > 50) state.history.pop();
  store.set(HISTORY_KEY, state.history);
}

function renderHistory() {
  const body = $('#historyBody');
  if (!state.history.length) {
    body.innerHTML = '<p class="history-empty">No bets yet. Play a shot and it will show up here.</p>';
    return;
  }
  const byId = (list, id) => list.find(p => p.id === id);
  body.innerHTML = state.history.map(e => {
    const hasWin = e.bets.some(b => b.win);
    const s = byId(SHOOTERS, e.shooterId), g = byId(GOALIES, e.goalieId);
    return `
      <div class="history-entry ${hasWin ? 'has-win' : 'all-lost'}">
        <div class="history-entry-header">
          <div class="history-teams">
            ${s ? `<span class="lg-hist-av">${avatarHTML(s)}</span>` : ''}
            <span class="history-team-abbr">${e.shooter.split(' ').slice(-1)}</span>
            <span class="lg-hist-outcome ${e.outcome.cls}">${e.outcome.what}</span>
            <span class="history-team-abbr">${e.goalie.split(' ').slice(-1)}</span>
            ${g ? `<span class="lg-hist-av">${avatarHTML(g)}</span>` : ''}
          </div>
          <div class="history-meta">
            <span class="history-datetime"><span class="history-date">${e.date}</span> <span class="history-time">${e.time}</span></span>
            <span class="history-bet-id">${e.id}</span>
          </div>
        </div>
        ${e.bets.map(b => `
          <div class="history-bet-row ${b.win ? 'win' : 'lost'}">
            <span class="history-bet-label">${b.description}: ${b.label}</span>
            <span class="history-bet-odds">${b.odds.toFixed(2)}</span>
            <span class="history-bet-result-badge ${b.win ? 'win' : 'lost'}">${b.win ? '+$' + b.payout.toFixed(2) : 'No Win'}</span>
          </div>`).join('')}
        <div class="history-entry-footer">
          <span class="history-stake">Stake: $${(e.stake * e.bets.length).toFixed(2)}</span>
          <span class="history-payout ${hasWin ? 'won' : ''}">${hasWin ? 'Return: $' + e.totalPayout.toFixed(2) : 'No Return'}</span>
        </div>
      </div>`;
  }).join('');
}

function openOverlay(id, focusId) {
  const el = $(id);
  el.removeAttribute('aria-hidden');
  el.classList.add('visible');
  if (focusId) $(focusId).focus();
  Sfx.play('tick');
}
function closeOverlay(id) {
  const el = $(id);
  el.setAttribute('aria-hidden', 'true');
  el.classList.remove('visible');
}

// ===== PRICING MODEL PANEL =====
function renderMaths() {
  const s = shooter(), g = goalie(), p = state.params;
  const { pGoal, book } = state.priced;
  const rows = Object.keys(SELECTIONS).map(m => {
    const head = `<tr class="mkt"><td colspan="4">${MARKETS[m].name} (${m})</td></tr>`;
    return head + SELECTIONS[m].map(sel => {
      const q = book[m][sel];
      const ret = q.suspended ? '—' : `${(q.p * q.odds * 100).toFixed(2)}%`;
      return `<tr><td>${getBetLabel(m, sel)}</td><td>${(q.p * 100).toFixed(3)}%</td>
        <td${q.suspended ? ' class="susp"' : ''}>${q.suspended ? (p.rtp / q.p).toFixed(3) + ' (off)' : q.odds.toFixed(2)}</td><td>${ret}</td></tr>`;
    }).join('');
  }).join('');

  $('#mathsBody').innerHTML = `
    <p class="lg-m-intro">Every price comes from one joint distribution over 15 outcomes (10 goals by shot type and target area, 5 no-goal by save type). The RNG draws from that same distribution, so every selection returns the RTP before odds are rounded down. <strong>Parameters are placeholders from Working Spec v0.04</strong> until the certified OddsGenerator maths is found.</p>
    <div class="lg-m-controls">
      <div class="lg-m-field">
        <label for="mRtp">RTP (%)</label>
        <input id="mRtp" type="number" step="0.01" min="50" max="99.9" value="${+(p.rtp * 100).toFixed(2)}">
        <small>Spec examples use 90%. GLI certified 91.95 to 92.01%.</small>
      </div>
      <div class="lg-m-field">
        <label for="mBase">League baseline (log5)</label>
        <input id="mBase" type="number" step="0.01" min="0.05" max="0.95" value="${p.baseline}">
        <small>0.50 matches the spec formula. About 0.31 corrects it.</small>
      </div>
    </div>
    <div>
      <div class="lg-m-title">${s.name} v ${g.name}</div>
      <p class="lg-m-sim">F = ${s.F}, PSP = ${g.PSP} (2 × ${g.CSP} − 1.09), P(Goal) = <strong>${(pGoal * 100).toFixed(2)}%</strong></p>
    </div>
    <table class="lg-mtable">
      <thead><tr><th>Selection</th><th>P(win)</th><th>Odds</th><th>Return</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <button class="lg-m-btn" id="mSim">Simulate 200,000 shots</button>
    <div class="lg-m-sim" id="mSimOut"></div>`;

  const apply = () => {
    const rtp = parseFloat($('#mRtp').value) / 100;
    const base = parseFloat($('#mBase').value);
    if (!(rtp > 0.5 && rtp < 1) || !(base > 0.04 && base < 0.96)) return;
    state.params = { ...state.params, rtp, baseline: base };
    reprice(); renderOdds(); syncSelections(); updateBetslip(); renderMaths();
  };
  $('#mRtp').addEventListener('change', apply);
  $('#mBase').addEventListener('change', apply);
  $('#mSim').addEventListener('click', runSimulation);
}

function runSimulation() {
  const N = 200000;
  const { outcomes, book, pGoal } = state.priced;
  let goals = 0;
  const mk = Object.keys(SELECTIONS);
  const ret = Object.fromEntries(mk.map(m => [m, 0])), stk = Object.fromEntries(mk.map(m => [m, 0]));
  for (let i = 0; i < N; i++) {
    const o = drawOutcome(outcomes);
    if (o.goal) goals++;
    for (const m of mk) for (const sel of SELECTIONS[m]) {
      const q = book[m][sel];
      if (q.suspended) continue;
      stk[m]++;
      if (selectionWins(m, sel, o)) ret[m] += q.odds;
    }
  }
  const tot = mk.reduce((a, m) => a + ret[m], 0) / mk.reduce((a, m) => a + stk[m], 0);
  $('#mSimOut').innerHTML = `Goals ${(goals / N * 100).toFixed(2)}% (model ${(pGoal * 100).toFixed(2)}%). Realised return backing every open selection at a flat stake: <strong>${(tot * 100).toFixed(2)}%</strong>.<br>` +
    mk.map(m => `${m} ${(ret[m] / stk[m] * 100).toFixed(2)}%`).join(', ');
}

// ===== AUTO PLAY =====
function autoBet() {
  state.bets = [];
  const markets = Object.keys(SELECTIONS).sort(() => Math.random() - 0.5).slice(0, 1 + randInt(3));
  for (const m of markets) {
    const open = SELECTIONS[m].filter(s => !isSuspended(m, s));
    if (!open.length) continue;
    const sel = open[randInt(open.length)];
    state.bets.push({ market: m, selection: sel, odds: oddsOf(m, sel), label: getBetLabel(m, sel), description: MARKETS[m].name });
  }
  syncSelections();
  updateBetslip();
}

function updateAutoplayDisplay() {
  const ap = state.autoplay;
  $('#autoplayStakeVal').textContent = state.stake;
  $('#autoplayTotalRisk').textContent = (state.stake * ap.rounds).toFixed(0);
  $$('.autoplay-round-btn').forEach(b => b.classList.toggle('active', +b.dataset.rounds === ap.rounds));
  $('#lossLimitInput').value = ap.lossLimit;
  $('#winLimit10x').classList.toggle('active', ap.winLimit === '10x');
  $('#winLimitNone').classList.toggle('active', ap.winLimit === 'none');
}

function activateAutoplay() {
  const ap = state.autoplay;
  Object.assign(ap, { active: true, roundsLeft: ap.rounds, net: 0 });
  $('#autoplayOverlay').classList.remove('visible');
  Sfx.play('select');
  runAutoplayRound();
}

function runAutoplayRound() {
  const ap = state.autoplay;
  clearTimeout(ap.timer);
  if (!ap.active || ap.roundsLeft <= 0) { stopAutoplay(); return; }
  if (state.isPlaying || $('#resultOverlay').classList.contains('visible')) loadMatch();
  autoBet();
  const round = startRound();
  if (!round) { stopAutoplay(); return; }
  $('#btnPlay').textContent = `AUTO ${ap.roundsLeft}`;

  if (!ap.skipResults) { showInGame(round); return; }

  // Skip to results: settle instantly, show the result screen only on the last round
  document.body.classList.add('simulating');
  ap.timer = setTimeout(() => {
    document.body.classList.remove('simulating');
    creditPayout(round);
    saveToHistory(round);
    if (afterAutoplayRound(round, { quiet: true })) {
      state.isPlaying = false;
      newRandomMatchup();
      ap.timer = setTimeout(runAutoplayRound, 250);
    } else {
      showResult(round);
    }
  }, 450);
}

// Books the round against the limits. Returns true if Auto Play continues.
function afterAutoplayRound(round, { quiet = false } = {}) {
  const ap = state.autoplay;
  if (!ap.active) return false;
  ap.net += round.payout - round.cost;
  ap.roundsLeft--;
  const hitWin = ap.winLimit === '10x' && round.payout >= state.stake * 10;
  const hitLoss = -ap.net >= ap.lossLimit;
  if (hitWin || hitLoss || ap.roundsLeft <= 0 || state.balance < state.stake) { stopAutoplay(); return false; }
  updateAutoChip();
  if (!quiet) ap.timer = setTimeout(nextAutoplayRound, AUTO_NEXT_DELAY);
  return true;
}

function nextAutoplayRound() {
  $('#resultOverlay').classList.remove('visible');
  ResultFx.stop();
  state.isPlaying = false;
  newRandomMatchup();
  state.autoplay.timer = setTimeout(runAutoplayRound, 350);
}

function stopAutoplay() {
  const ap = state.autoplay;
  clearTimeout(ap.timer);
  Object.assign(ap, { active: false, roundsLeft: 0 });
  document.body.classList.remove('simulating');
  $('#btnPlay').innerHTML = PLAY_BTN_HTML;
  updateBetslip();
  updateAutoChip();
}

function updateAutoChip() {
  const ap = state.autoplay;
  const chip = $('#autoChip');
  chip.classList.toggle('visible', ap.active);
  $('#autoChipLeft').textContent = ap.roundsLeft;
}

// ===== STAKE =====
function setStake(v) {
  const n = parseFloat(v);
  if (!isNaN(n) && n > 0 && n <= 10000) {
    state.stake = n; state.stakeInput = String(n);
    updateStakeDisplay(); updateBetslip();
  }
}
function updateStakeDisplay() {
  const d = state.stakeInput || '0';
  $('#stakeInputValue').textContent = `$${d}`;
  $$('.stake-preset').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.amount) === parseFloat(d)));
}
function handleNumpadKey(key) {
  Sfx.play('tick');
  if (key === 'confirm') {
    const n = parseFloat(state.stakeInput);
    if (!isNaN(n) && n > 0) setStake(n);
    $('#stakePanel').classList.remove('open');
    return;
  }
  if (key === 'backspace') { state.stakeInput = state.stakeInput.slice(0, -1); updateStakeDisplay(); return; }
  if (key === '.' && state.stakeInput.includes('.')) return;
  if (state.stakeInput.length >= 7) return;
  state.stakeInput += key;
  updateStakeDisplay();
}
function adjustStake(delta) { setStake(Math.max(1, (parseFloat(state.stakeInput) || 0) + delta)); Sfx.play('tick'); }

function positionBetslip() {
  if (isDesktop()) { $('#betslip').style.bottom = ''; return; } // docked in the bets column
  const offset = window.innerHeight - $('#mainContent').getBoundingClientRect().bottom;
  $('#betslip').style.bottom = offset > 4 ? `${Math.round(offset)}px` : '';
}

// ===== SOUND =====
function updateSoundButton() {
  const b = $('#btnSound');
  b.setAttribute('aria-pressed', Sfx.enabled);
  b.setAttribute('aria-label', Sfx.enabled ? 'Turn sound off' : 'Turn sound on');
}

// ===== EVENTS =====
function bindEvents() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#matchHeader [data-market][data-selection], .markets-section [data-market][data-selection]');
    if (btn) handleBetToggle(btn);
  });

  $$('.lg-arrow').forEach(b => b.addEventListener('click', () => cycle(b.dataset.role, +b.dataset.dir)));
  $('#shooterStage').addEventListener('click', (e) => { e.stopPropagation(); openSelector('shooter'); });
  $('#goalieStage').addEventListener('click', (e) => { e.stopPropagation(); openSelector('goalie'); });
  $('#playerSelectorClose').addEventListener('click', closeSelector);
  document.addEventListener('click', (e) => {
    const el = $('#playerSelector');
    if (el.classList.contains('visible') && !el.contains(e.target)) closeSelector();
  });
  $('#btnRandomize').addEventListener('click', () => { if (!state.isPlaying) { newRandomMatchup(); Sfx.play('swap'); } });
  $('#btnHome').addEventListener('click', () => { if (!state.isPlaying && !state.autoplay.active) { newRandomMatchup(); Sfx.play('swap'); } });
  $$('.lg-tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

  $('#betslipSummary').addEventListener('click', () => { $('#betslip').classList.toggle('expanded'); Sfx.play('tick'); });
  $('#btnPlay').addEventListener('click', playGame);
  $('#btnAuto').addEventListener('click', () => { if (!state.isPlaying) { updateAutoplayDisplay(); $('#autoplayOverlay').classList.add('visible'); Sfx.play('tick'); } });
  $('#btnStake').addEventListener('click', () => { state.stakeInput = String(state.stake); updateStakeDisplay(); $('#stakePanel').classList.add('open'); Sfx.play('tick'); });

  $('#autoplayClose').addEventListener('click', () => $('#autoplayOverlay').classList.remove('visible'));
  $('#autoplayOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('visible'); });
  $$('.autoplay-round-btn').forEach(b => b.addEventListener('click', () => { state.autoplay.rounds = +b.dataset.rounds; updateAutoplayDisplay(); Sfx.play('tick'); }));
  $('#lossLimitMinus').addEventListener('click', () => { state.autoplay.lossLimit = Math.max(1, state.autoplay.lossLimit - 1); updateAutoplayDisplay(); });
  $('#lossLimitPlus').addEventListener('click', () => { state.autoplay.lossLimit = Math.min(9999, state.autoplay.lossLimit + 1); updateAutoplayDisplay(); });
  $('#lossLimitInput').addEventListener('input', (e) => { const v = parseInt(e.target.value); if (v >= 1) state.autoplay.lossLimit = Math.min(9999, v); });
  $('#lossLimitInput').addEventListener('blur', updateAutoplayDisplay);
  $('#winLimit10x').addEventListener('click', () => { state.autoplay.winLimit = '10x'; updateAutoplayDisplay(); });
  $('#winLimitNone').addEventListener('click', () => { state.autoplay.winLimit = 'none'; updateAutoplayDisplay(); });
  $('#autoplaySkip').addEventListener('change', (e) => { state.autoplay.skipResults = e.target.checked; });
  $('#autoplayActivate').addEventListener('click', activateAutoplay);
  $('#autoChipStop').addEventListener('click', () => { stopAutoplay(); Sfx.play('deselect'); });

  $('#stakePanelClose').addEventListener('click', () => $('#stakePanel').classList.remove('open'));
  $('#stakeMinus').addEventListener('click', () => adjustStake(-1));
  $('#stakePlus').addEventListener('click', () => adjustStake(1));
  $$('.stake-preset').forEach(b => b.addEventListener('click', () => { setStake(parseFloat(b.dataset.amount)); Sfx.play('tick'); }));
  $$('.numpad-key').forEach(b => b.addEventListener('click', () => handleNumpadKey(b.dataset.key)));

  $('#btnSkipIngame').addEventListener('click', skipIngame);

  $('#btnHistory').addEventListener('click', () => { renderHistory(); openOverlay('#historyOverlay', '#btnHistoryClose'); });
  $('#btnHistoryClose').addEventListener('click', () => closeOverlay('#historyOverlay'));
  $('#historyOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeOverlay('#historyOverlay'); });

  $('#btnMaths').addEventListener('click', () => { renderMaths(); openOverlay('#mathsOverlay', '#btnMathsClose'); });
  $('#btnMathsClose').addEventListener('click', () => closeOverlay('#mathsOverlay'));
  $('#mathsOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeOverlay('#mathsOverlay'); });

  $('#btnHelp').addEventListener('click', () => { $('#helpOverlay').classList.add('visible'); Sfx.play('tick'); });
  $('#btnHelpClose').addEventListener('click', () => $('#helpOverlay').classList.remove('visible'));
  $('#helpOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('visible'); });

  $('#btnSound').addEventListener('click', () => {
    Sfx.setEnabled(!Sfx.enabled);
    ShotClip.syncSound();
    updateSoundButton();
    Sfx.play('select');
  });

  $('#btnNext').addEventListener('click', () => {
    if (state.autoplay.active) { clearTimeout(state.autoplay.timer); nextAutoplayRound(); return; }
    $('#resultOverlay').classList.remove('visible');
    ResultFx.stop();
    setTimeout(() => {
      $('#btnPlay').innerHTML = PLAY_BTN_HTML;
      newRandomMatchup();
    }, 250);
  });

  $('#btnRebet').addEventListener('click', () => {
    if (state.autoplay.active) stopAutoplay();
    $('#resultOverlay').classList.remove('visible');
    $('#btnPlay').innerHTML = PLAY_BTN_HTML;
    state.isPlaying = false;
    resetViews();
    syncSelections();
    updateBetslip();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeSelector(); closeOverlay('#historyOverlay'); closeOverlay('#mathsOverlay');
    $('#helpOverlay').classList.remove('visible');
    $('#autoplayOverlay').classList.remove('visible');
    $('#stakePanel').classList.remove('open');
  });
}
