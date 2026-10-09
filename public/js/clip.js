// ===== LEGENDS SHOOTOUT INSTANT — SHOT CLIPS =====
// One broadcast clip per shooter (assets/clips/<file>.mp4, built by
// scripts/encode-clips.sh). Every source clip is a goal, so each file is cut
// just before the deke/release: the footage never shows the puck crossing the
// line, and the drawn outcome is stamped over the frozen last frame.
// The clips show the goalie they were recorded against, not the picked one.
//
// ShotClip.prepare(shooter) · ShotClip.play(shooter, { onEnd, onFail }) · ShotClip.stop()

const ShotClip = (() => {
  const CLIP_PATH = 'assets/clips/';

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
    // If it stalls mid-way, reveal anyway
    timers.push(setTimeout(() => finish(true), ((v.duration || 4.3) + 3) * 1000));
  }

  function stop() {
    clearTimers();
    const v = el();
    if (!v) return;
    v.onended = v.onerror = null;
    if (!v.paused) v.pause();
  }

  return { prepare, play, stop };
})();
