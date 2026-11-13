/* The sealed Mega Dimension booster pack (styles in pack.css).
   - Drawn in WebGL as a real pillow: the body bulges, its sides curve away, and two studio softboxes
     (left and right) plus a soft overhead panel reflect off the curve. That gives the bright side
     shines of a foil pack, and they slide over the edges and crinkles as it turns. The surface comes
     from img/normal.webp (made with the same pillow numbers
     as PILLOW below). Without WebGL it falls back to the flat image with CSS light layers.
   - Tilt: a mouse over the pack, or a finger held on it, turns it (the pointer's side dips away, as
     the card carousel does). At rest the pack is drawn flat-on with no perspective, texel for pixel,
     so its sprite pixels stay whole.
   - Shake: a click or tap (or Enter / Space) shakes it like a pack you are guessing the cards in.
   - Every 7 s while it sits on screen untouched, a light sweeps across it.
   - Countdown to the drop in data-drop (an ISO time with its UTC offset): gold digits in the last
     minute, "Out now" at zero. With reduced motion it neither tilts, shakes nor sweeps.

   Opening (once the drop has passed, and only if the cards' images load):
   - The pack offers "Tap to open". Opening plays three of the anime cel transitions from fx/
     (fx.json) over the whole screen, centred on the pack:
       charge  pink lightning: the pack lifts and rumbles; under its pink flash the silhouettes light up
               (img/pack-lit-*.webp, which exists only in the after-release site);
       cut     gold slash: under its white the top crimp tears off and flies away, light spills out;
       reveal  the hit card (data-pack-hit, default Lugia) rises out of the pack, the blue smoke covers
               the screen, and under it the section becomes the card carousel (<template id="cards-reveal">,
               cards.css + cards.js loaded here), opened on that card.
   - "See the cards" skips straight to the carousel; reduced motion skips the effects. A visitor who has
     opened it once gets the carousel straight away next time.
   - Preview on a local server before the drop: ?pack=open. */
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
  var state = "sealed";                       // sealed | ready | opening | opened
  var opening = null;                         // the opening's timeline while it plays
  var ASSETS = img.getAttribute("src").replace(/pack\/img\/pack-\d+\.webp.*$/, "");   // "assets/"
  var HIT = root.getAttribute("data-pack-hit") || "lugia";
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var preview = local && /[?&]pack=open\b/.test(location.search);

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) { t = clamp(t, 0, 1); var c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

  // ── the frame loop: eases the tilt, runs the shake, the sweep and the opening, then draws ──
  function frame() {
    var now = performance.now();              // the same clock the shake, sweep and opening start from
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    var k = 1 - Math.exp(-dt / 0.09);
    tilt.x += (tilt.tx - tilt.x) * k;
    tilt.y += (tilt.ty - tilt.y) * k;
    var busy = Math.abs(tilt.tx - tilt.x) + Math.abs(tilt.ty - tilt.y) > 0.002;
    if (!busy) { tilt.x = tilt.tx; tilt.y = tilt.ty; }
    var s = { x: tilt.x, y: tilt.y, rz: 0, dx: 0, dy: 0, jy: 0, sweep: -1 };
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
    if (opening) busy = stepOpening(now, s) || busy;
    if (state !== "opened") { if (gl) gl.draw(s); else paintCss(s); }
    raf = busy ? requestAnimationFrame(frame) : 0;
    if (!busy) last = 0;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  // ── input ─────────────────────────────────────────────────────
  function aim(x, y) {
    if (reduce.matches || opening) { x = 0; y = 0; }
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
  btn.addEventListener("pointermove", function (e) {
    if (e.pointerType === "mouse" || held === e.pointerId) { var o = over(e); aim(o.x, o.y); }
  });
  btn.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") aim(0, 0); });
  btn.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse") return;
    held = e.pointerId;                       // a finger tilts the pack it holds
    var o = over(e); aim(o.x, o.y);
  });
  function release(e) { if (held === e.pointerId) { held = null; aim(0, 0); } }
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);   // the page scrolled instead

  btn.addEventListener("click", function () {
    if (state === "opening" || state === "opened") return;
    if (state === "ready") { open(); return; }
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
    if (!gl || reduce.matches || !onScreen || document.hidden || shake || sweep || opening || state === "opened") return;
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
  var CARD = { w: 700, h: 980 };              // the rising card, pack px (5:7)

  var VS = [
    "attribute vec2 a_uv;",
    "uniform mat3 u_rot;",
    "uniform vec2 u_scale;",                  // clip units per pack px
    "uniform vec2 u_shift;",                  // pack px
    "uniform float u_persp;",
    "uniform float u_piece;",                 // 0 the body, 1 the torn-off top
    "uniform mat3 u_topR;",
    "uniform vec3 u_topT;",
    "varying vec2 v_uv;",
    "varying vec3 v_pos;",
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
    "  if (u_piece > 0.5) {",                 // the top strip turns about its own middle and flies
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
    "uniform float u_cut;",                   // 1 once the top is torn
    "uniform float u_side;",                  // which piece this draw is (0 body, 1 top)
    "uniform float u_glow;",
    "uniform float u_alpha;",
    "varying vec2 v_uv;",
    "varying vec3 v_pos;",
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
    "  if (u_cut > 0.5) {",
    "    if (u_side < 0.5 && v_uv.y < edge) discard;",
    "    if (u_side > 0.5 && v_uv.y >= edge) discard;",
    "  }",
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
    // the torn edge glows: rift light spilling out of the open pack
    "  float d = abs(v_uv.y - edge);",
    "  col += u_glow * u_cut * (exp(-d / 0.006) * vec3(1.0, 0.92, 1.0) + exp(-d / 0.05) * vec3(0.55, 0.3, 0.95) * 0.6);",
    "  gl_FragColor = vec4(col * a.a, a.a) * u_alpha;",
    "}"
  ].join("\n");

  // the hit card rising out of the pack: a flat card just behind the face, so the body hides it until the
  // top has gone
  var CVS = [
    "attribute vec2 a_uv;",
    "uniform mat3 u_rot;",
    "uniform vec2 u_scale;",
    "uniform vec2 u_shift;",
    "uniform float u_persp;",
    "uniform vec4 u_rect;",                   // centre x, centre y, half width, half height (pack px)
    "varying vec2 v_uv;",
    "void main() {",
    "  vec3 p = vec3(u_rect.x + (a_uv.x - 0.5) * 2.0 * u_rect.z, u_rect.y + (0.5 - a_uv.y) * 2.0 * u_rect.w, -6.0);",
    "  p = u_rot * p;",
    "  p.xy += u_shift;",
    "  float s = 1.0 / (1.0 - u_persp * p.z / 3600.0);",
    "  gl_Position = vec4(p.xy * s * u_scale, -p.z / 4000.0, 1.0);",
    "  v_uv = a_uv;",
    "}"
  ].join("\n");
  var CFS = [
    "precision mediump float;",
    "uniform sampler2D u_card;",
    "uniform float u_glow;",
    "varying vec2 v_uv;",
    "void main() {",
    "  vec4 c = texture2D(u_card, v_uv);",
    "  if (c.a < 0.004) discard;",
    "  float rim = 1.0 - smoothstep(0.0, 0.06, min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y) * 1.4));",
    "  vec3 col = c.rgb + u_glow * (rim * vec3(0.8, 0.6, 1.0) + vec3(0.12, 0.08, 0.2));",
    "  gl_FragColor = vec4(col * c.a, c.a);",
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
      "u_crimp", "u_sweep", "u_piece", "u_topR", "u_topT", "u_cut", "u_side", "u_glow", "u_alpha"]);
    var C = program(c, CVS, CFS, ["u_rot", "u_scale", "u_shift", "u_persp", "u_rect", "u_card", "u_glow"]);

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
    var qb = c.createBuffer(); c.bindBuffer(c.ARRAY_BUFFER, qb); c.bufferData(c.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), c.STATIC_DRAW);
    c.enable(c.DEPTH_TEST); c.depthFunc(c.LEQUAL);
    c.enable(c.BLEND); c.blendFunc(c.ONE, c.ONE_MINUS_SRC_ALPHA);
    c.useProgram(P.p);
    c.uniform1i(P.U.u_alb, 0); c.uniform1i(P.U.u_nrm, 1); c.uniform1i(P.U.u_litTex, 2);
    c.uniform1f(P.U.u_crimp, PILLOW.CR / PILLOW.H);
    c.useProgram(C.p);
    c.uniform1i(C.U.u_card, 3);

    function tex(unit) {
      var t = c.createTexture();
      c.activeTexture(c.TEXTURE0 + unit); c.bindTexture(c.TEXTURE_2D, t);
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_WRAP_S, c.CLAMP_TO_EDGE);
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_WRAP_T, c.CLAMP_TO_EDGE);
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_MIN_FILTER, c.LINEAR);
      c.texImage2D(c.TEXTURE_2D, 0, c.RGBA, 1, 1, 0, c.RGBA, c.UNSIGNED_BYTE, new Uint8Array(4));
      return t;
    }
    var albTex = tex(0), nrmTex = tex(1), litTex = tex(2), cardTex = tex(3), albW = 0, litW = 0;
    var hasLit = false, hasCard = false;
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
    // the lit Megas exist only in the after-release site; without them the silhouettes stay
    function loadLit() {
      var w = albW || 640;
      return loadImage(base + "pack-lit-" + w + ".webp").then(function (im) { litW = w; hasLit = true; upload(litTex, 2, im); }, function () {});
    }
    function loadCard(src) {
      return loadImage(src).then(function (im) { hasCard = true; upload(cardTex, 3, im); });
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
    var lastS = { x: 0, y: 0, rz: 0, dx: 0, dy: 0, jy: 0, sweep: -1 };

    function draw(s) {
      lastS = s;
      var rad = Math.PI / 180;
      var ax = s.y * TILT_X * rad + (s.rx || 0) * rad, ay = (s.x * TILT_Y + s.jy) * rad, az = -s.rz * rad;
      var R = new Float32Array(rot(ax, ay, az));
      var zoom = s.zoom || 1;
      var flat = Math.abs(ax) + Math.abs(ay) + Math.abs(az) < 1e-5 && zoom === 1 && !s.cut;
      var k = size.packD / PILLOW.W * zoom;   // device px per pack px
      var pxPerPack = PILLOW.W / btn.clientWidth;
      var persp = flat ? 0 : Math.max(s.cut || zoom !== 1 ? 1 : 0, Math.min(1, (Math.abs(ax) + Math.abs(ay)) / (8 * rad)));
      c.clearColor(0, 0, 0, 0);
      c.clear(c.COLOR_BUFFER_BIT | c.DEPTH_BUFFER_BIT);

      if (s.card && hasCard) {                // the card first: the body in front hides its lower part
        c.useProgram(C.p);
        c.bindBuffer(c.ARRAY_BUFFER, qb);
        c.enableVertexAttribArray(C.a); c.vertexAttribPointer(C.a, 2, c.FLOAT, false, 0, 0);
        c.uniformMatrix3fv(C.U.u_rot, false, R);
        c.uniform2f(C.U.u_scale, 2 * k / size.cw, 2 * k / size.ch);
        c.uniform2f(C.U.u_shift, s.dx * pxPerPack, -s.dy * pxPerPack);
        c.uniform1f(C.U.u_persp, persp);
        c.uniform4f(C.U.u_rect, 0, s.card.y, CARD.w / 2, CARD.h / 2);
        c.uniform1f(C.U.u_glow, s.card.glow);
        c.drawArrays(c.TRIANGLE_STRIP, 0, 4);
      }

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
      c.uniform1f(P.U.u_cut, s.cut ? 1 : 0);
      c.uniform1f(P.U.u_glow, s.glow || 0);
      filterAlbedo(flat && albW === size.packD);
      // the body
      c.uniform1f(P.U.u_piece, 0); c.uniform1f(P.U.u_side, 0); c.uniform1f(P.U.u_alpha, 1);
      c.uniformMatrix3fv(P.U.u_topR, false, ID); c.uniform3f(P.U.u_topT, 0, 0, 0);
      c.drawElements(c.TRIANGLES, idx.length, c.UNSIGNED_SHORT, 0);
      // the torn-off top, flying
      if (s.cut && s.top && s.top.a > 0.002) {
        c.uniform1f(P.U.u_piece, 1); c.uniform1f(P.U.u_side, 1); c.uniform1f(P.U.u_alpha, s.top.a);
        c.uniformMatrix3fv(P.U.u_topR, false, new Float32Array(rot(s.top.rx * rad, s.top.ry * rad, s.top.rz * rad)));
        c.uniform3f(P.U.u_topT, s.top.x, s.top.y, s.top.z);
        c.drawElements(c.TRIANGLES, idx.length, c.UNSIGNED_SHORT, 0);
      }
    }

    var ready = Promise.all([useAlbedo(fit()), loadImage(base + "normal.webp").then(function (im) { upload(nrmTex, 1, im); })]);
    window.addEventListener("resize", function () {
      if (!gl || state === "opened") return;
      useAlbedo(fit()).then(function () { draw(lastS); });
    });
    canvas.addEventListener("webglcontextlost", function (e) {   // back to the CSS pack
      e.preventDefault(); gl = null; root.classList.remove("is-gl"); canvas.remove();
    });
    return ready.then(function () {
      btn.appendChild(canvas);
      return { draw: draw, canvas: canvas, fit: fit, loadLit: loadLit, loadCard: loadCard,
               margin: function (m) { fit(m); draw(lastS); } };
    });
  }

  // ── the effects overlay: the cel transitions over the whole screen ──
  // Each effect is an MP4 with its colour (premultiplied) on top and its alpha as grey below it.
  var FXVS = [
    "attribute vec2 a_uv;",
    "uniform vec4 u_rect;",                   // x0, y0, x1, y1 in clip space
    "varying vec2 v_uv;",
    "void main() { v_uv = a_uv; gl_Position = vec4(mix(u_rect.xy, u_rect.zw, a_uv), 0.0, 1.0); }"
  ].join("\n");
  var FXFS = [
    "precision mediump float;",
    "uniform sampler2D u_v;",
    "varying vec2 v_uv;",
    "void main() {",
    "  vec2 t = vec2(v_uv.x, 1.0 - v_uv.y);",
    "  vec3 col = texture2D(u_v, vec2(t.x, t.y * 0.5)).rgb;",
    "  float a = clamp((texture2D(u_v, vec2(t.x, 0.5 + t.y * 0.5)).r - 0.03) / 0.94, 0.0, 1.0);",
    "  gl_FragColor = vec4(min(col, vec3(a)), a);",
    "}"
  ].join("\n");

  function makeFx(meta) {
    var canvas = document.createElement("canvas");
    canvas.className = "pk-fx";
    canvas.setAttribute("aria-hidden", "true");
    var c = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!c) return null;
    var F = program(c, FXVS, FXFS, ["u_rect", "u_v"]);
    c.useProgram(F.p);
    var qb = c.createBuffer(); c.bindBuffer(c.ARRAY_BUFFER, qb); c.bufferData(c.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), c.STATIC_DRAW);
    c.enableVertexAttribArray(F.a); c.vertexAttribPointer(F.a, 2, c.FLOAT, false, 0, 0);
    c.enable(c.BLEND); c.blendFunc(c.ONE, c.ONE_MINUS_SRC_ALPHA);
    c.uniform1i(F.U.u_v, 0);
    var fx = {};
    Object.keys(meta).forEach(function (name) {
      var v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous";
      v.setAttribute("muted", ""); v.setAttribute("playsinline", "");
      v.src = ASSETS + "pack/fx/" + name + ".mp4";
      var t = c.createTexture();
      c.bindTexture(c.TEXTURE_2D, t);
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_WRAP_S, c.CLAMP_TO_EDGE);
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_WRAP_T, c.CLAMP_TO_EDGE);
      c.texParameteri(c.TEXTURE_2D, c.TEXTURE_MIN_FILTER, c.LINEAR);
      fx[name] = { v: v, t: t, meta: meta[name], t0: -1, has: false };
    });
    var centre = { x: 0, y: 0 };
    function fit() {
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
      c.viewport(0, 0, canvas.width, canvas.height);
    }
    return {
      canvas: canvas, fx: fx,
      prime: function () {                    // inside the tap: lets mobile browsers play them later
        Object.keys(fx).forEach(function (n) {
          var v = fx[n].v, p = v.play();
          if (p && p.then) p.then(function () { if (fx[n].t0 < 0) { v.pause(); v.currentTime = 0; } }, function () {});
        });
      },
      start: function (name, now) {
        var f = fx[name]; f.t0 = now;
        try { f.v.currentTime = 0; } catch (e) { /* not loaded yet */ }
        var p = f.v.play(); if (p && p.catch) p.catch(function () {});
      },
      // the effect's frame: from the video once it plays, from the clock until then
      frame: function (name, now) {
        var f = fx[name];
        if (f.t0 < 0) return -1;
        return f.v.currentTime > 0 ? f.v.currentTime * f.meta.fps : (now - f.t0) / 1000 * f.meta.fps;
      },
      attach: function (cx, cy) { centre.x = cx; centre.y = cy; fit(); document.body.appendChild(canvas); },
      draw: function (now) {
        c.clearColor(0, 0, 0, 0); c.clear(c.COLOR_BUFFER_BIT);
        // cover the screen from the pack's centre at the effects' 3:2
        var vw = innerWidth, vh = innerHeight;
        var hw = Math.max(centre.x, vw - centre.x) * 1.04, hh = Math.max(centre.y, vh - centre.y) * 1.04;
        var W = Math.max(2 * hw, 2 * hh * 1.5), H = W / 1.5;
        var x0 = (centre.x - W / 2) / vw * 2 - 1, x1 = (centre.x + W / 2) / vw * 2 - 1;
        var y0 = 1 - (centre.y + H / 2) / vh * 2, y1 = 1 - (centre.y - H / 2) / vh * 2;
        c.uniform4f(F.U.u_rect, x0, y0, x1, y1);
        Object.keys(fx).forEach(function (n) {
          var f = fx[n];
          if (f.t0 < 0 || f.done) return;
          if (this.frame(n, now) >= f.meta.frames - 0.5 || f.v.ended) { f.done = true; return; }
          if (f.v.readyState < 2) return;
          c.activeTexture(c.TEXTURE0); c.bindTexture(c.TEXTURE_2D, f.t);
          c.pixelStorei(c.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          c.texImage2D(c.TEXTURE_2D, 0, c.RGB, c.RGB, c.UNSIGNED_BYTE, f.v);
          c.drawArrays(c.TRIANGLE_STRIP, 0, 4);
        }, this);
      },
      remove: function () {
        canvas.remove();
        Object.keys(fx).forEach(function (n) { fx[n].v.pause(); fx[n].v.removeAttribute("src"); fx[n].v.load(); });
      }
    };
  }

  // ── ready: the drop has passed ────────────────────────────────
  var fxMeta = null, fxPlayer = null, skipBtn = null;
  var hint = root.querySelector(".pk-hint");

  function opened() {
    try { return localStorage.getItem("pk-opened") === "1"; } catch (e) { return false; }
  }
  function enterReady() {
    if (state !== "sealed") return;
    state = "checking";
    // offer the opening only once the cards are really there (the hit card's art and the card list)
    var cardSrc = ASSETS + "cards/img/" + HIT + "-720.webp";
    Promise.all([loadImage(cardSrc), fetch(ASSETS + "cards/cards.json", { method: "HEAD" }).then(function (r) { if (!r.ok) throw r; }),
                 fetch(ASSETS + "pack/fx/fx.json").then(function (r) { return r.json(); })])
      .then(function (got) {
        fxMeta = got[2];
        if (opened() && !preview) { reveal(true); return; }
        state = "ready";
        root.classList.add("is-ready");
        btn.setAttribute("aria-label", "Open the Mega Dimension booster pack");
        if (hint) hint.textContent = "Tap the pack to open it";
        addSkip();
        preloadCardsCss();
        if (gl) { gl.loadLit(); gl.loadCard(cardSrc); }
      }, function () {                        // the cards are not up yet: the pack stays sealed (it still shakes)
        state = "sealed";
        setTimeout(enterReady, 60000);        // and looks again in a minute
      });
  }
  function addSkip() {
    if (skipBtn) return;
    skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "pk-skip";
    skipBtn.textContent = "See the cards";
    skipBtn.addEventListener("click", function () { if (state === "ready") reveal(true); });
    (hint || btn).insertAdjacentElement("afterend", skipBtn);
  }
  var cssReady = null;
  function preloadCardsCss() {
    if (cssReady) return cssReady;
    cssReady = new Promise(function (res) {
      if (document.querySelector('link[href*="cards/cards.css"]')) return res();
      var l = document.createElement("link");
      l.rel = "stylesheet"; l.href = ASSETS + "cards/cards.css?v=20261109a";
      l.onload = l.onerror = function () { res(); };
      document.head.appendChild(l);
    });
    return cssReady;
  }

  // the section becomes the card carousel, opened on the hit card
  function reveal(instant) {
    var tpl = document.getElementById("cards-reveal");
    var section = root.closest("section");
    if (!tpl || !section) return;
    state = "opened";
    preloadCardsCss().then(function () {
      var frag = tpl.content.cloneNode(true);
      var next = frag.querySelector("section");
      if (next) next.setAttribute("data-fc-start", HIT);
      section.replaceWith(frag);
      tpl.remove();
      var js = document.createElement("script");
      js.src = ASSETS + "cards/cards.js?v=20261109a";
      document.body.appendChild(js);
      try { localStorage.setItem("pk-opened", "1"); } catch (e) { /* storage blocked */ }
      if (next) {
        if (!instant) next.scrollIntoView({ block: "start" });
        try { next.focus({ preventScroll: true }); } catch (e) { /* old browsers */ }
      }
    });
  }

  // ── the opening ──────────────────────────────────────────────
  // Times are seconds from the tap. Each step waits on its effect's own frame (fx.json), so a slow video
  // moves the cut with it: the lit swap, the tear and the carousel all happen while an effect covers the screen.
  function open() {
    if (reduce.matches || !gl || !fxMeta) { reveal(false); return; }
    var player = makeFx(fxMeta);
    if (!player) { reveal(false); return; }
    fxPlayer = player;
    state = "opening";
    root.classList.add("is-opening");
    aim(0, 0);
    shake = null; sweep = null;
    // the pack to the middle of the screen, a little low: the card rises above it
    try { btn.scrollIntoView({ block: "center", behavior: "instant" }); } catch (e) { btn.scrollIntoView(); }
    var r0 = btn.getBoundingClientRect(), room = r0.top - btn.clientWidth * 0.62 - 26 - 64;   // card + lift + the sticky header
    if (room < 0) window.scrollBy(0, room);
    var r = btn.getBoundingClientRect();
    player.attach(r.left + r.width / 2, r.top + r.height / 2);
    player.prime();
    gl.margin(Math.round(btn.clientWidth * 0.8));     // room above the pack for the card and the flying top
    var now = performance.now();
    opening = { t0: now, lit: false, cut: -1, rise: -1, fx2: false, fx3: false, swapped: false };
    player.start("pink-lightning", now);
    kick();
  }

  function stepOpening(now, s) {
    var o = opening, P = fxPlayer, t = (now - o.t0) / 1000;
    var f1 = P.frame("pink-lightning", now), f2 = P.frame("gold-slash", now), f3 = P.frame("water-wave", now);
    var M = fxMeta;
    // charge: the pack lifts toward you and rumbles harder and harder
    var lift = easeOut(t / 0.6);
    s.zoom = 1 + 0.09 * lift;
    var amp = o.cut < 0 ? smooth(t / 0.55) : Math.max(0, 1 - (t - o.cut) / 0.2) * 0.4;
    s.rz = 2.4 * amp * Math.sin(2 * Math.PI * 17 * t);
    s.dx = 3.5 * amp * Math.sin(2 * Math.PI * 23 * t + 1);
    s.dy = -10 * lift + 2 * amp * Math.sin(2 * Math.PI * 19 * t);
    s.jy = 6 * amp * Math.sin(2 * Math.PI * 9 * t);
    // under the pink flash the Megas light up
    if (!o.lit && f1 >= M["pink-lightning"].cover[0] + 1) o.lit = true;
    s.lit = o.lit ? 1 : 0;
    if (!o.fx2 && f1 >= M["pink-lightning"].cover[1] + 3) { o.fx2 = true; P.start("gold-slash", now); }
    // under the slash's white the top tears off
    if (o.cut < 0 && f2 >= M["gold-slash"].cut) o.cut = t;
    if (o.cut >= 0) {
      var tc = t - o.cut, p = clamp(tc / 0.8, 0, 1), e = easeOut(p);
      s.cut = true;
      s.top = { x: 230 * e, y: 520 * e - 160 * p * p, z: 60 * e, rx: -55 * p, ry: 20 * e, rz: -38 * e, a: 1 - smooth((p - 0.5) / 0.5) };
      s.glow = 1.6 * Math.exp(-tc / 0.35) + 0.75;
      s.dy += 16 * Math.sin(Math.PI * clamp(tc / 0.28, 0, 1));      // the body kicks back
      if (o.rise < 0 && f2 >= M["gold-slash"].cover[1] + 4) o.rise = t;
    }
    // the hit card rises out, glowing
    if (o.rise >= 0) {
      var rp = clamp((t - o.rise) / 0.75, 0, 1);
      var tearY = (0.5 - CUT_Y) * PILLOW.H;
      var top = tearY - 30 + (CARD.h * 0.56 + 30) * easeOutBack(rp);
      s.card = { y: top - CARD.h / 2, glow: 0.9 * (1 - rp) + 0.25 };
      if (!o.fx3 && rp >= 0.55) { o.fx3 = true; P.start("water-wave", now); }
    }
    // under the blue smoke the section becomes the carousel
    if (!o.swapped && f3 >= M["water-wave"].cut) { o.swapped = true; reveal(false); }
    P.draw(now);
    var done = o.swapped && (f3 >= M["water-wave"].frames - 0.5 || P.fx["water-wave"].v.ended);
    if (done || t > 9) { P.remove(); fxPlayer = null; opening = null; return false; }
    return true;
  }

  // ── start: WebGL, then the countdown ─────────────────────────
  try {
    var made = window.WebGLRenderingContext ? makeGl() : null;
    if (made) made.then(function (r) {
      gl = r;
      gl.draw({ x: tilt.x, y: tilt.y, rz: 0, dx: 0, dy: 0, jy: 0, sweep: -1 });
      root.classList.add("is-gl");
      if (state === "ready") { gl.loadLit(); gl.loadCard(ASSETS + "cards/img/" + HIT + "-720.webp"); }
    }).catch(function (err) { gl = null; if (window.console) console.warn("pack: flat fallback", err); });
  } catch (err) { gl = null; if (window.console) console.warn("pack: flat fallback", err); }

  var drop = preview ? Date.now() - 1000 : Date.parse(root.getAttribute("data-drop") || "");
  var cells = {};
  ["d", "h", "m", "s"].forEach(function (u) { cells[u] = root.querySelector('[data-u="' + u + '"]'); });
  var label = root.querySelector("[data-pack-label]");
  var two = function (n) { return (n < 10 ? "0" : "") + n; };

  function tick() {
    if (isNaN(drop)) return;
    var left = Math.max(0, Math.floor((drop - Date.now()) / 1000));
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
