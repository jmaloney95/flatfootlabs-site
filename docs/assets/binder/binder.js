/* The card binder (binder.html): every Mega card this browser has pulled from the home page's packs.
   Nothing is sent anywhere. The pack writes the collection to localStorage "pk-binder":
     {"v":1,"cards":{"<slug>":{"n":<times pulled>,"t":<first pulled, ms>}}}
   and this page only reads it (missing, blocked or damaged storage reads as an empty binder).

   The binder is a three-ring binder of pocket pages, 3 x 3 sleeves a page, cards in set order.
   - Closed: the cover. Opening swings it over to the left; its inside carries the set list.
   - Wide screens show a spread: two facing pages across the rings. The first spread is the inside
     cover and page 1, the last ends on the inside back cover. Phones show one page at a time.
   - A page turn is a sheet that swings over the rings in 3D (buttons, arrow keys, swipe). With reduced
     motion the pages just change.
   - Tap a card: the viewer shows it large. It tilts toward the pointer (a mouse hovering, or a finger
     held on it) with a light that follows, and turns over to its moves on a tap or Enter.
   - binder?new=<slug> (the pack links here after a pull) opens straight on that card's page and drops
     the new card into its sleeve.
   Cards are pixel art: their on-screen widths are picked so the card files land on whole device pixels
   where the screen allows, and a card at rest is drawn with no transform at all. */
