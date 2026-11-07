/* v2.7 – shared Vue-reactive theme preference; early paint before Vue bootstraps. */
(function () {
  'use strict';
  const KEY = 'credit:ui-theme:v1';
  const allowed = mode => mode === 'dark' ? 'dark' : 'light';
  const read = () => { try { return allowed(localStorage.getItem(KEY)); } catch (_) { return 'light'; } };
  let reactiveMode = null;
  function paint(mode) {
    const value = allowed(mode);
    document.documentElement.dataset.theme = value;
    document.documentElement.style.colorScheme = value;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = value === 'dark' ? '#101927' : '#f4f7fc';
    if (reactiveMode) reactiveMode.value = value;
    document.dispatchEvent(new CustomEvent('credit-theme-changed', { detail: { mode: value } }));
    return value;
  }
  function set(mode, broadcast=true) {
    const value = paint(mode);
    try { localStorage.setItem(KEY, value); } catch (_) {}
    if (broadcast) {
      try { if (parent !== window) parent.postMessage({ type:'credit-theme:changed', mode:value }, location.origin); } catch (_) {}
    }
    return value;
  }
  const state = () => {
    if (!reactiveMode && window.Vue?.ref) reactiveMode = window.Vue.ref(read());
    return reactiveMode;
  };
  window.CreditTheme = {read, apply:paint, set, toggle:() => set(read() === 'dark' ? 'light' : 'dark'), useTheme:state};
  paint(read());
  // The theme-color meta tag is parsed after this synchronous head script.
  document.addEventListener('DOMContentLoaded', () => paint(read()), { once: true });
  window.addEventListener('storage', e => { if (e.key === KEY) paint(read()); });
  window.addEventListener('pageshow', () => paint(read()));
})();
