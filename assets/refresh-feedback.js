/** Promise-aware progress animation shared by ALL visible refresh controls. */
(function (window) {
  'use strict';
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function run(button, task) {
    if (!button || button.dataset.refreshing === 'true') return;
    const originalDisabled = button.disabled;
    button.dataset.refreshing = 'true';
    button.classList.remove('refresh-complete', 'refresh-failed');
    button.classList.add('is-refreshing');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const start = Date.now();
    try {
      await Promise.resolve().then(task);
      await pause(Math.max(0, 350 - (Date.now() - start)));
      button.classList.remove('is-refreshing');
      button.classList.add('refresh-complete');
      await pause(480);
    } catch (err) {
      button.classList.remove('is-refreshing');
      button.classList.add('refresh-failed');
      if (window.flashError) window.flashError(err && err.message || '刷新失败，请重试');
      else console.error('[refresh]', err);
      await pause(600);
    } finally {
      button.classList.remove('is-refreshing', 'refresh-complete', 'refresh-failed');
      button.disabled = originalDisabled;
      button.removeAttribute('aria-busy');
      delete button.dataset.refreshing;
    }
  }
  window.CreditRefresh = { run };
})(window);
