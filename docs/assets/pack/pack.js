/* The Mega Dimension booster pack (styles in pack.css).
   - Drawn in WebGL as a real pillow: the body bulges, its sides curve away, and two studio softboxes
     (left and right) plus a soft overhead panel reflect off the curve. That gives the bright side
     shines of a foil pack, and they slide over the edges and crinkles as it turns. The surface comes
     from img/normal.webp (made with the same pillow numbers as PILLOW below). Without WebGL it falls
     back to the flat image with CSS light layers.
   - Tilt: a mouse over the pack, or a finger held on it, turns it (the pointer's side dips away, as
     the card carousel does). At rest the pack is drawn flat-on with no perspective, texel for pixel,
     so its sprite pixels stay whole.
   - Before the drop: a click or tap (or Enter / Space) shakes it like a pack you are guessing the cards in,
     every 7 s while it sits on screen untouched a light sweeps across it, and it counts down to data-drop
     (an ISO time with its UTC offset): gold digits in the last minute, "Out now" at zero. With reduced
     motion it neither tilts, shakes nor sweeps.

   After the drop (and only once the cards' list and images load) packs open, as many as you like:
   - The pull: each pack holds one card, drawn when the pack is ready from all of the set, so a pack can
     give a card the visitor already has. The odds follow the card's finish the way rarities do in a real
     pack (ODDS below). The binder is kept in this browser (localStorage "pk-binder", with how many of each
     card); binder.html shows it.
   - Focus: a tap (or Enter / Space) on the pack lifts it to the middle of the screen, over the page blurred
     behind a violet glow. Close, Escape or a tap outside puts it back.
   - The rip (in focus): drag across the top of the pack and the foil tears along your finger, the strip above
     the tear peeling toward you and light running out of the slit. The light's colour tells the rarity:
     violet for plain and gem finishes, gold for rainbow, gold and cosmos, fire red for the secret rares.
     A tap rips it in one go.
   - Sound (sfx/, Web Audio, the site's own on/off setting): the foil crinkles and tears as fast as the finger
     goes, the strip swishes off, the card slides out and whooshes forward and lands with its rarity's sound,
     the secret rares with their own swell and sting. A sound set whose sfx.json has "cues" plays its own
     sounds at the opening's moments instead, by the card's step (stepOf): builds that end on the landing,
     then the hit.
   - The pull-out: the strip flies off as the tear reaches the far side, the card rises out of the pack,
     is pulled clear and comes forward to the middle of the screen as the night comes up behind it. As it
     lands its rarity shows in light (TIERS): a soft flash and a glint for plain and gem finishes; a
     brighter flash and twinkles around the frame for rainbow, gold and cosmos; a flash over the whole
     screen and more twinkles, in the card's own colour, for the secret rares. Then its name, whether it
     is new or a duplicate (with how many the binder now holds), the binder count, and the card's Mystery
     Code (cards.json "code", with a copy button) that the game takes for this Mega. "Open another pack"
     drops a fresh pack in its place.
   - Without WebGL, or with reduced motion, a tap goes straight to the card.
   - When the countdown reaches zero on an open page, the pack's Megas light up with a soft flash and a
     few twinkles.
   - The cards are only ever seen by pulling them: there is no gallery of the set (the Pokédex has their stats).
     Under the pack: the binder link with the count, and how many packs everyone has opened (Abacus counter).
   - The after-launch page is built with data-open on [data-pack]: open on every visit, whatever the clock says.
   - Preview on a local server before the drop: ?pack=open; ?pack=open&hit=<slug> forces the first pull;
     &sfx=<name> plays the sound set in sfx/opt-<name>/. */
