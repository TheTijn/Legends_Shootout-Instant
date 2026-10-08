// ===== LEGENDS SHOOTOUT INSTANT — SHOT CLIPS =====
// One broadcast clip per shooter (assets/clips/<file>.mp4, built by
// scripts/encode-clips.sh). Every source clip is a goal, so each file is cut
// just before the deke/release: the footage never shows the puck crossing the
// line, and the drawn outcome is revealed afterwards by the canvas net cam.
// The clips show the goalie they were recorded against, not the picked one.
//
// ShotClip.prepare(shooter) · ShotClip.play(shooter, { onEnd, onFail }) · ShotClip.stop()

const ShotClip = (() => {
  const CLIP_PATH = 'assets/clips/';

  // Kit colours as they appear in each clip (sampled from the footage), so the
  // net cam that follows matches the video. Keyed by shooter file.
  const GK = {
    leafsBlue:   { jersey: '#1d3f8e', trim: '#ffffff', pads: '#f2f4f8', padTrim: '#1d3f8e', pants: '#1d3f8e', mask: '#eef1f6' },
    leafsWhite:  { jersey: '#f3f5f8', trim: '#1d3f8e', pads: '#f2f4f8', padTrim: '#1d3f8e', pants: '#1d3f8e', mask: '#1d3f8e' },
    hawksRed:    { jersey: '#c8102e', trim: '#151515', pads: '#f4f4f4', padTrim: '#c8102e', pants: '#151515', mask: '#f2f2f2' },
    hawksWhite:  { jersey: '#f4f4f4', trim: '#c8102e', pads: '#f4f4f4', padTrim: '#c8102e', pants: '#151515', mask: '#f2f2f2' },
    flyersWhite: { jersey: '#f4f1ec', trim: '#f26722', pads: '#f2f2f2', padTrim: '#f26722', pants: '#151515', mask: '#f26722' },
    oilersBlue:  { jersey: '#1c46a8', trim: '#f26722', pads: '#ea7a35', padTrim: '#1c46a8', pants: '#1c46a8', mask: '#f2f2f2' },
    sabresBlue:  { jersey: '#1f4aa8', trim: '#f2a900', pads: '#f4f6f8', padTrim: '#1f4aa8', pants: '#1f4aa8', mask: '#2a4fb8' },
    sabresWhite: { jersey: '#f4f6f8', trim: '#1f4aa8', pads: '#f4f6f8', padTrim: '#f2a900', pants: '#1f4aa8', mask: '#2a4fb8' },
    ducksBlack:  { jersey: '#1b1b1d', trim: '#f26722', pads: '#f2f2f2', padTrim: '#1b1b1d', pants: '#1b1b1d', mask: '#d9d9d9' },
    ducksWhite:  { jersey: '#f4f2ee', trim: '#f26722', pads: '#f2f2f2', padTrim: '#f26722', pants: '#1b1b1d', mask: '#e8e2cf' },
  };
  const SK = (jersey, trim, gloves = jersey, tape = trim) => ({ jersey, trim, gloves, tape });
  const KITS = {
    Ray_Bourque:      { goalie: GK.leafsBlue,   shooter: SK('#1a1a1a', '#fcb514') },
    Bobby_Clarke:     { goalie: GK.hawksRed,    shooter: SK('#f4f1ec', '#f26722', '#f26722') },
    Marcel_Dionne:    { goalie: GK.hawksRed,    shooter: SK('#4b2a7b', '#f4b400') },
    Ron_Francis:      { goalie: GK.flyersWhite, shooter: SK('#00543c', '#ffffff') },
    Brett_Hull:       { goalie: GK.oilersBlue,  shooter: SK('#1d4fa0', '#fcb514') },
    Nicklas_Lidstrom: { goalie: GK.flyersWhite, shooter: SK('#ce1126', '#ffffff') },
    Mark_Messier:     { goalie: GK.hawksWhite,  shooter: SK('#0038a8', '#ce1126') },
    Chris_Pronger:    { goalie: GK.sabresBlue,  shooter: SK('#006847', '#ffffff') },
    Mark_Recchi:      { goalie: GK.ducksBlack,  shooter: SK('#4b2a7b', '#f4b400') },
    Luc_Robitaille:   { goalie: GK.sabresWhite, shooter: SK('#151515', '#a2aaad') },
    Jeremy_Roenick:   { goalie: GK.flyersWhite, shooter: SK('#cf0a2c', '#151515') },
    Joe_Sakic:        { goalie: GK.ducksWhite,  shooter: SK('#6f263d', '#236192') },
    Denis_Savard:     { goalie: GK.oilersBlue,  shooter: SK('#c8102e', '#1d3f8e') },
    Teemu_Selanne:    { goalie: GK.leafsWhite,  shooter: SK('#0038a8', '#ce1126') },
    Mats_Sundin:      { goalie: GK.sabresWhite, shooter: SK('#00205b', '#ffffff') },
    Steve_Yzerman:    { goalie: GK.leafsBlue,   shooter: SK('#f4f4f4', '#ce1126', '#ce1126') },
  };
  const kitsFor = (shooter) => KITS[shooter.file] || null;
  const START_GUARD = 2500;   // no frames by then (blocked/slow) -> fall back to the canvas
  let video = null, timers = [], onVisible = null;

  const el = () => video || (video = document.getElementById('shotVideo'));
  const srcFor = (p) => `${CLIP_PATH}${p.file}.mp4`;

  function clearTimers() {
    timers.forEach(clearTimeout); timers = [];
    if (onVisible) { document.removeEventListener('visibilitychange', onVisible); onVisible = null; }
  }

  // Point the element at the shooter's clip so it is buffered before Play
  function prepare(shooter) {
    const v = el();
    if (!v) return;
    const src = srcFor(shooter);
    if (v.getAttribute('src') !== src) {
      v.setAttribute('src', src);
      v.setAttribute('poster', src.replace(/\.mp4$/, '.jpg'));
      v.load();
    }
    else if (v.paused && v.currentTime > 0) {
      try { v.currentTime = 0; } catch (e) { /* not seekable yet */ }
    }
  }

  function play(shooter, { onEnd, onFail }) {
    const v = el();
    stop();
    prepare(shooter);
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimers();
      v.onended = v.onerror = null;
      (ok ? onEnd : onFail)();
    };
    v.onended = () => finish(true);
    v.onerror = () => finish(false);
    // Browsers pause muted video in background tabs; pick up where it left off
    onVisible = () => { if (!document.hidden && !done && v.paused) v.play().catch(() => {}); };
    document.addEventListener('visibilitychange', onVisible);
    try { v.currentTime = 0; } catch (e) { /* not seekable yet */ }
    const p = v.play();
    if (p && p.catch) p.catch(() => finish(false));
    timers.push(setTimeout(() => { if (v.currentTime < 0.05) finish(false); }, START_GUARD));
    // If it stalls mid-way, cut to the net cam anyway
    timers.push(setTimeout(() => finish(true), ((v.duration || 4.3) + 3) * 1000));
  }

  function stop() {
    clearTimers();
    const v = el();
    if (!v) return;
    v.onended = v.onerror = null;
    if (!v.paused) v.pause();
  }

  return { prepare, play, stop, kitsFor };
})();
