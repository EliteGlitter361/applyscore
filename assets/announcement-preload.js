(() => {
  const themes = new Set(['meteors', 'ocean', 'bamboo', 'grassland', 'ink-landscape']);
  const warmed = new Map();
  const readyImages = new Map();

  window.CreditGetAnnouncementImage = theme => readyImages.get(theme);
  window.CreditPreloadAnnouncementTheme = theme => {
    if (!themes.has(theme)) return Promise.resolve('none');
    if (warmed.has(theme)) return warmed.get(theme);
    const image = new Image();
    image.alt = '';
    image.className = 'host-notice-art';
    image.setAttribute('aria-hidden', 'true');
    const ready = new Promise(resolve => {
      let settled = false;
      const timeout = setTimeout(() => finish(false), 1800);
      function finish(loaded) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        image.onload = image.onerror = null;
        if (loaded) readyImages.set(theme, image);
        resolve(loaded ? theme : 'none');
      }
      image.onload = async () => {
        try {
          if (image.decode) await image.decode();
          finish(true);
        } catch (_) { finish(false); }
      };
      image.onerror = () => finish(false);
    });
    warmed.set(theme, ready);
    image.src = '/assets/announcement-themes/' + theme + (theme === 'ink-landscape' ? '.png' : '.svg');
    return ready;
  };
  window.__creditInitialSettings?.then(settings => {
    window.CreditPreloadAnnouncementTheme(settings?.announcementTheme);
  }).catch(() => {});
})();
