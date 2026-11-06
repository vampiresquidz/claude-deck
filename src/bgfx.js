'use strict';
/* Animated pixel wallpapers: procedural canvas themes + AI-generated looping clips.
   Public API: BGFX.list, BGFX.set(key, {instant}), BGFX.setDim(0..1), BGFX.preview(key, canvas) */
(function () {
  const W = 192, H = 108;                      // logical "pixel" grid
  const rnd = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const fr = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
  const disc = (c, cx, cy, r, col) => { c.fillStyle = col; for (let y = -r; y <= r; y++) { const w = Math.floor(Math.sqrt(r * r - y * y)); c.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1); } };
  const lerp = (a, b, t) => a + (b - a) * t;
  const hsl = (h, s, l, a) => `hsla(${h},${s}%,${l}%,${a == null ? 1 : a})`;
  const grad = (c, stops) => { for (let y = 0; y < H; y++) { const t = y / (H - 1); let i = 0; while (i < stops.length - 2 && t > stops[i + 1][0]) i++; const [t0, c0] = stops[i], [t1, c1] = stops[i + 1]; const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0))); const bandK = Math.round(k * 14) / 14; c.fillStyle = `rgb(${c0.map((v, j) => Math.round(lerp(v, c1[j], bandK))).join(',')})`; c.fillRect(0, y, W, 1); } };

  /* ---------------- code-generated themes ---------------- */
  const CODE = {};

  CODE.moonlit = { name: 'Moonlit', init() { const r = rnd(7); return { stars: Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H * 0.7, p: r() * 6.28, s: 0.6 + r() * 1.6 })), shoot: 0 }; },
    draw(c, t, st) {
      grad(c, [[0, [8, 10, 32]], [0.6, [26, 24, 70]], [1, [70, 44, 96]]]);
      for (const s of st.stars) { const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.s + s.p)); fr(c, s.x, s.y, 1, 1, `rgba(255,244,214,${a})`); if (a > 0.92) { fr(c, s.x - 1, s.y, 3, 1, 'rgba(255,244,214,.5)'); fr(c, s.x, s.y - 1, 1, 3, 'rgba(255,244,214,.5)'); } }
      disc(c, 150, 26, 12, '#f6e7b4'); disc(c, 155, 23, 11, '#241f56'); disc(c, 150, 26, 12, 'rgba(246,231,180,0)');
      c.globalCompositeOperation = 'destination-over'; c.globalCompositeOperation = 'source-over';
      // crescent: redraw as disc minus offset disc
      disc(c, 150, 26, 12, '#f6e7b4'); disc(c, 155, 23, 11, '#262260'); 
      for (let k = 0; k < 3; k++) { const cx = ((t * (3 + k * 2) + k * 90) % (W + 80)) - 40, cy = 30 + k * 18; for (let i = 0; i < 5; i++) fr(c, cx + i * 6 - (i % 2) * 3, cy - Math.abs(i - 2) * 2, 9, 4 + (2 - Math.abs(i - 2)) * 2, `rgba(120,110,190,${0.30 - k * 0.06})`); }
      const ph = (t % 9) / 9; if (ph < 0.12) { const p = ph / 0.12; for (let i = 0; i < 9; i++) fr(c, 30 + p * 70 - i, 8 + p * 30 - i * 0.5, 1, 1, `rgba(255,255,255,${1 - i / 9})`); }
      for (let x = 0; x < W; x++) { const h = 12 + Math.sin(x * 0.07) * 4 + Math.sin(x * 0.23) * 2; fr(c, x, H - h, 1, h, '#0b0a1d'); }
    } };

  CODE.fireflies = { name: 'Fireflies', init() { const r = rnd(11); return { f: Array.from({ length: 34 }, () => ({ x: r() * W, y: 40 + r() * 60, ph: r() * 6.28, sp: 0.2 + r() * 0.5 })), g: Array.from({ length: 96 }, (_, i) => ({ x: i * 2 + r() * 2, h: 6 + r() * 14, ph: r() * 6.28 })) }; },
    draw(c, t, st) {
      grad(c, [[0, [6, 18, 22]], [0.7, [10, 40, 38]], [1, [8, 28, 20]]]);
      disc(c, 40, 24, 9, 'rgba(210,235,220,.18)'); disc(c, 40, 24, 6, 'rgba(225,245,230,.5)');
      for (const f of st.f) { const x = f.x + Math.sin(t * f.sp + f.ph) * 8, y = f.y + Math.cos(t * f.sp * 1.3 + f.ph) * 6; const a = Math.max(0, Math.sin(t * 1.4 + f.ph)); if (a > 0.05) { fr(c, x - 1, y - 1, 3, 3, `rgba(220,255,120,${a * 0.25})`); fr(c, x, y, 1, 1, `rgba(240,255,170,${a})`); } }
      for (const b of st.g) { const sw = Math.sin(t * 1.2 + b.ph + b.x * 0.05) * 2.2; for (let i = 0; i < b.h; i++) { const k = i / b.h; fr(c, b.x + sw * k * k, H - i, 2, 1, k < 0.5 ? '#0a2a18' : '#14452a'); } }
    } };

  CODE.jellyfish = { name: 'Jellyfish', init() { const r = rnd(5); return { j: Array.from({ length: 5 }, () => ({ x: 20 + r() * (W - 40), y: r() * H, sp: 3 + r() * 4, ph: r() * 6.28, hue: r() > 0.5 ? 280 : 175, s: 0.7 + r() * 0.8 })), b: Array.from({ length: 30 }, () => ({ x: r() * W, y: r() * H, sp: 4 + r() * 8 })) }; },
    draw(c, t, st) {
      grad(c, [[0, [4, 8, 30]], [1, [6, 30, 52]]]);
      for (const b of st.b) { const y = ((b.y - t * b.sp) % H + H) % H; fr(c, b.x + Math.sin(t + b.y) * 2, y, 1, 1, 'rgba(150,220,255,.45)'); }
      for (const j of st.j) {
        const y = ((j.y - t * j.sp * 0.5) % (H + 50) + H + 50) % (H + 50) - 25, pulse = Math.sin(t * 1.6 + j.ph), rw = Math.round((9 + pulse * 1.8) * j.s), rh = Math.round((6 - pulse) * j.s);
        const cx = j.x + Math.sin(t * 0.5 + j.ph) * 6;
        for (let yy = -rh; yy <= 0; yy++) { const w = Math.floor(rw * Math.sqrt(1 - (yy / rh) ** 2)); fr(c, cx - w, y + yy, w * 2 + 1, 1, hsl(j.hue, 85, 62 + yy * 1.5, 0.82)); }
        for (let k = -3; k <= 3; k++) for (let i = 0; i < 14 * j.s; i++) fr(c, cx + k * (rw / 3.5) + Math.sin(t * 2 + i * 0.5 + k + j.ph) * (1 + i * 0.12), y + i, 1, 1, hsl(j.hue, 85, 70, 0.6 - i / (30 * j.s)));
      }
    } };

  CODE.matrix = { name: 'Code Rain', init() { const r = rnd(3); return { cols: Array.from({ length: W / 3 | 0 }, () => ({ y: r() * H, sp: 18 + r() * 38, len: 8 + r() * 22, seed: r() })) }; },
    draw(c, t, st) {
      fr(c, 0, 0, W, H, '#020a05');
      st.cols.forEach((col, i) => { const head = (col.y + t * col.sp) % (H + col.len * 2); for (let k = 0; k < col.len; k++) { const y = head - k; if (y < 0 || y > H) continue; const flick = ((Math.floor(t * 8 + i * 7 + k * 3) * 2654435761) >>> 0) % 5 === 0 ? 0.55 : 1; const a = (1 - k / col.len) * flick; fr(c, i * 3, y, 2, 1, k === 0 ? `rgba(200,255,220,${a})` : `rgba(40,${160 + (col.seed * 80 | 0)},90,${a * 0.9})`); } });
    } };

  CODE.aurora = { name: 'Aurora', init() { const r = rnd(9); return { s: Array.from({ length: 60 }, () => ({ x: r() * W, y: r() * H * 0.8, p: r() * 6 })) }; },
    draw(c, t, st) {
      grad(c, [[0, [4, 6, 22]], [1, [10, 20, 40]]]);
      for (const s of st.s) fr(c, s.x, s.y, 1, 1, `rgba(255,255,255,${0.3 + 0.4 * Math.sin(t + s.p)})`);
      for (let x = 0; x < W; x++) for (let band = 0; band < 3; band++) {
        const base = 28 + band * 9 + Math.sin(x * 0.045 + t * 0.5 + band) * 10 + Math.sin(x * 0.11 - t * 0.8) * 3, hgt = 22 + Math.sin(x * 0.07 + t * 0.9 + band * 2) * 8, hue = 130 + band * 55 + Math.sin(t * 0.3 + x * 0.02) * 20;
        for (let y = 0; y < hgt; y++) { const k = y / hgt; fr(c, x, base - y, 1, 1, hsl(hue, 80, 55, (1 - k) * (0.10 + band * 0.02) + (y < 2 ? 0.12 : 0))); }
      }
      for (let x = 0; x < W; x++) fr(c, x, H - 8 - Math.sin(x * 0.06) * 3 - Math.sin(x * 0.2) * 1.5, 1, 20, '#05070f');
    } };

  CODE.sun = { name: 'Claude Sun', init() { const r = rnd(21); return { e: Array.from({ length: 40 }, () => ({ x: r() * W, y: r() * H, sp: 5 + r() * 12, ph: r() * 6 })) }; },
    draw(c, t, st) {
      grad(c, [[0, [24, 12, 22]], [0.55, [70, 30, 30]], [1, [120, 52, 36]]]);
      const cx = W / 2, cy = 52, rot = t * 0.25;
      for (let i = 0; i < 16; i++) { const a = rot + i * Math.PI / 8, len = 30 + (i % 2) * 12 + Math.sin(t * 1.2 + i) * 4; for (let d = 18; d < len; d++) fr(c, cx + Math.cos(a) * d * 1.0, cy + Math.sin(a) * d * 1.0, 2, 2, `rgba(217,119,87,${0.9 - d / (len + 8)})`); }
      disc(c, cx, cy, 20, '#d97757'); disc(c, cx, cy, 15, '#e88d68'); disc(c, cx, cy, 8, '#f5b898');
      for (const e of st.e) { const y = ((e.y - t * e.sp) % H + H) % H; fr(c, e.x + Math.sin(t + e.ph) * 3, y, 1, 1, `rgba(255,170,110,${0.3 + 0.5 * Math.sin(t * 2 + e.ph) ** 2})`); }
      for (let x = 0; x < W; x++) fr(c, x, H - 10 - Math.sin(x * 0.05) * 4 - Math.sin(x * 0.17) * 2, 1, 20, '#150a12');
    } };

  CODE.clouds = { name: 'Cloud Drift', init() { const r = rnd(33); return { c: Array.from({ length: 9 }, () => ({ x: r() * W, y: 8 + r() * 70, s: 0.6 + r() * 1.1, sp: 2 + r() * 5 })) }; },
    draw(c, t, st) {
      grad(c, [[0, [74, 140, 214]], [1, [186, 222, 244]]]);
      for (const k of st.c) { const x = ((k.x + t * k.sp) % (W + 80)) - 40; for (let i = 0; i < 6; i++) { const w = (12 + (i % 3) * 6) * k.s, h = (5 + (i % 2) * 3) * k.s; fr(c, x + i * 7 * k.s, k.y - h + (i % 2) * 2, w, h, 'rgba(255,255,255,.9)'); fr(c, x + i * 7 * k.s, k.y, w, 2, 'rgba(210,225,245,.9)'); } }
    } };

  /* ---------------- AI clips (see src/themes-ai/) ---------------- */
  const AI = {
    'ai-moon': { name: 'Moon Night (AI)', file: 'themes-ai/moon.mp4', poster: 'themes-ai/moon.jpg' },
    'ai-deep': { name: 'Deep Sea (AI)', file: 'themes-ai/deep.mp4', poster: 'themes-ai/deep.jpg' },
    'ai-sunset': { name: 'Retro Sunset (AI)', file: 'themes-ai/sunset.mp4', poster: 'themes-ai/sunset.jpg' },
  };

  const list = [{ key: 'none', name: 'None', kind: 'none' }]
    .concat(Object.entries(CODE).map(([k, v]) => ({ key: k, name: v.name, kind: 'code' })))
    .concat(Object.entries(AI).map(([k, v]) => ({ key: k, name: v.name, kind: 'ai', poster: v.poster })));

  /* ---------------- engine ---------------- */
  let host = null, cur = null, dim = 0.55, paused = false, raf = 0, last = 0;
  const active = new Set();

  function makeLayer(key) {
    const el = document.createElement('div'); el.className = 'bgfx-layer';
    const L = { key, el, kind: 'code' };
    if (CODE[key]) {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; el.append(cv);
      const c = cv.getContext('2d'); const th = CODE[key]; const st = th.init(); const t0 = performance.now() / 1000 - 5 - Math.random() * 20;
      L.draw = () => th.draw(c, performance.now() / 1000 - t0, st); L.draw();
    } else if (AI[key]) {
      L.kind = 'ai'; const v = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.src = AI[key].file; v.poster = AI[key].poster; el.append(v); L.video = v;
      v.play().catch(() => {});
    }
    return L;
  }
  function destroy(L) { if (L.video) { L.video.pause(); L.video.removeAttribute('src'); L.video.load(); } L.el.remove(); active.delete(L); }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (paused || now - last < 1000 / 24) return;
    last = now; for (const L of active) if (L.draw) L.draw();
  }
  function syncRun() {
    const run = !paused && active.size > 0;
    if (run && !raf) raf = requestAnimationFrame(loop);
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    for (const L of active) if (L.video) (paused ? L.video.pause() : L.video.play().catch(() => {}));
  }

  function ensureHost() {
    if (host) return host;
    host = document.getElementById('bgfx');
    if (!host) { host = document.createElement('div'); host.id = 'bgfx'; document.body.prepend(host); }
    const check = () => { const p = document.hidden || (BGFX.pauseWhenBlurred && !document.hasFocus()); if (p !== paused) { paused = p; syncRun(); } };
    document.addEventListener('visibilitychange', check); window.addEventListener('blur', check); window.addEventListener('focus', check);
    return host;
  }

  function set(key, opts) {
    ensureHost();
    const on = key && key !== 'none' && (CODE[key] || AI[key]);
    document.documentElement.classList.toggle('fx', !!on);
    setDim(dim);
    if (!on) { if (cur) { const old = cur; cur = null; old.el.style.opacity = 0; setTimeout(() => destroy(old), 400); } syncRun(); return; }
    if (cur && cur.key === key) return;
    const L = makeLayer(key); active.add(L); host.append(L.el);
    const old = cur; cur = L;
    if (!old || (opts && opts.instant) || matchMedia('(prefers-reduced-motion: reduce)').matches) { if (old) destroy(old); }
    else {
      // circular iris wipe from the bottom-left corner
      const anim = L.el.animate([{ clipPath: 'circle(0% at 0% 100%)' }, { clipPath: 'circle(150% at 0% 100%)' }], { duration: 750, easing: 'cubic-bezier(.65,0,.35,1)' });
      anim.onfinish = () => destroy(old);
    }
    syncRun();
  }
  function setDim(v) { dim = v; document.documentElement.style.setProperty('--fx-dim', String(v)); }

  function preview(key, canvas) {
    const th = CODE[key]; if (!th) return false;
    canvas.width = W; canvas.height = H; const c = canvas.getContext('2d'); th.draw(c, 6, th.init()); return true;
  }

  const BGFX = { list, set, setDim, preview, pauseWhenBlurred: true, refresh() { const p = document.hidden || (this.pauseWhenBlurred && !document.hasFocus()); paused = p; syncRun(); } };
  window.BGFX = BGFX;
})();
