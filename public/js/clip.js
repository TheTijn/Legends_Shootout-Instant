// ===== LEGENDS SHOOTOUT INSTANT — SHOT CLIPS =====
// Broadcast clips with commentary (assets/clips/<file>.mp4, built by
// scripts/encode-clips.sh from scripts/clips.txt). Each file is cut just before
// the deke/release and before the commentator calls the shot: the clip never
// gives the result away, and the drawn outcome is stamped over the frozen last
// frame. Clips play with sound when the sound toggle is on.
// Five shooters have their own clip; the others borrow the one whose kit looks
// closest (BORROW). The clips show the goalie they were recorded against, not
// the picked one.
// Prototype of the real-result flow: each clip is tagged with the outcome its
// full source really shows (LIBRARY). When the round's drawn outcome matches
// one, that clip plays in full (<slug>-full.mp4) through the real finish; any
// other outcome plays the cut and the outcome card shows the drawn result.
// The outcome always comes from the RNG; the footage is picked to fit it.
//
// In Video results mode (the prototype default) it works the other way round:
// pick() chooses a clip and its real outcome settles the round.
//
// ShotClip.prepare(shooter) · ShotClip.pick() · ShotClip.match(shooter, key) · ShotClip.footageKeys(shooter)
// ShotClip.play(shooter, { clip, onEnd, onFail }) · ShotClip.stop() · ShotClip.syncSound()

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
  // What each full source really shows (pricing.js outcome keys, shooter's view).
  // Mirrors the last column of scripts/clips.txt. variant feeds the outcome card
  // (a miss that went wide must not be drawn ringing off the post).
  const LIBRARY = [
    { slug: 'Mark_Messier',  outcome: 'FTL' },
    { slug: 'Steve_Yzerman', outcome: 'BBR' },
    { slug: 'Bobby_Clarke',  outcome: 'NM', variant: 'wide' },
    { slug: 'Denis_Savard',  outcome: 'NP' },
    { slug: 'Mats_Sundin',   outcome: 'NP' },
  ];
  const FULL_LENGTH = 12;     // s, every full source; used until the metadata loads
  let video = null, timers = [], stallTimer = null, onVisible = null;

  const el = () => video || (video = document.getElementById('shotVideo'));
  const kitOf = (p) => BORROW[p.file] || p.file;
  const srcFor = (p) => `${CLIP_PATH}${kitOf(p)}.mp4`;
  const fullSrc = (clip) => `${CLIP_PATH}${clip.slug}-full.mp4`;

  // Video results: any clip at random, never the same one twice in a row
  let lastPick = null;
  function pick() {
    const pool = LIBRARY.length > 1 ? LIBRARY.filter(c => c !== lastPick) : LIBRARY;
    lastPick = pool[Math.floor(Math.random() * pool.length)];
    return lastPick;
  }

  // Footage of this outcome, preferring the shooter's own (or borrowed) kit
  function match(shooter, key) {
    const hits = LIBRARY.filter(c => c.outcome === key);
    if (!hits.length) return null;
    return hits.find(c => c.slug === kitOf(shooter)) || hits[Math.floor(Math.random() * hits.length)];
  }

  // Outcome keys with real footage: those in the shooter's kit, and all of them
  function footageKeys(shooter) {
    return {
      kit: LIBRARY.filter(c => c.slug === kitOf(shooter)).map(c => c.outcome),
      any: [...new Set(LIBRARY.map(c => c.outcome))],
    };
  }
  let voiced = false;   // a clip is playing (heard when sound is on)

  // Mute/unmute the playing clip to match the sound toggle
  function syncSound() {
    const v = el();
    if (v) v.muted = !(voiced && Sfx.enabled);
  }

  function clearTimers() {
    timers.forEach(clearTimeout); timers = [];
    clearTimeout(stallTimer); stallTimer = null;
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

  function play(shooter, { clip = null, onEnd, onFail }) {
    const v = el();
    stop();
    prepare(shooter);
    if (clip) {
      // Swap to the full clip (its poster is the same first frame)
      v.setAttribute('src', fullSrc(clip));
      v.load();
    }
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimers();
      v.onended = v.onerror = v.onloadedmetadata = null;
      (ok ? onEnd : onFail)();
    };
    v.onended = () => finish(true);
    v.onerror = () => finish(false);
    // If it stalls mid-way, reveal anyway: 3s after the clip should have ended.
    // Re-armed once the real duration is known (a new src starts without one).
    const armStall = () => {
      clearTimeout(stallTimer);
      const len = isFinite(v.duration) && v.duration > 0 ? v.duration : (clip ? FULL_LENGTH : 7.2);
      stallTimer = setTimeout(() => finish(true), (len - v.currentTime + 3) * 1000);
    };
    v.onloadedmetadata = () => { if (!done) armStall(); };
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
    armStall();
  }

  function stop() {
    clearTimers();
    const v = el();
    if (!v) return;
    v.onended = v.onerror = v.onloadedmetadata = null;
    if (!v.paused) v.pause();
    voiced = false;
    v.muted = true;
  }

  return { prepare, pick, match, footageKeys, play, stop, syncSound };
})();
