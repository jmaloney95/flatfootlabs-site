/* The Mega Dimension page: the live clock in the hero.
   It runs the game's own rule: two minutes, gold under ten seconds, a collapse
   at zero, then a fresh rift. With reduced motion it sits at 2:00. */
(function () {
  "use strict";
  var hud = document.querySelector("[data-md-hud]");
  if (!hud) return;
  var min = hud.querySelector("[data-md-min]"), sec = hud.querySelector("[data-md-sec]");
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var total = 120, left = total, timer = null;

  function paint() {
    var m = Math.floor(left / 60), s = left % 60;
    min.textContent = String(m);
    sec.textContent = (s < 10 ? "0" : "") + s;
    hud.setAttribute("data-state", left === 0 ? "collapse" : left <= 10 ? "late" : "run");
  }
  function tick() {
    if (document.hidden) return;
    if (left > 0) { left -= 1; paint(); return; }
    // The collapse holds for a moment, then a new rift opens at 2:00.
    clearInterval(timer);
    setTimeout(function () { left = total; paint(); timer = setInterval(tick, 1000); }, 2400);
  }
  paint();
  if (!still) timer = setInterval(tick, 1000);
})();
