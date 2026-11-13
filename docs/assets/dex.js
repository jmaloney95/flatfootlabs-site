// Pokédex page: search, act and source filters, shiny toggles, open the entry a link names.
(function () {
  var q = document.querySelector('[data-dex-q]');
  var entries = Array.prototype.slice.call(document.querySelectorAll('.ff-dex-entry'));
  var actBtns = document.querySelectorAll('[data-dex-acts] [data-act]');
  var kindBtns = document.querySelectorAll('[data-dex-kinds] [data-kind]');
  var countEl = document.querySelector('[data-dex-count]');
  var emptyEl = document.querySelector('[data-dex-empty]');
  var act = 'all';

  function kinds() {
    var on = [];
    kindBtns.forEach(function (b) { if (b.getAttribute('aria-pressed') === 'true') on.push(b.dataset.kind); });
    return on;
  }

  function apply() {
    var text = (q.value || '').trim().toLowerCase();
    var words = text ? text.split(/\s+/) : [];
    var want = kinds();
    var shown = 0;
    entries.forEach(function (e) {
      var ok = act === 'all' || e.dataset.act === act;
      if (ok && want.length) {
        var src = e.dataset.src.split(' ');
        ok = want.some(function (k) { return src.indexOf(k) !== -1; });
      }
      if (ok && words.length) {
        var hay = e.dataset.q;
        ok = words.every(function (w) { return hay.indexOf(w) !== -1; });
      }
      e.hidden = !ok;
      if (ok) shown++;
    });
    countEl.textContent = shown === entries.length ? 'Showing all ' + shown : 'Showing ' + shown + ' of ' + entries.length;
    emptyEl.hidden = shown !== 0;
  }

  q.addEventListener('input', apply);
  actBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      act = b.dataset.act;
      actBtns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      apply();
    });
  });
  kindBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
      apply();
    });
  });

  document.querySelectorAll('[data-shiny-toggle]').forEach(function (b) {
    var img = b.parentNode.querySelector('img');
    b.addEventListener('click', function () {
      var on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      img.src = on ? img.dataset.shiny : img.dataset.normal;
      img.alt = img.alt.replace(/ \(shiny\)$/, '') + (on ? ' (shiny)' : '');
    });
  });

  // A link to #dex-... opens that entry, clearing filters that would hide it.
  function openFromHash() {
    var id = decodeURIComponent(location.hash.slice(1));
    if (id.indexOf('dex-') !== 0) return;
    var el = document.getElementById(id);
    if (!el) return;
    if (el.hidden) {
      q.value = ''; act = 'all';
      actBtns.forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.act === 'all')); });
      kindBtns.forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
      apply();
    }
    el.open = true;
    el.scrollIntoView({ block: 'start' });
  }
  window.addEventListener('hashchange', openFromHash);
  // On load, run after the browser's own scroll restore so the entry wins.
  if (location.hash.indexOf('#dex-') === 0 && 'scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (document.readyState === 'complete') openFromHash();
  else window.addEventListener('load', openFromHash);
})();