(function () {
  "use strict";
  var root = document.querySelector("[data-pack]");
  if (!root) return;
  root.classList.add("is-js");
  var btn = root.querySelector("[data-pack-btn]");
  var shaker = root.querySelector("[data-pack-shake]");
  var tiltEl = root.querySelector("[data-pack-tilt]");
  var img = root.querySelector(".pk-img");
  var reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var TILT_X = 12, TILT_Y = 16;               // degrees at the pack's edge
  var tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  var shake = null, sweep = null, onScreen = true;
  var raf = 0, last = 0, held = null;
  var gl = null;                              // the WebGL renderer, once it has drawn
  var state = "sealed";                       // sealed | checking | ready | focusing | opening | revealed
  var opening = null;                         // the opening's timeline while it plays
  var rip = null;                             // the tear while it runs: { dir, prog, target, auto }
  var landing = null;                         // a fresh pack dropping into place: { t0 }
  var lit = { v: 0, to: 0 };                  // the pack's Megas: 0 silhouettes, 1 lit
  var focus = null;                           // the pack lifted to the middle of the screen (makeFocus)
  var move = null;                            // the pack travelling into or out of focus: { t0, out, dx, dy, sc }
  var ASSETS = img.getAttribute("src").replace(/pack\/img\/pack-\d+\.webp.*$/, "");   // "assets/"
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var preview = local && /[?&]pack=open\b/.test(location.search);

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) { t = clamp(t, 0, 1); var c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

  // ── the pull and the binder ──────────────────────────────────
  // Weights by finish, not percentages: on every pull a card's chance is its weight over the whole set's
  // total (134 for the 30 cards), whatever the binder holds. Each secret rare is 1 in 134.
  var ODDS = { "Thin silver": 6, "Chrome": 6, "B/W vortex": 6,
               "Emerald": 5, "Ruby": 5, "Sapphire": 5,
               "Rainbow swirl": 4,
               "Gold": 3, "Cosmos": 3,
               "Manga blaze": 1, "Shadow": 1 };
  // what a pull looks like: the light in the tear (glow), and how the card shows its rarity as it lands: the
  // flash over the card, a flash over the whole screen (blink), how many twinkles, and how often one comes
  // after (idle, seconds; 0 none)
  var TIERS = {
    plain:  { glow: [0.55, 0.3, 0.95], flash: 0.45, blink: 0,   twinkles: 0,  idle: 0,   tint: "235,225,255", tag: "" },
    rare:   { glow: [1.0, 0.74, 0.22], flash: 0.7,  blink: 0,   twinkles: 8,  idle: 2.2, tint: "255,236,170", tag: "Rare" },
    secret: { glow: [1.0, 0.32, 0.1],  flash: 0.6,  blink: 0.85, twinkles: 16, idle: 1.3, tint: "255,190,120", tag: "Secret rare" }
  };
  function tierOf(card) {
    if (card.finish === "Manga blaze" || card.finish === "Shadow") return "secret";
    if (card.finish === "Rainbow swirl" || card.finish === "Gold" || card.finish === "Cosmos") return "rare";
    return "plain";
  }
  // how big a pull sounds (sfx.json "cues"): every pull sounds rare, and the rarest are the loudest
  function stepOf(card) {
    var f = card.finish;
    if (f === "Manga blaze" || f === "Shadow") return 4;
    if (f === "Gold" || f === "Cosmos") return 3;
    if (f === "Rainbow swirl") return 2;
    return 1;
  }
  var CARDS = null;                          // cards.json's list, once loaded
  var HIT = null;                             // the card in the pack on screen
  var forced = preview ? (location.search.match(/[?&]hit=([a-z0-9_]+)/) || [])[1] : null;
  var memBinder = null;                       // used when the browser blocks storage
  function readBinder() {
    try {
      var b = JSON.parse(localStorage.getItem("pk-binder") || "null");
      if (b && b.v === 1 && b.cards && typeof b.cards === "object") return b;
    } catch (e) { if (memBinder) return memBinder; }
    return memBinder || { v: 1, cards: {} };
  }
  function addToBinder(slug) {
    var b = readBinder(), c = b.cards[slug];
    b.cards[slug] = c ? { n: (c.n || 1) + 1, t: c.t } : { n: 1, t: Math.round(Date.now()) };
    memBinder = b;
    try { localStorage.setItem("pk-binder", JSON.stringify(b)); } catch (e) { /* kept for this visit only */ }
    return { isNew: !c, n: b.cards[slug].n, owned: owned(b) };
  }
  function owned(b) { return CARDS ? CARDS.filter(function (c) { return b.cards[c.slug]; }).length : 0; }
  function pull() {
    if (forced && byslug(forced)) { var f = forced; forced = null; return byslug(f); }
    var w = CARDS.map(function (c) { return ODDS[c.finish] || 4; });
    var r = Math.random() * w.reduce(function (a, b) { return a + b; }, 0);
    for (var i = 0; i < CARDS.length; i++) { r -= w[i]; if (r < 0) return CARDS[i]; }
    return CARDS[CARDS.length - 1];
  }
  function byslug(s) { for (var i = 0; i < CARDS.length; i++) if (CARDS[i].slug === s) return CARDS[i]; return null; }
  function cardSrc(card, w) { return ASSETS + "cards/img/" + card.slug + "-" + (w || 720) + ".webp"; }

  // ── the frame loop: eases the tilt, runs the shake, the sweep, the tear and the opening, then draws ──
  function frame() {
    var now = performance.now();              // the same clock the shake, sweep and opening start from
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    var k = 1 - Math.exp(-dt / 0.09);
    tilt.x += (tilt.tx - tilt.x) * k;
    tilt.y += (tilt.ty - tilt.y) * k;
    var busy = Math.abs(tilt.tx - tilt.x) + Math.abs(tilt.ty - tilt.y) > 0.002;
    if (!busy) { tilt.x = tilt.tx; tilt.y = tilt.ty; }
    var s = { x: tilt.x, y: tilt.y, rz: 0, dx: 0, dy: 0, jy: 0, sweep: -1, tear: [0, 1, 0], alpha: 1 };
    if (shake) {
      var t = (now - shake.t0) / 1000;
      if (t >= 0.72) shake = null;
      else {
        var e = Math.exp(-t / 0.2), w = 2 * Math.PI * 7.5;
        s.rz = 4.8 * e * Math.sin(w * t);               // degrees
        s.dx = 9 * e * Math.sin(w * t + 0.6);           // css px
        s.dy = 2.5 * e * Math.sin(2 * w * t);
        s.jy = 7 * Math.exp(-t / 0.26) * Math.sin(2 * Math.PI * 6 * t + 1);   // a turn that moves the light
        busy = true;
      }
    }
    if (sweep) {
      var p = (now - sweep.t0) / 1600;
      if (p >= 1) sweep = null;
      else { s.sweep = p; busy = true; }
    }
    if (lit.v !== lit.to) { lit.v = lit.to > lit.v ? Math.min(lit.to, lit.v + dt / 0.35) : Math.max(lit.to, lit.v - dt / 0.35); busy = true; }
    s.lit = lit.v;
    if (move) busy = stepMove(now) || busy;
    if (landing) busy = stepLanding(now, s) || busy;
    if (rip && !opening) busy = stepRip(dt, now, s) || busy;
    if (opening) busy = stepOpening(now, s) || busy;
    if (gl) gl.draw(s); else paintCss(s);
    raf = busy ? requestAnimationFrame(frame) : 0;
    if (!busy) last = 0;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  // ── input ─────────────────────────────────────────────────────
  function aim(x, y) {
    if (reduce.matches || opening || rip || state === "revealed") { x = 0; y = 0; }
    if (x === tilt.tx && y === tilt.ty) return;
    tilt.tx = x; tilt.ty = y; kick();
  }
  function over(e) {
    var r = btn.getBoundingClientRect();
    return {
      x: clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1),
      y: clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1)
    };
  }
  // a drag across a ready pack tears it; anything else tilts it
  var drag = null, dragged = false;
  btn.addEventListener("pointermove", function (e) {
    if (drag && drag.id === e.pointerId && state === "ready" && focus && focus.on && gl && !reduce.matches) {
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.tearing && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        drag.tearing = true;
        if (!rip) { rip = { dir: dx > 0 ? 1 : -1, prog: 0, target: 0, auto: null }; tearStart(); }
        held = null; aim(0, 0);
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
        mark("is-tearing", true);
      }
      if (drag.tearing) {
        var r = btn.getBoundingClientRect();
        var u = clamp((e.clientX - r.left) / r.width, 0, 1);
        rip.target = Math.max(rip.target, rip.dir > 0 ? u : 1 - u);
        kick();
        return;
      }
    }
    if (e.pointerType === "mouse" || held === e.pointerId) { var o = over(e); aim(o.x, o.y); }
  });
  btn.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse" && !(drag && drag.tearing)) aim(0, 0); });
  btn.addEventListener("pointerdown", function (e) {
    dragged = false;
    unlockAudio();
    if (state === "ready" && focus && focus.on) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tearing: false };
    if (e.pointerType === "mouse") return;
    held = e.pointerId;                       // a finger tilts the pack it holds
    var o = over(e); aim(o.x, o.y);
  });
  function release(e) {
    if (drag && drag.id === e.pointerId) {
      if (drag.tearing) {
        dragged = true;                       // not a tap: the click that follows is ignored
        mark("is-tearing", false);
        if (rip && rip.target >= 0.6) rip.target = 1;   // most of the way: it finishes itself
      }
      drag = null;
    }
    if (held === e.pointerId) { held = null; aim(0, 0); }
  }
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);   // the page scrolled instead

  btn.addEventListener("click", function () {
    if (dragged) { dragged = false; return; }
    unlockAudio();
    if (state === "ready") {
      if (focus && focus.on) tapOpen();
      else if (gl && !reduce.matches) enterFocus();
      else quickOpen();
      return;
    }
    if (state !== "sealed" && state !== "checking") return;
    sfx("crinkle", { gain: 0.9 });
    if (reduce.matches) return;
    if (gl) { shake = { t0: performance.now() }; sweep = null; kick(); return; }
    shaker.classList.remove("is-shaking");    // the CSS fallback restarts its keyframes
    void shaker.offsetWidth;
    shaker.classList.add("is-shaking");
  });
  shaker.addEventListener("animationend", function (e) {
    if (e.animationName === "pk-shake") shaker.classList.remove("is-shaking");
  });

  // the idle sweep (WebGL only; the CSS fallback has its own keyframes)
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; }).observe(btn);
  }
  setInterval(function () {
    if (!gl || reduce.matches || !onScreen || document.hidden || shake || sweep || opening || rip || landing) return;
    if (state === "revealed" || state === "opening") return;
    if (tilt.tx || tilt.ty || tilt.x || tilt.y) return;
    sweep = { t0: performance.now() }; kick();
  }, 7000);

  // ── CSS fallback: the flat image turned in 3D, light layers following the pointer ──
  function paintCss(s) {
    var x = s.x, y = s.y;
    if (Math.abs(x) < 0.002 && Math.abs(y) < 0.002) {
      tiltEl.style.transform = "";
      root.style.setProperty("--pk-lt", "0");
      root.classList.remove("is-live");
      return;
    }
    tiltEl.style.transform = "perspective(1300px) rotateX(" + (-y * TILT_X).toFixed(2) + "deg) rotateY(" + (x * TILT_Y).toFixed(2) + "deg)";
    root.style.setProperty("--pk-mx", (50 + x * 46).toFixed(1) + "%");
    root.style.setProperty("--pk-my", (42 + y * 44).toFixed(1) + "%");
    root.style.setProperty("--pk-sx", (50 - x * 70 - y * 20).toFixed(1) + "%");
    root.style.setProperty("--pk-ga", (Math.atan2(y, x) * 180 / Math.PI + 90).toFixed(1) + "deg");
    root.style.setProperty("--pk-lt", Math.min(1, 0.25 + Math.hypot(x, y)).toFixed(3));
    root.classList.add("is-live");
  }

  // ── WebGL: the pillow ─────────────────────────────────────────
  var PILLOW = { W: 960, H: 1728, CR: 104, PINCH: 7, T: 48, P: 4, Q: 12 };   // the same numbers the art was made with
  var MARGIN = 32;                            // css px of canvas around the pack, room for the turn
  var CUT_Y = 132 / 1728;                     // where the top tears off, a little under the top crimp
  var CARD = { w: 700, h: 980 };              // the card inside, pack px (5:7)
  var PEEL = 0.5;                             // radians: how far the torn strip folds toward you
  var LIFT = 36;                              // pack px: how far it lifts off the body, opening a slit of light

  // the tear's shape and how torn a column is, shared by both shaders
  var TEAR_GLSL = [
    "float torn(float x) { float a = u_tear.y > 0.0 ? x : 1.0 - x; return smoothstep(0.0, 0.2, u_tear.x - a); }"
  ].join("\n");

  var VS = [
    "attribute vec2 a_uv;",
    "uniform mat3 u_rot;",
    "uniform vec2 u_scale;",                  // clip units per pack px
    "uniform vec2 u_shift;",                  // pack px
    "uniform float u_persp;",
    "uniform float u_piece;",                 // 0 the body, 1 the strip above the tear
    "uniform vec3 u_tear;",                   // how far the tear has run (0..1, past 1 = right across), its direction (+1 from the left), the peel angle
    "uniform mat3 u_topR;",
    "uniform vec3 u_topT;",
    "varying vec2 v_uv;",
    "varying vec3 v_pos;",
    TEAR_GLSL,
    "float pillow(vec2 uv) {",
    "  float t = (uv.y * " + PILLOW.H.toFixed(1) + " - " + PILLOW.CR.toFixed(1) + ") / " + (PILLOW.H - 2 * PILLOW.CR).toFixed(1) + ";",
    "  if (t < 0.0 || t > 1.0) return 0.0;",
    "  float halfw = " + (PILLOW.W / 2).toFixed(1) + " - " + PILLOW.PINCH.toFixed(1) + " * pow(max(sin(3.14159265 * t), 0.0), 0.6);",
    "  float u = min(abs(uv.x - 0.5) * " + PILLOW.W.toFixed(1) + " / halfw, 1.0);",
    "  float v = abs(2.0 * t - 1.0);",
    "  return " + PILLOW.T.toFixed(1) + " * sqrt(max(1.0 - pow(u, " + PILLOW.P.toFixed(1) + "), 0.0)) * sqrt(max(1.0 - pow(v, " + PILLOW.Q.toFixed(1) + "), 0.0));",
    "}",
    "void main() {",
    "  vec3 p = vec3((a_uv.x - 0.5) * " + PILLOW.W.toFixed(1) + ", (0.5 - a_uv.y) * " + PILLOW.H.toFixed(1) + ", pillow(a_uv));",
    "  if (u_piece > 0.5) {",
    // where it is torn, the strip folds toward you on the tear line, more the further behind the tear's tip
    "    float th = u_tear.z * torn(a_uv.x);",
    "    float hy = " + ((0.5 - CUT_Y) * PILLOW.H).toFixed(1) + ";",
    "    vec3 q = p - vec3(0.0, hy, 0.0);",
    "    p = vec3(q.x, q.y * cos(th) - q.z * sin(th), q.y * sin(th) + q.z * cos(th)) + vec3(0.0, hy + " + LIFT.toFixed(1) + " * torn(a_uv.x), 0.0);",
    // and once it is free it turns about its own middle and flies
    "    vec3 pivot = vec3(0.0, " + ((0.5 - CUT_Y / 2) * PILLOW.H).toFixed(1) + ", 0.0);",
    "    p = u_topR * (p - pivot) + pivot + u_topT;",
    "  }",
    "  p = u_rot * p;",
    "  p.xy += u_shift;",
    "  float s = 1.0 / (1.0 - u_persp * p.z / 3600.0);",   // perspective only while turned; flat-on is exact
    "  gl_Position = vec4(p.xy * s * u_scale, -p.z / 4000.0, 1.0);",
    "  v_uv = a_uv;",
    "  v_pos = p;",
    "}"
  ].join("\n");

  var FS = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "uniform sampler2D u_alb;",
    "uniform sampler2D u_nrm;",
    "uniform sampler2D u_litTex;",
    "uniform float u_lit;",                   // 0 the silhouettes, 1 the lit Megas
    "uniform mat3 u_nrot;",                   // = u_rot (its own copy: shared uniforms must match precision)
    "uniform float u_crimp;",                 // crimp height as a fraction of the pack
    "uniform float u_sweep;",                 // -1 off, else 0..1 across
    "uniform vec3 u_tear;",
    "uniform float u_side;",                  // which piece this draw is (0 body, 1 the strip)
    "uniform float u_glow;",
    "uniform float u_gap;",                   // 1 while the slit is open and lit, fading once the strip has gone
    "uniform vec3 u_glowCol;",                // the rarity's colour in the light from the tear
    "uniform float u_alpha;",
    "varying vec2 v_uv;",
    "varying vec3 v_pos;",
    TEAR_GLSL,
    "float band(float x, float c, float w, float soft) { return 1.0 - smoothstep(w, w + soft, abs(x - c)); }",
    "float tear(float u) { return " + CUT_Y.toFixed(5) + " + 0.004 * sin(u * 91.0) + 0.003 * sin(u * 37.0 + 1.3) + 0.002 * sin(u * 211.0); }",
    // the studio: a softbox each side, a soft panel overhead, and the sweep's narrow strip
    "float studio(vec3 r) {",
    "  float az = degrees(atan(r.x, r.z));",
    "  float el = degrees(asin(clamp(r.y, -1.0, 1.0)));",
    "  float tall = band(el, 0.0, 46.0, 20.0);",
    "  float side = (band(az, -47.0, 13.0, 17.0) + band(az, 47.0, 13.0, 17.0)) * tall;",
    "  float top = band(az, 0.0, 24.0, 22.0) * band(el, 40.0, 8.0, 10.0) * 0.3;",
    "  float sw = 0.0;",
    "  if (u_sweep >= 0.0) {",
    "    float c = mix(34.0, -34.0, smoothstep(0.0, 1.0, u_sweep));",
    "    sw = band(az, c, 2.5, 4.0) * tall * 0.75 * sin(3.14159265 * u_sweep);",
    "  }",
    "  return side + top + sw;",
    "}",
    "void main() {",
    "  float edge = tear(v_uv.x);",
    "  float tr = torn(v_uv.x);",
    // the body leaves the torn part of the strip to the second draw, which draws nothing else
    "  if (u_side < 0.5 && v_uv.y < edge && tr > 0.002) {",
    "    float gap = " + (LIFT * 1.1 / PILLOW.H).toFixed(5) + " * tr;",
    "    float inside = smoothstep(edge - gap, edge - gap * 0.25, v_uv.y) * u_gap;",
    "    if (inside < 0.004) discard;",
    "    vec3 lc = mix(u_glowCol, vec3(1.0, 0.97, 1.0), 0.35 + 0.5 * inside);",
    "    float la = inside * clamp(0.55 + 0.4 * u_glow, 0.0, 1.0);",
    "    gl_FragColor = vec4(lc * la, la);",
    "    return;",
    "  }",
    "  if (u_side > 0.5 && (v_uv.y >= edge || tr <= 0.002)) discard;",
    "  vec4 a = mix(texture2D(u_alb, v_uv), texture2D(u_litTex, v_uv), u_lit);",
    "  if (a.a < 0.004) discard;",
    "  vec3 n0 = texture2D(u_nrm, v_uv).xyz * 2.0 - 1.0;",
    "  vec3 n = normalize(u_nrot * n0);",
    "  vec3 V = normalize(vec3(0.0, 0.0, 3600.0) - v_pos);",   // the eye: the view angle varies across the face
    "  vec3 r = reflect(-V, n);",
    "  float facing = max(dot(n, V), 0.0);",
    "  float crimp = step(v_uv.y, u_crimp) + step(1.0 - u_crimp, v_uv.y);",
    "  vec3 L = normalize(vec3(-0.3, 0.5, 0.8));",
    "  float d0 = 0.62 + 0.38 * max(dot(n0, L), 0.0);",
    "  float d1 = 0.62 + 0.38 * max(dot(n, L), 0.0);",
    "  vec3 col = a.rgb * clamp(d1 / d0, 0.72, 1.3);",
    "  col *= mix(0.5, 1.0, smoothstep(0.25, 0.8, facing));",   // the sides fall away into shadow past the shine
    // full gloss where the foil wraps round the sides, a soft sheen on the flat printed face, less on the crimps
    "  float curve = smoothstep(0.06, 0.3, length(n0.xy));",
    "  float gloss = mix(0.2, 1.0, curve) * mix(1.0, 0.55, crimp);",
    "  float s = studio(r) * gloss * (0.7 + 0.4 * (1.0 - facing));",
    "  vec3 tint = mix(vec3(1.0), clamp(a.rgb * 1.5 + 0.25, 0.0, 1.0), 0.45 * crimp);",   // the metal crimps tint their shine
    "  col = 1.0 - (1.0 - col) * (1.0 - clamp(s * tint, 0.0, 1.0));",
    // the lips of the tear glow: light spilling out of the open pack, brightest where the tear is running
    "  float d = abs(v_uv.y - edge);",
    "  float run = u_tear.y > 0.0 ? v_uv.x : 1.0 - v_uv.x;",
    "  float tip = u_tear.x < 1.0 ? exp(-abs(run - u_tear.x) / 0.03) : 0.0;",
    "  col += u_glow * (tr + 1.6 * tip) * (exp(-d / 0.006) * vec3(1.0, 0.95, 1.0) + exp(-d / 0.05) * u_glowCol * 0.7);",
    "  gl_FragColor = vec4(col * a.a, a.a) * u_alpha;",
    "}"
  ].join("\n");

  function shader(c, type, src) {
    var o = c.createShader(type); c.shaderSource(o, src); c.compileShader(o);
    if (!c.getShaderParameter(o, c.COMPILE_STATUS)) throw new Error(c.getShaderInfoLog(o));
    return o;
  }
  function program(c, vs, fs, names) {
    var p = c.createProgram();
    c.attachShader(p, shader(c, c.VERTEX_SHADER, vs));
    c.attachShader(p, shader(c, c.FRAGMENT_SHADER, fs));
    c.linkProgram(p);
    if (!c.getProgramParameter(p, c.LINK_STATUS)) throw new Error(c.getProgramInfoLog(p));
    var U = {};
    names.forEach(function (n) { U[n] = c.getUniformLocation(p, n); });
    return { p: p, U: U, a: c.getAttribLocation(p, "a_uv") };
  }
  function loadImage(src) {
    return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = src; });
  }

  function makeGl() {
    var canvas = document.createElement("canvas");
    canvas.className = "pk-gl";
    canvas.setAttribute("aria-hidden", "true");
    var c = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true, depth: true });
    if (!c) return null;
    var P = program(c, VS, FS, ["u_rot", "u_nrot", "u_scale", "u_shift", "u_persp", "u_alb", "u_nrm", "u_litTex", "u_lit",
      "u_crimp", "u_sweep", "u_piece", "u_topR", "u_topT", "u_tear", "u_side", "u_glow", "u_gap", "u_glowCol", "u_alpha"]);

    // the mesh: denser toward the sides and the crimps, where the pillow curves fastest
    var NX = 96, NY = 160, uv = [], idx = [];
    function spread(i, n) { var s = i / n * 2 - 1; return 0.5 + 0.5 * Math.sin(s * Math.PI / 2); }
    for (var j = 0; j <= NY; j++) for (var i = 0; i <= NX; i++) uv.push(spread(i, NX), spread(j, NY));
    for (j = 0; j < NY; j++) for (i = 0; i < NX; i++) {
      var a0 = j * (NX + 1) + i, a1 = a0 + 1, b0 = a0 + NX + 1, b1 = b0 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
    var vb = c.createBuffer(); c.bindBuffer(c.ARRAY_BUFFER, vb); c.bufferData(c.ARRAY_BUFFER, new Float32Array(uv), c.STATIC_DRAW);
    var ib = c.createBuffer(); c.bindBuffer(c.ELEMENT_ARRAY_BUFFER, ib); c.bufferData(c.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), c.STATIC_DRAW);
    c.enable(c.DEPTH_TEST); c.depthFunc(c.LEQUAL);
    c.enable(c.BLEND); c.blendFunc(c.ONE, c.ONE_MINUS_SRC_ALPHA);
    c.useProgram(P.p);
    c.uniform1i(P.U.u_alb, 0); c.uniform1i(P.U.u_nrm, 1); c.uniform1i(P.U.u_litTex, 2);
    c.uniform1f(P.U.u_crimp, PILLOW.CR / PILLOW.H);

    function tex(unit) {
      var t = c.createTexture();
      c.activeTexture(c.TEXTURE0 + unit); c.bindTexture(c.TEXTURE_2D, t);
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_WRAP_S, c.CLAMP_TO_EDGE);
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_WRAP_T, c.CLAMP_TO_EDGE);
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_MIN_FILTER, c.LINEAR);
      c.texImage2D(c.TEXTURE_2D, 0, c.RGBA, 1, 1, 0, c.RGBA, c.UNSIGNED_BYTE, new Uint8Array(4));
      return t;
    }
    var albTex = tex(0), nrmTex = tex(1), litTex = tex(2), albW = 0;
    var hasLit = false;
    function upload(t, unit, im) {
      c.activeTexture(c.TEXTURE0 + unit); c.bindTexture(c.TEXTURE_2D, t);
      c.pixelStorei(c.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      c.texImage2D(c.TEXTURE_2D, 0, c.RGBA, c.RGBA, c.UNSIGNED_BYTE, im);
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_MIN_FILTER, c.LINEAR);
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_MAG_FILTER, c.LINEAR);
    }

    var base = ASSETS + "pack/img/";
    var size = { packD: 0, cw: 0, ch: 0, m: MARGIN };
    function fit(margin) {                    // backing store in device pixels; the pack lands on whole pixels
      var M = margin || size.m || MARGIN;
      var dpr = window.devicePixelRatio || 1;
      var cssW = btn.clientWidth, cssH = cssW * PILLOW.H / PILLOW.W;
      var packD = Math.round(cssW * dpr), m = Math.round(M * dpr);
      size = { packD: packD, cw: packD + 2 * m, ch: Math.round(packD * PILLOW.H / PILLOW.W) + 2 * m, m: M };
      canvas.width = size.cw; canvas.height = size.ch;
      canvas.style.width = (cssW + 2 * M) + "px";
      canvas.style.height = (cssH + 2 * M) + "px";
      canvas.style.left = canvas.style.top = -M + "px";
      c.viewport(0, 0, size.cw, size.ch);
      return packD <= 320 ? 320 : packD <= 640 ? 640 : 960;
    }
    function useAlbedo(w) {
      if (w === albW) return Promise.resolve();
      return loadImage(base + "pack-" + w + ".webp").then(function (im) { albW = w; upload(albTex, 0, im); });
    }
    function filterAlbedo(exact) {
      c.activeTexture(c.TEXTURE0); c.bindTexture(c.TEXTURE_2D, albTex);
      var f = exact ? c.NEAREST : c.LINEAR;
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_MIN_FILTER, f);
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_MAG_FILTER, f);
    }
    // the lit Megas exist only once the cards are out; without them the silhouettes stay
    function loadLit() {
      if (hasLit) return Promise.resolve(true);
      var w = albW || 640;
      return loadImage(base + "pack-lit-" + w + ".webp").then(function (im) { hasLit = true; upload(litTex, 2, im); return true; }, function () { return false; });
    }

    function rot(ax, ay, az) {                // R = Rz * Ry * Rx, column-major for GL
      var cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
      return mul([cz, sz, 0, -sz, cz, 0, 0, 0, 1], mul([cy, 0, -sy, 0, 1, 0, sy, 0, cy], [1, 0, 0, 0, cx, sx, 0, -sx, cx]));
    }
    function mul(A, B) {                      // 3x3, column-major
      var o = [];
      for (var col = 0; col < 3; col++) for (var row = 0; row < 3; row++) {
        o[col * 3 + row] = A[row] * B[col * 3] + A[3 + row] * B[col * 3 + 1] + A[6 + row] * B[col * 3 + 2];
      }
      return o;
    }
    var ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    var lastS = { x: 0, y: 0, rz: 0, dx: 0, dy: 0, jy: 0, sweep: -1, tear: [0, 1, 0], alpha: 1 };

    function draw(s) {
      lastS = s;
      var rad = Math.PI / 180;
      var ax = s.y * TILT_X * rad + (s.rx || 0) * rad, ay = (s.x * TILT_Y + s.jy) * rad, az = -s.rz * rad;
      var R = new Float32Array(rot(ax, ay, az));
      var zoom = s.zoom || 1;
      var torn = s.tear[0] > 0;
      var flat = Math.abs(ax) + Math.abs(ay) + Math.abs(az) < 1e-5 && zoom === 1 && !torn;
      var k = size.packD / PILLOW.W * zoom;   // device px per pack px
      var pxPerPack = PILLOW.W / btn.clientWidth;
      var persp = flat ? 0 : Math.max(torn || zoom !== 1 ? 1 : 0, Math.min(1, (Math.abs(ax) + Math.abs(ay)) / (8 * rad)));
      c.clearColor(0, 0, 0, 0);
      c.clear(c.COLOR_BUFFER_BIT | c.DEPTH_BUFFER_BIT);

      c.useProgram(P.p);
      c.bindBuffer(c.ARRAY_BUFFER, vb);
      c.bindBuffer(c.ELEMENT_ARRAY_BUFFER, ib);
      c.enableVertexAttribArray(P.a); c.vertexAttribPointer(P.a, 2, c.FLOAT, false, 0, 0);
      c.uniformMatrix3fv(P.U.u_rot, false, R);
      c.uniformMatrix3fv(P.U.u_nrot, false, R);
      c.uniform2f(P.U.u_scale, 2 * k / size.cw, 2 * k / size.ch);
      c.uniform2f(P.U.u_shift, s.dx * pxPerPack, -s.dy * pxPerPack);
      c.uniform1f(P.U.u_persp, persp);
      c.uniform1f(P.U.u_sweep, s.sweep);
      c.uniform1f(P.U.u_lit, hasLit ? (s.lit || 0) : 0);
      c.uniform3f(P.U.u_tear, s.tear[0], s.tear[1], s.tear[2]);
      c.uniform1f(P.U.u_glow, s.glow || 0);
      c.uniform1f(P.U.u_gap, s.gap == null ? 1 : s.gap);
      var g = s.glowCol || TIERS.plain.glow;
      c.uniform3f(P.U.u_glowCol, g[0], g[1], g[2]);
      filterAlbedo(flat && albW === size.packD);
      // the body
      c.uniform1f(P.U.u_piece, 0); c.uniform1f(P.U.u_side, 0); c.uniform1f(P.U.u_alpha, s.alpha);
      c.uniformMatrix3fv(P.U.u_topR, false, ID); c.uniform3f(P.U.u_topT, 0, 0, 0);
      c.drawElements(c.TRIANGLES, idx.length, c.UNSIGNED_SHORT, 0);
      // the torn strip: peeling, then flying
      var top = s.top || { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, a: 1 };
      if (torn && top.a > 0.002) {
        c.uniform1f(P.U.u_piece, 1); c.uniform1f(P.U.u_side, 1); c.uniform1f(P.U.u_alpha, top.a * s.alpha);
        c.uniformMatrix3fv(P.U.u_topR, false, new Float32Array(rot(top.rx * rad, top.ry * rad, top.rz * rad)));
        c.uniform3f(P.U.u_topT, top.x, top.y, top.z);
        c.drawElements(c.TRIANGLES, idx.length, c.UNSIGNED_SHORT, 0);
      }
    }

    var ready = Promise.all([useAlbedo(fit()), loadImage(base + "normal.webp").then(function (im) { upload(nrmTex, 1, im); })]);
    window.addEventListener("resize", function () {
      if (!gl) return;
      useAlbedo(fit()).then(function () { draw(lastS); });
    });
    canvas.addEventListener("webglcontextlost", function (e) {   // back to the CSS pack
      e.preventDefault(); gl = null; mark("is-gl", false); canvas.remove();
    });
    return ready.then(function () {
      btn.appendChild(canvas);
      return { draw: draw, canvas: canvas, fit: fit, loadLit: loadLit,
               refit: function () { return useAlbedo(fit()).then(function () { draw(lastS); }); },
               margin: function (m) { fit(m); draw(lastS); } };
    });
  }

  // ── twinkles: the cards' own four-point glints (a long cross, a short diagonal one, a soft halo), drawn on a
  // canvas the size of the screen over whatever rectangle they belong to ──
  function makeSparks(parent) {
    var cv = document.createElement("canvas");
    cv.className = "pk-sparks";
    cv.setAttribute("aria-hidden", "true");
    parent.appendChild(cv);
    var cx = cv.getContext("2d"), list = [], dpr = 1;
    function fit() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
    }
    fit();
    function ray(x, y, a, l, w) {
      cx.beginPath();
      cx.moveTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      cx.lineTo(x + Math.cos(a + Math.PI / 2) * w, y + Math.sin(a + Math.PI / 2) * w);
      cx.lineTo(x - Math.cos(a) * l, y - Math.sin(a) * l);
      cx.lineTo(x - Math.cos(a + Math.PI / 2) * w, y - Math.sin(a + Math.PI / 2) * w);
      cx.closePath(); cx.fill();
    }
    function twinkle(x, y, len, rot, a, tint) {
      if (len < 0.5) return;
      cx.save();
      cx.globalAlpha = Math.min(1, a * 1.2);
      var g = cx.createRadialGradient(x, y, 0, x, y, len * 0.9);
      g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(0.18, "rgba(" + tint + ",.5)"); g.addColorStop(1, "rgba(" + tint + ",0)");
      cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, len * 0.9, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = "#fff";
      ray(x, y, rot, len, len * 0.055); ray(x, y, rot + Math.PI / 2, len, len * 0.055);
      ray(x, y, rot + Math.PI / 4, len * 0.42, len * 0.035); ray(x, y, rot - Math.PI / 4, len * 0.42, len * 0.035);
      cx.restore();
    }
    return {
      canvas: cv,
      add: function (sp) { list.push(sp); },
      // a twinkle's size and place scale with the rectangle (a card 360 px wide is the reference)
      draw: function (now, r) {
        if (cv.width !== Math.round(innerWidth * dpr) || cv.height !== Math.round(innerHeight * dpr)) fit();
        cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (var i = list.length - 1; i >= 0; i--) {
          var sp = list[i], p = (now - sp.t0) / sp.life;
          if (p >= 1) { list.splice(i, 1); continue; }
          if (p < 0) continue;
          var k = Math.pow(Math.sin(Math.PI * p), 1.4);
          twinkle(r.left + sp.u * r.width, r.top + sp.v * r.height, sp.len * k * r.width / 360, sp.rot + p * 0.5, k, sp.tint);
        }
        return list.length > 0;
      }
    };
  }
  // where a twinkle catches: mostly along the frame and at the corners, now and then on the face
  function spark(t0, big, tint) {
    var u, v;
    if (Math.random() < 0.65) {
      var side = Math.floor(Math.random() * 4), along = Math.random(), out = (Math.random() - 0.35) * 0.08;
      if (side === 0) { u = along; v = -out; } else if (side === 1) { u = 1 + out; v = along; }
      else if (side === 2) { u = along; v = 1 + out; } else { u = -out; v = along; }
    } else { u = 0.12 + Math.random() * 0.76; v = 0.1 + Math.random() * 0.8; }
    return { t0: t0, life: 620 + Math.random() * 380, u: u, v: v, len: (big ? 30 : 14) + Math.random() * (big ? 26 : 14),
             rot: Math.random() * 0.3, tint: tint };
  }

  // ── ready: the drop has passed ────────────────────────────────
  var links = null, countEl = null;
  var hint = root.querySelector(".pk-hint");
  var sawCountdown = false;                   // the page was open before the drop: light the pack with a flash

  function enterReady() {
    if (state !== "sealed") return;
    state = "checking";
    // offer packs only once the cards are really there: the card list, then the first card's art
    fetch(ASSETS + "cards/cards.json").then(function (r) { if (!r.ok) throw r; return r.json(); })
      .then(function (got) {
        if (!got.cards || !got.cards.length) throw new Error("no cards");
        CARDS = got.cards;
        HIT = pull();
        return loadImage(cardSrc(HIT));
      })
      .then(function () {
        state = "ready";
        mark("is-ready", true);
        btn.setAttribute("aria-label", "Open the Mega Dimension booster pack");
        if (hint) hint.textContent = "Tap the pack to open it";
        addLinks();
        if (SND.ctx) loadSounds();             // the card slides, now that the cards are out
        lightUp();
      }).catch(function () {                  // the cards are not up yet: the pack stays sealed (it still shakes)
        state = "sealed";
        setTimeout(enterReady, 60000);        // and looks again in a minute
      });
  }
  // the pack's Megas light up once the cards are out; on a page that watched the countdown, with a soft flash
  // and a few twinkles
  function lightUp() {
    var flash = sawCountdown && gl && !reduce.matches;
    if (gl) gl.loadLit().then(function (ok) {
      if (!ok) return;
      if (!flash) { lit.to = 1; lit.v = 1; kick(); return; }
      lit.to = 1; kick();
      mark("is-waking", true);
      sfx("wake");
      setTimeout(function () { mark("is-waking", false); }, 1000);
      var sp = makeSparks(document.body), t0 = performance.now();
      sp.canvas.classList.add("pk-sparks--page");
      for (var i = 0; i < 6; i++) sp.add(spark(t0 + 120 + i * 140 + Math.random() * 60, i % 2 === 0, "214,186,255"));
      (function loop() {
        var r = btn.getBoundingClientRect();
        if (sp.draw(performance.now(), r)) requestAnimationFrame(loop); else sp.canvas.remove();
      })();
    });
    else {                                    // the flat pack shows the lit art too, when it exists
      var lit320 = ASSETS + "pack/img/pack-lit-320.webp";
      loadImage(lit320).then(function () {
        img.src = lit320;
        img.srcset = lit320 + " 1x, " + ASSETS + "pack/img/pack-lit-640.webp 2x, " + ASSETS + "pack/img/pack-lit-960.webp 3x";
      }, function () {});
    }
  }
  function addLinks() {
    if (links) return;
    links = document.createElement("div");
    links.className = "pk-links";
    links.innerHTML = '<a class="pk-binder-link" href="binder"><span>Your binder</span> <b data-pk-count></b></a>' +
                      '<span class="pk-opened" data-pk-opened hidden></span>';
    countEl = links.querySelector("[data-pk-count]");
    tallyEl = links.querySelector("[data-pk-opened]");
    (hint || btn).insertAdjacentElement("afterend", links);
    updateCount();
    readTally();
  }
  function updateCount() {
    if (!countEl || !CARDS) return;
    countEl.textContent = owned(readBinder()) + " / " + CARDS.length;
  }

  // ── packs opened by everyone: a free public counter (Abacus, no account). Each opened pack adds one and the
  // total shows under the pack. Previews on this computer count on a key of their own, so testing never touches
  // the real number. The counter is a busy free service that can take many seconds to answer, so the line shows
  // the last total this browser saw straight away, reading the total never waits on adding this visitor's
  // packs, and an add gets a long time before it's given up (cutting one off after the counter took it would
  // send it again later). If the counter has never answered here, the line stays hidden. ──
  var TALLY = "https://abacus.jasoncameron.dev/", TALLY_KEY = "flatfootlabs.com/" + (local ? "mega-packs-test" : "mega-packs");
  var TALLY_LAST = "pk-tally-last";
  var tallyEl = null, tallyShown = 0;
  function showTally(d) {
    var n = d && d.value;
    if (!tallyEl || typeof n !== "number" || n < 1 || n < tallyShown) return;
    tallyShown = n;
    tallyEl.textContent = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (n === 1 ? " pack" : " packs") + " opened";
    tallyEl.hidden = false;
    try { localStorage.setItem(TALLY_LAST, String(n)); } catch (e) { /* storage off: no memory between visits */ }
  }
  function tally(path) {
    if (!window.fetch) return Promise.resolve(null);
    var ctl = window.AbortController ? new AbortController() : null;
    var stop = ctl ? setTimeout(function () { ctl.abort(); }, 45000) : 0;   // never hang on forever
    return fetch(TALLY + path + "/" + TALLY_KEY, ctl ? { cache: "no-store", signal: ctl.signal } : { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { clearTimeout(stop); showTally(d); return d && typeof d.value === "number" ? d : null; },
            function () { clearTimeout(stop); return null; });
  }
  // an opened pack waits in this browser until the counter has taken it, so a slow or busy counter (or a
  // visitor offline) loses nothing: the next page load sends what is still waiting
  var memWaiting = 0, flushing = false;
  function waiting(d) {
    try {
      var n = (+localStorage.getItem("pk-tally") || 0) + (d || 0);
      if (d) localStorage.setItem("pk-tally", String(Math.max(0, n)));
      return Math.max(0, n);
    } catch (e) { memWaiting = Math.max(0, memWaiting + (d || 0)); return memWaiting; }
  }
  function flush() {
    if (flushing || !waiting()) return;
    flushing = true;
    tally("hit").then(function (d) {
      flushing = false;
      if (d) { waiting(-1); flush(); }
    });
  }
  function readTally() {
    var last = 0;
    try { last = +localStorage.getItem(TALLY_LAST) || 0; } catch (e) { /* no storage */ }
    if (last) showTally({ value: last });
    // a read that fails tries again a little later, a few times, until a total has been shown
    (function read(tries) {
      tally("get").then(function (d) {
        if (!d && !tallyShown && tries > 1) setTimeout(function () { read(tries - 1); }, 15000);
      });
    })(4);
    flush();
  }
  function countPack() { waiting(1); flush(); }

  // ── state classes: on the pack's own block, and on its stand-in in focus (the CSS keys off both) ──
  function mark(name, on) {
    root.classList.toggle(name, on);
    if (focus) focus.slot.classList.toggle(name, on);
  }

  // ── sound: Web Audio. The sounds load when the pointer first reaches the pack (or on the first tap); browsers
  // start the sound itself only after a tap, and anything played before then waits for it. The setting is the
  // site's own ("fc-sound", shared with the card carousel and the binder). sfx/sfx.json lists the files and their
  // levels; the card slides are the carousel's. ──
  var SND = { ctx: null, out: null, buf: {}, gain: {}, loading: null, cues: null };
  // a preview on this computer can try another set of sounds: &sfx=<name> plays pack/sfx/opt-<name>/
  var sfxSet = preview ? (location.search.match(/[?&]sfx=([a-z0-9-]+)/) || [])[1] : null;
  var SFX_LIST = sfxSet ? "pack/sfx/opt-" + sfxSet + "/sfx.json" : "pack/sfx/sfx.json";
  function soundOn() { try { return localStorage.getItem("fc-sound") !== "off"; } catch (e) { return true; } }
  function setSound(on) {
    try { localStorage.setItem("fc-sound", on ? "on" : "off"); } catch (e) { /* storage blocked */ }
    if (SND.out) SND.out.gain.value = on ? 1 : 0;
    document.querySelectorAll("[data-pk-sound]").forEach(function (b) { b.setAttribute("aria-pressed", on ? "true" : "false"); });
  }
  function unlockAudio() {
    loadAudio();
    if (SND.ctx && SND.ctx.state === "suspended") SND.ctx.resume();
  }
  function loadAudio() {
    if (!SND.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { SND.ctx = new AC(); } catch (e) { return; }
      SND.out = SND.ctx.createGain();
      SND.out.gain.value = soundOn() ? 1 : 0;
      SND.out.connect(SND.ctx.destination);
      SND.loading = fetch(ASSETS + SFX_LIST).then(function (r) { return r.json(); }).then(function (list) {
        SND.cues = list.cues || null;
        SND.list = list.sounds || list;
        SND.stepOnly = {};                    // the sounds only the opening's cues play
        if (SND.cues) Object.keys(SND.cues).forEach(function (k) {
          Object.keys(SND.cues[k]).forEach(function (ev) { SND.cues[k][ev].forEach(function (c) { SND.stepOnly[c.s] = true; }); });
        });
        return loadSounds();
      }).catch(function () {});
    }
  }
  // the sounds not loaded yet: the card set's own (its slides) only once the cards are out, and of the opening's
  // sounds only the step of the card in the pack (each new pack loads its own)
  function loadSounds() {
    if (!SND.list) return Promise.resolve();
    var want = {}, set = HIT && SND.cues ? SND.cues[String(stepOf(HIT))] : null;
    if (set) Object.keys(set).forEach(function (ev) { set[ev].forEach(function (c) { want[c.s] = true; }); });
    return Promise.all(Object.keys(SND.list).map(function (name) {
      var item = SND.list[name];
      if (SND.buf[name] || item.loading || (item.src.indexOf("cards/") === 0 && !CARDS)) return null;
      if (SND.stepOnly[name] && !want[name]) return null;
      item.loading = true;
      SND.gain[name] = item.gain;
      return fetch(ASSETS + item.src).then(function (r) { if (!r.ok) throw r; return r.arrayBuffer(); })
        .then(function (a) {
          return new Promise(function (res, rej) {
            var p = SND.ctx.decodeAudioData(a, res, rej);
            if (p && p.catch) p.catch(function () {});
          });
        })
        .then(function (b) { SND.buf[name] = b; }, function () { item.loading = false; /* a missing sound stays silent */ });
    }));
  }
  btn.addEventListener("pointerenter", loadAudio, { once: true });
  // play a sound now (or `delay` s from now); `pick` chooses among numbered takes (name-1, name-2, ...)
  function sfx(name, opts) {
    opts = opts || {};
    if (!SND.ctx) return;
    var takes = Object.keys(SND.buf).filter(function (n) { return n === name || n.indexOf(name + "-") === 0; });
    if (!takes.length) return;
    var n = takes[Math.floor(Math.random() * takes.length)];
    var src = SND.ctx.createBufferSource(), g = SND.ctx.createGain();
    src.buffer = SND.buf[n];
    src.playbackRate.value = opts.rate || 1;
    g.gain.value = (SND.gain[n] == null ? 1 : SND.gain[n]) * (opts.gain == null ? 1 : opts.gain);
    src.connect(g); g.connect(SND.out);
    src.start(SND.ctx.currentTime + (opts.delay || 0), opts.offset || 0);
    return { src: src, g: g };
  }
  // a moment of the opening ("free", "rise", "pull", "out", "land") in the sound of the card's step. A cue with
  // "end": "land" builds into the landing: it starts early enough to finish as the card lands (ETA, seconds after
  // each moment, from stepOpening's timings), or part way in when it is longer than the time left. A slow frame can
  // land the card early, so the landing fades out any build still going: the hit always comes in clean.
  var ETA = { free: 2.35, rise: 2.05, pull: 1.05, out: 0.55 };
  var builds = [];
  function cue(ev, card) {
    var set = SND.cues && SND.cues[String(stepOf(card))];
    if (!set) return false;
    if (ev === "land") {
      builds.forEach(function (n) {
        try { n.g.gain.setTargetAtTime(0, SND.ctx.currentTime, 0.012); n.src.stop(SND.ctx.currentTime + 0.12); } catch (e) { /* ended */ }
      });
      builds = [];
    }
    (set[ev] || []).forEach(function (c) {
      var rate = c.rate || 1, b = SND.buf[c.s];
      if (c.end === "land") {
        if (!b) return;
        var lead = (ETA[ev] || 0) + (c.delay || 0) - b.duration / rate;
        var n = sfx(c.s, { gain: c.gain, rate: rate, delay: Math.max(0, lead), offset: lead < 0 ? -lead * rate : 0 });
        if (n) builds.push(n);
      } else {
        sfx(c.s, { gain: c.gain, rate: rate, delay: c.delay });
      }
    });
    return true;
  }
  // the foil tears as fast as the finger goes: the recording is played in slices, each up to where the tear has
  // reached, one after another (sped up a little when the finger is ahead of it)
  var tearSnd = null;
  function tearStart() {
    tearSnd = null;
    if (!SND.ctx) return;
    var takes = ["tear-1", "tear-2"].filter(function (n) { return SND.buf[n]; });
    if (!takes.length) return;
    var n = takes[Math.floor(Math.random() * takes.length)];
    tearSnd = { b: SND.buf[n], g: SND.gain[n] == null ? 1 : SND.gain[n], done: 0, at: 0 };
  }
  function tearTo(p) {
    var t = tearSnd;
    if (!t || !SND.ctx) return;
    p = Math.min(1, p);
    if (p <= t.done || (p - t.done < 0.04 && p < 1)) return;
    var c = SND.ctx, D = t.b.duration, now = c.currentTime, start = Math.max(now, t.at);
    var rate = 1 + Math.min(0.8, (start - now) * 3);
    var off = t.done * D, len = (p - t.done) * D, end = start + len / rate;
    var src = c.createBufferSource(), g = c.createGain();
    src.buffer = t.b; src.playbackRate.value = rate;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(t.g, start + 0.005);
    g.gain.setValueAtTime(t.g, Math.max(start + 0.005, end - 0.006));
    g.gain.linearRampToValueAtTime(0, end + 0.004);
    src.connect(g); g.connect(SND.out);
    src.start(start, off, len + 0.01);
    t.done = p; t.at = end;
  }
  function soundButton() {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pk-sound";
    b.setAttribute("data-pk-sound", "");
    b.setAttribute("aria-pressed", soundOn() ? "true" : "false");
    b.innerHTML = '<svg class="pk-sound-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/>' +
      '<path class="pk-sound-on" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/><path class="pk-sound-off" d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>' +
      '<span>Sound</span>';
    b.addEventListener("click", function () { unlockAudio(); setSound(b.getAttribute("aria-pressed") !== "true"); });
    return b;
  }

  // ── focus: tapping a ready pack lifts it to the middle of the screen, over the page blurred behind a glow;
  // there it rips. The pack itself moves (its canvas keeps drawing); a stand-in holds its place in the page. ──
  function focusSize() { return innerHeight >= 760 && innerWidth >= 360 ? 320 : 240; }
  function focusRect(w) {
    var h = w * PILLOW.H / PILLOW.W;
    var top = Math.max(w * 0.42 + 16, (innerHeight - h) / 2 + w * 0.08);
    top = Math.min(top, Math.max(12, innerHeight - h - 64));
    return { left: Math.round((innerWidth - w) / 2), top: Math.round(top), width: w, height: h };
  }
  function makeFocus() {
    var el = document.createElement("div");
    el.className = "pk-focus";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Open the Mega Dimension booster pack");
    el.innerHTML = '<div class="pk-focus-back"></div><div class="pk-focus-glow" aria-hidden="true"></div>' +
      '<div class="pk-focus-slot"></div><p class="pk-focus-hint">Swipe across the top to open</p>' +
      '<div class="pk-focus-tools"><button type="button" class="pk-focus-close" aria-label="Close">&times;</button></div>';
    var f = { el: el, on: false, slot: el.querySelector(".pk-focus-slot"), hold: null };
    el.querySelector(".pk-focus-tools").insertBefore(soundButton(), el.querySelector(".pk-focus-close"));
    el.querySelector(".pk-focus-back").addEventListener("click", function () { exitFocus(); });
    el.querySelector(".pk-focus-close").addEventListener("click", function () { exitFocus(); });
    el.addEventListener("keydown", function (e) { if (e.key === "Escape") exitFocus(); });
    // the page under the blur stays where it is
    el.addEventListener("wheel", function (e) { e.preventDefault(); }, { passive: false });
    el.addEventListener("touchmove", function (e) { if (!e.target.closest || !e.target.closest(".pk-pack")) e.preventDefault(); }, { passive: false });
    return f;
  }
  function layoutFocus() {
    if (!focus || !focus.on) return;
    var w = focusSize();
    if (btn.style.width !== w + "px") { btn.style.width = w + "px"; if (gl) gl.refit(); }
    var r = focusRect(w), s = focus.slot.style;
    s.left = r.left + "px"; s.top = r.top + "px"; s.width = w + "px";
    focus.el.style.setProperty("--pk-gx", (r.left + w / 2) + "px");
    focus.el.style.setProperty("--pk-gy", (r.top + r.height / 2) + "px");
    focus.el.style.setProperty("--pk-hint-y", (r.top + r.height + 22) + "px");
    return r;
  }
  window.addEventListener("resize", layoutFocus);
  function enterFocus() {
    if (state !== "ready" || !gl || (focus && focus.on)) return;
    focus = focus || makeFocus();
    var from = btn.getBoundingClientRect();
    focus.hold = document.createElement("span");
    focus.hold.className = "pk-hold";
    focus.hold.style.width = from.width + "px"; focus.hold.style.height = from.height + "px";
    btn.parentNode.insertBefore(focus.hold, btn);
    focus.slot.className = "pk-focus-slot " + root.className;
    focus.slot.appendChild(btn);
    document.body.appendChild(focus.el);
    focus.on = true;
    var to = layoutFocus();
    state = "focusing";
    move = { t0: performance.now(), out: false, dx: from.left - to.left, dy: from.top - to.top, sc: from.width / to.width };
    stepMove(move.t0);
    try { btn.focus({ preventScroll: true }); } catch (e) { /* old browsers */ }
    sfx("crinkle", { gain: 0.8 }); sfx("whoosh", { gain: 0.5, delay: 0.04 });
    kick();
  }
  function exitFocus() {
    if (!focus || !focus.on || state !== "ready" || move) return;
    var to = focus.hold.getBoundingClientRect(), from = focus.slot.getBoundingClientRect();
    state = "focusing";
    move = { t0: performance.now(), out: true, dx: to.left - from.left, dy: to.top - from.top, sc: to.width / from.width };
    sfx("whoosh", { gain: 0.35, rate: 0.9 }); sfx("crinkle", { gain: 0.5, delay: 0.3 });
    kick();
  }
  // the move: the pack's slot travels between its place in the page and the middle (a: 1 in the page, 0 centred)
  function stepMove(now) {
    var p = clamp((now - move.t0) / 480, 0, 1), e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    var a = move.out ? e : 1 - e;
    focus.slot.style.transform = a < 1e-4 ? "" : "translate(" + (move.dx * (move.out ? e : a)).toFixed(2) + "px, " +
      (move.dy * (move.out ? e : a)).toFixed(2) + "px) scale(" + (1 + (move.sc - 1) * (move.out ? e : a)).toFixed(4) + ")";
    focus.el.style.setProperty("--pk-f", (move.out ? 1 - e : e).toFixed(3));
    if (p < 1) return true;
    var out = move.out;
    move = null;
    if (out) {                                // back in the page
      focus.slot.style.transform = "";
      focus.hold.parentNode.insertBefore(btn, focus.hold);
      focus.hold.remove(); focus.hold = null;
      focus.el.remove(); focus.on = false;
      btn.style.width = "";
      if (gl) gl.refit();
      try { btn.focus({ preventScroll: true }); } catch (e2) { /* old browsers */ }
    }
    state = "ready";
    return false;
  }

  // ── the rip ──────────────────────────────────────────────────
  function tapOpen() {
    if (!gl || reduce.matches) { quickOpen(); return; }
    if (!rip) { rip = { dir: 1, prog: 0, target: 0, auto: null }; tearStart(); }
    rip.auto = { t0: performance.now(), from: rip.target };
    kick();
  }
  function stepRip(dt, now, s) {
    if (rip.auto) rip.target = Math.max(rip.target, rip.auto.from + (1 - rip.auto.from) * easeOut((now - rip.auto.t0) / 420));
    rip.prog += (rip.target - rip.prog) * (1 - Math.exp(-dt / 0.045));
    if (rip.target - rip.prog < 0.002) rip.prog = rip.target;
    s.tear = [rip.prog, rip.dir, PEEL];
    tearTo(rip.prog);
    s.glow = 0.55 + 0.35 * rip.prog;
    s.glowCol = TIERS[tierOf(HIT)].glow;
    if (rip.prog >= 0.97) { begin(now); return true; }
    return rip.prog !== rip.target || !!rip.auto;
  }

  // ── the opening: the strip flies, the card is pulled out and revealed ──
  // Times are seconds from the end of the rip.
  var flyer = null, inPack = null, lastPulled = null, stage = null, glitter = null;
  function begin(now) {
    state = "opening";
    mark("is-opening", true);
    mark("is-tearing", false);
    var got = addToBinder(HIT.slug);
    lastPulled = HIT;
    countPack();
    gl.margin(Math.round(btn.clientWidth * 0.9));     // room above the pack for the strip and the card
    opening = { t0: now, dir: rip.dir, from: rip.prog, rise: -1, pull: -1, out: -1, card: HIT, tier: tierOf(HIT), got: got };
    tearTo(1);
    rip = null;
    if (!focus || !focus.on) makeRoom();
    makeInPack(HIT);
    if (!cue("free", HIT)) sfx("free", { gain: 0.9, delay: 0.02 });
    kick();
  }

  // the card inside the pack: a picture behind the pack's canvas, so the pack's body hides it until it rises
  function makeInPack(card) {
    inPack = document.createElement("img");
    inPack.className = "pk-card";
    inPack.alt = "";
    inPack.src = cardSrc(card);
    inPack.style.visibility = "hidden";
    var g = TIERS[tierOf(card)].glow;
    inPack.style.setProperty("--pk-gc", "rgb(" + g.map(function (v) { return Math.round(v * 255); }).join(",") + ")");
    btn.insertBefore(inPack, gl.canvas);
  }
  // place it from the pack's own numbers: centre y in pack px (up from the middle), with the pack's offsets
  function placeInPack(s, cy, glow) {
    var c = btn.clientWidth / PILLOW.W, zoom = s.zoom || 1;
    inPack.style.width = (CARD.w * c) + "px";
    inPack.style.height = (CARD.h * c) + "px";
    inPack.style.transform = "translate(-50%, -50%) translate(" + (s.dx * zoom).toFixed(2) + "px, " +
      (-cy * zoom * c + s.dy * zoom).toFixed(2) + "px) scale(" + zoom.toFixed(4) + ")";
    inPack.style.setProperty("--pk-glow", glow.toFixed(3));
    inPack.style.visibility = "visible";
  }

  function stepOpening(now, s) {
    var o = opening, t = (now - o.t0) / 1000;
    // the tear runs right across, the pack leans in toward you and jolts as the strip comes free
    var tp = clamp(o.from + (1.25 - o.from) * easeOut(t / 0.12), 0, 1.25);
    s.tear = [tp, o.dir, PEEL];
    s.glowCol = TIERS[o.tier].glow;
    var lift = easeOut(t / 0.35);
    s.zoom = 1 + 0.06 * lift;
    s.dy = -8 * lift;
    var amp = Math.max(0, 1 - t / 0.25) * 0.4;
    s.rz = 1.6 * amp * Math.sin(2 * Math.PI * 17 * t);
    s.dx = 2.5 * amp * Math.sin(2 * Math.PI * 23 * t + 1);
    s.dy += 1.5 * amp * Math.sin(2 * Math.PI * 19 * t);
    // the strip flies off the way the tear ran, and light spills out of the open pack
    var p = clamp(t / 0.8, 0, 1), e = easeOut(p), side = o.dir;
    s.top = { x: 230 * e * side, y: 520 * e - 160 * p * p, z: 60 * e, rx: -55 * p, ry: 20 * e * side, rz: -38 * e * side, a: 1 - smooth((p - 0.5) / 0.5) };
    s.glow = 1.6 * Math.exp(-t / 0.35) + 0.75;
    s.gap = Math.exp(-t / 0.18);
    s.dy += 16 * Math.sin(Math.PI * clamp(t / 0.28, 0, 1));      // the body kicks back
    if (o.rise < 0 && t >= 0.3) { o.rise = t; sfx("slide", { gain: 0.55, rate: 0.85 }); cue("rise", o.card); }
    var tearY = (0.5 - CUT_Y) * PILLOW.H;     // the tear line, pack px up from the middle
    // the card rises out, glowing ...
    if (o.rise >= 0 && o.out < 0) {
      var rp = clamp((t - o.rise) / 0.7, 0, 1);
      var top = tearY - 30 + (CARD.h * 0.46 + 30) * easeOutBack(rp);
      if (o.pull < 0 && t - o.rise >= 1.0) { o.pull = t; sfx("slide", { gain: 0.8, rate: 1.15 }); cue("pull", o.card); }
      // ... and is pulled clear: a slow start, as a snug card comes, then free
      if (o.pull >= 0) {
        var pp = clamp((t - o.pull) / 0.5, 0, 1);
        top += (CARD.h * 0.54 + 70) * (pp < 0.35 ? 0.18 * smooth(pp / 0.35) : 0.18 + 0.82 * smooth((pp - 0.35) / 0.65));
        if (pp >= 1) {
          o.out = t; o.fly = flyOut(now); showStage(o, true);
          sfx("whoosh", { gain: 0.7 });
          if (!cue("out", o.card) && o.tier === "secret") sfx("swell", { gain: 1 });   // it swells into the landing
        }
      }
      if (o.out < 0) placeInPack(s, top - CARD.h / 2, 0.9 * (1 - rp) + 0.35);
    }
    // the card comes forward, straight and face on, while the night comes up behind it
    if (o.fly && flyer) {
      var fp = clamp((now - o.fly.t0) / 550, 0, 1);
      var fe = fp < 0.5 ? 4 * fp * fp * fp : 1 - Math.pow(-2 * fp + 2, 3) / 2;
      flyer.style.transform = fp >= 1 ? "none" : "translate(" + (o.fly.dx * (1 - fe)).toFixed(2) + "px, " +
        (o.fly.dy * (1 - fe)).toFixed(2) + "px) scale(" + (o.fly.sc + (1 - o.fly.sc) * fe).toFixed(4) + ")";
      if (stage) stage.style.opacity = smooth(fp / 0.85).toFixed(3);
      if (fp >= 1) { land(o, now); opening = null; return false; }
    }
    if (t > 8) {                              // a safety net: never leave the opening half done
      if (!stage) showStage(o, true);
      land(o, now); opening = null; return false;
    }
    return true;
  }

  // keep room above the pack for the card as it comes out
  function makeRoom() {
    var r = btn.getBoundingClientRect();
    var need = btn.clientWidth * 0.75 + 72;   // most of a card over the pack, and the sticky header
    if (r.top < need) window.scrollBy({ top: r.top - need, behavior: reduce.matches ? "auto" : "smooth" });
  }

  // the card leaves the pack: a copy on top of the page takes over at the same spot and travels to the reveal
  function flyOut(now) {
    var from = inPack.getBoundingClientRect();
    var to = stageRect();
    flyer = document.createElement("img");
    flyer.className = "pk-fly";
    flyer.alt = "";
    flyer.src = inPack.src;
    flyer.style.left = to.left + "px"; flyer.style.top = to.top + "px";
    flyer.style.width = to.width + "px"; flyer.style.height = to.height + "px";
    var fly = { t0: now, dx: from.left - to.left, dy: from.top - to.top, sc: from.width / to.width };
    flyer.style.transform = "translate(" + fly.dx + "px, " + fly.dy + "px) scale(" + fly.sc + ")";
    document.body.appendChild(flyer);
    inPack.remove(); inPack = null;
    return fly;
  }

  // the reveal's card size: whole device pixels per card pixel where it fits (the art is 720 px wide)
  function stageRect() {
    var vw = innerWidth, vh = innerHeight, dpr = window.devicePixelRatio || 1;
    var info = vw < 720 ? 300 : 0;            // phones stack the words (and the Mystery Code) under the card
    var maxW = Math.min(420, vw - 48, (vh - 140 - info) * CARD.w / CARD.h);
    var w = 0;
    [2, 1, 0.5].forEach(function (m) { var c = 720 * m / dpr; if (!w && c <= maxW) w = c; });
    if (!w) w = Math.max(160, Math.floor(maxW));
    var h = w * CARD.h / CARD.w;
    var left = vw < 720 ? (vw - w) / 2 : vw / 2 - w - 24;
    var top = vw < 720 ? Math.max(24, (vh - h - info) / 2) : (vh - h) / 2;
    return { left: Math.round(left), top: Math.round(top), width: w, height: h };
  }

  // ── the reveal ───────────────────────────────────────────────
  // arriving: built as the card leaves the pack, dark and empty, and filled when it lands (land)
  function showStage(o, arriving) {
    var card = o.card, got = o.got, r = stageRect();
    stage = document.createElement("div");
    stage.className = "pk-stage pk-stage--" + o.tier + (arriving ? " is-arriving" : "");
    stage.setAttribute("role", "dialog");
    stage.setAttribute("aria-modal", "true");
    stage.setAttribute("aria-label", card.name);
    stage.style.setProperty("--pk-card-glow", card.glow || "#7614d8");
    if (arriving) stage.style.opacity = "0";
    // the rarity, then new or a duplicate with how many the binder now holds
    var tag = (TIERS[o.tier].tag ? TIERS[o.tier].tag + " · " : "") +
      (got.isNew ? "New card" : 'Duplicate <b class="pk-stage-dupe">×' + got.n + '</b>');
    var full = got.owned >= CARDS.length;
    stage.innerHTML =
      '<div class="pk-stage-back" aria-hidden="true"></div>' +
      '<div class="pk-stage-blink" aria-hidden="true"></div>' +
      '<div class="pk-stage-card" style="left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px">' +
        '<img alt="" width="' + r.width + '" height="' + r.height + '">' +
        '<span class="pk-stage-shine" aria-hidden="true"><i class="pk-stage-glint"></i></span>' +
        '<span class="pk-stage-flash" aria-hidden="true"></span></div>' +
      '<div class="pk-stage-info">' +
        '<span class="pk-stage-tag">' + tag + '</span>' +
        '<h3 class="pk-stage-name">' + esc(card.name) + '</h3>' +
        '<p class="pk-stage-meta">' + esc(card.finish) + ' · No. ' + pad3(card.n) + ' · BST ' + card.bst + '</p>' +
        '<p class="pk-stage-count"><b>' + got.owned + ' / ' + CARDS.length + '</b> in your binder' + (full && got.isNew ? ': complete!' : '') + '</p>' +
        (card.code ? codeBlock(card.code) : '') +
        '<div class="pk-stage-btns">' +
          '<button type="button" class="ff-btn ff-btn--violet ff-btn--sm" data-again>Open another pack</button>' +
          '<a class="ff-btn ff-btn--light ff-btn--sm" href="binder?new=' + encodeURIComponent(card.slug) + '">Open your binder</a>' +
        '</div>' +
      '</div>' +
      '<div class="pk-stage-tools"><button type="button" class="pk-stage-close" aria-label="Close" data-close>&times;</button></div>';
    var im = stage.querySelector(".pk-stage-card img");
    im.src = cardSrc(card, r.width * (window.devicePixelRatio || 1) <= 360 ? 360 : 720);
    im.alt = card.name + " card";
    stage.querySelector(".pk-stage-tools").insertBefore(soundButton(), stage.querySelector("[data-close]"));
    document.body.appendChild(stage);
    layoutStage();
    document.documentElement.classList.add("pk-staged");
    var copyBtn = stage.querySelector("[data-copy-code]");
    if (copyBtn) copyBtn.addEventListener("click", function () { copyCode(copyBtn); });
    stage.querySelector("[data-again]").addEventListener("click", function () { closeStage(true); });
    stage.querySelector("[data-close]").addEventListener("click", function () { closeStage(false); });
    stage.addEventListener("keydown", function (e) { if (e.key === "Escape") closeStage(false); });
    tiltCard(stage.querySelector(".pk-stage-card"));
  }

  // the card's Mystery Code (cards.json "code"): the same for everyone; the game gives this card's Mega for it
  function codeBlock(code) {
    return '<div class="pk-code">' +
        '<span class="pk-code-label">Mystery Code</span>' +
        '<code class="pk-code-value" data-code>' + esc(code) + '</code>' +
        '<button type="button" class="pk-code-copy" data-copy-code aria-label="Copy the Mystery Code">Copy</button>' +
        '<span class="pk-code-said" role="status" aria-live="polite"></span>' +
      '</div>' +
      '<p class="pk-code-note">Enter it at the Pokémon Center in Tradewind Town or Shin Tokyo to receive this Mega, ' +
        'once per save, from v1.3.0.</p>';
  }
  function copyCode(button) {
    var box = button.parentNode, code = box.querySelector("[data-code]"), said = box.querySelector(".pk-code-said");
    function done(ok) {
      if (!ok) {                              // no clipboard: leave the code selected to copy by hand
        try { var rg = document.createRange(); rg.selectNodeContents(code); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); } catch (e) { /* old browsers */ }
      }
      button.textContent = ok ? "Copied" : "Selected";
      said.textContent = ok ? "Code copied" : "Code selected: copy it with your device";
      clearTimeout(button._t);
      button._t = setTimeout(function () { button.textContent = "Copy"; said.textContent = ""; }, 1800);
    }
    var text = code.textContent;
    function legacy() {
      var ta = document.createElement("textarea"), ok = false;
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.top = "0"; ta.style.opacity = "0";
      box.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove(); button.focus({ preventScroll: true });
      return ok;
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(legacy()); });
    else done(legacy());
  }

  // the card lands: it takes the flying copy's place, and its rarity shows in light
  //   plain   a soft flash and one glint across the face
  //   rare    a brighter flash, the glint, and twinkles around the frame (one now and then after)
  //   secret  a soft flash over the whole screen, the card's flash and glint, more twinkles in its own colour
  function land(o, now) {
    if (!stage) return;
    stage.style.opacity = "";
    stage.classList.remove("is-arriving");
    if (flyer) { flyer.remove(); flyer = null; }
    state = "revealed";
    updateCount();
    try { stage.querySelector("[data-again]").focus({ preventScroll: true }); } catch (e) { /* old browsers */ }
    sfx("land", { gain: 0.9 });
    if (!cue("land", o.card)) sfx("reveal-" + o.tier);
    if (reduce.matches) return;
    var T = TIERS[o.tier];
    var tint = o.card.finish === "Shadow" ? "214,170,255" : T.tint;
    stage.style.setProperty("--pk-tint", tint);
    var g = glitter = {
      t0: now, T: T, tint: tint, next: now + 1300 + T.idle * 500,
      flash: stage.querySelector(".pk-stage-flash"), glint: stage.querySelector(".pk-stage-glint"),
      blink: stage.querySelector(".pk-stage-blink"), info: stage.querySelector(".pk-stage-info"),
      sparks: T.twinkles ? makeSparks(stage) : null
    };
    for (var i = 0; i < T.twinkles; i++) g.sparks.add(spark(now + 110 + i * (950 / T.twinkles) + Math.random() * 70, i % 3 === 0, tint));
    g.info.style.opacity = "0";
    (function loop() {
      if (glitter !== g || !stage) return;
      var t2 = performance.now(), s = (t2 - g.t0) / 1000;
      g.flash.style.opacity = (g.T.flash * (s < 0.06 ? s / 0.06 : Math.exp(-(s - 0.06) / 0.22))).toFixed(3);
      var gp = smooth((s - 0.08) / 0.75);
      g.glint.style.left = (-60 + 190 * gp).toFixed(1) + "%";
      g.glint.style.opacity = gp > 0 && gp < 1 ? "1" : "0";
      if (g.T.blink) g.blink.style.opacity = (g.T.blink * (s < 0.05 ? s / 0.05 : Math.exp(-(s - 0.05) / 0.2))).toFixed(3);
      var ip = smooth((s - 0.15) / 0.4);
      g.info.style.opacity = ip.toFixed(3);
      g.info.style.setProperty("--pk-in", ((1 - ip) * 14).toFixed(1) + "px");
      var live = s < 1.4;
      if (g.sparks) {
        if (g.T.idle && t2 >= g.next) { g.sparks.add(spark(t2, Math.random() < 0.4, g.tint)); g.next = t2 + g.T.idle * 1000 * (0.7 + 0.6 * Math.random()); }
        var r = stage.querySelector(".pk-stage-card").getBoundingClientRect();
        live = g.sparks.draw(t2, r) || live || !!g.T.idle;
      }
      if (live) requestAnimationFrame(loop);
    })();
  }
  // the card where stageRect puts it; the words beside it (wide screens) or under it (phones)
  function layoutStage() {
    if (!stage) return;
    var r = stageRect(), cardEl = stage.querySelector(".pk-stage-card"), info = stage.querySelector(".pk-stage-info");
    cardEl.style.left = r.left + "px"; cardEl.style.top = r.top + "px";
    cardEl.style.width = r.width + "px"; cardEl.style.height = r.height + "px";
    stage.style.setProperty("--pk-cx", Math.round(r.left + r.width / 2) + "px");
    stage.style.setProperty("--pk-cy", Math.round(r.top + r.height / 2) + "px");
    var phone = innerWidth < 720;
    stage.classList.toggle("is-narrow", phone);
    info.style.left = phone ? "16px" : (r.left + r.width + 48) + "px";
    info.style.right = phone ? "16px" : "";
    info.style.top = phone ? (r.top + r.height + 18) + "px" : (r.top + r.height / 2) + "px";
  }
  window.addEventListener("resize", layoutStage);
  function esc(s) { return String(s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }); }
  function pad3(n) { return (n < 10 ? "00" : n < 100 ? "0" : "") + n; }

  // the revealed card leans toward the pointer (or a finger on it) and lies flat again when let go
  function tiltCard(el) {
    if (reduce.matches) return;
    function at(e) {
      var r = el.getBoundingClientRect();
      var x = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1), y = clamp((e.clientY - r.top) / r.height * 2 - 1, -1, 1);
      el.style.transform = "perspective(1200px) rotateX(" + (-y * 9).toFixed(2) + "deg) rotateY(" + (x * 12).toFixed(2) + "deg)";
      el.style.setProperty("--pk-lx", (50 + x * 40).toFixed(1) + "%");
      el.style.setProperty("--pk-ly", (50 + y * 40).toFixed(1) + "%");
      el.classList.add("is-tilted");
    }
    function rest() { el.style.transform = ""; el.classList.remove("is-tilted"); }
    el.addEventListener("pointermove", at);
    el.addEventListener("pointerdown", at);
    el.addEventListener("pointerleave", rest);
    el.addEventListener("pointerup", function (e) { if (e.pointerType !== "mouse") rest(); });
  }

  function closeStage(again) {
    if (!stage || state !== "revealed") return;
    var s = stage; stage = null; glitter = null;
    s.classList.add("is-closing");
    setTimeout(function () { s.remove(); }, reduce.matches ? 0 : 220);
    document.documentElement.classList.remove("pk-staged");
    nextPack(!again);
    if (!again) {
      if (focus && focus.on) exitFocus();
      else { try { btn.focus({ preventScroll: true }); } catch (e) { /* old browsers */ } }
    }
  }

  // a fresh pack: the next card is drawn and the pack drops into place
  function nextPack(still) {
    HIT = pull();
    loadImage(cardSrc(HIT)).catch(function () {});
    if (SND.ctx) loadSounds();                // the new card's step
    state = "ready";
    mark("is-opening", false);
    rip = null; opening = null;
    if (gl) {
      gl.margin(MARGIN);
      if (!reduce.matches && !still) {
        landing = { t0: performance.now() };
        sfx("crinkle", { gain: 0.6, delay: 0.12 }); sfx("land", { gain: 0.45, delay: 0.3 });
      }
    }
    kick();
  }
  function stepLanding(now, s) {
    var p = clamp((now - landing.t0) / 520, 0, 1);
    s.dy += -120 * (1 - easeOutBack(p));
    s.alpha = smooth(p / 0.35);
    if (p > 0.55) s.jy += 3 * Math.sin(2 * Math.PI * 5 * (p - 0.55)) * (1 - p) * 2;   // it lands with a little settle
    if (p >= 1) { landing = null; return false; }
    return true;
  }

  // no WebGL or reduced motion: straight to the card
  function quickOpen() {
    var got = addToBinder(HIT.slug);
    lastPulled = HIT;
    countPack();
    var o = { card: HIT, tier: tierOf(HIT), got: got };
    showStage(o, false);
    land(o, performance.now());
  }

  // ── start: WebGL, then the countdown ─────────────────────────
  try {
    var made = window.WebGLRenderingContext ? makeGl() : null;
    if (made) made.then(function (r) {
      gl = r;
      gl.draw({ x: tilt.x, y: tilt.y, rz: 0, dx: 0, dy: 0, jy: 0, sweep: -1, tear: [0, 1, 0], alpha: 1 });
      mark("is-gl", true);
      if (state === "ready") {
        lightUp();
      }
    }).catch(function (err) { gl = null; if (window.console) console.warn("pack: flat fallback", err); });
  } catch (err) { gl = null; if (window.console) console.warn("pack: flat fallback", err); }

  // ?pack=open&wake counts the last 4 seconds down, to preview the flash at zero
  var drop = preview ? Date.now() + (/[?&]wake\b/.test(location.search) ? 4000 : -1000)
    : root.hasAttribute("data-open") ? 0 : Date.parse(root.getAttribute("data-drop") || "");
  var cells = {};
  ["d", "h", "m", "s"].forEach(function (u) { cells[u] = root.querySelector('[data-u="' + u + '"]'); });
  var label = root.querySelector("[data-pack-label]");
  var two = function (n) { return (n < 10 ? "0" : "") + n; };

  function tick() {
    if (isNaN(drop)) return;
    var left = Math.max(0, Math.floor((drop - Date.now()) / 1000));
    if (left > 0) sawCountdown = true;
    var d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
    cells.d.textContent = two(d); cells.h.textContent = two(h); cells.m.textContent = two(m); cells.s.textContent = two(s);
    var st = left === 0 ? "open" : left <= 60 ? "late" : "run";
    if (root.getAttribute("data-state") !== st) {
      root.setAttribute("data-state", st);
      if (label) label.textContent = st === "open" ? "Out now" : "Opens in";
    }
    if (left > 0) setTimeout(tick, (drop - Date.now()) % 1000 + 15);   // just after each whole second
    else enterReady();
  }
  tick();
})();
