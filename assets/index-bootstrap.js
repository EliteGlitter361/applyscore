/** Start independent list reads before the Vue controller mounts. */
(function(global){
  if(global.__routeRedirecting||global.__musicEntering||!global.apiCache)return;
  for(const url of ['/api/apps','/api/requests?scope=published']){
    global.apiCache.get(url,{ttl:5000}).catch(()=>{});
  }
})(window);
