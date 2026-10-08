// ===== LEGENDS SHOOTOUT INSTANT — FACE-OFF INTRO =====
// Broadcast-style "shooter vs goalie" sting played over the shot canvas
// before each shot. Animation lives in scss/_lg-ingame.scss (.lg-intro);
// this file only sequences the classes, sounds and the hand-off.

const Intro = (() => {
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const TIMING = reduceMotion ? { handoff: 300, clear: 500 } : { handoff: 1250, clear: 1600 };
  let timers = [];

  const el = () => document.getElementById('intro');
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  function reset() {
    clearTimers();
    const root = el();
    if (root) root.classList.remove('play', 'out');
  }

  // opts: { shooterHTML, goalieHTML, shooterName, goalieName, shooterAccent, goalieAccent, onDone }
  function play(opts) {
    reset();
    const root = el();
    root.style.setProperty('--sa', opts.shooterAccent);
    root.style.setProperty('--ga', opts.goalieAccent);
    document.getElementById('introShooter').innerHTML = opts.shooterHTML;
    document.getElementById('introGoalie').innerHTML = opts.goalieHTML;
    document.getElementById('introShooterName').textContent = opts.shooterName;
    document.getElementById('introGoalieName').textContent = opts.goalieName;

    void root.offsetWidth; // restart CSS animations
    root.classList.add('play');
    Sfx.play('whoosh');
    if (!reduceMotion) later(() => Sfx.play('slam'), 360);

    later(() => {
      root.classList.add('out');
      opts.onDone && opts.onDone();
    }, TIMING.handoff);
    later(() => root.classList.remove('play', 'out'), TIMING.clear);
  }

  return { play, reset };
})();
