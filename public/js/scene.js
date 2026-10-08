// ===== LEGENDS SHOOTOUT INSTANT — SHOT SCENE (NET CAM) =====
// Canvas render of the shot, driven entirely by the RNG outcome. It is shown
// as the "net cam" after the shooter's clip (quick mode) or on its own when a
// clip can't play. Virtual canvas: 640 x 360, camera behind the shooter.
//
// API: init(canvas) · drawIdle(goalie)
//      start({ outcome, shooter, goalie, onReveal, onDone, quick, kit, shooterKit })
//      skip() · stop()
// kit / shooterKit override the colours so the net cam matches the clip.
// onReveal(info) fires at impact; info.variant is 'post' when a miss rings
// off the iron, otherwise null.
//
// Rendering: a pre-rendered arena layer (crowd with depth-of-field, glass,
// boards, textured ice, markings, reflections) + per-frame net, goalie,
// shooter's gloves/stick, puck, particles and post effects (grain, vignette).

const ShotScene = (() => {
  const W = 640, H = 360;
  const GL = 236;                                   // goal line y
  const MOUTH = { x0: 248, x1: 392, y0: 156, y1: GL };
  const BACK = { x0: 266, x1: 374, y0: 178, y1: 224 };

  const TARGETS = {
    TL: { x: 266, y: 170 }, TR: { x: 374, y: 170 },
    BL: { x: 264, y: 224 }, BR: { x: 376, y: 224 },
    FH: { x: 320, y: 229 },
  };

  const DEFAULT_KIT = { jersey: '#123e7a', trim: '#ffffff', pads: '#f4f6f8', mask: '#f2f2f2' };

  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const BASE = reduceMotion ? { approach: 250, flight: 430, hold: 1200 } : { approach: 1500, flight: 430, hold: 1750 };
  const QUICK_APPROACH = reduceMotion ? 150 : 420;
  const T = { ...BASE };                            // per-play timings, set in start()
  const SLOWMO = { from: 0.5, to: 0.84, rate: reduceMotion ? 1 : 0.3 };

  let canvas, ctx, raf = null, play = null, watchdog = null, idleGoalie = null;
  let arenaLayer = null, grainTile = null, flakeSprite = null;
  const AL = { x: -80, y: -70, w: 800, h: 520, scale: 2.4 }; // arena layer bounds (virtual units)

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = t => Math.max(0, Math.min(1, t));
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOutBack = t => { const c1 = 1.6, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const rand = (a, b) => a + Math.random() * (b - a);

  // Seeded RNG so the arena looks the same every build
  function seeded(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = c => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

  function normKit(k = DEFAULT_KIT) {
    return {
      jersey: k.jersey, trim: k.trim,
      pads: k.pads || '#f4f6f8', padTrim: k.padTrim || k.trim,
      pants: k.pants || '#151b29', mask: k.mask || '#eef0f3',
    };
  }

  // ---------- init ----------
  function init(el) {
    canvas = el;
    ctx = canvas.getContext('2d');
    buildAssets();
    drawIdle();
    // Board ads use Barlow Condensed; rebuild once the web font is in
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { buildArena(); if (!play) drawIdle(idleGoalie); });
    }
  }

  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function buildAssets() {
    // film grain tile
    grainTile = makeCanvas(160, 160);
    const g = grainTile.getContext('2d');
    const img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // soft snow sprite
    flakeSprite = makeCanvas(16, 16);
    const f = flakeSprite.getContext('2d');
    const fg = f.createRadialGradient(8, 8, 0, 8, 8, 8);
    fg.addColorStop(0, 'rgba(255,255,255,1)'); fg.addColorStop(0.45, 'rgba(240,248,255,0.75)'); fg.addColorStop(1, 'rgba(230,242,255,0)');
    f.fillStyle = fg; f.fillRect(0, 0, 16, 16);
    buildArena();
  }

  // ---------- pre-rendered arena ----------
  function buildArena() {
    arenaLayer = makeCanvas(AL.w * AL.scale, AL.h * AL.scale);
    const c = arenaLayer.getContext('2d');
    const toLayer = (cc) => { cc.setTransform(AL.scale, 0, 0, AL.scale, -AL.x * AL.scale, -AL.y * AL.scale); };
    toLayer(c);

    // crowd on its own layer so it can be thrown out of focus
    const crowd = makeCanvas(arenaLayer.width, Math.round(200 * AL.scale));
    const cc = crowd.getContext('2d');
    toLayer(cc);
    drawStands(cc);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.filter = 'blur(3.4px)';
    c.drawImage(crowd, 0, 0);
    c.filter = 'none';
    c.restore();

    drawGlass(c);
    const boards = makeCanvas(arenaLayer.width, arenaLayer.height);
    const bc = boards.getContext('2d');
    toLayer(bc);
    drawBoards(bc);
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(boards, 0, 0); c.restore();

    drawIce(c);
    // boards mirrored in the ice, soft and fading
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    const yb = (137 - AL.y) * AL.scale;
    c.beginPath(); c.rect(0, yb, arenaLayer.width, 40 * AL.scale); c.clip();
    c.translate(0, yb * 2); c.scale(1, -1);
    c.globalAlpha = 0.2; c.filter = 'blur(3px)';
    c.drawImage(boards, 0, 0);
    c.restore();
    c.save(); toLayer(c);
    const fade = c.createLinearGradient(0, 137, 0, 178);
    fade.addColorStop(0, 'rgba(214,227,238,0)'); fade.addColorStop(1, 'rgba(226,236,244,0.85)');
    c.fillStyle = fade; c.fillRect(AL.x, 137, AL.w, 41);
    c.restore();
    toLayer(c);
    drawIceMarkings(c);
  }

  function drawStands(c) {
    const R = seeded(42);
    // stand structure
    const sg = c.createLinearGradient(0, AL.y, 0, 106);
    sg.addColorStop(0, '#05080f'); sg.addColorStop(0.5, '#0d1424'); sg.addColorStop(1, '#1a2336');
    c.fillStyle = sg; c.fillRect(AL.x, AL.y, AL.w, 106 - AL.y);
    const shirts = ['#1c3f8f', '#c8102e', '#f1f1f1', '#1b1b1b', '#f26722', '#2b47b0', '#6f263d', '#ffb81c', '#00543c', '#9aa4b1', '#e8e8e8', '#0b2d6b'];
    const skins = ['#f1c7a5', '#e0b08c', '#c98e66', '#9b6a4a', '#6f4a35'];
    const aisles = [-10, 168, 352, 536, 712];
    const rows = 15;
    for (let r = 0; r < rows; r++) {
      const k = r / (rows - 1);
      const y = lerp(-62, 100, k);
      const s = lerp(0.55, 1.35, k);
      // seat row band
      c.fillStyle = `rgba(30,40,60,${0.5 + k * 0.3})`;
      c.fillRect(AL.x, y + 2.5 * s, AL.w, 3 * s);
      c.fillStyle = 'rgba(70,85,110,0.35)';
      c.fillRect(AL.x, y + 2.5 * s, AL.w, 0.6 * s);
      for (let x = AL.x + R() * 6; x < AL.x + AL.w; x += (6.2 + R() * 3) * s) {
        if (aisles.some(a => Math.abs(x - a) < 7 * s)) continue;
        if (R() < 0.12) continue;                     // empty seat
        const shirt = shirts[Math.floor(R() * shirts.length)];
        const skin = skins[Math.floor(R() * skins.length)];
        const bob = (R() - 0.5) * 1.5 * s;
        // torso
        c.fillStyle = shade(shirt, -0.25);
        c.beginPath(); c.ellipse(x, y + bob + 1.6 * s, 3.1 * s, 2.6 * s, 0, Math.PI, 0); c.fill();
        c.fillStyle = shirt;
        c.beginPath(); c.ellipse(x - 0.4 * s, y + bob + 1.2 * s, 2.6 * s, 2.1 * s, 0, Math.PI, 0); c.fill();
        // head + hair
        c.fillStyle = skin;
        c.beginPath(); c.arc(x, y + bob - 2.4 * s, 1.55 * s, 0, 6.283); c.fill();
        c.fillStyle = R() < 0.3 ? shade(shirt, -0.1) : 'rgba(40,28,20,0.9)';
        c.beginPath(); c.arc(x, y + bob - 2.9 * s, 1.5 * s, Math.PI, 0); c.fill();
        // arms raised now and then
        if (R() < 0.06) {
          c.strokeStyle = shirt; c.lineWidth = 1.1 * s; c.lineCap = 'round';
          c.beginPath(); c.moveTo(x - 2 * s, y + bob); c.lineTo(x - 3.2 * s, y + bob - 6 * s); c.stroke();
        }
      }
    }
    // aisles with yellow step edges (as in the clips)
    for (const a of aisles) {
      c.fillStyle = 'rgba(60,62,70,0.9)';
      c.beginPath(); c.moveTo(a - 5, -70); c.lineTo(a + 5, -70); c.lineTo(a + 9, 106); c.lineTo(a - 9, 106); c.closePath(); c.fill();
      for (let r = 0; r < rows; r++) {
        const y = lerp(-62, 100, r / (rows - 1)) + 4;
        c.fillStyle = 'rgba(232,186,40,0.75)';
        c.fillRect(a - lerp(5, 9, r / rows), y, lerp(10, 18, r / rows), 1);
      }
    }
    // upper-deck darkness and overhead light haze
    const hz = c.createLinearGradient(0, AL.y, 0, 40);
    hz.addColorStop(0, 'rgba(2,4,8,0.85)'); hz.addColorStop(1, 'rgba(2,4,8,0)');
    c.fillStyle = hz; c.fillRect(AL.x, AL.y, AL.w, 110);
  }

  function drawGlass(c) {
    // glass panes over the crowd
    const gg = c.createLinearGradient(0, 26, 0, 106);
    gg.addColorStop(0, 'rgba(190,215,240,0.10)'); gg.addColorStop(1, 'rgba(190,215,240,0.18)');
    c.fillStyle = gg; c.fillRect(AL.x, 26, AL.w, 80);
    c.fillStyle = 'rgba(235,245,255,0.55)'; c.fillRect(AL.x, 26, AL.w, 0.8);
    // stanchions
    for (let x = -46; x < 720; x += 118) {
      c.fillStyle = 'rgba(20,28,40,0.55)'; c.fillRect(x + 1.4, 26, 0.9, 80);
      c.fillStyle = 'rgba(230,240,250,0.55)'; c.fillRect(x, 26, 1.4, 80);
    }
    // reflections
    c.save();
    c.beginPath(); c.rect(AL.x, 26, AL.w, 80); c.clip();
    for (const [x, w, a] of [[30, 26, 0.07], [70, 8, 0.05], [430, 34, 0.06], [482, 10, 0.05], [610, 20, 0.05]]) {
      c.fillStyle = `rgba(255,255,255,${a})`;
      c.beginPath(); c.moveTo(x, 26); c.lineTo(x + w, 26); c.lineTo(x + w - 40, 106); c.lineTo(x - 40, 106); c.closePath(); c.fill();
    }
    c.restore();
    // goal light housing on top of the glass
    c.fillStyle = '#20242c'; c.beginPath(); c.roundRect ? c.roundRect(311, 15, 18, 12, 3) : c.rect(311, 15, 18, 12); c.fill();
    c.fillStyle = '#4a0b14'; c.beginPath(); c.ellipse(320, 18, 7, 5, 0, Math.PI, 0); c.fill();
  }

  function drawBoards(c) {
    // top rail (blue cap, as in the clips)
    const rg = c.createLinearGradient(0, 105, 0, 111);
    rg.addColorStop(0, '#3c62c4'); rg.addColorStop(1, '#162f78');
    c.fillStyle = rg; c.fillRect(AL.x, 105, AL.w, 6);
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(AL.x, 105, AL.w, 0.7);
    // dasher ads
    const ads = [
      { w: 112, kind: 'slate' }, { w: 128, kind: 'legends' }, { w: 120, kind: 'alumni' }, { w: 128, kind: 'legends' },
      { w: 112, kind: 'slate' }, { w: 120, kind: 'alumni' }, { w: 128, kind: 'legends' }, { w: 112, kind: 'red' },
    ];
    let x = AL.x;
    let i = 0;
    while (x < AL.x + AL.w) {
      const ad = ads[i++ % ads.length];
      drawAd(c, x, 111, ad.w, 20, ad.kind);
      x += ad.w;
      c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(x - 0.6, 111, 0.6, 20);
    }
    // shading across the boards
    const sh = c.createLinearGradient(0, 111, 0, 131);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,10,30,0.12)');
    c.fillStyle = sh; c.fillRect(AL.x, 111, AL.w, 20);
    // kick plate
    const kg = c.createLinearGradient(0, 131, 0, 137);
    kg.addColorStop(0, '#e7bf3a'); kg.addColorStop(1, '#a8861d');
    c.fillStyle = kg; c.fillRect(AL.x, 131, AL.w, 6);
    // puck marks
    const R = seeded(7);
    for (let k = 0; k < 90; k++) {
      c.fillStyle = `rgba(20,20,20,${0.15 + R() * 0.35})`;
      c.beginPath(); c.ellipse(AL.x + R() * AL.w, 118 + R() * 18, 0.5 + R() * 1.6, 0.4 + R() * 0.8, R(), 0, 6.283); c.fill();
    }
  }

  function drawAd(c, x, y, w, h, kind) {
    const bg = { slate: '#2c3e57', legends: '#f7f7f5', alumni: '#f7f7f5', red: '#c8102e' }[kind];
    c.fillStyle = bg; c.fillRect(x, y, w, h);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (kind === 'legends' || kind === 'slate') {
      const col = kind === 'legends' ? '#c8102e' : '#ffffff';
      c.fillStyle = col;
      c.font = 'italic 800 6px "Barlow Condensed", sans-serif';
      c.fillText('LEGENDS', x + w / 2, y + 6.5);
      c.font = 'italic 900 9px "Barlow Condensed", sans-serif';
      c.fillText('SHOOT●UT', x + w / 2, y + 13.5);
    } else if (kind === 'alumni') {
      c.fillStyle = '#16181d';
      c.font = '800 10px "Barlow Condensed", sans-serif';
      c.fillText('THE ALUMNI', x + w / 2, y + h / 2 + 0.5);
    } else {
      c.fillStyle = '#ffffff';
      c.font = 'italic 900 9px "Barlow Condensed", sans-serif';
      c.fillText('NHL ALUMNI', x + w / 2, y + h / 2 + 0.5);
    }
  }

  function drawIce(c) {
    const g = c.createLinearGradient(0, 137, 0, 440);
    g.addColorStop(0, '#c4d4e2'); g.addColorStop(0.18, '#dfe9f2'); g.addColorStop(0.55, '#eef4f9'); g.addColorStop(1, '#f8fbfd');
    c.fillStyle = g; c.fillRect(AL.x, 137, AL.w, 440 - 137 + 80);
    const R = seeded(99);
    // fine grain
    for (let k = 0; k < 3200; k++) {
      const y = 137 + Math.pow(R(), 0.8) * 320;
      c.fillStyle = R() < 0.5 ? `rgba(120,150,185,${0.05 + R() * 0.06})` : `rgba(255,255,255,${0.25 + R() * 0.35})`;
      c.fillRect(AL.x + R() * AL.w, y, 0.4 + R() * 1.2, 0.3 + R() * 0.4);
    }
    // overhead light reflections
    for (const [x, y, rx, ry, a] of [[150, 176, 70, 7, 0.45], [490, 174, 70, 7, 0.45], [320, 166, 46, 5, 0.35], [80, 300, 120, 14, 0.3], [560, 300, 120, 14, 0.3]]) {
      const lg = c.createRadialGradient(x, y, 0, x, y, rx);
      lg.addColorStop(0, `rgba(255,255,255,${a})`); lg.addColorStop(1, 'rgba(255,255,255,0)');
      c.save(); c.translate(x, y); c.scale(1, ry / rx); c.translate(-x, -y);
      c.fillStyle = lg; c.beginPath(); c.arc(x, y, rx, 0, 6.283); c.fill();
      c.restore();
    }
    // snow build-up in the crease and the slot
    for (let k = 0; k < 140; k++) {
      const a = R() * Math.PI, rr = 30 + R() * 70;
      const x = 320 + Math.cos(a) * rr * 1.5 * (R() < 0.5 ? -1 : 1), y = GL + 4 + Math.sin(a) * rr * 0.35;
      c.fillStyle = `rgba(255,255,255,${0.12 + R() * 0.25})`;
      c.beginPath(); c.ellipse(x, y, 2 + R() * 7, 0.6 + R() * 1.6, (R() - 0.5) * 0.4, 0, 6.283); c.fill();
    }
    // skate cuts: long arcs + bright edges
    c.lineCap = 'round';
    for (let k = 0; k < 46; k++) {
      const x0 = 120 + R() * 400, y0 = 250 + R() * 190;
      const x1 = 260 + R() * 120, y1 = 236 + R() * 30;
      const cx = (x0 + x1) / 2 + (R() - 0.5) * 120, cy = (y0 + y1) / 2 + (R() - 0.5) * 30;
      c.strokeStyle = `rgba(140,168,198,${0.08 + R() * 0.12})`; c.lineWidth = 0.5 + R() * 0.7;
      c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(cx, cy, x1, y1); c.stroke();
      c.strokeStyle = `rgba(255,255,255,${0.25 + R() * 0.3})`; c.lineWidth = 0.4;
      c.beginPath(); c.moveTo(x0 + 0.6, y0 + 0.5); c.quadraticCurveTo(cx + 0.6, cy + 0.5, x1 + 0.6, y1 + 0.5); c.stroke();
    }
    // net shadow
    const ns = c.createRadialGradient(320, GL - 6, 10, 320, GL - 6, 90);
    ns.addColorStop(0, 'rgba(30,45,70,0.22)'); ns.addColorStop(1, 'rgba(30,45,70,0)');
    c.save(); c.translate(320, GL - 6); c.scale(1, 0.18); c.translate(-320, -(GL - 6));
    c.fillStyle = ns; c.beginPath(); c.arc(320, GL - 6, 90, 0, 6.283); c.fill(); c.restore();
  }

  function drawIceMarkings(c) {
    c.save();
    c.filter = 'blur(0.35px)';
    const red = 'rgba(206,28,52,0.82)', blue = 'rgba(33,94,190,0.75)';
    // goalie trapezoid behind the net
    c.strokeStyle = red; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(224, GL); c.lineTo(196, 137); c.moveTo(416, GL); c.lineTo(444, 137); c.stroke();
    // goal line
    c.fillStyle = red; c.fillRect(AL.x, GL - 1.2, AL.w, 2.6);
    // crease (NHL "D")
    const crease = () => { c.beginPath(); c.moveTo(226, GL); c.lineTo(226, GL + 15); c.bezierCurveTo(238, GL + 33, 402, GL + 33, 414, GL + 15); c.lineTo(414, GL); c.closePath(); };
    const cg = c.createLinearGradient(0, GL, 0, GL + 30);
    cg.addColorStop(0, 'rgba(70,146,228,0.78)'); cg.addColorStop(1, 'rgba(92,164,236,0.62)');
    c.fillStyle = cg; crease(); c.fill();
    c.strokeStyle = red; c.lineWidth = 1.6; crease(); c.stroke();
    // crease hash marks
    c.beginPath(); c.moveTo(250, GL + 21); c.lineTo(250, GL + 26); c.moveTo(390, GL + 21); c.lineTo(390, GL + 26); c.stroke();
    // faceoff circles, hash marks, dots
    c.strokeStyle = red; c.lineWidth = 2.2;
    for (const fx of [40, 600]) {
      c.beginPath(); c.ellipse(fx, 300, 150, 44, 0, 0, 6.283); c.stroke();
      c.fillStyle = red;
      c.beginPath(); c.ellipse(fx, 300, 9, 3.2, 0, 0, 6.283); c.fill();
      for (const hx of [-22, 22]) { c.fillRect(fx + hx - 1, 252, 2, 8); c.fillRect(fx + hx - 1, 340, 2, 10); }
      c.lineWidth = 1.4;
      for (const sx of [-1, 1]) {
        c.beginPath(); c.moveTo(fx + sx * 6, 292); c.lineTo(fx + sx * 6, 296); c.lineTo(fx + sx * 22, 296);
        c.moveTo(fx + sx * 6, 309); c.lineTo(fx + sx * 6, 304); c.lineTo(fx + sx * 22, 304); c.stroke();
      }
      c.lineWidth = 2.2;
    }
    c.filter = 'none';
    c.restore();
    // a light skim of ice over the paint
    const sk = c.createLinearGradient(0, 137, 0, 420);
    sk.addColorStop(0, 'rgba(225,236,245,0.12)'); sk.addColorStop(1, 'rgba(255,255,255,0.06)');
    c.fillStyle = sk; c.fillRect(AL.x, 137, AL.w, 300);
  }

  // ---------- canvas & camera ----------
  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || W, h = canvas.clientHeight || H;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    // uniform "cover" scale so a non-16:9 viewer crops instead of stretching
    const sc = Math.max(canvas.width / W, canvas.height / H);
    ctx.setTransform(sc, 0, 0, sc, (canvas.width - W * sc) / 2, (canvas.height - H * sc) / 2);
    ctx.imageSmoothingQuality = 'high';
  }

  function camera(z, cx, cy) {
    ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-cx, -cy);
  }

  // ---------- dynamic arena ----------
  function drawArena(t, goalLight, flashes) {
    ctx.drawImage(arenaLayer, AL.x, AL.y, AL.w, AL.h);

    // camera flashes in the stands after a goal
    for (const f of flashes) {
      const k = (t - f.t) / 150;
      if (k < 0 || k > 1) continue;
      const a = 1 - k;
      const rg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 12);
      rg.addColorStop(0, `rgba(255,255,255,${a})`); rg.addColorStop(0.25, `rgba(220,235,255,${a * 0.6})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg; ctx.fillRect(f.x - 12, f.y - 12, 24, 24);
    }

    // goal light
    if (goalLight > 0) {
      ctx.fillStyle = `rgba(255,70,70,${goalLight})`;
      ctx.beginPath(); ctx.ellipse(320, 18, 7, 5, 0, Math.PI, 0); ctx.fill();
      const rg = ctx.createRadialGradient(320, 18, 2, 320, 18, 150);
      rg.addColorStop(0, `rgba(255,50,50,${0.75 * goalLight})`); rg.addColorStop(0.35, `rgba(255,30,40,${0.25 * goalLight})`); rg.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = rg; ctx.fillRect(170, -130, 300, 300);
      ctx.save();
      ctx.beginPath(); ctx.rect(-80, -80, 800, 186); ctx.clip();
      ctx.translate(320, 18); ctx.rotate(t / 160);
      ctx.fillStyle = `rgba(255,60,60,${0.12 * goalLight})`;
      for (const a of [0, Math.PI]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 260, a - 0.16, a + 0.16); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }
  }

  // ---------- net ----------
  // ripple: { x, y, t } (ms since impact) bulges the mesh around the impact
  function meshPoint(x, y, ripple, depth) {
    if (!ripple) return [x, y];
    const dx = x - ripple.x, dy = y - ripple.y;
    const d2 = dx * dx + dy * dy;
    const k = ripple.t / 1000;
    const amp = 8 * Math.exp(-k * 3.4) * Math.cos(k * 17);
    const fall = Math.exp(-d2 / 1100) * (0.4 + depth * 0.6);
    const bx = 320, by = 200;
    return [x + (bx - x) * 0.05 * amp * fall + dx * 0.012 * amp * fall, y + (by - y) * 0.05 * amp * fall + dy * 0.012 * amp * fall];
  }

  // Diamond mesh over a quad (p00 top-left, p10 top-right, p01 bottom-left, p11 bottom-right)
  function meshQuad(p00, p10, p01, p11, cells, ripple, depth) {
    const at = (u, v) => {
      const x = lerp(lerp(p00[0], p10[0], u), lerp(p01[0], p11[0], u), v);
      const y = lerp(lerp(p00[1], p10[1], u), lerp(p01[1], p11[1], u), v);
      return meshPoint(x, y, ripple, depth);
    };
    const [nu, nv] = cells;
    ctx.beginPath();
    for (let i = -nv; i <= nu; i++) {
      for (const dir of [1, -1]) {
        let first = true;
        for (let s = 0; s <= 1.0001; s += 1 / Math.max(nv, 6)) {
          const v = s;
          const uu = dir > 0 ? (i + s * nv) / nu : (i + nv - s * nv) / nu;
          if (uu < -0.001 || uu > 1.001) { first = true; continue; }
          const [px, py] = at(clamp01(uu), v);
          if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
        }
      }
    }
  }

  function drawNetBack(ripple) {
    const tl = [MOUTH.x0, MOUTH.y0], tr = [MOUTH.x1, MOUTH.y0], bl = [MOUTH.x0, MOUTH.y1], br = [MOUTH.x1, MOUTH.y1];
    const btl = [BACK.x0, BACK.y0], btr = [BACK.x1, BACK.y0], bbl = [BACK.x0, BACK.y1], bbr = [BACK.x1, BACK.y1];

    // shadowed interior + white skirt along the base
    ctx.fillStyle = 'rgba(36,48,70,0.16)';
    ctx.beginPath(); ctx.moveTo(...tl); ctx.lineTo(...btl); ctx.lineTo(...btr); ctx.lineTo(...tr); ctx.lineTo(...br); ctx.lineTo(...bl); ctx.closePath(); ctx.fill();
    const skirt = ctx.createLinearGradient(0, BACK.y1 - 9, 0, BACK.y1);
    skirt.addColorStop(0, 'rgba(250,252,255,0.95)'); skirt.addColorStop(1, 'rgba(200,210,222,0.95)');
    ctx.fillStyle = skirt;
    ctx.beginPath();
    ctx.moveTo(MOUTH.x0 + 2, GL - 2); ctx.lineTo(BACK.x0, BACK.y1); ctx.lineTo(BACK.x1, BACK.y1); ctx.lineTo(MOUTH.x1 - 2, GL - 2);
    ctx.lineTo(MOUTH.x1 - 6, GL - 9); ctx.lineTo(BACK.x1 - 2, BACK.y1 - 8); ctx.lineTo(BACK.x0 + 2, BACK.y1 - 8); ctx.lineTo(MOUTH.x0 + 6, GL - 9);
    ctx.closePath(); ctx.fill();

    // base frame tube on the ice
    ctx.strokeStyle = '#8f0d22'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(MOUTH.x0, GL); ctx.bezierCurveTo(MOUTH.x0 + 4, GL - 8, BACK.x0 - 6, BACK.y1 + 2, BACK.x0, BACK.y1);
    ctx.lineTo(BACK.x1, BACK.y1); ctx.bezierCurveTo(BACK.x1 + 6, BACK.y1 + 2, MOUTH.x1 - 4, GL - 8, MOUTH.x1, GL); ctx.stroke();
    // back frame bars
    ctx.strokeStyle = 'rgba(160,20,40,0.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(...bbl); ctx.lineTo(...btl); ctx.lineTo(...btr); ctx.lineTo(...bbr); ctx.stroke();

    // mesh panels: cord shadow then cord
    const panels = [
      [btl, btr, bbl, bbr, [14, 6], 1],        // back
      [tl, tr, btl, btr, [18, 3], 0.6],         // top
      [tl, btl, bl, bbl, [3, 10], 0.5],         // left side
      [btr, tr, bbr, br, [3, 10], 0.5],         // right side
    ];
    for (const [a, b, c2, d, cells, depth] of panels) {
      ctx.strokeStyle = 'rgba(30,40,60,0.18)'; ctx.lineWidth = 1.1;
      ctx.save(); ctx.translate(0.5, 0.6); meshQuad(a, b, c2, d, cells, ripple, depth); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.78)'; ctx.lineWidth = 0.6;
      meshQuad(a, b, c2, d, cells, ripple, depth); ctx.stroke();
    }
    // impact pocket
    if (ripple && ripple.t < 1000) {
      const a = Math.max(0, 1 - ripple.t / 1000);
      const r = 12 + ripple.t / 70;
      const rg = ctx.createRadialGradient(ripple.x, ripple.y, 0, ripple.x, ripple.y, r);
      rg.addColorStop(0, `rgba(12,20,34,${0.3 * a})`); rg.addColorStop(1, 'rgba(12,20,34,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(ripple.x, ripple.y, r, r * 0.75, 0, 0, 6.283); ctx.fill();
    }
  }

  function tube(x1, y1, x2, y2, w) {
    const vertical = Math.abs(x2 - x1) < Math.abs(y2 - y1);
    const g = vertical ? ctx.createLinearGradient(x1 - w / 2, 0, x1 + w / 2, 0) : ctx.createLinearGradient(0, y1 - w / 2, 0, y1 + w / 2);
    g.addColorStop(0, '#6e0716'); g.addColorStop(0.3, '#d3162f'); g.addColorStop(0.45, '#ff6a7c'); g.addColorStop(0.55, '#e01934'); g.addColorStop(1, '#5c0512');
    ctx.strokeStyle = g; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function drawNetFront() {
    // crossbar first so the posts overlap the corners
    tube(MOUTH.x0, MOUTH.y0, MOUTH.x1, MOUTH.y0, 5.2);
    tube(MOUTH.x0, MOUTH.y0, MOUTH.x0, MOUTH.y1, 5.4);
    tube(MOUTH.x1, MOUTH.y0, MOUTH.x1, MOUTH.y1, 5.4);
    // specular glints
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(MOUTH.x0 - 1.4, MOUTH.y0 + 6, 0.9, 50);
    ctx.fillRect(MOUTH.x1 - 1.4, MOUTH.y0 + 6, 0.9, 50);
    ctx.fillRect(MOUTH.x0 + 8, MOUTH.y0 - 1.6, 110, 0.8);
    // pegs
    ctx.fillStyle = '#1a1d24';
    ctx.fillRect(MOUTH.x0 - 3, MOUTH.y1 - 1, 6, 2.5); ctx.fillRect(MOUTH.x1 - 3, MOUTH.y1 - 1, 6, 2.5);
  }

  // ---------- volume-shaded drawing helpers ----------
  const INK = 'rgba(8,12,22,0.38)';
  // Fill a path with a key-lit gradient, inner shadow and specular bloom, then ink it.
  function vol(build, color, bb, o = {}) {
    build();
    const g = ctx.createLinearGradient(bb.x, bb.y, bb.x + bb.w * 0.7, bb.y + bb.h);
    const dark = lum(color) < 0.25;
    g.addColorStop(0, shade(color, o.hi ?? (dark ? 0.22 : 0.16)));
    g.addColorStop(0.5, color);
    g.addColorStop(1, shade(color, o.lo ?? -0.32));
    ctx.fillStyle = g; ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.lineWidth = o.edge ?? Math.max(2, Math.min(bb.w, bb.h) * 0.32);
    ctx.strokeStyle = `rgba(0,0,0,${o.ao ?? 0.18})`; ctx.stroke();
    const r = Math.max(bb.w, bb.h);
    const hx = bb.x + bb.w * (o.sx ?? 0.32), hy = bb.y + bb.h * (o.sy ?? 0.2);
    const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.7);
    hg.addColorStop(0, `rgba(255,255,255,${o.spec ?? 0.26})`); hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg; ctx.fillRect(bb.x - 4, bb.y - 4, bb.w + 8, bb.h + 8);
    // cool rim light from the arena behind, on the right edge
    const rim = ctx.createLinearGradient(bb.x + bb.w * 0.75, 0, bb.x + bb.w, 0);
    rim.addColorStop(0, 'rgba(200,225,255,0)'); rim.addColorStop(1, `rgba(200,225,255,${o.rim ?? 0.22})`);
    ctx.fillStyle = rim; ctx.fillRect(bb.x, bb.y - 4, bb.w + 4, bb.h + 8);
    ctx.restore();
    build();
    ctx.strokeStyle = o.ink ?? INK; ctx.lineWidth = o.inkW ?? 0.75; ctx.stroke();
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // Tapered limb from (x1,y1) radius r1 to (x2,y2) radius r2
  function capsule(x1, y1, x2, y2, r1, r2) {
    const a = Math.atan2(y2 - y1, x2 - x1), n = a + Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(x1 + Math.cos(n) * r1, y1 + Math.sin(n) * r1);
    ctx.lineTo(x2 + Math.cos(n) * r2, y2 + Math.sin(n) * r2);
    ctx.arc(x2, y2, r2, n, n + Math.PI, true);
    ctx.lineTo(x1 - Math.cos(n) * r1, y1 - Math.sin(n) * r1);
    ctx.arc(x1, y1, r1, n + Math.PI, n, true);
    ctx.closePath();
  }
  const capBB = (x1, y1, x2, y2, r) => ({ x: Math.min(x1, x2) - r, y: Math.min(y1, y2) - r, w: Math.abs(x2 - x1) + r * 2, h: Math.abs(y2 - y1) + r * 2 });

  // ---------- goalie ----------
  function restPose(gx) {
    return { gx, butterfly: 0, spread: 0, lean: 0, glove: { x: gx + 37, y: 188 }, blocker: { x: gx - 36, y: 192 }, stickDx: 0, gloveClosed: 0 };
  }

  function reactionPose(outcome, target) {
    const p = restPose(320);
    if (outcome.goal) {
      switch (outcome.area) {
        case 'TL': p.gx = 330; p.lean = 0.12; p.glove = { x: 374, y: 166 }; break;   // bites the wrong way
        case 'TR': p.gx = 310; p.lean = -0.12; p.blocker = { x: 266, y: 170 }; break;
        case 'BL': p.gx = 334; p.butterfly = 1; p.lean = 0.08; p.glove = { x: 372, y: 200 }; break;
        case 'BR': p.gx = 306; p.butterfly = 1; p.lean = -0.08; p.blocker = { x: 268, y: 202 }; break;
        case 'FH': p.spread = 1; p.butterfly = 0.2; break;
      }
      return p;
    }
    switch (outcome.save) {
      case 'G': p.gx = 326; p.lean = 0.1; p.glove = { x: target.x, y: target.y }; p.gloveClosed = 1; break;
      case 'B': p.gx = 312; p.lean = -0.1; p.blocker = { x: target.x, y: target.y }; break;
      case 'P': p.gx = target.x < 320 ? 312 : 328; p.butterfly = 1; p.lean = target.x < 320 ? -0.05 : 0.05; break;
      case 'S': p.stickDx = target.x - 320; p.butterfly = 0.45; break;
      case 'M': p.gx = target.x < 320 ? 312 : 328; p.lean = target.x < 320 ? -0.06 : 0.06; break;
    }
    return p;
  }

  function mixPose(a, b, t) {
    return {
      gx: lerp(a.gx, b.gx, t), butterfly: lerp(a.butterfly, b.butterfly, clamp01(t)), spread: lerp(a.spread, b.spread, clamp01(t)),
      lean: lerp(a.lean, b.lean, t),
      glove: { x: lerp(a.glove.x, b.glove.x, t), y: lerp(a.glove.y, b.glove.y, t) },
      blocker: { x: lerp(a.blocker.x, b.blocker.x, t), y: lerp(a.blocker.y, b.blocker.y, t) },
      stickDx: lerp(a.stickDx, b.stickDx, t), gloveClosed: lerp(a.gloveClosed, b.gloveClosed, clamp01(t)),
    };
  }

  // One leg pad. Local space: x across the pad (+x = outer edge), y from the
  // top of the thigh rise (0) down to the toe (L). Rotates about the knee.
  function drawPad(kx, ky, angle, side, L, K) {
    ctx.save();
    ctx.translate(kx, ky); ctx.rotate(angle); ctx.scale(side, 1);
    const kT = L * 0.3, kB = L * 0.47;                       // knee stack band
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(-10, 5);
      ctx.quadraticCurveTo(-10, -1, -4, -1.5);
      ctx.lineTo(5, -1.5);
      ctx.quadraticCurveTo(11, -1, 11, 5);
      ctx.lineTo(11.4, kT);
      ctx.quadraticCurveTo(13.4, (kT + kB) / 2, 11.4, kB);
      ctx.lineTo(10.6, L - 6);
      ctx.quadraticCurveTo(10.4, L, 4, L);
      ctx.lineTo(-4.5, L);
      ctx.quadraticCurveTo(-10.4, L, -10.2, L - 6);
      ctx.lineTo(-11, kB);
      ctx.quadraticCurveTo(-12.6, (kT + kB) / 2, -11, kT);
      ctx.closePath();
    };
    vol(body, K.pads, { x: -12, y: -2, w: 25, h: L + 2 }, { ao: 0.2, spec: 0.34, edge: 7 });
    ctx.save(); body(); ctx.clip();
    // thigh rise slightly in shadow under the pants
    const tg = ctx.createLinearGradient(0, -2, 0, kT);
    tg.addColorStop(0, 'rgba(0,0,0,0.22)'); tg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = tg; ctx.fillRect(-13, -2, 26, kT + 2);
    // knee stack
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(-13, kT, 26, kB - kT);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(-11, kT + 1); ctx.quadraticCurveTo(0, kT - 1.5, 12, kT + 1); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(-11, kB); ctx.quadraticCurveTo(0, kB + 1.5, 12, kB); ctx.stroke();
    // graphic: band under the knee + block on the outer lower face
    ctx.fillStyle = K.padTrim;
    ctx.fillRect(-13, kB + 3, 26, 2.2);
    ctx.beginPath();
    ctx.moveTo(1.5, kB + 9); ctx.lineTo(12, kB + 6); ctx.lineTo(12, L * 0.86); ctx.lineTo(6, L * 0.9);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.moveTo(1.5, kB + 9); ctx.lineTo(12, kB + 6); ctx.lineTo(12, kB + 7.2); ctx.lineTo(1.5, kB + 10.2); ctx.closePath(); ctx.fill();
    // face rolls
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); for (const cx of [-5.2, -0.4]) { ctx.moveTo(cx, kB + 6); ctx.lineTo(cx, L - 4); } ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); for (const cx of [-4.5, 0.3]) { ctx.moveTo(cx, kB + 6); ctx.lineTo(cx, L - 4); } ctx.stroke();
    // outer roll
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(9.4, 6); ctx.lineTo(9.6, L - 6); ctx.stroke();
    ctx.restore();
    // skate toe + blade
    ctx.fillStyle = '#101216'; rr(-6.5, L - 1.5, 13, 4.2, 2); ctx.fill();
    ctx.fillStyle = 'rgba(210,220,232,0.9)'; ctx.fillRect(-7, L + 2.6, 14, 0.9);
    ctx.restore();
  }

  function drawGoalie(pose, kit, opts = {}) {
    const K = normKit(kit);
    const { gx, butterfly: bf, spread: sp, lean } = pose;
    const footY = GL + 3;
    const drop = bf * 20;
    const hipY = 195 + drop;                                 // top of the pants
    const sy = 156 + drop * 0.92;                            // shoulder line
    const rot = (x, y) => { const dx = x - gx, dy = y - (hipY + 8), c = Math.cos(lean), s = Math.sin(lean); return { x: gx + dx * c - dy * s, y: hipY + 8 + dx * s + dy * c }; };
    const lightJersey = lum(K.jersey) > 0.7;
    const accentOnJersey = lightJersey ? K.trim : '#ffffff';
    ctx.lineJoin = 'round';

    if (opts.shadow !== false) {
      const sw = 58 + bf * 18 + sp * 12;
      const sg = ctx.createRadialGradient(gx, footY, 4, gx, footY, sw);
      sg.addColorStop(0, 'rgba(12,22,42,0.45)'); sg.addColorStop(0.6, 'rgba(12,22,42,0.16)'); sg.addColorStop(1, 'rgba(12,22,42,0)');
      ctx.save(); ctx.translate(gx, footY); ctx.scale(1, 0.12); ctx.translate(-gx, -footY);
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(gx, footY, sw, 0, 6.283); ctx.fill(); ctx.restore();
    }

    // soft shadow cast back onto the net/ice behind
    if (opts.shadow !== false) {
      const cs = ctx.createRadialGradient(gx + 6, sy + 30, 6, gx + 6, sy + 30, 70);
      cs.addColorStop(0, 'rgba(20,30,50,0.16)'); cs.addColorStop(1, 'rgba(20,30,50,0)');
      ctx.fillStyle = cs; ctx.fillRect(gx - 70, sy - 40, 150, 140);
    }

    // stick shaft runs behind the blocker, in front of the body
    const heel = { x: gx - 16 + pose.stickDx, y: footY - 4 };
    const bh = pose.blocker;

    // pads: pivot at the top, toes swing out into the butterfly
    const L = 52 - bf * 6;
    for (const side of [-1, 1]) {
      const kx = gx + side * (11.5 + sp * 15 - bf * 3);
      const ky = lerp(footY - L - 1, footY - 16, bf);
      const ang = side * (0.06 + sp * 0.24 + bf * 1.22);
      drawPad(kx, ky, -ang, side, L, K);
    }

    // pants: puffy, with leg openings
    const pl = rot(gx - 29, hipY - 4), pr = rot(gx + 29, hipY - 4), plb = rot(gx - 26, hipY + 14), prb = rot(gx + 26, hipY + 14);
    const pm = rot(gx, hipY + 7), pmL = rot(gx - 5, hipY + 12), pmR = rot(gx + 5, hipY + 12);
    const pants = () => {
      ctx.beginPath();
      ctx.moveTo(pl.x, pl.y);
      ctx.lineTo(pr.x, pr.y);
      ctx.quadraticCurveTo(pr.x + 3, (pr.y + prb.y) / 2, prb.x, prb.y);
      ctx.quadraticCurveTo((prb.x + pmR.x) / 2, prb.y + 1, pmR.x, pmR.y);
      ctx.lineTo(pm.x, pm.y); ctx.lineTo(pmL.x, pmL.y);
      ctx.quadraticCurveTo((plb.x + pmL.x) / 2, plb.y + 1, plb.x, plb.y);
      ctx.quadraticCurveTo(pl.x - 3, (pl.y + plb.y) / 2, pl.x, pl.y);
      ctx.closePath();
    };
    vol(pants, K.pants, { x: gx - 30, y: hipY - 5, w: 60, h: 20 }, { ao: 0.28, spec: 0.2 });
    ctx.save(); pants(); ctx.clip();
    ctx.fillStyle = rgba(K.trim, lum(K.pants) < 0.3 ? 0.9 : 0.6);
    for (const sx of [-1, 1]) { const a = rot(gx + sx * 27, hipY), b = rot(gx + sx * 24, hipY + 14); ctx.beginPath(); ctx.moveTo(a.x - 1.2, a.y); ctx.lineTo(a.x + 1.2, a.y); ctx.lineTo(b.x + 1.2, b.y); ctx.lineTo(b.x - 1.2, b.y); ctx.closePath(); ctx.fill(); }
    ctx.restore();

    // torso: loose jersey over the chest protector
    const hemY = hipY + 3;
    const nk = rot(gx, sy - 2);
    const shL = rot(gx - 36, sy + 8), shR = rot(gx + 36, sy + 8);          // outer shoulder points
    const wl = rot(gx - 27, sy + 30), wr = rot(gx + 27, sy + 30);           // waist
    const hl = rot(gx - 31, hemY), hr = rot(gx + 31, hemY), hm = rot(gx, hemY + 3);
    const capL = rot(gx - 30, sy - 5), capR = rot(gx + 30, sy - 5);
    const torso = () => {
      ctx.beginPath();
      ctx.moveTo(nk.x, nk.y);
      ctx.bezierCurveTo(nk.x + 14, nk.y - 3, capR.x, capR.y - 2, capR.x + 3, capR.y + 1);
      ctx.quadraticCurveTo(shR.x + 1, shR.y - 8, shR.x, shR.y);
      ctx.bezierCurveTo(shR.x - 1, shR.y + 10, wr.x + 2, wr.y - 6, wr.x, wr.y);
      ctx.quadraticCurveTo(wr.x + 1, (wr.y + hr.y) / 2 + 2, hr.x, hr.y);
      ctx.quadraticCurveTo(hm.x, hm.y + 1, hl.x, hl.y);
      ctx.quadraticCurveTo(wl.x - 1, (wl.y + hl.y) / 2 + 2, wl.x, wl.y);
      ctx.bezierCurveTo(wl.x - 2, wl.y - 6, shL.x + 1, shL.y + 10, shL.x, shL.y);
      ctx.quadraticCurveTo(shL.x - 1, shL.y - 8, capL.x - 3, capL.y + 1);
      ctx.bezierCurveTo(capL.x, capL.y - 2, nk.x - 14, nk.y - 3, nk.x, nk.y);
      ctx.closePath();
    };
    vol(torso, K.jersey, { x: gx - 37, y: sy - 8, w: 74, h: hemY - sy + 10 }, { ao: 0.24, spec: 0.26, edge: 12 });
    ctx.save(); torso(); ctx.clip();
    // hem stripes
    const s1a = rot(gx - 36, hemY - 9), s1b = rot(gx + 36, hemY - 9);
    ctx.strokeStyle = K.trim; ctx.lineWidth = 3.6; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(s1a.x, s1a.y); ctx.quadraticCurveTo(nk.x, s1a.y + 2, s1b.x, s1b.y); ctx.stroke();
    const s2a = rot(gx - 36, hemY - 4.5), s2b = rot(gx + 36, hemY - 4.5);
    ctx.strokeStyle = lightJersey ? rgba(K.trim, 0.5) : 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(s2a.x, s2a.y); ctx.quadraticCurveTo(nk.x, s2a.y + 2, s2b.x, s2b.y); ctx.stroke();
    // chest protector contour + folds under the fabric
    ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.lineWidth = 1.4;
    const c1 = rot(gx - 22, sy + 14), c2 = rot(gx + 22, sy + 14), c3 = rot(gx, sy + 20);
    ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.quadraticCurveTo(c3.x, c3.y + 3, c2.x, c2.y); ctx.stroke();
    for (const [x0, x1] of [[-17, -11], [15, 9]]) {
      const f1 = rot(gx + x0, sy + 20), f2 = rot(gx + x1, hemY - 12);
      ctx.beginPath(); ctx.moveTo(f1.x, f1.y); ctx.quadraticCurveTo(f1.x + 3, (f1.y + f2.y) / 2, f2.x, f2.y); ctx.stroke();
    }
    ctx.restore();
    // crest
    const cr = rot(gx, sy + 24);
    ctx.fillStyle = accentOnJersey;
    ctx.beginPath(); ctx.arc(cr.x, cr.y, 7, 0, 6.283); ctx.fill();
    ctx.fillStyle = lightJersey ? '#ffffff' : K.jersey;
    ctx.beginPath(); ctx.arc(cr.x, cr.y, 5.6, 0, 6.283); ctx.fill();
    ctx.strokeStyle = accentOnJersey; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(cr.x, cr.y, 4.1, 0, 6.283); ctx.stroke();
    ctx.fillStyle = accentOnJersey;
    ctx.font = '900 2.6px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('THE', cr.x, cr.y - 1.2); ctx.fillText('ALUMNI', cr.x, cr.y + 1.4);

    // shoulder pad seams + occlusion under the caps
    ctx.save(); torso(); ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.14)'; ctx.lineWidth = 1.2;
    for (const sx of [-1, 1]) {
      const a = rot(gx + sx * 14, sy - 3), b2 = rot(gx + sx * 33, sy + 12), c = rot(gx + sx * 24, sy + 9);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b2.x, b2.y); ctx.stroke();
    }
    const ao = ctx.createLinearGradient(0, hemY - 6, 0, hemY + 3);
    ao.addColorStop(0, 'rgba(0,0,0,0)'); ao.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = ao; ctx.fillRect(gx - 40, hemY - 6, 80, 10);
    ctx.restore();

    // mask + neck guard
    const hd = rot(gx, sy - 13);
    ctx.save(); ctx.translate(hd.x, hd.y); ctx.rotate(lean);
    const shell = () => { ctx.beginPath(); ctx.moveTo(-10.8, 1); ctx.bezierCurveTo(-12, -14.5, 12, -14.5, 10.8, 1); ctx.bezierCurveTo(10.4, 8.5, 5.6, 13.4, 0, 14); ctx.bezierCurveTo(-5.6, 13.4, -10.4, 8.5, -10.8, 1); ctx.closePath(); };
    vol(shell, K.mask, { x: -11.5, y: -13, w: 23, h: 27 }, { spec: 0.5, ao: 0.18 });
    ctx.save(); shell(); ctx.clip();
    ctx.strokeStyle = lum(K.mask) > 0.7 ? K.jersey : K.trim; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, -3.5); ctx.stroke();
    ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(-10, -5); ctx.quadraticCurveTo(0, -10, 10, -5); ctx.stroke();
    ctx.restore();
    // face opening + chrome cage
    ctx.fillStyle = 'rgba(6,8,14,0.9)'; rr(-6.8, -3, 13.6, 12.5, 4.6); ctx.fill();
    ctx.strokeStyle = 'rgba(70,78,92,0.9)'; ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = -4.6; i <= 4.7; i += 2.3) { ctx.moveTo(i + 0.3, -2.8); ctx.lineTo(i * 0.82 + 0.3, 9.8); }
    for (const yy of [0.3, 3.6, 6.9]) { ctx.moveTo(-6.4, yy + 0.3); ctx.lineTo(6.4, yy + 0.3); }
    ctx.stroke();
    ctx.strokeStyle = '#e4e9f0'; ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let i = -4.6; i <= 4.7; i += 2.3) { ctx.moveTo(i, -3); ctx.lineTo(i * 0.82, 9.5); }
    for (const yy of [0.3, 3.6, 6.9]) { ctx.moveTo(-6.5, yy); ctx.lineTo(6.5, yy); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(230,236,242,0.95)';                                   // neck guard
    ctx.beginPath(); ctx.moveTo(-4.2, 12.6); ctx.lineTo(4.2, 12.6); ctx.quadraticCurveTo(3.6, 17, 0, 17.4); ctx.quadraticCurveTo(-3.6, 17, -4.2, 12.6); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 0.5; ctx.stroke();
    ctx.restore();

    // stick shaft
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0b0c0f'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(bh.x + 2, bh.y + 10); ctx.lineTo(heel.x - 1, heel.y - 20); ctx.stroke();
    ctx.strokeStyle = '#1b1d23'; ctx.lineWidth = 5.6;
    ctx.beginPath(); ctx.moveTo(heel.x - 1, heel.y - 20); ctx.lineTo(heel.x + 1, heel.y - 1); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(bh.x + 1, bh.y + 10); ctx.lineTo(heel.x - 2.5, heel.y - 19); ctx.stroke();

    // arms: bulky sleeves over arm pads, foreshortened toward camera
    const shB = rot(gx - 30, sy + 8), shG = rot(gx + 30, sy + 8);
    for (const [sh, hand, side] of [[shB, pose.blocker, -1], [shG, pose.glove, 1]]) {
      const el = { x: lerp(sh.x, hand.x, 0.42) + side * 8, y: lerp(sh.y, hand.y, 0.55) + 4 };
      ctx.save();
      if (!reduceMotion) ctx.filter = 'blur(2.5px)';
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 14; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sh.x - side * 3, sh.y + 4); ctx.lineTo(el.x - side * 4, el.y + 3); ctx.lineTo(hand.x - side * 4, hand.y + 4); ctx.stroke();
      ctx.restore();
      vol(() => capsule(sh.x, sh.y, el.x, el.y, 9.6, 8.6), K.jersey, capBB(sh.x, sh.y, el.x, el.y, 9.6), { ao: 0.24, spec: 0.22 });
      vol(() => capsule(el.x, el.y, hand.x, hand.y, 8.6, 6.4), shade(K.jersey, -0.05), capBB(el.x, el.y, hand.x, hand.y, 8.6), { ao: 0.24, spec: 0.2 });
      ctx.save(); capsule(el.x, el.y, hand.x, hand.y, 8.6, 6.4); ctx.clip();
      const ang = Math.atan2(hand.y - el.y, hand.x - el.x);
      ctx.translate(lerp(el.x, hand.x, 0.22), lerp(el.y, hand.y, 0.22)); ctx.rotate(ang);
      ctx.fillStyle = K.trim; ctx.fillRect(-1.6, -10, 3.4, 20);
      ctx.fillStyle = lightJersey ? rgba(K.trim, 0.45) : 'rgba(255,255,255,0.85)'; ctx.fillRect(2.6, -10, 1.3, 20);
      ctx.restore();
      // elbow bulge
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath(); ctx.ellipse(el.x, el.y + 2, 6, 3, 0, 0, Math.PI); ctx.fill();
    }

    // blocker (shooter's left)
    const b = pose.blocker;
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(-0.1 + lean * 0.5);
    vol(() => rr(5, -9, 7, 17, 3), shade(K.pads, -0.12), { x: 5, y: -9, w: 7, h: 17 }, { spec: 0.2 });      // hand/fingers behind
    const board = () => rr(-12, -16, 21, 30, 4);
    vol(board, K.pads, { x: -12, y: -16, w: 21, h: 30 }, { spec: 0.4, edge: 6 });
    ctx.save(); board(); ctx.clip();
    ctx.fillStyle = K.padTrim;
    ctx.beginPath(); ctx.moveTo(-12, -2); ctx.lineTo(9, -10); ctx.lineTo(9, -4); ctx.lineTo(-12, 4); ctx.closePath(); ctx.fill();
    ctx.fillRect(-12, 9, 21, 2.2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-11, -15, 2, 28);
    ctx.restore();
    ctx.restore();

    // catching glove (shooter's right): pocket toward the camera, closes on a save
    const gv = pose.glove, cl = pose.gloveClosed;
    ctx.save(); ctx.translate(gv.x, gv.y); ctx.rotate(0.15 + 0.35 * cl + lean * 0.4);
    const mitt = () => {
      ctx.beginPath();
      ctx.moveTo(-12, 11);
      ctx.bezierCurveTo(-17, 4, -17, -8, -9, -14 + cl * 3);
      ctx.bezierCurveTo(-3, -18 + cl * 4, 9, -18 + cl * 4, 14, -11 + cl * 3);
      ctx.bezierCurveTo(18, -4, 17, 7, 11, 12);
      ctx.bezierCurveTo(5, 16, -6, 16, -12, 11);
      ctx.closePath();
    };
    vol(mitt, K.pads, { x: -17, y: -18, w: 35, h: 33 }, { spec: 0.36, edge: 8 });
    ctx.save(); mitt(); ctx.clip();
    // palm/pocket
    const pg = ctx.createRadialGradient(2, 1, 1, 1, -1, 13);
    pg.addColorStop(0, '#b48d5c'); pg.addColorStop(0.65, '#8a663d'); pg.addColorStop(1, '#5e4227');
    ctx.fillStyle = pg;
    const sq = 1 - cl * 0.55;
    const pocket = () => { ctx.beginPath(); ctx.moveTo(-8, 6 * sq); ctx.bezierCurveTo(-11, -2 * sq, -6, -11 * sq, 2, -10 * sq); ctx.bezierCurveTo(10, -9 * sq, 12, 0, 9, 6 * sq); ctx.bezierCurveTo(5, 11 * sq, -4, 11 * sq, -8, 6 * sq); ctx.closePath(); };
    pocket(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,235,200,0.35)'; ctx.lineWidth = 0.5; ctx.setLineDash([1.2, 1.2]);
    ctx.save(); ctx.translate(0.5, 0.5); ctx.scale(0.92, 0.92); pocket(); ctx.stroke(); ctx.restore();
    ctx.setLineDash([]);
    // T-web at the top of the pocket
    ctx.fillStyle = shade(K.pads, -0.08);
    rr(-2.5, -17, 7, 9, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(90,64,36,0.6)'; ctx.lineWidth = 0.55;
    ctx.beginPath(); for (let j = -15; j <= -9; j += 2.4) { ctx.moveTo(-2, j); ctx.lineTo(4, j + 0.8); } ctx.stroke();
    // trim: thumb + cuff
    ctx.fillStyle = K.padTrim;
    ctx.beginPath(); ctx.moveTo(-17, -2); ctx.bezierCurveTo(-16, -9, -12, -13, -8, -14); ctx.lineTo(-6, -11); ctx.bezierCurveTo(-10, -9, -12, -5, -13, 0); ctx.closePath(); ctx.fill();
    ctx.fillRect(-16, 8, 30, 8);
    ctx.restore();
    if (cl > 0.5 && opts.caught) { ctx.fillStyle = '#050505'; ctx.beginPath(); ctx.ellipse(2, -2, 4.6, 2.6, 0.25, 0, 6.283); ctx.fill(); }
    ctx.restore();

    // paddle blade along the ice in front of the skates
    ctx.save(); ctx.translate(heel.x, heel.y);
    vol(() => rr(-2, -3.6, 38, 5.8, 2.4), '#1b1d23', { x: -2, y: -3.6, w: 38, h: 5.8 }, { spec: 0.22 });
    ctx.fillStyle = '#eef1f5'; rr(15, -2.7, 20, 3.9, 1.6); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.4;
    ctx.beginPath(); for (let i = 17; i < 34; i += 2.2) { ctx.moveTo(i, -2.5); ctx.lineTo(i + 0.8, 1.1); } ctx.stroke();
    ctx.restore();
  }

  // ---------- shooter's gloves & stick (out of focus, foreground) ----------
  function drawShooterFG(at, hand, alpha, lift, SK, viewBottom = H) {
    if (alpha <= 0) return;
    const side = hand === 'L' ? -1 : 1;
    const bx = at.x + side * 11, by = at.y + 3 - lift;
    const p0 = { x: bx + side * 150, y: H + 40 - lift * 2 }, p1 = { x: bx + side * 6, y: by };
    const pt = (t) => ({ x: lerp(p0.x, p1.x, t), y: lerp(p0.y, p1.y, t) });
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (!reduceMotion) ctx.filter = 'blur(0.9px)';
    // shadow on the ice
    ctx.strokeStyle = 'rgba(20,32,55,0.16)'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(p0.x - side * 10, p0.y + 14); ctx.lineTo(p1.x, p1.y + 7 + lift); ctx.stroke();
    // shaft
    ctx.strokeStyle = '#0d0e11'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    ctx.strokeStyle = SK.tape; ctx.lineWidth = 8; ctx.lineCap = 'butt';
    const t1 = pt(0.52), t2 = pt(0.6);
    ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(p0.x - 2, p0.y - 2); ctx.lineTo(p1.x - 1, p1.y - 2); ctx.stroke();
    // blade with tape
    ctx.save(); ctx.translate(bx, by); ctx.rotate(side * -0.12);
    vol(() => rr(-18, -5, 36, 11, 5), '#141518', { x: -18, y: -5, w: 36, h: 11 }, { spec: 0.15 });
    ctx.fillStyle = '#f2f2f2'; rr(-11, -3.6, 15, 8, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); for (let i = -10; i < 4; i += 2.4) { ctx.moveTo(i, -3.4); ctx.lineTo(i + 1, 4.2); } ctx.stroke();
    ctx.restore();
    // gloves with sleeves coming into frame
    // hands sit just inside the bottom of the frame, like a POV shot
    const tAt = (y) => Math.max(0.05, Math.min(0.9, (p0.y - y) / (p0.y - p1.y)));
    for (const [tt, s] of [[tAt(viewBottom + 6), 1.15], [tAt(viewBottom - 16), 0.92]]) {
      const g = pt(tt);
      const sleeveEnd = { x: g.x + side * 60 * s, y: g.y + 70 * s };
      vol(() => capsule(g.x + side * 6 * s, g.y + 6 * s, sleeveEnd.x, sleeveEnd.y, 11 * s, 16 * s), SK.jersey, capBB(g.x, g.y, sleeveEnd.x, sleeveEnd.y, 16 * s), { ao: 0.22, spec: 0.18 });
      ctx.save(); capsule(g.x + side * 6 * s, g.y + 6 * s, sleeveEnd.x, sleeveEnd.y, 11 * s, 16 * s); ctx.clip();
      const sa = Math.atan2(sleeveEnd.y - g.y, sleeveEnd.x - g.x);
      ctx.translate(lerp(g.x, sleeveEnd.x, 0.45), lerp(g.y, sleeveEnd.y, 0.45)); ctx.rotate(sa);
      ctx.fillStyle = SK.trim; ctx.fillRect(-3, -20 * s, 6 * s, 40 * s);
      ctx.restore();
      ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(ang);
      vol(() => rr(-13 * s, -9 * s, 26 * s, 18 * s, 6 * s), SK.gloves, { x: -13 * s, y: -9 * s, w: 26 * s, h: 18 * s }, { spec: 0.3, ao: 0.25 });
      ctx.fillStyle = SK.trim; rr(-13 * s, 3 * s, 26 * s, 3.4 * s, 1.5 * s); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); for (const fx of [-5, 0, 5]) { ctx.moveTo(fx * s, -8 * s); ctx.lineTo(fx * s, 2 * s); } ctx.stroke();
      ctx.restore();
    }
    ctx.filter = 'none';
    ctx.restore();
  }

  // ---------- puck ----------
  function drawPuck(x, y, groundY, r, vx = 0, vy = 0) {
    const h = Math.max(0, groundY - y);
    ctx.fillStyle = `rgba(16,26,46,${Math.max(0.06, 0.32 - Math.min(0.26, h / 260))})`;
    ctx.beginPath(); ctx.ellipse(x, groundY + r * 0.45, r * (1.15 + h / 180), r * 0.36, 0, 0, 6.283); ctx.fill();
    // motion blur: ghost copies back along the travel direction
    const sp = Math.hypot(vx, vy);
    const copies = sp > 0.5 && !reduceMotion ? 5 : 0;
    for (let i = copies; i >= 1; i--) {
      ctx.fillStyle = `rgba(10,10,12,${0.12 * (1 - i / (copies + 1))})`;
      ctx.beginPath(); ctx.ellipse(x - vx * i * 0.9, y - vy * i * 0.9, r, r * 0.6, 0, 0, 6.283); ctx.fill();
    }
    ctx.fillStyle = '#050505'; ctx.beginPath(); ctx.ellipse(x, y + r * 0.12, r, r * 0.62, 0, 0, 6.283); ctx.fill();
    const tg = ctx.createLinearGradient(x, y - r * 0.6, x, y + r * 0.3);
    tg.addColorStop(0, '#3a3a3e'); tg.addColorStop(1, '#141416');
    ctx.fillStyle = tg; ctx.beginPath(); ctx.ellipse(x, y - r * 0.1, r * 0.94, r * 0.48, 0, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = Math.max(0.4, r * 0.1);
    ctx.beginPath(); ctx.ellipse(x, y - r * 0.1, r * 0.94, r * 0.48, 0, Math.PI * 1.05, Math.PI * 1.75); ctx.stroke();
  }

  // ---------- particles ----------
  function emit(list, x, y, n, opts = {}) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const ang = (opts.ang ?? -Math.PI / 2) + rand(-1, 1) * (opts.spread ?? 1.1);
      const sp = rand(opts.vmin ?? 40, opts.vmax ?? 140);
      list.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0, max: rand(380, 820), r: rand(0.8, opts.rmax ?? 2.6), spark: !!opts.spark, g: opts.g ?? 260 });
    }
  }
  function stepParticles(list, dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life += dt; if (p.life > p.max) { list.splice(i, 1); continue; }
      p.vy += p.g * dt / 1000; p.vx *= 0.985;
      p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000;
    }
  }
  function drawParticles(list) {
    for (const p of list) {
      const a = 1 - p.life / p.max;
      if (p.spark) {
        ctx.strokeStyle = `rgba(255,214,120,${a})`; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); ctx.stroke();
      } else {
        ctx.globalAlpha = a * 0.95;
        ctx.drawImage(flakeSprite, p.x - p.r * 2, p.y - p.r * 2, p.r * 4, p.r * 4);
        ctx.globalAlpha = 1;
      }
    }
  }

  // ---------- reflections of net + goalie in the ice ----------
  function drawReflection(pose, kit) {
    for (const [y0, h, a] of [[GL + 2, 14, 0.12], [GL + 16, 16, 0.045]]) {
      ctx.save();
      ctx.beginPath(); ctx.rect(150, y0, 340, h); ctx.clip();
      ctx.translate(0, GL * 2 + 4); ctx.scale(1, -1);
      ctx.globalAlpha = a;
      drawGoalie(pose, kit, { shadow: false });
      drawNetFront();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- post effects ----------
  function drawGrade(slow, goalLight, real) {
    // stadium haze from the top, cool tone
    const hz = ctx.createLinearGradient(0, 0, 0, H * 0.5);
    hz.addColorStop(0, 'rgba(170,200,240,0.10)'); hz.addColorStop(1, 'rgba(170,200,240,0)');
    ctx.fillStyle = hz; ctx.fillRect(0, 0, W, H * 0.5);
    if (goalLight > 0) { ctx.fillStyle = `rgba(255,30,40,${0.06 * goalLight})`; ctx.fillRect(0, 0, W, H); }
    if (slow > 0) {
      ctx.fillStyle = `rgba(10,24,52,${0.12 * slow})`; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = `rgba(5,10,20,${0.85 * slow})`;
      ctx.fillRect(0, 0, W, 24 * slow); ctx.fillRect(0, H - 24 * slow, W, 24 * slow);
    }
    const vg = ctx.createRadialGradient(W / 2, H * 0.48, H * 0.3, W / 2, H * 0.5, W * 0.64);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(2,6,14,${0.5 + slow * 0.2})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    // film grain
    if (!reduceMotion) {
      ctx.save();
      ctx.globalAlpha = 0.05; ctx.globalCompositeOperation = 'overlay';
      const ox = -Math.floor((real * 0.37) % 160), oy = -Math.floor((real * 0.23) % 160);
      for (let x = ox; x < W; x += 160) for (let y = oy; y < H; y += 160) ctx.drawImage(grainTile, x, y);
      ctx.restore();
    }
  }

  // ---------- time warp (slow-mo before impact) ----------
  function sceneTime(real) {
    const s0 = T.approach + T.flight * SLOWMO.from, s1 = T.approach + T.flight * SLOWMO.to;
    const stretched = (s1 - s0) / SLOWMO.rate;
    if (real < s0) return real;
    if (real < s0 + stretched) return s0 + (real - s0) * SLOWMO.rate;
    return s1 + (real - s0 - stretched);
  }
  function slowmoAmount(real) {
    if (SLOWMO.rate === 1) return 0;
    const s0 = T.approach + T.flight * SLOWMO.from;
    const stretched = (T.flight * (SLOWMO.to - SLOWMO.from)) / SLOWMO.rate;
    const k = (real - s0) / stretched;
    if (k <= 0 || k >= 1.25) return 0;
    return k < 1 ? Math.min(1, k * 4) : 1 - (k - 1) * 4;
  }

  // ---------- frame ----------
  function frame(now) {
    if (!play) return;
    fit();
    const real = now - play.t0;
    const dt = Math.min(50, now - (play.last || now)); play.last = now;
    const t = sceneTime(real);
    const { outcome } = play;
    const tRelease = T.approach, tImpact = T.approach + T.flight, tEnd = tImpact + T.hold;
    const slow = slowmoAmount(real);
    fire(t, tRelease, tImpact);

    // puck
    let puck, groundY, r, inNet = false, fgA = 1, fgLift = 0, vx = 0, vy = 0;
    const releasePt = { x: play.releaseX, y: 288 };
    if (t < tRelease) {
      const k = easeInOut(clamp01(t / T.approach));
      puck = play.quick
        ? { x: lerp(releasePt.x - 34, releasePt.x, k), y: lerp(312, releasePt.y, k) }
        : { x: lerp(320, releasePt.x, k) + Math.sin(k * Math.PI * 3) * 26 * (1 - k * 0.6), y: lerp(396, releasePt.y, k) };
      groundY = puck.y; r = 9;
    } else if (t < tImpact) {
      const k = clamp01((t - tRelease) / T.flight);
      const ke = easeOut(k);
      const gy = lerp(releasePt.y, play.groundTarget, ke);
      const lift = (play.groundTarget - play.target.y) * ke;
      puck = { x: lerp(releasePt.x, play.target.x, ke), y: gy - lift };
      if (play.lastPuck) { vx = puck.x - play.lastPuck.x; vy = puck.y - play.lastPuck.y; }
      groundY = gy; r = lerp(9, 4.4, ke);
      fgA = 1 - k; fgLift = k * 30;
    } else {
      const k = clamp01((t - tImpact) / play.after.dur);
      const ke = easeOut(k);
      const a = play.after;
      puck = { x: lerp(play.target.x, a.x, ke), y: lerp(play.target.y, a.y, ke) - Math.sin(k * Math.PI) * (a.arc || 0) };
      groundY = lerp(play.groundTarget, a.ground, ke);
      r = lerp(4.4, a.r, ke); inNet = outcome.goal; fgA = 0;
      if (!play.revealed) { play.revealed = true; play.onReveal && play.onReveal({ variant: play.variant }); }
    }
    play.lastPuck = puck;

    // goalie pose (overshoot ease into the reaction)
    const rest = restPose(320 + Math.sin(t / 260) * 2.5 + (puck.x - 320) * 0.07);
    rest.glove.y += Math.sin(t / 190) * 1.2;
    const reactRaw = clamp01((t - tRelease - T.flight * (outcome.goal ? 0.55 : 0.12)) / (T.flight * 0.85));
    const pose = t < tRelease ? rest : mixPose(rest, play.pose, easeOutBack(reactRaw));
    if (play.pose.butterfly > 0.5 && reactRaw > 0.55 && !play.padSpray) {
      play.padSpray = true;
      emit(play.parts, pose.gx - 34, GL + 1, 12, { ang: Math.PI, spread: 0.45, vmin: 30, vmax: 100, g: 120 });
      emit(play.parts, pose.gx + 34, GL + 1, 12, { ang: 0, spread: 0.45, vmin: 30, vmax: 100, g: 120 });
    }

    const sinceImpact = t - tImpact;
    const goalLight = outcome.goal && sinceImpact >= 0 ? 0.65 + 0.35 * Math.sin(sinceImpact / 90) : 0;
    const ripple = outcome.goal && sinceImpact >= 0 ? { x: play.target.x, y: play.target.y, t: sinceImpact } : null;

    stepParticles(play.parts, dt * (slow ? SLOWMO.rate : 1));

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    const ck = easeInOut(clamp01(t / tImpact));
    let zoom = lerp(play.quick ? 1.52 : 1.2, 1.78, ck) + slow * 0.12;
    let cx = lerp(320, 320 + (play.target.x - 320) * 0.25, ck) + Math.sin(real / 700) * 1.2;
    let cy = lerp(play.quick ? 214 : 224, 196, ck) + Math.sin(real / 900) * 0.8;
    if (sinceImpact >= 0 && !reduceMotion) {
      const s = Math.max(0, 1 - sinceImpact / (outcome.goal ? 420 : 260)) * (outcome.goal ? 3.2 : 1.6);
      cx += (Math.random() - 0.5) * s; cy += (Math.random() - 0.5) * s;
    }
    camera(zoom, cx, cy);
    drawArena(real, goalLight, play.flashes);
    drawReflection(pose, play.kit);
    drawNetBack(ripple);
    if (inNet) drawPuck(puck.x, puck.y, groundY, r);
    drawNetFront();
    const caught = !outcome.goal && outcome.save === 'G' && t >= tImpact;
    drawGoalie(pose, play.kit, { caught });
    if (!inNet && !caught) drawPuck(puck.x, puck.y, groundY, r, vx, vy);
    drawShooterFG(t < tRelease ? puck : releasePt, play.hand, fgA, fgLift, play.shooterKit, cy + (H / 2) / zoom);
    drawParticles(play.parts);
    ctx.restore();

    if (outcome.goal && sinceImpact >= 0) {
      const f = Math.max(0, 0.32 - sinceImpact / 800);
      if (f > 0) { ctx.fillStyle = `rgba(255,255,255,${f})`; ctx.fillRect(0, 0, W, H); }
    }
    drawGrade(slow, goalLight, real);

    if (t >= tEnd) { finish(); return; }
    raf = requestAnimationFrame(frame);
  }

  // Sound + one-shot effects keyed to scene time
  function fire(t, tRelease, tImpact) {
    const ev = play.events, o = play.outcome;
    if (!ev.skate && t >= 40 && !play.quick) { ev.skate = true; Sfx.play('skate'); }
    if (!ev.skate2 && t >= 820 && T.approach > 900) { ev.skate2 = true; Sfx.play('skate'); }
    if (!ev.release && t >= tRelease) {
      ev.release = true;
      Sfx.play(play.shotType === 'B' ? 'snap' : 'slap');
      emit(play.parts, play.releaseX, 292, 22, { ang: -Math.PI / 2, spread: 1.3, vmin: 50, vmax: 170 });
    }
    if (!ev.impact && t >= tImpact) {
      ev.impact = true;
      const tg = play.target;
      if (o.goal) {
        Sfx.play('net');
        setTimeout(() => { if (play && play.outcome === o) Sfx.play('horn'); }, 140);
        Sfx.play('crowdCheer');
        emit(play.parts, tg.x, tg.y, 16, { spread: Math.PI, vmin: 20, vmax: 70, g: 90 });
        for (let i = 0; i < 26; i++) play.flashes.push({ x: rand(-60, 700), y: rand(-50, 100), t: performance.now() - play.t0 + rand(80, 1700) });
      } else {
        const snd = { G: 'glove', B: 'pad', P: 'pad', S: 'stick', M: play.variant === 'post' ? 'post' : 'boards' }[o.save];
        Sfx.play(snd);
        Sfx.play('crowdOoh');
        if (play.variant === 'post') emit(play.parts, tg.x, tg.y, 14, { spread: Math.PI, vmin: 60, vmax: 160, g: 160, spark: true });
        else if (o.save !== 'G') emit(play.parts, tg.x, tg.y, 10, { spread: Math.PI, vmin: 40, vmax: 120, g: 200, rmax: 1.8 });
      }
    }
  }

  function afterPath(outcome, target, variant) {
    if (outcome.goal) return { x: target.x + (320 - target.x) * 0.18, y: target.y - 4, ground: GL - 12, r: 4, dur: 520 };
    switch (outcome.save) {
      case 'G': return { x: target.x, y: target.y, ground: GL, r: 4, dur: 400 };
      case 'B': return { x: -40, y: 210, ground: GL + 20, r: 6, arc: 40, dur: 620 };
      case 'P': return { x: target.x < 320 ? 196 : 444, y: 344, ground: 344, r: 8.5, arc: 26, dur: 620 };
      case 'S': return { x: target.x < 320 ? -40 : 680, y: 268, ground: 268, r: 6, arc: 4, dur: 600 };
      case 'M':
        if (variant === 'post') return { x: target.x < 300 ? 196 : target.x > 340 ? 450 : 352, y: target.y < 160 ? 96 : 270, ground: target.y < 160 ? GL - 70 : 270, r: target.y < 160 ? 3 : 6.5, arc: 30, dur: 640 };
        return { x: target.x + (target.x - 320) * 1.3, y: target.y - 40, ground: GL - 60, r: 3.5, dur: 520 };
    }
  }

  function saveTarget(save) {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    switch (save) {
      case 'G': return pick([{ x: 362, y: 176 }, { x: 358, y: 190 }]);
      case 'B': return pick([{ x: 280, y: 180 }, { x: 284, y: 194 }]);
      case 'P': return pick([{ x: 292, y: 226 }, { x: 348, y: 226 }]);
      case 'S': return pick([{ x: 304, y: 234 }, { x: 336, y: 234 }]);
      case 'M': return pick([{ x: 408, y: 196 }, { x: 232, y: 202 }, { x: 322, y: 142 }]);
    }
  }

  // Half of all misses ring off the iron (post or crossbar)
  function postTarget() {
    return [{ x: MOUTH.x0, y: 196 }, { x: MOUTH.x1, y: 186 }, { x: 304, y: MOUTH.y0 }][Math.floor(Math.random() * 3)];
  }

  function shooterKitFor(shooter, override) {
    if (override) return { jersey: override.jersey, trim: override.trim, gloves: override.gloves || override.jersey, tape: override.tape || override.trim };
    return { jersey: shooter.accent, trim: '#ffffff', gloves: shade(shooter.accent, -0.3), tape: shooter.accent };
  }

  function start({ outcome, shooter, goalie, onReveal, onDone, quick = false, kit = null, shooterKit = null }) {
    stop();
    Object.assign(T, BASE, quick ? { approach: QUICK_APPROACH } : {});
    let variant = null, target;
    if (outcome.goal) target = TARGETS[outcome.area];
    else if (outcome.save === 'M' && Math.random() < 0.5) { variant = 'post'; target = postTarget(); }
    else target = saveTarget(outcome.save);
    play = {
      t0: performance.now(), last: 0, outcome, onReveal, onDone, revealed: false, quick,
      target, variant,
      hand: shooter.hand,
      shooterKit: shooterKitFor(shooter, shooterKit),
      shotType: outcome.shot || (Math.random() < 0.8 ? 'F' : 'B'),
      releaseX: 320 + (Math.random() - 0.5) * 60,
      kit: kit || goalie.kit || DEFAULT_KIT,
      parts: [], flashes: [], events: {},
    };
    play.groundTarget = Math.min(GL - 2, Math.max(target.y, GL - 6));
    play.pose = reactionPose(outcome, target);
    play.after = afterPath(outcome, target, variant);
    raf = requestAnimationFrame(frame);
    // rAF doesn't run in hidden tabs; make sure the round still settles
    const realLength = T.approach + T.flight + T.flight * (SLOWMO.to - SLOWMO.from) * (1 / SLOWMO.rate - 1) + T.hold;
    watchdog = setTimeout(() => { if (play) finish(); }, realLength + 1500);
  }

  function finish() {
    const p = play;
    clearTimeout(watchdog);
    cancelAnimationFrame(raf); raf = null;
    if (!p) return;
    if (!p.revealed) { p.revealed = true; p.onReveal && p.onReveal({ variant: p.variant }); }
    play = null;
    p.onDone && p.onDone();
  }

  function skip() { if (play) finish(); }
  function stop() { clearTimeout(watchdog); cancelAnimationFrame(raf); raf = null; play = null; }

  function drawIdle(goalie, kitOverride) {
    if (!ctx) return;
    idleGoalie = goalie || idleGoalie;
    goalie = idleGoalie;
    fit();
    ctx.clearRect(0, 0, W, H);
    const kit = kitOverride || (goalie && goalie.kit) || DEFAULT_KIT;
    const pose = restPose(320);
    ctx.save(); camera(1.2, 320, 214);
    drawArena(0, 0, []); drawReflection(pose, kit); drawNetBack(null);
    drawNetFront();
    drawGoalie(pose, kit);
    drawPuck(320, 300, 300, 9);
    ctx.restore();
    drawGrade(0, 0, 0);
  }

  return { init, start, skip, stop, drawIdle };
})();
