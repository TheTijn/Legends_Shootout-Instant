// ===== LEGENDS SHOOTOUT INSTANT — SHOT CLIPS =====
// Broadcast clips with commentary (assets/clips/<file>.mp4, built by
// scripts/encode-clips.sh from scripts/clips.txt). Each file is cut just before
// the deke/release and before the commentator calls the shot: the clip never
// gives the result away, and the drawn outcome is stamped over the frozen last
// frame. Clips play with sound when the sound toggle is on.
// Five shooters have their own clip; the others borrow the one whose kit looks
// closest (BORROW). The clips show the goalie they were recorded against, not
// the picked one.
//
// ShotClip.prepare(shooter) · ShotClip.play(shooter, { onEnd, onFail })
// ShotClip.stop() · ShotClip.syncSound()

const ShotClip = (() => {
  const CLIP_PATH = 'assets/clips/';

  const START_GUARD = 2500;   // no frames by then (blocked/slow) -> fall back to the canvas
  const VOLUME = 0.9;         // commentary level against the Sfx mix
  // Shooters without a clip of their own -> clip with the closest-looking kit
  const BORROW = {
    Teemu_Selanne: 'Mark_Messier',       // blue
    Ron_Francis: 'Mark_Messier',         // dark green, no close match
    Marcel_Dionne: 'Mark_Messier',       // purple/gold, no close match
    Nicklas_Lidstrom: 'Steve_Yzerman',   // Red Wings red
    Jeremy_Roenick: 'Steve_Yzerman',     // Blackhawks red
    Chris_Pronger: 'Bobby_Clarke',       // Flyers
    Ray_Bourque: 'Bobby_Clarke',         // white, black/gold trim
    Luc_Robitaille: 'Bobby_Clarke',      // white, black trim
    Joe_Sakic: 'Denis_Savard',           // burgundy, blue
    Mark_Recchi: 'Denis_Savard',         // red, navy
    Brett_Hull: 'Mats_Sundin',           // white, blue
  };
  let video = null, timers = [], onVisible = null;

  const el = () => video || (video = document.getElementById('shotVideo'));
  const srcFor = (p) => `${CLIP_PATH}${BORROW[p.file] || p.file}.mp4`;
  let voiced = false;   // a clip is playing (heard when sound is on)

  // Mute/unmute the playing clip to match the sound toggle
  function syncSound() {
    const v = el();
    if (v) v.muted = !(voiced && Sfx.enabled);
  }

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
    voiced = true;
    v.volume = VOLUME;
    syncSound();
    const p = v.play();
    if (p && p.catch) {
      p.catch((err) => {
        // Autoplay with sound refused (no recent gesture, e.g. iOS Auto Play): play it muted
        if (err && err.name === 'NotAllowedError' && !v.muted && !done) {
          v.muted = true;
          v.play().catch(() => finish(false));
        } else finish(false);
      });
    }
    timers.push(setTimeout(() => { if (v.currentTime < 0.05) finish(false); }, START_GUARD));
    // If it stalls mid-way, reveal anyway
    timers.push(setTimeout(() => finish(true), ((v.duration || 7.2) + 3) * 1000));
  }

  function stop() {
    clearTimers();
    const v = el();
    if (!v) return;
    v.onended = v.onerror = null;
    if (!v.paused) v.pause();
    voiced = false;
    v.muted = true;
  }

  return { prepare, play, stop, syncSound };
})();
