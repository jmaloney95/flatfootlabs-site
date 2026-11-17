/* The card scroll (cards.html): every Mega card on a glossy floor, one card in focus.
   Drag the row or the sprite strip (with a fling), use the arrows, the arrow keys or a sideways
   wheel; tap a card to bring it to the centre. The centre card tilts toward the pointer (a mouse
   hovering, or a finger held on it) with a light that follows; tapping it flips it over to its
   back (the moves), with a real page-turn sound on the flip.
   Each step plays a real card-slide recording timed so its peak lands on the row's fastest moment.
   All sounds: assets/cards/sfx (CC0); the Sound button turns them off.

   Layout: the position is one number, f (card index, fractional while moving; the row is a loop).
   Every frame places each card from its distance d to f through the slot table below. The focused
   card's width is picked so the card files land on whole device pixels; a card at rest (flat, not
   tilting, not mid-flip) has no transform at all, so its sprite stays sharp. */
(() => {
  const root = document.querySelector('[data-fc]');
  if (!root) return;
  const $ = (sel) => root.querySelector(sel);

  // slots by distance from the centre: x offset (in focused-card widths), scale, darkening
  const SX = [0, 1.111, 2.0, 2.806, 3.556, 4.3];
  const SS = [1, 0.72, 0.6, 0.54, 0.5, 0.48];
  const SD = [0, 0.24, 0.42, 0.58, 0.72, 0.8];
  const STEP_DUR = 0.66;                     // seconds for one card, as in the film
  const FLIP_DUR = 0.56;                     // seconds for a flip
  const TILT_X = 11, TILT_Y = 15;            // degrees at the card's edge
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  let C = [], N = 0, SFX = [], FLIP = null;
  let f = 0, anim = null, drag = null, raf = 0, shown = -1, wheelT = 0;
  let L = {};                                 // layout numbers (CSS px)
  const cards = [], ghosts = [], tiles = [];
  // the centre card's tilt: current and target, in -1..1 of the card's half-size
  const tilt = { x: 0, y: 0, tx: 0, ty: 0, i: -1, t: 0 };

  fetch(root.dataset.fc).then((r) => r.json()).then(init).catch(() => root.classList.add('is-failed'));

  // ── helpers ───────────────────────────────────────────────────────────
  const mod = (a, n) => ((a % n) + n) % n;
  const wrapD = (d) => mod(d + N / 2, N) - N / 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad = (n, w) => String(n).padStart(w, '0');
  const easeInOut = (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2);   // power3.inOut
  const easeOut = (t) => 1 - (1 - t) ** 4;
  const easeFlip = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);    // cubic in-out
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
  const centre = () => mod(Math.round(f), N);

  function init(data) {
    C = data.cards; N = C.length; SFX = data.sfx; FLIP = data.flip || null;
    const want = new URLSearchParams(location.search).get('card') || root.dataset.fcStart;   // data-fc-start: the pack's hit
    const start = C.findIndex((c) => c.slug === want);
    f = start > 0 ? start : 0;
    build();
    layout();
    render();
    info(true);
    settle();
    new ResizeObserver(() => { layout(); render(); }).observe(root);
    const stage = $('.fc-stage');               // browsers without overflow: clip: undo any focus scroll
    stage.addEventListener('scroll', () => { stage.scrollTop = 0; stage.scrollLeft = 0; });
    bind();
    preloadSounds();
  }

  // ── DOM ───────────────────────────────────────────────────────────────
  // a card: its reflection (which turns with the flip), the body (front + back faces, each with a
  // light layer, turned in 3D for tilt and flip), the darkening and the arrival streak on top
  const SIDES = '<div class="fc-side fc-side--front"><img alt=""><i class="fc-light"></i></div>' +
                '<div class="fc-side fc-side--back"><img alt=""><i class="fc-light"></i></div>';
  function build() {
    const row = $('.fc-row'), gh = $('.fc-ghosts'), strip = $('.fc-strip-inner');
    C.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = 'fc-card'; el.dataset.i = i;
      el.setAttribute('role', 'group'); el.setAttribute('aria-roledescription', 'card');
      el.setAttribute('aria-label', `${i + 1} of ${N}: ${c.name}`);
      el.innerHTML = `<div class="fc-shadow"></div><div class="fc-refl" aria-hidden="true"><div class="fc-body">${SIDES}</div></div>` +
        `<div class="fc-body fc-main">${SIDES}</div><div class="fc-dim"></div><div class="fc-glare"></div>`;
      row.appendChild(el);
      const main = el.querySelector('.fc-main'), refl = el.querySelector('.fc-refl .fc-body');
      const imgs = (b) => ({ front: b.querySelector('.fc-side--front img'), back: b.querySelector('.fc-side--back img') });
      const k = { el, main, refl, m: imgs(main), r: imgs(refl), dim: el.querySelector('.fc-dim'),
        loaded: false, backLoaded: false, vis: true, back: false, angle: 0, flip: null, mode: '' };
      k.m.front.alt = `${c.name} card, ${c.finish} finish`;
      k.m.back.alt = `${c.name} card, back: ability and moves`;
      cards.push(k);

      const g = document.createElement('div');
      g.className = 'fc-ghost'; g.textContent = c.title;
      gh.appendChild(g); ghosts.push(g);

      const t = document.createElement('button');
      t.type = 'button'; t.className = 'fc-tile'; t.dataset.i = i; t.tabIndex = -1;
      t.setAttribute('aria-label', `Show ${c.name}`);
      t.innerHTML = `<span class="fc-tile-bg" style="background:linear-gradient(160deg,${c.glow} 0%,${c.bg} 100%)"></span>` +
        `<img src="assets/cards/sprites/${c.slug}.png" alt="" width="${c.size}" height="${c.size}">` +
        `<span class="fc-tile-cap"><b>${pad(c.n, 3)}</b>${c.name.replace(/^Mega /, '')}</span>`;
      strip.appendChild(t); tiles.push({ el: t, img: t.querySelector('img') });
    });
  }

  // ── layout: sizes from the section's box ──────────────────────────────
  function exactWidth(target) {
    // the card files are 360 / 720 px wide (sprites 4x/5x and 8x/10x): use a width where one
    // card-file pixel is a whole or half device pixel, when one is close to the target
    const dpr = window.devicePixelRatio || 1;
    let best = 0;
    for (const s of [0.5, 1, 1.5, 2, 2.5, 3]) {
      const w = (720 * s) / dpr;
      if (w <= target * 1.06) best = w;
    }
    return best >= target * 0.9 ? best : Math.round(target);
  }

  function layout() {
    const SW = root.clientWidth, SH = root.clientHeight, dpr = window.devicePixelRatio || 1;
    const mobile = SW < 720;
    const tileK = !mobile && SH >= 980 ? 2 : 1;     // sprites 2x in the strip only when there is room
    const TH = 80 * tileK + (tileK === 2 ? 12 : 20);
    const TW = Math.round(TH * 1.14);
    const PITCH = TW + (mobile ? 10 : 16);
    const top = mobile ? 118 : 132, foot = mobile ? 78 : 92, gap = mobile ? 24 : 30, capH = 26;
    const availH = SH - top - foot - gap - TH - capH;
    const W = exactWidth(Math.min(availH / 1.4, mobile ? SW * 0.66 : SW * 0.25, 380));
    const H = W * 1.4;
    const block = H + gap + TH + capH;
    const y0 = top + Math.max(0, (SH - foot - top - block) / 2);
    const snap = (v) => Math.round(v * dpr) / dpr;
    L = { SW, SH, W, H, TW, TH, PITCH, tileK, mobile, dpr, sx: mobile ? 0.8 : 1,   // phones pull the neighbours in
      left: snap(SW / 2 - W / 2), top: snap(y0), floor: y0 + H, strip: snap(y0 + H + gap) };

    root.style.setProperty('--fc-floor', `${L.floor}px`);
    root.style.setProperty('--fc-strip', `${L.strip}px`);
    root.style.setProperty('--fc-tw', `${TW}px`);
    root.style.setProperty('--fc-th', `${TH}px`);
    root.style.setProperty('--fc-glow-y', `${((y0 + H * 0.45) / SH) * 100}%`);
    const sizes = `${W}px`;
    cards.forEach((c) => {
      Object.assign(c.el.style, { width: `${W}px`, height: `${H}px`, left: `${L.left}px`, top: `${L.top}px` });
      [c.m.front, c.m.back, c.r.front, c.r.back].forEach((im) => { im.sizes = sizes; });
    });
    const gSize = Math.min(SW * 0.17, H * 0.62);
    ghosts.forEach((g) => { g.style.fontSize = `${gSize}px`; g.style.top = `${y0 + H * 0.16}px`; });
    tiles.forEach((t, i) => {
      const s = C[i].size * tileK;
      Object.assign(t.img.style, { width: `${s}px`, height: `${s}px`, left: `${Math.round((TW - s) / 2)}px`, top: `${Math.round((TH - s) / 2)}px` });
    });
    const sel = $('.fc-select');
    Object.assign(sel.style, { left: `${SW / 2 - TW / 2 - 6}px`, top: `${L.strip - 6}px`, width: `${TW + 12}px`, height: `${TH + 12}px` });
  }

  // ── images, loaded as cards come near ─────────────────────────────────
  const srcset = (slug, side) => `assets/cards/img/${slug}${side}-360.webp 360w, assets/cards/img/${slug}${side}-720.webp 720w`;
  function load(c, i, first) {
    if (c.loaded) return;
    c.loaded = true;
    c.m.front.fetchPriority = first ? 'high' : 'low';    // the centre card before its neighbours
    const slug = C[i].slug;
    for (const im of [c.m.front, c.r.front]) { im.srcset = srcset(slug, ''); im.src = `assets/cards/img/${slug}-360.webp`; }
  }
  function loadBack(c, i) {
    if (c.backLoaded) return;
    c.backLoaded = true;
    const slug = C[i].slug;
    for (const im of [c.m.back, c.r.back]) { im.srcset = srcset(slug, '-back'); im.src = `assets/cards/img/${slug}-back-360.webp`; }
  }

  // ── render: everything from f ─────────────────────────────────────────
  function slot(d) {
    const a = Math.abs(d), s = Math.sign(d), k = Math.min(Math.floor(a), SX.length - 2), t = Math.min(a - k, 1);
    const lerp = (A) => A[k] + (A[k + 1] - A[k]) * t;
    return { x: s * lerp(SX) * L.W * L.sx, sc: lerp(SS), dim: lerp(SD) };
  }

  // the card's own turn: flip angle + tilt (centre card only); flat when at rest
  function pose(c, i) {
    const tl = i === tilt.i ? tilt : null;
    const rx = tl ? -tl.y * TILT_X : 0, ry = tl ? tl.x * TILT_Y : 0;
    const flat = Math.abs(rx) < 0.05 && Math.abs(ry) < 0.05 && !c.flip;
    const mode = flat ? (c.back ? 'back' : 'front') : '3d';
    if (mode !== c.mode) {
      c.el.classList.toggle('is-3d', mode === '3d');
      c.el.classList.toggle('is-back', c.back);
      c.mode = mode;
    }
    if (flat) {
      c.main.style.transform = ''; c.refl.style.transform = '';
      c.el.style.removeProperty('--fc-lt');
      return;
    }
    const lift = c.flip ? 1 + 0.06 * Math.sin(Math.PI * c.flip.p) : 1;      // the card rises as it turns
    const P = (L.W * 4.2).toFixed(0);
    c.main.style.transform = `perspective(${P}px) rotateX(${rx.toFixed(2)}deg) rotateY(${(c.angle + ry).toFixed(2)}deg) scale(${lift.toFixed(4)})`;
    c.refl.style.transform = `perspective(${P}px) rotateY(${c.angle.toFixed(2)}deg)`;
    if (tl) {
      const mx = 50 + tl.x * 45, my = 50 + tl.y * 45;
      c.el.style.setProperty('--fc-mx', `${mx.toFixed(1)}%`);
      c.el.style.setProperty('--fc-mxb', `${(100 - mx).toFixed(1)}%`);       // the back face is mirrored
      c.el.style.setProperty('--fc-my', `${my.toFixed(1)}%`);
      c.el.style.setProperty('--fc-lt', Math.min(1, Math.hypot(tl.x, tl.y)).toFixed(3));
    }
  }

  function render() {
    const reach = Math.max(4.6, (L.SW / 2) / (L.W * 0.8));
    cards.forEach((c, i) => {
      const d = wrapD(i - f), a = Math.abs(d);
      const vis = a < Math.min(reach, SX.length - 1.4);
      if (vis !== c.vis) { c.el.style.visibility = vis ? '' : 'hidden'; c.vis = vis; }
      if (a < 3.6) load(c, i, a < 0.5);
      if (!vis) return;
      if (c.back) loadBack(c, i);
      const s = slot(d);
      c.el.style.transform = a < 1e-4 ? 'none' : `translate3d(${s.x.toFixed(2)}px,0,0) scale(${s.sc.toFixed(4)})`;
      c.el.style.zIndex = String(100 - Math.round(a * 10));
      c.dim.style.opacity = s.dim.toFixed(3);
      pose(c, i);
    });
    ghosts.forEach((g, i) => {
      const d = wrapD(i - f), a = Math.abs(d);
      const o = clamp(1 - a * 1.7, 0, 1);
      g.style.opacity = o.toFixed(3);
      if (o > 0) g.style.transform = `translate3d(${(d * 110 * Math.min(1, L.SW / 1400)).toFixed(1)}px,0,0)`;
    });
    tiles.forEach((t, i) => {
      const d = wrapD(i - f);
      const x = L.SW / 2 - L.TW / 2 + d * L.PITCH;
      const vis = x > -L.TW * 2 && x < L.SW + L.TW;
      t.el.style.visibility = vis ? '' : 'hidden';
      if (vis) t.el.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
    });
    const i0 = Math.floor(f), t = f - i0, a = C[mod(i0, N)], b = C[mod(i0 + 1, N)];
    root.style.setProperty('--fc-bg', mix(a.bg, b.bg, t));
    root.style.setProperty('--fc-glow', mix(a.glow, b.glow, t));
    const idx = centre();
    if (idx !== shown) info(false, idx);
  }

  // counter, caption and credit roll to the card nearest the centre
  function info(first, idx = centre()) {
    const dir = shown < 0 ? 0 : (wrapD(idx - shown) > 0 ? 1 : -1);
    shown = idx;
    const c = C[idx];
    const name = c.dex ? `<a href="dex#${c.dex}" title="Pokédex entry">${c.name}</a>` : c.name;
    const cap = `${name}<i>·</i>${c.finish}<i>·</i>BST ${c.bst}`;
    roll('[data-fc-num]', pad(idx + 1, 2), dir, first);
    roll('[data-fc-cap]', cap, dir, first, true);
    roll('[data-fc-credit]', c.credit, dir, first);
  }
  function roll(sel, text, dir, first, html) {
    const el = $(sel); if (!el) return;
    if (html) el.innerHTML = text; else el.textContent = text;
    const box = el.parentElement;
    box.classList.remove('is-up', 'is-down');
    if (first || !dir) return;
    void box.offsetWidth;                     // restart the animation
    box.classList.add(dir > 0 ? 'is-up' : 'is-down');
  }

  // ── motion ────────────────────────────────────────────────────────────
  let lastT = 0;
  function kick() { if (!raf) raf = requestAnimationFrame(tick); }
  function tick(now) {
    raf = 0;
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0.016;
    lastT = now;
    if (anim) {
      const p = anim.dur <= 0 ? 1 : clamp((now - anim.t0) / anim.dur, 0, 1);
      f = anim.from + (anim.to - anim.from) * anim.ease(p);
      if (p >= 1) { f = anim.to; anim = null; settle(); }
    }
    // the tilt eases toward its target (about 90 ms). It belongs to one card (tilt.i): while the row
    // moves, or once another card is in the centre, it eases back to flat before it moves on
    let busy = !!(anim || drag);
    const ci = centre();
    if (anim || (drag && drag.moved) || tilt.i !== ci) { tilt.tx = 0; tilt.ty = 0; }
    const k = reduce.matches ? 1 : 1 - Math.exp(-dt / 0.09);
    tilt.x += (tilt.tx - tilt.x) * k; tilt.y += (tilt.ty - tilt.y) * k;
    if (Math.abs(tilt.tx - tilt.x) + Math.abs(tilt.ty - tilt.y) > 0.002) busy = true;
    else { tilt.x = tilt.tx; tilt.y = tilt.ty; }
    if (tilt.i !== ci && tilt.x === 0 && tilt.y === 0) tilt.i = ci;
    // flips
    cards.forEach((c) => {
      if (!c.flip) return;
      const p = c.flip.dur <= 0 ? 1 : clamp((now - c.flip.t0) / c.flip.dur, 0, 1);
      c.flip.p = p;
      c.angle = c.flip.from + (c.flip.to - c.flip.from) * easeFlip(p);
      if (p >= 1) { c.angle = c.flip.to % 360; c.back = c.angle === 180; c.flip = null; }
      else busy = true;
    });
    render();
    if (busy) kick(); else lastT = 0;
  }

  // ease toward a target index; `moving` = the row is already in motion (no ease-in)
  function goTo(to, moving) {
    cancelSounds();
    const from = f, dist = Math.abs(to - from);
    if (dist < 1e-6) { f = to; render(); settle(); return; }
    const dur = reduce.matches ? 0 : Math.min(1.25, STEP_DUR + 0.11 * (Math.max(1, dist) - 1)) * (moving ? 0.85 : 1);
    anim = { from, to, t0: performance.now(), dur: dur * 1000, ease: moving ? easeOut : easeInOut };
    scheduleSounds(anim);
    kick();
  }
  function step(dir) {
    const base = anim ? anim.to : Math.round(f);
    goTo(base + dir, !!anim || Math.abs(f - Math.round(f)) > 1e-3);
    const btn = root.querySelector(dir > 0 ? '[data-fc-next]' : '[data-fc-prev]');
    if (btn) { btn.classList.add('is-pressed'); setTimeout(() => btn.classList.remove('is-pressed'), 160); }
  }
  function show(i) {                          // bring card i to the centre the short way round
    const base = anim ? anim.to : Math.round(f);
    goTo(base + wrapD(i - base), !!anim);
  }
  function settle() {
    const idx = centre(), c = C[idx];
    cards.forEach((k, i) => k.el.classList.toggle('is-arriving', i === idx && !reduce.matches && !k.back));
    loadBack(cards[idx], idx);                // ready before anyone flips it
    announce(idx);
    setTimeout(() => cards[idx] && cards[idx].el.classList.remove('is-arriving'), 800);
  }
  function announce(idx) {
    const c = C[idx], live = $('[data-fc-live]');
    if (live) live.textContent = `${idx + 1} of ${N}: ${c.name}, ${c.finish}, BST ${c.bst}${cards[idx].back ? '. Showing the back: ability and moves' : ''}`;
  }

  // turn the centre card over (front <-> back), the page-turn sound on the moment it is edge-on
  function flip(i) {
    const c = cards[i];
    loadBack(c, i);
    const from = c.flip ? c.angle : (c.back ? 180 : 0);
    const to = c.flip ? (c.flip.to === 180 ? 0 : 180) : (c.back ? 0 : 180);
    const dur = reduce.matches ? 0 : FLIP_DUR * Math.abs(to - from) / 180 * 1000;
    c.flip = { from, to, t0: performance.now(), dur, p: 0 };
    c.back = to === 180;                      // the side it is turning to (for the announcement)
    c.el.classList.remove('is-arriving');
    if (FLIP) playFlip(dur / 2000);
    announce(i);
    kick();
  }

  // ── input ─────────────────────────────────────────────────────────────
  function bind() {
    root.querySelector('[data-fc-next]').addEventListener('click', () => { wake(); step(1); });
    root.querySelector('[data-fc-prev]').addEventListener('click', () => { wake(); step(-1); });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); wake(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); wake(); step(-1); }
      else if ((e.key === 'Enter' || e.key === ' ') && e.target === root) { e.preventDefault(); wake(); flip(centre()); }
    });
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('pointerleave', () => { if (!drag) aim(0, 0); });
    root.addEventListener('wheel', wheel, { passive: false });
    // the strip's buttons are reached by clicks on the tiles (handled as taps), never by Tab
    root.querySelectorAll('.fc-tile').forEach((t) => t.addEventListener('click', (e) => e.preventDefault()));

    const snd = root.querySelector('[data-fc-sound]');
    try { if (localStorage.getItem('fc-sound') === 'off') snd.setAttribute('aria-pressed', 'false'); } catch (e) { /* storage blocked */ }
    snd.addEventListener('click', () => {
      const on = snd.getAttribute('aria-pressed') !== 'true';
      snd.setAttribute('aria-pressed', String(on));
      try { localStorage.setItem('fc-sound', on ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
      if (on) { wake(); play(0, 0, 0.8); }
    });
  }

  // the pointer over the centre card: -1..1 across it, or null when it is elsewhere
  function overCentre(e) {
    const c = cards[centre()];
    if (!c || anim) return null;
    const r = c.el.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    return Math.abs(x) <= 1.04 && Math.abs(y) <= 1.04 ? { x: clamp(x, -1, 1), y: clamp(y, -1, 1) } : null;
  }
  function aim(x, y) {
    if (reduce.matches) { x = y = 0; }
    if (x !== tilt.tx || y !== tilt.ty) { tilt.tx = x; tilt.ty = y; kick(); }
  }
  function updateCursor(e) {
    root.classList.toggle('is-over-card', !!overCentre(e));
  }

  function down(e) {
    if (e.button !== 0 || e.target.closest('button:not(.fc-tile), a, .fc-head')) return;
    wake();
    const onStrip = !!e.target.closest('.fc-strip');
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, f0: f, px: onStrip ? L.PITCH : L.W * SX[1] * L.sx,
      moved: false, hist: [[performance.now(), f]], target: e.target, touch: e.pointerType !== 'mouse' };
    if (anim) { drag.f0 = f; anim = null; cancelSounds(); }
    if (drag.touch) { const o = overCentre(e); if (o) aim(o.x, o.y); }   // a finger tilts the card it holds
  }
  function move(e) {
    if (!drag) {                              // hovering: a mouse tilts the centre card
      if (e.pointerType === 'mouse') { const o = overCentre(e); aim(o ? o.x : 0, o ? o.y : 0); updateCursor(e); }
      return;
    }
    if (e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved) {
      if (drag.touch) { const o = overCentre(e); if (o) aim(o.x, o.y); }
      if (Math.abs(dx) < 8) return;
      if (Math.abs(e.clientY - drag.y0) > Math.abs(dx)) { drag = null; aim(0, 0); return; }   // a vertical scroll
      drag.moved = true;
      aim(0, 0);
      root.classList.add('is-dragging');
      try { root.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    }
    const prev = f;
    f = drag.f0 - dx / drag.px;
    crossings(prev, f);
    const now = performance.now();
    drag.hist.push([now, f]);
    while (drag.hist.length > 2 && now - drag.hist[0][0] > 90) drag.hist.shift();
    kick();
  }
  function up(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    root.classList.remove('is-dragging');
    if (d.touch) aim(0, 0);
    if (!d.moved) { if (e.type === 'pointerup') tap(d.target); return; }
    const [t0, f0] = d.hist[0], [t1, f1] = d.hist[d.hist.length - 1];
    const v = t1 > t0 ? (f1 - f0) / ((t1 - t0) / 1000) : 0;           // cards per second
    goTo(Math.round(f + clamp(v * 0.22, -6, 6)), true);
  }
  function tap(target) {
    const card = target.closest('.fc-card'), tile = target.closest('.fc-tile');
    const i = card ? +card.dataset.i : tile ? +tile.dataset.i : -1;
    if (i < 0) return;
    if (card && i === centre() && !anim) flip(i);
    else show(i);
  }
  function wheel(e) {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault(); wake();
    if (anim) { anim = null; cancelSounds(); }
    const prev = f;
    f += e.deltaX / (L.W * SX[1] * L.sx * 1.6);
    crossings(prev, f);
    kick();
    clearTimeout(wheelT);
    wheelT = setTimeout(() => goTo(Math.round(f), true), 140);
  }

  // ── sound: the film's card-slide takes, cycled, and the page turn ─────
  let ctx = null, gain = null, bufs = [], flipBuf = null, raw = null, take = 0, lastPlay = 0;
  const pending = [];
  const soundOn = () => root.querySelector('[data-fc-sound]').getAttribute('aria-pressed') === 'true';

  // fetch and decode now (an offline context needs no gesture; its buffers play in any context)
  function preloadSounds() {
    const srcs = SFX.map((s) => s.src).concat(FLIP ? [FLIP.src] : []);
    const keep = (b) => { bufs = b.slice(0, SFX.length).filter(Boolean); flipBuf = FLIP ? b[SFX.length] || null : null; };
    const decode = (dc, arrs) => Promise.all(arrs.map((a) => new Promise((res) => dc.decodeAudioData(a, res, () => res(null)))));
    raw = Promise.all(srcs.map((s) => fetch(s).then((r) => r.arrayBuffer()))).then((arrs) => {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) return arrs;                  // decoded by wake() instead
      return decode(new OAC(1, 1, 48000), arrs).then((b) => { keep(b); return null; });
    }).catch(() => null);
    raw.keep = keep;
  }
  function wake() {                           // browsers start audio only from a gesture
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    gain = ctx.createGain(); gain.gain.value = 0.8; gain.connect(ctx.destination);
    if (raw) {
      const keep = raw.keep;
      raw.then((arrs) => {
        if (!arrs) return;
        return Promise.all(arrs.map((a) => new Promise((res) => ctx.decodeAudioData(a, res, () => res(null))))).then(keep);
      });
    }
  }
  function startBuf(buf, peak, lead, level) {  // a buffer whose peak lands `lead` s from now
    const now = ctx.currentTime, peakAt = now + lead;
    let at = peakAt - peak, off = 0;
    if (at < now) { off = Math.min(now - at, Math.max(0, peak - 0.03)); at = now; }
    const src = ctx.createBufferSource(), g = ctx.createGain();
    g.gain.value = level; src.buffer = buf; src.connect(g); g.connect(gain);
    src.start(at, Math.max(0, off));
    return { src, at, peakAt };
  }
  // the next slide take, its peak `lead` seconds from now; takes closer than minGap (peak to peak)
  // to the previous one are skipped
  function play(lead, minGap = 0.05, level = 1) {
    if (!ctx || !bufs.length || !soundOn()) return;
    const n = take % bufs.length;
    if (ctx.currentTime + lead - lastPlay < minGap) return;
    take++;
    const p = startBuf(bufs[n], SFX[n] ? SFX[n].peak : 0.2, lead, level);
    lastPlay = p.peakAt;
    pending.push(p);
    p.src.onended = () => { const k = pending.indexOf(p); if (k >= 0) pending.splice(k, 1); };
  }
  function playFlip(lead) {
    if (!ctx || !flipBuf || !soundOn()) return;
    startBuf(flipBuf, FLIP.peak, lead, 0.9);
  }
  function cancelSounds() {                   // drop slide takes that have not started yet
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let k = pending.length - 1; k >= 0; k--) {
      if (pending[k].at > now + 0.005) { try { pending[k].src.stop(); } catch (e) { /* not started */ } pending.splice(k, 1); }
    }
    lastPlay = pending.reduce((m, p) => Math.max(m, p.peakAt), Math.min(lastPlay, now));
  }
  // a tween: one take per card it passes, its peak on the moment the card crosses the centre line
  function scheduleSounds(a) {
    if (!ctx || !soundOn()) return;
    const lo = Math.min(a.from, a.to), hi = Math.max(a.from, a.to);
    const marks = [];
    for (let b = Math.floor(lo) + 0.5; b < hi; b += 1) if (b > lo) marks.push(b);
    marks.slice(0, 10).forEach((b) => {
      const target = (b - a.from) / (a.to - a.from);
      let x0 = 0, x1 = 1;                     // invert the ease by bisection
      for (let k = 0; k < 24; k++) { const m = (x0 + x1) / 2; if (a.ease(m) < target) x0 = m; else x1 = m; }
      play((x0 * a.dur) / 1000, 0.06, marks.length > 3 ? 0.7 : 1);
    });
  }
  // a drag or wheel: a take whenever a card crosses the centre line
  function crossings(a, b) {
    if (Math.round(a) !== Math.round(b)) play(0.04, 0.07, 0.85);
  }
})();