(() => {
  'use strict';
  const root = document.querySelector('[data-bd]');
  if (!root) return;
  const $ = (sel) => root.querySelector(sel);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const KEY = 'pk-binder';
  const PER = 9;                               // sleeves on a page
  const TURN_MS = 760, OPEN_MS = 900, FLIP_MS = 560;
  const TILT_X = 11, TILT_Y = 15;              // degrees at the card's edge

  let C = [], N = 0, FLIP = null, SFX = [];
  let have = {};                               // slug -> { n, t }
  let P = 0;                                   // pocket pages
  let L = null;                                // layout (CSS px)
  let view = -1;                               // -1 closed; else the spread (wide) or the page (phone)
  let busy = false;                            // a turn or the cover is moving
  let newSlug = null;

  const binder = $('[data-bd-binder]'), stage = $('[data-bd-stage]');
  const el = {};                               // the binder's parts, made in build()

  // ── helpers ───────────────────────────────────────────────────────────
  const pad = (n, w) => String(n).padStart(w, '0');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const easeFlip = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
  const owned = (c) => !!have[c.slug];
  const count = () => C.filter(owned).length;

  function readBinder() {
    let cards = {};
    try {
      const o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && o.cards && typeof o.cards === 'object') cards = o.cards;
    } catch (e) { /* blocked or damaged: an empty binder */ }
    const out = {};
    Object.keys(cards).forEach((slug) => {
      const v = cards[slug] || {};
      out[slug] = { n: Math.max(1, Math.floor(+v.n) || 1), t: +v.t || 0 };
    });
    return out;
  }

  // ── start ─────────────────────────────────────────────────────────────
  fetch(root.dataset.bd).then((r) => { if (!r.ok) throw r; return r.json(); }).then(init).catch(() => {
    $('[data-bd-failed]').hidden = false;
    stage.hidden = true;
    root.querySelector('.bd-foot').hidden = true;
    $('[data-bd-hint]').hidden = true;
  });

  function init(data) {
    C = data.cards; N = C.length; FLIP = data.flip || null; SFX = data.sfx || [];
    P = Math.ceil(N / PER);
    have = readBinder();
    const q = new URLSearchParams(location.search).get('new');
    if (q && C.some((c) => c.slug === q)) {
      newSlug = q;
      if (!have[q]) have[q] = { n: 1, t: Date.now() };   // storage blocked: still show the card just pulled
    }
    $('[data-bd-total]').textContent = N;
    layout();
    build();
    paintCounts();
    if (newSlug) {
      const page = C.findIndex((c) => c.slug === newSlug) / PER | 0;
      show(viewOfPage(page));
      setTimeout(() => dropIn(newSlug), 60);
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* file:// */ }
    } else show(-1);
    bind();
    preloadSounds();
    new ResizeObserver(() => relayout()).observe(stage);
    window.addEventListener('storage', (e) => { if (e.key === KEY) refresh(); });
  }

  // a pack opened in another tab: repaint the pockets and the counts
  function refresh() {
    have = readBinder();
    paintCounts();
    paintCover();
    show(view, true);
  }

  // ── layout: card size from the room there is ─────────────────────────
  function exactWidth(target) {
    // the pocket images are 360 px files (720 on dense screens): use a width where one file pixel is a
    // whole or quarter device pixel when one is close to the target
    const dpr = window.devicePixelRatio || 1;
    let best = 0;
    for (const s of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]) {
      const w = (360 * s) / dpr;
      if (w <= target * 1.02) best = w;
    }
    return best >= target * 0.78 ? best : Math.floor(target);
  }
  function unit() {                            // the smallest whole CSS px that is whole in device px
    const dpr = window.devicePixelRatio || 1;
    for (let k = 1; k <= 4; k++) if (Math.abs(k * dpr - Math.round(k * dpr)) < 0.01) return k;
    return 1;
  }
  function layout() {
    const W = stage.clientWidth, u = unit();
    const snap = (v) => Math.max(u, Math.round(v / u) * u);
    const wide = W >= 900;
    const pk = snap(wide ? 8 : 4), gap = snap(wide ? 8 : 4), pp = snap(wide ? 12 : 8), sp = snap(wide ? 24 : 16), bm = snap(wide ? 8 : 6);
    const fixedW = bm + sp + 2 * pp + 2 * gap + 6 * pk;
    const fixedH = 2 * bm + 2 * pp + 2 * gap + 6 * pk;
    // wide: as big as 180 px a card (the 360 px files at half size); short screens scale down to fit
    let target = wide ? Math.min((W / 2 - fixedW) / 3, 180) : Math.min((W - fixedW) / 3, 150);
    if (wide && window.innerHeight < 760) target = Math.min(target, (Math.max(520, window.innerHeight - 120) - fixedH) / (3 * 1.4));
    const cw = exactWidth(Math.max(56, target));
    const ch = cw * 1.4;
    const qw = cw + 2 * pk, qh = ch + 2 * pk;
    const pw = bm + sp + 2 * pp + 3 * qw + 2 * gap, ph = 2 * bm + 2 * pp + 3 * qh + 2 * gap;
    L = { wide, u, cw, ch, pk, gap, pp, sp, bm, qw, qh, pw, ph, bw: wide ? 2 * pw : pw };
    const s = binder.style;
    s.setProperty('--cw', `${cw}px`); s.setProperty('--ch', `${ch}px`);
    s.setProperty('--pk', `${pk}px`); s.setProperty('--gap', `${gap}px`);
    s.setProperty('--pp', `${pp}px`); s.setProperty('--sp', `${sp}px`); s.setProperty('--bm', `${bm}px`);
    s.setProperty('--pw', `${pw}px`); s.setProperty('--ph', `${ph}px`);
    s.setProperty('--bw', `${L.bw}px`);
    binder.classList.toggle('is-wide', wide);
    binder.classList.toggle('is-narrow', !wide);
    stage.style.height = `${ph}px`;
    align();
  }
  // the binder centred in the stage with its top-left on a whole device pixel, so its pockets are too
  function align() {
    const dpr = window.devicePixelRatio || 1;
    const r = stage.getBoundingClientRect();
    const x = r.left + (r.width - L.bw) / 2, y = r.top + window.scrollY;
    binder.style.left = `${Math.round(x * dpr) / dpr - r.left}px`;
    binder.style.top = `${Math.round(y * dpr) / dpr - y}px`;
  }
  function relayout() {
    if (!L) return;
    const was = L.wide, firstPage = pageOfView(view);
    layout();
    if (was !== L.wide) show(view < 0 ? -1 : viewOfPage(firstPage), true);
    else { sizeImages(binder); align(); }
  }

  // ── which pages a view shows ──────────────────────────────────────────
  // wide: the items in spread order, two per spread: [cover inside, page 0, page 1, ..., inside back]
  function items() {
    const a = ['ifc'];
    for (let p = 0; p < P; p++) a.push(p);
    if (a.length % 2) a.push('ibc'); else a.push('blank', 'ibc');
    return a;
  }
  const lastView = () => (L.wide ? items().length / 2 - 1 : P - 1);
  function viewOfPage(p) { return L.wide ? Math.floor((p + 1) / 2) : p; }
  function pageOfView(v) { return v < 0 ? 0 : L.wide ? Math.max(0, 2 * v - 1) : v; }
  function sides(v) {                          // what the left and right halves hold for a view
    if (!L.wide) return { l: null, r: v };
    const a = items();
    return { l: a[2 * v], r: a[2 * v + 1] };
  }

  // ── DOM ───────────────────────────────────────────────────────────────
  function build() {
    binder.innerHTML =
      '<div class="bd-back" aria-hidden="true"></div>' +
      '<div class="bd-half bd-half--l"></div><div class="bd-half bd-half--r"></div>' +
      '<div class="bd-rings" aria-hidden="true"><i></i><i></i><i></i></div>' +
      '<div class="bd-cover"><div class="bd-cover-front"></div><div class="bd-cover-in"></div></div>';
    el.l = binder.querySelector('.bd-half--l');
    el.r = binder.querySelector('.bd-half--r');
    el.cover = binder.querySelector('.bd-cover');
    el.front = binder.querySelector('.bd-cover-front');
    el.inside = binder.querySelector('.bd-cover-in');
    paintCover();
  }

  function paintCover() {
    const n = count(), done = n === N;
    el.front.innerHTML =
      '<span class="bd-spine" aria-hidden="true"></span>' +
      '<img class="bd-cover-logo" src="assets/md/lockup-wot.webp" width="1200" height="756" alt="Pokémon Wishes of Tomorrow: Mega Dimension">' +
      '<p class="bd-cover-kicker">Mega card binder</p>' +
      `<p class="bd-plate"><b>${n}</b><span>/ ${N}</span></p>` +
      (done ? '<span class="bd-stamp" aria-label="Complete set">Complete</span>' : '') +
      '<button class="ff-btn ff-btn--violet ff-btn--sm bd-open" type="button" data-bd-open>Open the binder<i class="ff-i ff-i-arrow" aria-hidden="true"></i></button>';
    el.front.querySelector('[data-bd-open]').addEventListener('click', (e) => { e.stopPropagation(); wake(); go(0); });
    // the inside of the cover: the set list (names show once the card is pulled)
    const rows = C.map((c) => {
      const o = owned(c);
      return `<li class="${o ? 'is-owned' : ''}"><b>${pad(c.n, 3)}</b><span>${o ? esc(c.name) : '—'}</span>${o ? '<i class="bd-tick" aria-label="pulled"></i>' : ''}</li>`;
    }).join('');
    el.inside.innerHTML =
      '<div class="bd-setlist"><p class="bd-setlist-head"><span>Set list</span>' +
      `<b>${n} / ${N}</b></p><ol>${rows}</ol>` +
      '<p class="bd-setlist-foot">28 Megas · 2 secret rares</p></div>';
  }

  function paintCounts() {
    const n = count();
    $('[data-bd-have]').textContent = n;
    $('[data-bd-status]').textContent = n === N ? 'Complete set' : n === 1 ? 'card collected' : 'cards collected';
    $('[data-bd-bar]').style.width = `${(n / N) * 100}%`;
    root.classList.toggle('is-complete', n === N);
    $('[data-bd-empty]').hidden = !(n === 0 && view >= 0);
  }

  // a page of sleeves (p: the page number), drawn for one side of the rings
  const srcset = (slug) => `assets/cards/img/${slug}-360.webp 360w, assets/cards/img/${slug}-720.webp 720w`;
  function makePage(item, side) {
    const pg = document.createElement('div');
    pg.className = `bd-page bd-page--${side}`;
    if (item === 'ibc' || item === 'ifc') { pg.classList.add('bd-page--board'); pg.innerHTML = item === 'ibc' ? boardBack() : ''; return pg; }
    pg.innerHTML = '<span class="bd-holes" aria-hidden="true"><i></i><i></i><i></i></span><div class="bd-grid"></div>';
    if (item === 'blank' || item === null) return pg;
    const grid = pg.querySelector('.bd-grid');
    pg.setAttribute('role', 'group');
    pg.setAttribute('aria-label', `Page ${item + 1} of ${P}`);
    for (let k = 0; k < PER; k++) {
      const i = item * PER + k, c = C[i];
      let q;
      if (!c) {                                // the sleeves past the last card
        q = document.createElement('div');
        q.className = 'bd-pocket is-spare';
        q.setAttribute('aria-hidden', 'true');
        q.innerHTML = '<span class="bd-sleeve"></span>';
      } else if (owned(c)) {
        const h = have[c.slug];
        q = document.createElement('button');
        q.type = 'button';
        q.className = 'bd-pocket is-owned';
        q.dataset.i = i;
        q.setAttribute('aria-label', `${pad(c.n, 3)}: ${c.name}, ${c.finish}${h.n > 1 ? `, ×${h.n}` : ''}. Open`);
        q.innerHTML = `<img class="bd-card" alt="" draggable="false" src="assets/cards/img/${c.slug}-360.webp" srcset="${srcset(c.slug)}" width="360" height="504">` +
          '<span class="bd-sleeve"></span>' + (h.n > 1 ? `<span class="bd-dupe">×${h.n}</span>` : '');
      } else {
        const secret = c.n > 28;
        q = document.createElement('div');
        q.className = `bd-pocket is-missing${secret ? ' is-secret' : ''}`;
        q.setAttribute('role', 'img');
        q.setAttribute('aria-label', `${pad(c.n, 3)}: ${secret ? 'secret rare, ' : ''}not pulled yet`);
        q.innerHTML = `<img class="bd-sil" alt="" draggable="false" src="assets/cards/sprites/${c.slug}.png" width="${c.size}" height="${c.size}" data-size="${c.size}">` +
          `<span class="bd-no">${pad(c.n, 3)}</span>${secret ? '<span class="bd-secret">Secret rare</span>' : ''}<span class="bd-sleeve"></span>`;
      }
      grid.appendChild(q);
    }
    pg.insertAdjacentHTML('beforeend', `<span class="bd-pageno" aria-hidden="true">${item + 1}</span>`);
    sizeImages(pg);
    return pg;
  }
  function boardBack() {
    return '<img class="bd-board-mark" src="assets/md/lockup.webp" width="1200" height="346" alt="">' +
      '<p class="bd-board-line">Wishes of Tomorrow · Flatfoot Labs</p>';
  }
  // pocket images at the card width; silhouettes at a whole-number scale that fits the sleeve
  function sizeImages(scope) {
    scope.querySelectorAll('.bd-card').forEach((im) => { im.sizes = `${L.cw}px`; });
    scope.querySelectorAll('.bd-sil').forEach((im) => {
      const s = +im.dataset.size, k = Math.max(1, Math.floor((L.cw * 0.92) / s));
      im.style.width = im.style.height = `${s * k}px`;
    });
  }

  // ── showing a view ────────────────────────────────────────────────────
  function fill(half, item, side) {
    half.textContent = '';
    if (item === null || item === undefined || item === 'ifc') return;
    half.appendChild(makePage(item, side));
  }
  function show(v, quiet) {
    view = v;
    const open = v >= 0;
    binder.classList.toggle('is-open', open);
    binder.classList.toggle('is-closed', !open);
    el.cover.style.transform = '';
    if (open) {
      const s = sides(v);
      fill(el.l, s.l, 'l');
      fill(el.r, s.r, 'r');
    } else { el.l.textContent = ''; el.r.textContent = ''; }
    // the open cover lies under the left half on a wide screen, and is folded away on a phone
    el.cover.classList.toggle('is-under', open);
    paintWhere();
    paintCounts();
    if (!quiet) announce();
  }
  function paintWhere() {
    const where = $('[data-bd-where]');
    if (view < 0) where.textContent = 'Cover';
    else if (!L.wide) where.textContent = `Page ${view + 1} of ${P}`;
    else {
      const s = sides(view), ps = [s.l, s.r].filter((x) => typeof x === 'number').map((x) => x + 1);
      where.textContent = ps.length > 1 ? `Pages ${ps[0]}–${ps[1]} of ${P}` : ps.length ? `Page ${ps[0]} of ${P}` : 'Inside cover';
    }
    $('[data-bd-prev]').disabled = view < 0;
    $('[data-bd-next]').disabled = view >= lastView();
  }
  function announce() {
    const live = $('[data-bd-live]');
    live.textContent = view < 0 ? `The binder is closed. ${count()} of ${N} cards.` : $('[data-bd-where]').textContent;
  }

  // ── turning ───────────────────────────────────────────────────────────
  function go(to) {
    if (busy || !L) return;
    to = clamp(to, -1, lastView());
    if (to === view) return;
    const dir = to > view ? 1 : -1;
    if (reduce.matches) { show(to); return; }
    if (view < 0 || to < 0) { swingCover(to); return; }
    if (Math.abs(to - view) > 1) { show(to); return; }
    turn(dir);
  }

  // the cover swings round the rings (and the binder slides so the open spread is centred)
  function swingCover(to) {
    busy = true;
    const opening = to >= 0;
    playTurn(OPEN_MS);
    if (opening) {
      const s = sides(to);
      fill(el.l, s.l, 'l'); fill(el.r, s.r, 'r');
      binder.classList.add('is-open', 'is-opening'); binder.classList.remove('is-closed');
    } else binder.classList.add('is-closing');
    const from = opening ? 0 : -180, end = opening ? -180 : 0;
    const shift = L.wide ? L.pw / 2 : 0;
    // on a phone the cover folds away off the left edge, so it fades as it goes
    const kf = L.wide ? [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${end}deg)` }]
      : [{ transform: `rotateY(${from}deg)`, opacity: opening ? 1 : 0 }, { transform: `rotateY(${(from + end) / 2}deg)`, opacity: 1, offset: 0.55 },
         { transform: `rotateY(${end}deg)`, opacity: opening ? 0 : 1 }];
    const a = el.cover.animate(kf, { duration: OPEN_MS, easing: 'cubic-bezier(.55,0,.25,1)', fill: 'forwards' });
    const b = binder.animate([{ transform: `translateX(${opening ? -shift : 0}px)` }, { transform: `translateX(${opening ? 0 : -shift}px)` }],
      { duration: OPEN_MS, easing: 'cubic-bezier(.55,0,.25,1)', fill: 'forwards' });
    done([a, b], OPEN_MS, () => {
      binder.classList.remove('is-opening', 'is-closing');
      a.cancel(); b.cancel();
      busy = false;
      show(to);
    });
  }

  // a sheet over the rings: forward lifts the right page over to the left; back brings the left one over
  function turn(dir) {
    busy = true;
    const cur = sides(view), next = sides(view + dir);
    const sheet = document.createElement('div');
    sheet.className = 'bd-sheet';
    const front = document.createElement('div'), back = document.createElement('div');
    front.className = 'bd-sheet-face bd-sheet-face--front';
    back.className = 'bd-sheet-face bd-sheet-face--back';
    if (dir > 0) {                             // the sheet: this right page on its front, the next left page on its back
      front.appendChild(makePage(cur.r, 'r'));
      if (L.wide) back.appendChild(makePage(next.l, 'l'));
      else back.appendChild(makePage('blank', 'l'));
      fill(el.r, next.r, 'r');
    } else {
      front.appendChild(makePage(next.r, 'r'));
      if (L.wide) { back.appendChild(makePage(cur.l, 'l')); fill(el.l, next.l, 'l'); }
      else back.appendChild(makePage('blank', 'l'));
    }
    if (!L.wide && dir < 0) { /* the page underneath stays until the sheet lands */ }
    sheet.append(front, back);
    binder.appendChild(sheet);
    playTurn(TURN_MS);
    // wide: right over the rings to the other side; phone: the spine is the screen's edge, so the page
    // lifts away (or comes back) to a quarter turn and fades there instead of going off screen
    const kf = L.wide
      ? [{ transform: `rotateY(${dir > 0 ? 0 : -180}deg)` }, { transform: `rotateY(${dir > 0 ? -180 : 0}deg)` }]
      : dir > 0
        ? [{ transform: 'rotateY(0deg)', opacity: 1 }, { transform: 'rotateY(-60deg)', opacity: 1, offset: 0.55 }, { transform: 'rotateY(-96deg)', opacity: 0 }]
        : [{ transform: 'rotateY(-96deg)', opacity: 0 }, { transform: 'rotateY(-60deg)', opacity: 1, offset: 0.45 }, { transform: 'rotateY(0deg)', opacity: 1 }];
    const a = sheet.animate(kf, { duration: TURN_MS, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' });
    done([a], TURN_MS, () => { sheet.remove(); busy = false; show(view + dir); });
  }
  // the end of an animation, or a timer when a hidden tab never runs it
  function done(anims, ms, fn) {
    let fired = false;
    const once = () => { if (!fired) { fired = true; fn(); } };
    Promise.all(anims.map((a) => a.finished)).then(once, once);
    setTimeout(once, ms + 250);
  }

  // ── a new card drops into its sleeve ──────────────────────────────────
  function dropIn(slug) {
    const i = C.findIndex((c) => c.slug === slug);
    const q = binder.querySelector(`.bd-pocket[data-i="${i}"]`);
    if (!q) return;
    q.classList.add('is-new');
    // a first copy says New; a duplicate says +1 (its sleeve's corner already shows how many)
    q.insertAdjacentHTML('beforeend', `<span class="bd-newtag">${(have[slug] || {}).n > 1 ? '+1' : 'New'}</span>`);
    const r = q.getBoundingClientRect();
    if (r.top < 70 || r.bottom > window.innerHeight) q.scrollIntoView({ block: 'center', behavior: reduce.matches ? 'auto' : 'smooth' });
    if (reduce.matches) return;
    q.classList.add('is-dropping');
    const img = q.querySelector('.bd-card');
    img.addEventListener('animationend', () => { q.classList.remove('is-dropping'); q.classList.add('is-landed'); playSlide(0); }, { once: true });
  }

  // ── the viewer ────────────────────────────────────────────────────────
  const V = { box: document.querySelector('[data-bd-view]'), i: -1, back: false, angle: 0, flip: null,
              tilt: { x: 0, y: 0, tx: 0, ty: 0 }, raf: 0, last: 0, opener: null, held: null };
  const vcard = document.querySelector('[data-bd-vcard]'), vbody = document.querySelector('[data-bd-vbody]');
  const vfront = document.querySelector('[data-bd-vfront]'), vback = document.querySelector('[data-bd-vback]');

  // the card's width: on phones the words, the Mystery Code and the arrows sit under it, so it takes the height
  // they leave (info = their measured height; 70 px of the view's top padding holds the close button)
  function vWidth(info) {
    const dpr = window.devicePixelRatio || 1;
    const narrow = window.innerWidth < 760;
    const tall = narrow ? Math.max(200, window.innerHeight - 70 - 16 - 18 - info) : window.innerHeight * 0.8;
    const target = Math.min(tall / 1.4, window.innerWidth * (narrow ? 0.82 : 0.5), 432);
    let best = 0;
    for (const s of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]) { const w = (720 * s) / dpr; if (w <= target * 1.02) best = w; }
    return best >= target * 0.86 ? best : Math.floor(target);
  }
  function openView(i, from) {
    const c = C[i];
    if (!c || !owned(c)) return;
    V.i = i; V.back = false; V.angle = 0; V.flip = null;
    V.tilt.x = V.tilt.y = V.tilt.tx = V.tilt.ty = 0;
    if (from) V.opener = from;
    vfront.alt = `${c.name} card, ${c.finish} finish`;
    vback.alt = `${c.name} card, back: ability and moves`;
    const h = have[c.slug];
    document.querySelector('[data-bd-vname]').textContent = c.name;
    const date = h.t ? new Date(h.t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    document.querySelector('[data-bd-vmeta]').innerHTML =
      `<span>${pad(c.n, 3)}</span><i>·</i><span>${esc(c.finish)}</span><i>·</i><span>BST ${c.bst}</span>` +
      (date ? `<br><span>Pulled ${esc(date)}</span>` : '') + (h.n > 1 ? `<i>·</i><b>×${h.n}</b>` : '') +
      `<br><small>${esc(c.credit)}</small>`;
    // its Mystery Code: only for a card in the binder (the viewer opens on nothing else)
    const code = owned(c) && c.code ? c.code : '';
    document.querySelector('[data-bd-vcode]').hidden = !code;
    document.querySelector('[data-bd-vcode-note]').hidden = !code;
    document.querySelector('[data-bd-vcode-value]').textContent = code;
    resetCopy();
    const many = C.filter(owned).length > 1;
    document.querySelector('[data-bd-vprev]').hidden = !many;
    document.querySelector('[data-bd-vnext]').hidden = !many;
    if (V.box.hidden) {
      V.box.hidden = false;
      document.documentElement.classList.add('bd-lock');
    }
    const w = vWidth(document.querySelector('.bd-vinfo').offsetHeight);   // sized once the words are in
    vcard.style.width = `${w}px`; vcard.style.height = `${w * 1.4}px`;
    for (const [im, side] of [[vfront, ''], [vback, '-back']]) {
      im.sizes = `${w}px`;
      im.srcset = `assets/cards/img/${c.slug}${side}-360.webp 360w, assets/cards/img/${c.slug}${side}-720.webp 720w`;
      im.src = `assets/cards/img/${c.slug}${side}-720.webp`;
    }
    vpose();
    vcard.focus({ preventScroll: true });
  }
  function closeView() {
    if (V.box.hidden) return;
    V.box.hidden = true;
    document.documentElement.classList.remove('bd-lock');
    V.i = -1; V.flip = null;
    if (V.opener && document.contains(V.opener)) V.opener.focus({ preventScroll: true });
  }
  function stepView(dir) {
    const own = C.map((c, i) => (owned(c) ? i : -1)).filter((i) => i >= 0);
    const k = own.indexOf(V.i);
    openView(own[(k + dir + own.length) % own.length]);
  }
  function vflip() {
    const from = V.flip ? V.angle : (V.back ? 180 : 0);
    const to = V.flip ? (V.flip.to === 180 ? 0 : 180) : (V.back ? 0 : 180);
    const dur = reduce.matches ? 0 : FLIP_MS * Math.abs(to - from) / 180;
    V.flip = { from, to, t0: performance.now(), dur };
    V.back = to === 180;
    playFlip(dur / 2000);
    vkick();
  }
  function vkick() { if (!V.raf) V.raf = requestAnimationFrame(vtick); }
  function vtick(now) {
    V.raf = 0;
    const dt = V.last ? Math.min(0.05, (now - V.last) / 1000) : 0.016;
    V.last = now;
    let more = false;
    const t = V.tilt, k = reduce.matches ? 1 : 1 - Math.exp(-dt / 0.09);
    t.x += (t.tx - t.x) * k; t.y += (t.ty - t.y) * k;
    if (Math.abs(t.tx - t.x) + Math.abs(t.ty - t.y) > 0.002) more = true; else { t.x = t.tx; t.y = t.ty; }
    if (V.flip) {
      const p = V.flip.dur <= 0 ? 1 : clamp((now - V.flip.t0) / V.flip.dur, 0, 1);
      V.angle = V.flip.from + (V.flip.to - V.flip.from) * easeFlip(p);
      V.lift = 1 + 0.05 * Math.sin(Math.PI * p);
      if (p >= 1) { V.angle = V.flip.to % 360; V.flip = null; V.lift = 1; } else more = true;
    }
    vpose();
    if (more) vkick(); else V.last = 0;
  }
  // flat and untransformed at rest (sharp pixels); in 3D only while it tilts or turns
  function vpose() {
    const t = V.tilt, rx = -t.y * TILT_X, ry = t.x * TILT_Y;
    const flat = Math.abs(rx) < 0.05 && Math.abs(ry) < 0.05 && !V.flip;
    vcard.classList.toggle('is-3d', !flat);
    vcard.classList.toggle('is-back', V.back);
    if (flat) { vbody.style.transform = ''; vcard.style.removeProperty('--lt'); return; }
    const P3 = (vcard.clientWidth * 4.2).toFixed(0);
    vbody.style.transform = `perspective(${P3}px) rotateX(${rx.toFixed(2)}deg) rotateY(${(V.angle + ry).toFixed(2)}deg) scale(${(V.lift || 1).toFixed(4)})`;
    const mx = 50 + t.x * 45, my = 50 + t.y * 45;
    vcard.style.setProperty('--mx', `${mx.toFixed(1)}%`);
    vcard.style.setProperty('--mxb', `${(100 - mx).toFixed(1)}%`);
    vcard.style.setProperty('--my', `${my.toFixed(1)}%`);
    vcard.style.setProperty('--lt', Math.min(1, Math.hypot(t.x, t.y)).toFixed(3));
  }
  function vaim(x, y) {
    if (reduce.matches) x = y = 0;
    if (x !== V.tilt.tx || y !== V.tilt.ty) { V.tilt.tx = x; V.tilt.ty = y; vkick(); }
  }
  function vover(e) {
    const r = vcard.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    return Math.abs(x) <= 1.04 && Math.abs(y) <= 1.04 ? { x: clamp(x, -1, 1), y: clamp(y, -1, 1) } : null;
  }

  // ── input ─────────────────────────────────────────────────────────────
  function bind() {
    $('[data-bd-prev]').addEventListener('click', () => { wake(); go(view - 1); });
    $('[data-bd-next]').addEventListener('click', () => { wake(); go(view + 1); });
    // the closed cover opens on a tap anywhere on it
    binder.addEventListener('click', (e) => {
      if (swiped) { swiped = false; e.preventDefault(); e.stopPropagation(); return; }
      if (view < 0 && e.target.closest('.bd-cover')) { wake(); go(0); return; }
      const q = e.target.closest('.bd-pocket.is-owned');
      if (q) { wake(); openView(+q.dataset.i, q); }
    }, true);
    document.addEventListener('keydown', (e) => {
      if (!V.box.hidden) {
        if (e.key === 'Escape') { e.preventDefault(); closeView(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); stepView(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); stepView(-1); }
        else if ((e.key === 'Enter' || e.key === ' ') && e.target === vcard) { e.preventDefault(); wake(); vflip(); }
        else if (e.key === 'Tab') trapTab(e);
        return;
      }
      if (e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); wake(); go(view + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); wake(); go(view - 1); }
    });
    // swipe to turn
    let sw = null, swiped = false;
    stage.addEventListener('pointerdown', (e) => { if (e.button === 0) sw = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
    stage.addEventListener('pointerup', (e) => {
      if (!sw || sw.id !== e.pointerId) return;
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.3) { swiped = true; setTimeout(() => { swiped = false; }, 400); wake(); go(view + (dx < 0 ? 1 : -1)); }
    });
    stage.addEventListener('pointercancel', () => { sw = null; });

    // the viewer
    V.box.querySelectorAll('[data-bd-close]').forEach((b) => b.addEventListener('click', closeView));
    document.querySelector('[data-bd-vprev]').addEventListener('click', () => stepView(-1));
    document.querySelector('[data-bd-vnext]').addEventListener('click', () => stepView(1));
    document.querySelector('[data-bd-vcopy]').addEventListener('click', copyCode);
    vcard.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' || V.held === e.pointerId) { const o = vover(e); vaim(o ? o.x : 0, o ? o.y : 0); }
    });
    vcard.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') vaim(0, 0); });
    vcard.addEventListener('pointerdown', (e) => {
      wake();
      if (e.pointerType !== 'mouse') { V.held = e.pointerId; const o = vover(e); if (o) vaim(o.x, o.y); }
      V.down = { x: e.clientX, y: e.clientY };
    });
    const release = (e) => { if (V.held === e.pointerId) { V.held = null; vaim(0, 0); } };
    vcard.addEventListener('pointerup', (e) => {
      const d = V.down; V.down = null; release(e);
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 12) vflip();
    });
    vcard.addEventListener('pointercancel', release);

    const snd = $('[data-bd-sound]');
    try { if (localStorage.getItem('fc-sound') === 'off') snd.setAttribute('aria-pressed', 'false'); } catch (e) { /* storage blocked */ }
    snd.addEventListener('click', () => {
      const on = snd.getAttribute('aria-pressed') !== 'true';
      snd.setAttribute('aria-pressed', String(on));
      try { localStorage.setItem('fc-sound', on ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
      if (on) { wake(); playSlide(0); }
    });
  }
  // the viewer's Mystery Code: copy it, or leave it selected where the browser has no clipboard
  let copyT = 0;
  function resetCopy() {
    clearTimeout(copyT);
    document.querySelector('[data-bd-vcopy]').textContent = 'Copy';
    document.querySelector('.bd-vcode-said').textContent = '';
  }
  function copyCode() {
    const btn = document.querySelector('[data-bd-vcopy]'), el = document.querySelector('[data-bd-vcode-value]');
    const text = el.textContent;
    const done = (ok) => {
      if (!ok) {
        try { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { /* old browsers */ }
      }
      btn.textContent = ok ? 'Copied' : 'Selected';
      document.querySelector('.bd-vcode-said').textContent = ok ? 'Code copied' : 'Code selected: copy it with your device';
      clearTimeout(copyT);
      copyT = setTimeout(resetCopy, 1800);
    };
    const legacy = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;opacity:0';
      btn.parentNode.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove(); btn.focus({ preventScroll: true });
      return ok;
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => done(true), () => done(legacy()));
    else done(legacy());
  }
  function trapTab(e) {
    const f = [...V.box.querySelectorAll('button:not([hidden]), [tabindex="0"]')].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }

  // ── sound: the page turn (a real recording) and the card-slide takes ─
  let ctx = null, gain = null, flipBuf = null, slideBufs = [], raw = null, take = 0;
  const soundOn = () => $('[data-bd-sound]').getAttribute('aria-pressed') === 'true';
  function preloadSounds() {
    const srcs = (FLIP ? [FLIP.src] : []).concat(SFX.map((s) => s.src));
    raw = Promise.all(srcs.map((s) => fetch(s).then((r) => r.arrayBuffer()))).catch(() => null);
  }
  function wake() {                            // browsers start audio only from a gesture
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !raw) return;
    ctx = new AC();
    gain = ctx.createGain(); gain.gain.value = 0.8; gain.connect(ctx.destination);
    raw.then((arrs) => {
      if (!arrs) return;
      return Promise.all(arrs.map((a) => new Promise((res) => ctx.decodeAudioData(a.slice(0), res, () => res(null))))).then((b) => {
        flipBuf = FLIP ? b[0] : null;
        slideBufs = b.slice(FLIP ? 1 : 0).filter(Boolean);
      });
    });
  }
  function startBuf(buf, peak, lead, level) {  // a buffer whose peak lands `lead` s from now
    const now = ctx.currentTime;
    let at = now + lead - peak, off = 0;
    if (at < now) { off = Math.min(now - at, Math.max(0, peak - 0.03)); at = now; }
    const src = ctx.createBufferSource(), g = ctx.createGain();
    g.gain.value = level; src.buffer = buf; src.connect(g); g.connect(gain);
    src.start(at, off);
  }
  function playFlip(lead) { if (ctx && flipBuf && soundOn()) startBuf(flipBuf, FLIP.peak, lead, 0.9); }
  function playTurn(ms) { playFlip(ms / 2000); }
  function playSlide(lead) {
    if (!ctx || !slideBufs.length || !soundOn()) return;
    const n = take++ % slideBufs.length;
    startBuf(slideBufs[n], SFX[n] ? SFX[n].peak : 0.2, lead, 0.9);
  }
})();
