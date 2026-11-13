// Images page behaviour: toolbar filter, expandable repository rows,
// expand-all, and copy digest with a PatternFly tooltip. No network access.
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var status = $('[data-status]');
  // PatternFly component rules set display, which beats the hidden attribute: set both.
  function show(el, on) { if (!el) return; el.hidden = !on; el.style.display = on ? '' : 'none'; }
  function announce(msg) { if (status) { status.textContent = ''; setTimeout(function () { status.textContent = msg; }, 50); } }

  var tip = document.createElement('div');
  tip.className = 'pf-v6-c-tooltip pf-m-top';
  tip.setAttribute('role', 'tooltip');
  tip.style.position = 'absolute';
  tip.style.zIndex = 'var(--pf-t--global--z-index--2xl)';
  tip.innerHTML = '<div class="pf-v6-c-tooltip__arrow"></div><div class="pf-v6-c-tooltip__content"></div>';
  show(tip, false);
  document.body.appendChild(tip);
  function showTip(el, text) {
    tip.lastChild.textContent = text;
    show(tip, true);
    var r = el.getBoundingClientRect();
    tip.style.left = Math.max(4, r.left + window.scrollX + r.width / 2 - tip.offsetWidth / 2) + 'px';
    tip.style.top = (r.top + window.scrollY - tip.offsetHeight - 8) + 'px';
  }
  function hideTip() { show(tip, false); }
  $$('[data-tip]').forEach(function (el) {
    var on = function () { showTip(el, el.dataset.tip); };
    el.addEventListener('mouseenter', on);
    el.addEventListener('focus', on);
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('blur', hideTip);
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') hideTip(); });
  document.addEventListener('scroll', hideTip, true);

  // The async Clipboard API needs a secure context; a plain-HTTP registry falls back to execCommand.
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }
  $$('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      copyText(btn.dataset.copy).then(function () {
        showTip(btn, 'Copied');
        announce('Digest copied');
      }, function () {
        showTip(btn, 'Copy failed');
        announce('Copy failed');
      });
    });
  });

  function setExpanded(g, on) {
    var btn = $('[data-toggle]', g);
    g.classList.toggle('pf-m-expanded', on);
    g.rows[0].classList.toggle('pf-m-expanded', on);
    g.rows[1].classList.toggle('pf-m-expanded', on);
    btn.classList.toggle('pf-m-expanded', on);
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function syncToggleAll() {
    var all = $('[data-toggle-all]');
    if (!all) return;
    var groups = $$('[data-group]').filter(function (g) { return !g.hidden; });
    var on = groups.length > 0 && groups.every(function (g) { return g.classList.contains('pf-m-expanded'); });
    all.classList.toggle('pf-m-expanded', on);
    all.setAttribute('aria-expanded', on ? 'true' : 'false');
    all.setAttribute('aria-label', on ? 'Collapse all repositories' : 'Expand all repositories');
  }
  $$('[data-group]').forEach(function (g) {
    $('[data-toggle]', g).addEventListener('click', function () {
      setExpanded(g, !g.classList.contains('pf-m-expanded'));
      syncToggleAll();
    });
  });
  var all = $('[data-toggle-all]');
  if (all) all.addEventListener('click', function () {
    var on = all.getAttribute('aria-expanded') !== 'true';
    $$('[data-group]').forEach(function (g) { if (!g.hidden) setExpanded(g, on); });
    syncToggleAll();
  });

  // A filter matches a repository name or a repository:tag reference and opens
  // every repository with a match; clearing it closes them all.
  var input = $('[data-filter]');
  if (!input) return;
  var utils = $('[data-utilities]');
  var noResults = $('[data-no-results]');
  function matches(el, q) { return el.dataset.search.toLowerCase().indexOf(q) !== -1; }
  function applyFilter() {
    var q = input.value.trim().toLowerCase();
    var count = 0;
    $$('[data-group]').forEach(function (g) {
      var repoHit = !q || matches(g, q);
      var n = 0;
      $$('.pf-v6-c-table__expandable-row tbody tr', g).forEach(function (tr) {
        var ok = repoHit || matches(tr, q);
        show(tr, ok);
        if (ok) n++;
      });
      show(g, n > 0);
      setExpanded(g, !!q && n > 0);
      count += n;
    });
    syncToggleAll();
    show(noResults, count === 0);
    show(utils, !!q);
    var noun = count === 1 ? 'image' : 'images';
    $('[data-count]').textContent = count;
    $('[data-count-sr]').textContent = count + ' matching ' + noun;
    if (q) announce(count + ' matching ' + noun);
  }
  show(utils, false);
  show(noResults, false);
  input.addEventListener('input', applyFilter);
  $$('[data-clear]').forEach(function (b) {
    b.addEventListener('click', function () { input.value = ''; applyFilter(); input.focus(); });
  });
})();
