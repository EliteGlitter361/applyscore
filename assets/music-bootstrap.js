/* Redirect legacy multi-page entry points to a persistent Vue audio host.
 * The host keeps one <audio> alive while its iframe navigates across pages. */
(function(){
  if(window.self!==window.top)return;
  if(new URLSearchParams(location.search).has('__music_embed'))return;
  const route=(location.pathname==='/'?'/index.html':location.pathname)+location.search+location.hash;
  if(location.pathname!=='/' && !/^\/[a-z0-9-]+\.html$/i.test(location.pathname))return;
  window.__musicEntering=true;
  location.replace('/music-shell.html?view='+encodeURIComponent(route));
})();
