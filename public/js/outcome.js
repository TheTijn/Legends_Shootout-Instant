// ===== LEGENDS SHOOTOUT INSTANT — OUTCOME CARD =====
// Animated result card that sweeps over the viewer when the shooter's clip
// ends. Goal: the shooter + the net with the puck landing in the scored
// target area. Miss: the puck goes wide / rings off the iron. Save: the
// goalie with the save type. The deciding player is shown as their trading
// card (cardSrc() in data.js). Styles in scss/_lg-outcome.scss.
//
// Outcome.prepare(shooter, goalie) · Outcome.show({ outcome, variant, d, shooter, goalie })
// Outcome.reset()

const Outcome = (() => {
  // Net geometry (SVG user units, shooter's view): posts at x 36 / 284,
  // crossbar at y 36, goal line at y 198.
  const ZONES = {
    TL: { x: 52, y: 52, w: 78, h: 58, cx: 91, cy: 80 },
    TR: { x: 190, y: 52, w: 78, h: 58, cx: 229, cy: 80 },
    BL: { x: 52, y: 118, w: 74, h: 56, cx: 89, cy: 146 },
    BR: { x: 194, y: 118, w: 74, h: 56, cx: 231, cy: 146 },
    FH: { cx: 160, cy: 156 },
  };
  const MISS = {
    wide:  [{ x: 8, y: 118, tag: 'Wide' }, { x: 312, y: 106, tag: 'Wide' }, { x: 160, y: 10, tag: 'Over' }],
    post:  [{ x: 36, y: 112, tag: 'Post' }, { x: 284, y: 98, tag: 'Post' }, { x: 128, y: 36, tag: 'Crossbar' }],
  };

  const el = () => document.getElementById('shotOutcome');
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const cardImg = (p) =>
    `<img src="${cardSrc(p)}" srcset="${cardSrc(p)} 1x, ${cardSrc(p, true)} 2x" alt="${p.name}" decoding="async">`;
  const cardHTML = (p) => `<span class="lgo-card">${cardImg(p)}</span>`;

  // Fetch both cards while the clip plays so they don't pop in on the reveal
  function prepare(shooter, goalie) {
    for (const p of [shooter, goalie]) {
      const img = new Image();
      img.srcset = `${cardSrc(p)} 1x, ${cardSrc(p, true)} 2x`;
      img.src = cardSrc(p);
    }
  }

  function zoneShape(key) {
    if (key === 'FH') {
      return '<path class="lgo-zone" data-z="FH" d="M134 174 V146 a26 26 0 0 1 52 0 V174 Z"/>';
    }
    const z = ZONES[key];
    return `<rect class="lgo-zone" data-z="${key}" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="9"/>`;
  }

  function zoneLabel(key, text) {
    const z = ZONES[key];
    const y = key === 'FH' ? 168 : z.y + z.h - 8;
    return `<text class="lgo-zone-label" data-z="${key}" x="${z.cx}" y="${y}" text-anchor="middle">${text}</text>`;
  }

  // A hockey puck: vulcanised side band with knurling, top face with rim light
  function puckSVG() {
    let knurl = '';
    for (let x = -13; x <= 13; x += 2.6) knurl += `<line x1="${x}" y1="${1.5 + Math.abs(x) * 0.02}" x2="${x}" y2="${6.5 - Math.abs(x) * 0.05}"/>`;
    return `
      <g class="lgo-puck-body">
        <path d="M-15 0 V6.5 A15 6 0 0 0 15 6.5 V0 Z" fill="url(#lgoPuckSide)"/>
        <g stroke="rgba(255,255,255,0.10)" stroke-width="0.7">${knurl}</g>
        <ellipse cx="0" cy="0" rx="15" ry="6" fill="url(#lgoPuckTop)"/>
        <ellipse cx="0" cy="0" rx="8.5" ry="3.2" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="0.7"/>
        <path d="M-13.6 -2.4 A15 6 0 0 1 11 -4.1" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1" stroke-linecap="round"/>
        <path d="M-15 6.5 A15 6 0 0 0 15 6.5" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="0.6"/>
      </g>`;
  }

  function netSVG({ hitZone, puck, post }) {
    const labels = { TL: 'Top left', TR: 'Top right', BL: 'Bottom left', BR: 'Bottom right', FH: 'Five hole' };
    const sparks = post ? Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return `<line class="lgo-spark" style="--i:${i}" x1="${puck.x + Math.cos(a) * 6}" y1="${puck.y + Math.sin(a) * 6}" x2="${puck.x + Math.cos(a) * 16}" y2="${puck.y + Math.sin(a) * 16}"/>`;
    }).join('') : '';
    return `
    <svg class="lgo-net-svg" viewBox="0 0 320 240" aria-hidden="true">
      <defs>
        <pattern id="lgoMesh" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0 H9 M0 0 V9" stroke="rgba(255,255,255,0.62)" stroke-width="0.8" fill="none"/>
        </pattern>
        <pattern id="lgoMeshShade" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45) translate(0.8 0.8)">
          <path d="M0 0 H9 M0 0 V9" stroke="rgba(0,10,30,0.35)" stroke-width="0.8" fill="none"/>
        </pattern>
        <linearGradient id="lgoPostV" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#5e0614"/><stop offset="0.28" stop-color="#c8102e"/>
          <stop offset="0.42" stop-color="#ff7586"/><stop offset="0.52" stop-color="#e3183a"/><stop offset="1" stop-color="#4a0410"/>
        </linearGradient>
        <linearGradient id="lgoPostH" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#5e0614"/><stop offset="0.28" stop-color="#c8102e"/>
          <stop offset="0.42" stop-color="#ff7586"/><stop offset="0.52" stop-color="#e3183a"/><stop offset="1" stop-color="#4a0410"/>
        </linearGradient>
        <linearGradient id="lgoInside" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#0b1424" stop-opacity="0.85"/><stop offset="1" stop-color="#152238" stop-opacity="0.75"/>
        </linearGradient>
        <linearGradient id="lgoSkirt" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9c6d6"/>
        </linearGradient>
        <radialGradient id="lgoIce" cx="0.5" cy="0.2" r="0.8">
          <stop offset="0" stop-color="#f4f9fd"/><stop offset="1" stop-color="#bcd0e2"/>
        </radialGradient>
        <radialGradient id="lgoPuckTop" cx="0.38" cy="0.3" r="0.8">
          <stop offset="0" stop-color="#4a4a50"/><stop offset="0.55" stop-color="#1c1c20"/><stop offset="1" stop-color="#0a0a0c"/>
        </radialGradient>
        <linearGradient id="lgoPuckSide" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#050506"/><stop offset="0.35" stop-color="#26262b"/><stop offset="0.6" stop-color="#121214"/><stop offset="1" stop-color="#030304"/>
        </linearGradient>
        <radialGradient id="lgoHit" cx="0.5" cy="0.5" r="0.6">
          <stop offset="0" style="stop-color: var(--hit); stop-opacity: 0.95"/><stop offset="0.6" style="stop-color: var(--hit); stop-opacity: 0.45"/><stop offset="1" style="stop-color: var(--hit); stop-opacity: 0.25"/>
        </radialGradient>
        <linearGradient id="lgoTrail" x1="0" x2="0" y1="1" y2="0">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.85"/>
        </linearGradient>
        <filter id="lgoSoft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
      </defs>

      <!-- ice + crease -->
      <ellipse cx="160" cy="212" rx="166" ry="30" fill="url(#lgoIce)" opacity="0.85"/>
      <path d="M38 198 V208 C52 232 268 232 282 208 V198 Z" fill="#4b97e2" opacity="0.75"/>
      <path d="M38 198 V208 C52 232 268 232 282 208 V198" fill="none" stroke="#d8243c" stroke-width="2"/>
      <rect x="-10" y="196.8" width="340" height="2.6" fill="#d8243c"/>
      <ellipse cx="160" cy="200" rx="128" ry="7" fill="rgba(10,20,40,0.35)" filter="url(#lgoSoft)"/>

      <!-- inside of the net: back, top and side panels -->
      <path d="M42 42 L70 62 L250 62 L278 42 L278 198 L250 186 L70 186 L42 198 Z" fill="url(#lgoInside)"/>
      <rect x="70" y="62" width="180" height="124" fill="url(#lgoMeshShade)"/>
      <rect x="70" y="62" width="180" height="124" fill="url(#lgoMesh)"/>
      <path d="M42 42 L70 62 L70 186 L42 198 Z" fill="url(#lgoMesh)" opacity="0.8"/>
      <path d="M278 42 L250 62 L250 186 L278 198 Z" fill="url(#lgoMesh)" opacity="0.8"/>
      <path d="M42 42 L278 42 L250 62 L70 62 Z" fill="url(#lgoMesh)" opacity="0.7"/>
      <path d="M70 62 V186 H250 V62" fill="none" stroke="rgba(160,20,40,0.45)" stroke-width="1.4"/>
      <path d="M42 198 L70 186 L250 186 L278 198 L272 190 L246 179 L74 179 L48 190 Z" fill="url(#lgoSkirt)"/>
      <circle class="lgo-pocket" cx="${puck.x}" cy="${puck.y}" r="18" fill="rgba(4,8,18,0.55)" filter="url(#lgoSoft)"/>

      <!-- target areas (shooter's view) -->
      <g class="lgo-zones">
        ${['TL', 'TR', 'BL', 'BR', 'FH'].map(zoneShape).join('')}
        ${['TL', 'TR', 'BL', 'BR', 'FH'].map(k => zoneLabel(k, labels[k])).join('')}
      </g>

      <!-- impact ripple -->
      <g class="lgo-ripple" transform="translate(${puck.x} ${puck.y})">
        <circle r="10"/><circle r="10"/><circle r="10"/>
      </g>
      ${sparks}

      <!-- frame: crossbar then posts (tubes), post pegs -->
      <rect x="30" y="30" width="260" height="12" rx="6" fill="url(#lgoPostH)"/>
      <rect x="30" y="30" width="12" height="171" rx="6" fill="url(#lgoPostV)"/>
      <rect x="278" y="30" width="12" height="171" rx="6" fill="url(#lgoPostV)"/>
      <circle cx="36" cy="36" r="6" fill="url(#lgoPostH)"/>
      <circle cx="284" cy="36" r="6" fill="url(#lgoPostH)"/>
      <path d="M33 44 V190 M281 44 V190 M46 33 H274" stroke="rgba(255,255,255,0.75)" stroke-width="1.4" stroke-linecap="round"/>
      <rect x="29" y="196" width="14" height="5" rx="1.5" fill="#15181e"/>
      <rect x="277" y="196" width="14" height="5" rx="1.5" fill="#15181e"/>

      <!-- puck: trail + flight into the target -->
      <line class="lgo-trail" x1="160" y1="300" x2="${puck.x}" y2="${puck.y}" stroke="url(#lgoTrail)" stroke-width="7" stroke-linecap="round" pathLength="100"/>
      <g class="lgo-puck" style="--px:${puck.x}px; --py:${puck.y}px">${puckSVG()}</g>
    </svg>`;
  }

  function show({ outcome, variant, d, shooter, goalie }) {
    const root = el();
    const isGoal = outcome.goal, isMiss = !outcome.goal && outcome.save === 'M';
    const hero = isGoal || isMiss ? shooter : goalie;
    const word = isGoal ? 'Goal!' : isMiss ? (variant === 'post' ? 'Post!' : 'Miss!') : 'Save!';
    const tickerWord = isGoal ? 'GOAL' : isMiss ? 'MISS' : 'SAVE';
    const ticker = Array.from({ length: 12 }, () => `<span>${tickerWord}</span>`).join('<i>•</i>');

    let right = '';
    if (isGoal || isMiss) {
      let puck, hitZone = null, missTag = '';
      if (isGoal) { hitZone = outcome.area; puck = { x: ZONES[hitZone].cx, y: ZONES[hitZone].cy }; }
      else { const m = pick(variant === 'post' ? MISS.post : MISS.wide); puck = { x: m.x, y: m.y }; missTag = m.tag; }
      right = `<div class="lgo-net">${netSVG({ hitZone, puck, post: variant === 'post' })}
        ${missTag ? `<span class="lgo-net-tag">${missTag}</span>` : ''}</div>`;
      root.dataset.zone = hitZone || '';
    } else {
      right = `<div class="lgo-goalie">${cardHTML(goalie)}
        <span class="lgo-badge"><b>${d.how}</b></span></div>`;
      root.dataset.zone = '';
    }

    root.className = `lg-outcome ${isGoal ? 'is-goal' : isMiss ? 'is-miss' : 'is-save'}`;
    root.style.setProperty('--accent', hero.accent);
    root.setAttribute('aria-label', `${d.who}: ${word} ${d.how}`);
    root.innerHTML = `
      <div class="lgo-bg">
        <span class="lgo-panel a"></span><span class="lgo-panel b"></span>
        <span class="lgo-streaks"></span>
        <div class="lgo-ticker"><div>${ticker}</div><div>${ticker}</div></div>
      </div>
      ${isGoal || isMiss ? `<div class="lgo-player">${cardHTML(hero)}</div>` : ''}
      <div class="lgo-text">
        <span class="lgo-kicker">${d.who}</span>
        <span class="lgo-word">${word}</span>
        <span class="lgo-detail">${d.how}</span>
      </div>
      ${right}`;
    if (isGoal) root.querySelector(`.lgo-zone[data-z="${outcome.area}"]`)?.classList.add('hit');
    if (isGoal) root.querySelector(`.lgo-zone-label[data-z="${outcome.area}"]`)?.classList.add('hit');
    void root.offsetWidth;
    root.classList.add('play');
  }

  function reset() {
    const root = el();
    if (!root) return;
    root.className = 'lg-outcome';
    root.innerHTML = '';
  }

  // ms from show() until the puck reaches the net (for the impact sounds)
  const IMPACT_MS = 1150;

  return { prepare, show, reset, IMPACT_MS };
})();
