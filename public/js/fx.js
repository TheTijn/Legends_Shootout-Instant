// ===== LEGENDS SHOOTOUT INSTANT — RESULT PARTICLES =====
// Canvas burst of confetti, pucks and sparkles over the win hero.
// ResultFx.burst({ x, y, colors }) · ResultFx.stop()

const ResultFx = (() => {
  let canvas, ctx, raf = null, parts = [], last = 0, w = 0, h = 0, gen = 0;
  const rand = (a, b) => a + Math.random() * (b - a);

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(x, y, colors, n, power) {
    for (let i = 0; i < n; i++) {
      const kind = Math.random() < 0.14 ? 'puck' : Math.random() < 0.3 ? 'spark' : 'confetti';
      const ang = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const sp = rand(220, 620) * power;
      parts.push({
        kind, x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        rot: rand(0, 6.283), vr: rand(-12, 12),
        flip: rand(0, 6.283), vf: rand(6, 14),
        size: kind === 'puck' ? rand(7, 11) : kind === 'spark' ? rand(2, 4) : rand(5, 9),
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 0, max: rand(2200, 3600),
      });
    }
  }

  function draw(p) {
    const a = Math.min(1, 1.6 * (1 - p.life / p.max));
    ctx.globalAlpha = a;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    if (p.kind === 'confetti') {
      ctx.scale(1, Math.cos(p.flip));
      ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    } else if (p.kind === 'puck') {
      ctx.scale(1, 0.45 + 0.25 * Math.cos(p.flip));
      ctx.fillStyle = '#0b0b0b'; ctx.beginPath(); ctx.arc(0, 0, p.size, 0, 6.283); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, p.size * 0.72, 3.6, 5.2); ctx.stroke();
    } else {
      const s = p.size * (0.7 + 0.3 * Math.sin(p.flip * 2));
      ctx.fillStyle = '#fff6d0';
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const ang = i * Math.PI / 2;
        ctx.lineTo(Math.cos(ang) * s * 2.2, Math.sin(ang) * s * 2.2);
        ctx.lineTo(Math.cos(ang + Math.PI / 4) * s * 0.5, Math.sin(ang + Math.PI / 4) * s * 0.5);
      }
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function tick(now) {
    const dt = Math.min(40, now - last) / 1000; last = now;
    ctx.clearRect(0, 0, w, h);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt * 1000;
      if (p.life > p.max || p.y > h + 40) { parts.splice(i, 1); continue; }
      const drag = p.kind === 'confetti' ? 2.6 : p.kind === 'spark' ? 1.8 : 0.9;
      p.vx -= p.vx * drag * dt; p.vy -= p.vy * drag * dt;
      p.vy += (p.kind === 'confetti' ? 240 : p.kind === 'spark' ? 120 : 520) * dt;
      if (p.kind === 'confetti') p.vx += Math.sin(p.flip) * 30 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt; p.flip += p.vf * dt;
      draw(p);
    }
    ctx.globalAlpha = 1;
    raf = parts.length ? requestAnimationFrame(tick) : null;
  }

  function burst({ x, y, colors }) {
    canvas = canvas || document.getElementById('resFx');
    ctx = ctx || canvas.getContext('2d');
    stop();
    const g = gen;
    size();
    spawn(x, y, colors, 110, 1);
    setTimeout(() => { if (g === gen) { spawn(x - w * 0.25, y + 10, colors, 40, 0.75); spawn(x + w * 0.25, y + 10, colors, 40, 0.75); if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } } }, 380);
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    gen++;
    if (raf) cancelAnimationFrame(raf);
    raf = null; parts = [];
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { burst, stop };
})();
