// Follow the OS colour scheme with PatternFly's dark theme class. Loaded
// synchronously in <head> so the first paint is already in the right theme.
(function () {
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function apply() { document.documentElement.classList.toggle('pf-v6-theme-dark', mq.matches); }
  apply();
  mq.addEventListener('change', apply);
})();
