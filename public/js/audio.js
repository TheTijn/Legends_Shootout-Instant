// ===== LEGENDS SHOOTOUT INSTANT — SOUND =====
// Every effect is synthesised with Web Audio (no sound files to ship).
// The AudioContext is created/resumed on the first user gesture; the
// on/off preference is remembered per browser.

const Sfx = (() => {
  const STORE_KEY = 'legends_sound';
  let ctx = null, master = null, noiseBuf = null;
  let enabled = true;
  try { enabled = localStorage.getItem(STORE_KEY) !== 'off'; } catch (e) { /* storage blocked */ }

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  // ---------- building blocks ----------
  function env(g, t, a, peak, dcy, sustain = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + dcy);
  }

  function noise({ t = 0, dur = 0.3, type = 'bandpass', f = 1000, f2 = null, q = 1, peak = 0.4, a = 0.005, out = master }) {
    const now = ctx.currentTime + t;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, now);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, now + dur);
    const g = ctx.createGain(); env(g, now, a, peak, dur);
    src.connect(fl); fl.connect(g); g.connect(out);
    src.start(now, Math.random() * 1.5); src.stop(now + a + dur + 0.05);
  }

  function tone({ t = 0, f = 440, f2 = null, dur = 0.2, type = 'sine', peak = 0.3, a = 0.004, out = master, detune = 0 }) {
    const now = ctx.currentTime + t;
    const o = ctx.createOscillator(); o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(f, now);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + dur);
    const g = ctx.createGain(); env(g, now, a, peak, dur);
    o.connect(g); g.connect(out);
    o.start(now); o.stop(now + a + dur + 0.05);
  }

  // ---------- effects ----------
  const FX = {
    tick() { tone({ f: 1900, f2: 1500, dur: 0.035, type: 'triangle', peak: 0.12 }); },
    select() {
      tone({ f: 880, dur: 0.05, type: 'triangle', peak: 0.12 });
      tone({ t: 0.045, f: 1320, dur: 0.07, type: 'triangle', peak: 0.1 });
    },
    deselect() { tone({ f: 900, f2: 600, dur: 0.07, type: 'triangle', peak: 0.1 }); },
    swap() { noise({ dur: 0.18, type: 'bandpass', f: 600, f2: 2600, q: 0.8, peak: 0.12, a: 0.03 }); },
    whoosh() { noise({ dur: 0.38, type: 'bandpass', f: 300, f2: 3200, q: 0.7, peak: 0.22, a: 0.08 }); },
    slam() {
      tone({ f: 120, f2: 45, dur: 0.35, type: 'sine', peak: 0.55 });
      noise({ dur: 0.12, type: 'lowpass', f: 2200, peak: 0.25 });
      tone({ t: 0.01, f: 660, f2: 640, dur: 0.5, type: 'triangle', peak: 0.06 });
    },
    slap() {
      noise({ dur: 0.07, type: 'highpass', f: 1800, peak: 0.6, a: 0.001 });
      tone({ f: 160, f2: 60, dur: 0.12, type: 'sine', peak: 0.5, a: 0.001 });
      noise({ t: 0.02, dur: 0.25, type: 'bandpass', f: 1200, f2: 600, q: 1.2, peak: 0.12 });
    },
    snap() { // shorter, crisper wrist/backhand release
      noise({ dur: 0.05, type: 'highpass', f: 2600, peak: 0.45, a: 0.001 });
      tone({ f: 220, f2: 90, dur: 0.08, type: 'sine', peak: 0.3, a: 0.001 });
    },
    post() {
      noise({ dur: 0.04, type: 'highpass', f: 3000, peak: 0.4, a: 0.001 });
      [2380, 3710, 5130, 6950].forEach((f, i) => tone({ f, dur: 1.1 - i * 0.2, type: 'sine', peak: 0.2 / (i + 1), a: 0.001 }));
    },
    net() {
      noise({ dur: 0.35, type: 'lowpass', f: 2400, f2: 500, peak: 0.35, a: 0.004 });
      tone({ f: 90, f2: 50, dur: 0.2, type: 'sine', peak: 0.25, a: 0.002 });
    },
    glove() {
      tone({ f: 140, f2: 70, dur: 0.14, type: 'sine', peak: 0.55, a: 0.001 });
      noise({ dur: 0.08, type: 'bandpass', f: 900, q: 1.5, peak: 0.35, a: 0.001 });
    },
    pad() {
      tone({ f: 95, f2: 55, dur: 0.2, type: 'sine', peak: 0.6, a: 0.001 });
      noise({ dur: 0.14, type: 'lowpass', f: 700, peak: 0.4, a: 0.001 });
    },
    stick() {
      noise({ dur: 0.05, type: 'bandpass', f: 1600, q: 3, peak: 0.45, a: 0.001 });
      tone({ f: 420, f2: 260, dur: 0.09, type: 'triangle', peak: 0.18, a: 0.001 });
    },
    boards() {
      tone({ f: 70, f2: 45, dur: 0.3, type: 'sine', peak: 0.5, a: 0.002 });
      noise({ dur: 0.3, type: 'lowpass', f: 400, peak: 0.35, a: 0.002 });
    },
    horn() {
      const now = ctx.currentTime;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.32, now + 0.06);
      g.gain.setValueAtTime(0.32, now + 1.5);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 2.1);
      const trem = ctx.createOscillator(); trem.frequency.value = 6; const tg = ctx.createGain(); tg.gain.value = 0.05;
      trem.connect(tg); tg.connect(g.gain); trem.start(now); trem.stop(now + 2.2);
      lp.connect(g); g.connect(master);
      [196, 247, 294, 392].forEach((f, i) => {
        for (const det of [-9, 7]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det + i;
          o.connect(lp); o.start(now); o.stop(now + 2.2);
        }
      });
    },
    crowdCheer() {
      noise({ dur: 2.6, type: 'bandpass', f: 900, f2: 1300, q: 0.6, peak: 0.32, a: 0.35 });
      noise({ t: 0.1, dur: 2.2, type: 'bandpass', f: 2400, f2: 1800, q: 0.9, peak: 0.14, a: 0.4 });
    },
    crowdOoh() {
      noise({ dur: 1.2, type: 'bandpass', f: 520, f2: 380, q: 1.4, peak: 0.24, a: 0.15 });
    },
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        tone({ t: i * 0.09, f, dur: 0.5, type: 'triangle', peak: 0.16 });
        tone({ t: i * 0.09, f: f * 2, dur: 0.3, type: 'sine', peak: 0.04 });
      });
      tone({ t: 0.4, f: 1567.98, dur: 0.9, type: 'sine', peak: 0.08 });
    },
    lose() {
      tone({ f: 330, f2: 300, dur: 0.25, type: 'triangle', peak: 0.1 });
      tone({ t: 0.18, f: 262, f2: 240, dur: 0.4, type: 'triangle', peak: 0.1 });
    },
    coin() { tone({ f: 1760 + Math.random() * 400, dur: 0.08, type: 'triangle', peak: 0.05 }); },
  };

  function play(name, ...args) {
    if (!enabled || !FX[name] || !ensure()) return;
    try { FX[name](...args); } catch (e) { /* never let audio break the game */ }
  }

  function setEnabled(on) {
    enabled = on;
    try { localStorage.setItem(STORE_KEY, on ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
    if (on) ensure();
    else if (ctx) ctx.suspend();
  }

  function unlockOnce() {
    const unlock = () => { if (enabled) ensure(); };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
  }
  unlockOnce();

  return { play, setEnabled, get enabled() { return enabled; } };
})();
