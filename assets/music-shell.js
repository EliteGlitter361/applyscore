/* NBS persistent Vue 3 audio host, v2.3. The host survives iframe navigations. */
(function () {
  'use strict';
  const Vue = window.Vue;
  if (!Vue?.createApp) return;
  // The index page lives inside an iframe; its fixed elements cannot cover the
  // persistent music host. Mirror only the announcement into the top document.
  const noticeLayer=document.createElement('section');
  noticeLayer.id='credit-host-announcement';
  noticeLayer.setAttribute('aria-label','系统公告');
  noticeLayer.hidden=true;
  const noticeTag=document.createElement('div');noticeTag.className='host-notice-tag';noticeTag.textContent='系统公告';
  const noticeTitle=document.createElement('h1');
  const noticeBody=document.createElement('p');noticeBody.className='host-notice-body';
  const noticeActions=document.createElement('div');noticeActions.className='host-notice-actions';
  const noticeConfirm=document.createElement('button');noticeConfirm.type='button';noticeConfirm.textContent='确定';
  const noticeLogin=document.createElement('a');noticeLogin.className='host-admin-login';noticeLogin.href='/login.html';noticeLogin.textContent='管理员登录';
  const noticeCard=document.createElement('div');noticeCard.className='host-notice-card';
  const noticeCardHeader=document.createElement('div');noticeCardHeader.className='host-notice-card-header';
  const noticeCardIcon=document.createElement('span');noticeCardIcon.className='host-notice-card-icon';noticeCardIcon.setAttribute('aria-hidden','true');noticeCardIcon.textContent='i';
  const noticeCardHeading=document.createElement('span');noticeCardHeading.className='host-notice-card-heading';noticeCardHeading.textContent='系统服务消息';
  noticeCardHeader.append(noticeCardIcon,noticeCardHeading);
  const noticeCardMain=document.createElement('div');noticeCardMain.className='host-notice-card-main';
  noticeActions.append(noticeLogin,noticeConfirm);noticeCardMain.append(noticeTag,noticeTitle,noticeBody);noticeCard.append(noticeCardHeader,noticeCardMain,noticeActions);noticeLayer.append(noticeCard);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>document.body.append(noticeLayer),{once:true});else document.body.append(noticeLayer);
  const showHostNotice=(data)=>{
    if(!data?.open){noticeLayer.hidden=true;document.documentElement.classList.remove('credit-notice-active');return;}
    noticeTitle.textContent=String(data.title||'系统公告');
    noticeBody.textContent=String(data.message||'');
    noticeConfirm.hidden=data.showConfirm===false;
    noticeLayer.hidden=false;
    document.documentElement.classList.add('credit-notice-active');
  };
  noticeConfirm.addEventListener('click',()=>{
    document.getElementById('credit-view-frame')?.contentWindow?.postMessage({type:'credit-fullscreen-announcement-close'},location.origin);
    showHostNotice({open:false});
  });
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==document.getElementById('credit-view-frame')?.contentWindow)return;
    if(event.data?.type==='credit-fullscreen-announcement')showHostNotice(event.data);
  });
  // Reset when a page change begins; new announcement pages can announce again.
  const resetHostNotice=()=>showHostNotice({open:false});
  window.addEventListener('credit-view-changing',resetHostNotice);
  const SETTINGS = 'credit:nbs:options:v2';
  const LIBRARY = 'credit:nbs:tracks:v3';
  const CACHE = 'credit-nbs-mp3-v3';
  const LIMIT = 512 * 1024 * 1024; // adaptive cap; never exceed available browser quota
  const MAX_TRACK_BYTES = 12 * 1024 * 1024;
  const mediaUrl = id => '/api/music/' + encodeURIComponent(id);
  const safeRead = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch (_) { return fallback; }
  };
  const saved = safeRead(SETTINGS, {});
  const validId = id => /^[0-9a-f-]{8,64}$/i.test(id || '');
  const idle = fn => (window.requestIdleCallback ? window.requestIdleCallback(fn, {timeout:2500}) : setTimeout(fn, 300));

  const app = Vue.createApp({
    data() {
      return {
        enabled: saved.enabled !== false,
        showIsland: saved.showIsland !== false,
        islandCollapsed: saved.islandCollapsed !== false,
        autoPlay: !!saved.autoPlay, themeMode:window.CreditTheme?.read() || "light", frameBusy:true,
        mode: ['sequence','shuffle','repeat-one'].includes(saved.mode) ? saved.mode : 'sequence',
        ballPosition: saved.ballPosition || (saved.islandCollapsed !== false ? saved.islandPosition : null) || null,
        windowPosition: saved.windowPosition || (saved.islandCollapsed === false ? saved.islandPosition : null) || null,
        drawer: false, listExpanded: false,
        tracks: safeRead(LIBRARY, []).filter(t => t && validId(t.id)),
        currentId: localStorage.getItem('credit:nbs:last-track') || '',
        playing: false, currentTime: 0, duration: 0, loading: false, connecting: false, error: '',
        waitingGesture: false, cacheCount: 0, caching: false
      };
    },
    computed: {
      currentTrack() { return this.tracks.find(t => t.id === this.currentId) || null; },
      islandStyle() {
        const position = this.islandCollapsed ? this.ballPosition : this.windowPosition;
        if (!position) return {};
        return {left: position.x + 'px', top: position.y + 'px', bottom: 'auto', transform: 'translateX(-50%)'};
      },
      percent() { return this.duration > 0 && Number.isFinite(this.duration) ? Math.min(100, Math.max(0, this.currentTime / this.duration * 100)) : 0; }
    },
    methods: {
      formatTime(n) { if (!Number.isFinite(n) || n < 0) return '0:00'; const s = Math.floor(n); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2,'0'); },
      saveSettings() {
        try { localStorage.setItem(SETTINGS, JSON.stringify({enabled:this.enabled,showIsland:this.showIsland,mode:this.mode,autoPlay:this.autoPlay,islandCollapsed:this.islandCollapsed,ballPosition:this.ballPosition,windowPosition:this.windowPosition})); } catch (_) {}
      },
      onEnabledChange() {
        this.saveSettings();
        if (!this.enabled) {this.audio.pause();this.playing=false;this.waitingGesture=false;}
        else {this.scheduleWarm();this.prepareAutoPlay();}
      },
      openSoftwareSettings(){
        this.drawer=false;
        let adminView=false;
        try{
          const url=new URL(this.frame.contentWindow.location.href);
          adminView=['/admin.html','/dashboard.html','/student.html','/music.html'].includes(url.pathname)||url.searchParams.get('view')==='admin';
        }catch(_){}
        this.changePage(adminView?'/settings.html?view=admin':'/settings.html');
      },
      toggleTheme(){this.themeMode=window.CreditTheme?.toggle() || 'light';},
      updateTheme(){this.themeMode=window.CreditTheme?.read() || 'light';},
      toggleIslandList() {
        this.listExpanded = !this.listExpanded;
        this.$nextTick(() => this.clampIsland());
      },
      collapseIsland() {
        // A window's clamped center must never overwrite the saved ball anchor.
        if (this.islandCollapsed) return;
        this.islandCollapsed = true;
        this.$nextTick(() => { this.clampIsland(); this.saveSettings(); });
      },
      expandIsland() {
        if (!this.islandCollapsed) return;
        if (!this.windowPosition && this.ballPosition) {
          this.windowPosition = {x:this.ballPosition.x, y:this.ballPosition.y - 122};
        }
        this.islandCollapsed = false;
        this.$nextTick(() => { this.clampIsland(); this.saveSettings(); });
      },
      clampIsland() {
        const key = this.islandCollapsed ? 'ballPosition' : 'windowPosition';
        const position = this[key];
        if (!position) return;
        const el = this.$refs.island;
        const width = el?.offsetWidth || (this.islandCollapsed ? 64 : Math.min(455,innerWidth-20));
        const height = el?.offsetHeight || (this.islandCollapsed ? 64 : 150);
        const half = width / 2;
        const minX = half + 8, maxX = Math.max(minX, innerWidth - half - 8);
        const minY = 8, maxY = Math.max(minY, innerHeight - height - 8);
        const x = Math.round(Math.min(Math.max(minX,position.x),maxX));
        const y = Math.round(Math.min(Math.max(minY,position.y),maxY));
        if (x !== position.x || y !== position.y) this[key] = {x,y};
      },
      startDrag(event) {
        if (event.button != null && event.button !== 0) return;
        const rect = this.$refs.island?.getBoundingClientRect(); if (!rect) return;
        if (!this.islandCollapsed && event.target?.closest?.('button,input')) return;
        this._drag={id:event.pointerId,startX:event.clientX,startY:event.clientY,
          x:rect.left+rect.width/2,y:rect.top,moved:false,ball:this.islandCollapsed};
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      },
      moveDrag(event) {
        const d=this._drag; if(!d || d.id!==event.pointerId) return;
        if(Math.hypot(event.clientX-d.startX,event.clientY-d.startY)>6) d.moved=true;
        if(!d.moved) return;
        const key=d.ball?'ballPosition':'windowPosition';
        this[key]={x:d.x+event.clientX-d.startX,y:d.y+event.clientY-d.startY};
        this.clampIsland();
      },
      endDrag(event) {
        const d=this._drag; if(!d || d.id!==event.pointerId) return;
        this._drag=null;
        try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch(_) {}
        if (d.ball && !d.moved) {this.expandIsland();return;}
        if (d.moved) {this.clampIsland();this.saveSettings();}
      },
      cancelDrag(){this._drag=null;},
      async refreshCacheCount() {
        try {
          if (!('caches' in window)) return;
          const cache = await caches.open(CACHE);
          const keys = await cache.keys();
          this._cachedIds = new Set(keys.map(req => req.url.split('/').pop()));
          this.cacheCount = this._cachedIds.size;
        } catch (_) { /* private mode: use streaming */ }
      },
      async clearCache() {
        this._warmGeneration++;
        this._cacheSaturated = false;
        try {
          await caches.delete(CACHE);
          this.cacheCount = 0;
          this._cachedIds.clear();
          this.error = '缓存已清理，当前播放不会中断';
        } catch (_) { this.error = '浏览器不支持清除缓存'; }
      },
      async cachedSource(id) {
        if (!validId(id) || !('caches' in window) || !this._cachedIds?.has(id)) return null;
        try {
          const cache = await caches.open(CACHE);
          const response = await cache.match(mediaUrl(id));
          if (!response || !response.ok) { this._cachedIds.delete(id); return null; }
          const blob = await response.blob();
          if (!blob.size) { this._cachedIds.delete(id); return null; }
          return URL.createObjectURL(blob);
        } catch (_) { return null; }
      },
      async cacheCapacity() {
        try {
          const estimate = await navigator.storage?.estimate?.();
          if (estimate?.quota) {
            // Use no more than 25% of total origin quota, and keep headroom for other data.
            return Math.max(0, Math.min(LIMIT, Math.floor(estimate.quota * .25),
              Math.floor(Math.max(0, estimate.quota - (estimate.usage || 0) - 8 * 1024 * 1024))));
          }
        } catch (_) {}
        return 128 * 1024 * 1024;
      },
      async warmTrack(id, generation = this._warmGeneration) {
        if (!this.enabled || !validId(id) || !('caches' in window) || navigator.connection?.saveData) return false;
        if (!this.tracks.some(t => t.id === id) || generation !== this._warmGeneration) return false;
        if (this._cachedIds.has(id)) return true;
        if (this._warming.has(id)) return false;
        this._warming.add(id); this.caching = true;
        try {
          const cache = await caches.open(CACHE);
          if (await cache.match(mediaUrl(id))) {
            this._cachedIds.add(id); this.cacheCount = this._cachedIds.size; return true;
          }
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 40000);
          try {
            const response = await fetch(mediaUrl(id), {signal: controller.signal, cache:'default'});
            const length = Number(response.headers.get('Content-Length')) || 0;
            if (!response.ok || response.status !== 200 || length > MAX_TRACK_BYTES) return false;
            const blob = await response.blob();
            if (!blob.size || blob.size > MAX_TRACK_BYTES || generation !== this._warmGeneration || !this.enabled) return false;
            const keys = await cache.keys();
            let total = 0;
            for (const key of keys) {
              const stored = await cache.match(key);
              total += Number(stored?.headers.get('Content-Length')) || 0;
            }
            const capacity = await this.cacheCapacity();
            if (blob.size + total > capacity) {
              this._cacheSaturated = true;
              this.error = '本机音乐缓存空间已满，已缓存的歌曲仍可正常播放';
              return false;
            }
            await cache.put(mediaUrl(id), new Response(blob, {status:200,
              headers:{'Content-Type':'audio/mpeg','Content-Length':String(blob.size)}}));
            this._cachedIds.add(id); this.cacheCount = this._cachedIds.size;
            return true;
          } finally { clearTimeout(timeout); }
        } catch (_) { return false; }
        finally { this._warming.delete(id); this.caching = this._warming.size > 0; }
      },
      cachePriorityIds() {
        if (!this.tracks.length) return [];
        const idx = Math.max(0, this.tracks.findIndex(t => t.id === this.currentId));
        // Ahead-of-playback order: next track first, then remaining playlist, current last.
        const ordered = [];
        for (let step = 1; step <= this.tracks.length; step++) {
          const track = this.tracks[(idx + step) % this.tracks.length];
          if (track) ordered.push(track.id);
        }
        return ordered;
      },
      scheduleWarm() {
        if (!this.enabled || !this.tracks.length || this._warmScheduled || this._cacheSaturated || navigator.connection?.saveData) return;
        this._warmScheduled = true;
        idle(async () => {
          this._warmScheduled = false;
          if (this._warmRunning) { this._warmAgain = true; return; }
          this._warmRunning = true;
          const generation = this._warmGeneration;
          try {
            // Downloads are strictly sequential: prefetching never creates a burst.
            for (const id of this.cachePriorityIds()) {
              if (generation !== this._warmGeneration || !this.enabled || this._cacheSaturated) break;
              if (!this._cachedIds.has(id)) await this.warmTrack(id, generation);
            }
          } finally {
            this._warmRunning = false;
            if (this._warmAgain) { this._warmAgain = false; this.scheduleWarm(); }
          }
        });
      },
      preferredNextIndex() {
        const len = this.tracks.length;
        if (!len) return -1;
        const old = this.tracks.findIndex(t => t.id === this.currentId);
        if (this.mode === 'shuffle' && len > 1) {
          const others = this.tracks.map((t,i)=>i).filter(i=>i!==old);
          const cached = others.filter(i=>this._cachedIds.has(this.tracks[i].id));
          const choices = cached.length ? cached : others;
          return choices[Math.floor(Math.random() * choices.length)];
        }
        // Respect sequence among cached songs: nearest following cached entry wins.
        if (len > 1) for (let distance=1; distance<len; distance++) {
          const i = (old + distance + len) % len;
          if (this._cachedIds.has(this.tracks[i].id)) return i;
        }
        return (old + 1 + len) % len;
      },
      async refreshTracks() {
        if (this.loading) return;
        this.loading=true; this.error='';
        try {
          const response=await fetch('/api/music',{cache:'no-store'});
          const data=await response.json();
          if (!response.ok || !Array.isArray(data.tracks)) throw Error(data.error || '音乐列表获取失败');
          this.tracks=data.tracks.filter(t=>t && validId(t.id));
          try {localStorage.setItem(LIBRARY,JSON.stringify(this.tracks));} catch (_) {}
          if (this.currentId && !this.tracks.some(t=>t.id===this.currentId)) {
            this.audio.pause();this.audio.removeAttribute('src');this.audio.load();
            this.currentId='';this.playing=false;
          }
          if (!this.currentId && this.tracks.length) this.currentId=this.tracks[0].id;
          this._cacheSaturated = false;
          this.scheduleWarm();
          this.prepareAutoPlay();
        } catch (e) {
          this.error='无法同步最新曲目列表，正在使用已缓存的列表';
          if (!this.currentId && this.tracks[0]) this.currentId=this.tracks[0].id;
        } finally {this.loading=false;}
      },
      async playIndex(index, auto=false) {
        if (!this.enabled || !this.tracks.length) return;
        const track = this.tracks[index]; if (!track) return;
        const generation = ++this._playGeneration;
        const changed = this.currentId !== track.id || !this.audio.getAttribute('src');
        this.currentId = track.id;
        try { localStorage.setItem('credit:nbs:last-track', track.id); } catch (_) {}
        if (changed) {
          // Resolve a complete local MP3 first. Never start a network request for a cached song.
          const expectedCached = this._cachedIds.has(track.id);
          this.connecting = !expectedCached;
          const cached = expectedCached ? await this.cachedSource(track.id) : null;
          if (generation !== this._playGeneration) { if(cached) URL.revokeObjectURL(cached); return; }
          if (this._blobUrl) { URL.revokeObjectURL(this._blobUrl); this._blobUrl = null; }
          this._blobUrl = cached;
          this.connecting = !cached;
          this.audio.src = cached || mediaUrl(track.id);
          this.audio.preload = 'auto'; this.audio.load();
          this.currentTime = 0; this.duration = 0;
        }
        try {
          await this.audio.play();
          if (generation !== this._playGeneration) return;
          this.playing = true; this.connecting = false; this.waitingGesture = false; this.error = '';
          this.scheduleWarm();
        } catch (_) {
          if (generation !== this._playGeneration) return;
          this.playing = false; this.connecting = false; this.waitingGesture = true;
          if (!auto) this.error = '浏览器暂时阻止播放，点击播放按钮即可继续';
        }
      },
      prepareAutoPlay() {
        if (!this.enabled || !this.autoPlay || !this.tracks.length || !this.audio?.paused || this._autoPending) return;
        // Browser policy decides whether audible autoplay is permitted.
        this._autoPending=true;this.playIndex(Math.max(0,this.tracks.findIndex(t=>t.id===this.currentId)),true).finally(()=>{this._autoPending=false;});
      },
      resumeOnGesture(event) {
        if (event?.target?.closest?.('.nbs-island, .music-drawer')) return;
        if (!this.enabled || (!this.waitingGesture && !this._autoPending) || !this.audio?.paused) return;
        this.waitingGesture=false;
        // Must run synchronously inside a trusted click/touch/keyboard handler.
        if (this.audio.getAttribute('src')) {
          this.audio.play().then(()=>{this.playing=true;this.error='';}).catch(()=>{this.waitingGesture=true;});
        } else {
          const i=Math.max(0,this.tracks.findIndex(t=>t.id===this.currentId));
          if (this.tracks[i]) {
            this.audio.src=mediaUrl(this.tracks[i].id);this.audio.load();
            this.audio.play().then(()=>{this.playing=true;this.error='';}).catch(()=>{this.waitingGesture=true;});
          }
        }
      },
      togglePlayback() {
        if (!this.enabled)return;
        if (this.audio.paused) this.playIndex(Math.max(0,this.tracks.findIndex(t=>t.id===this.currentId)));
        else {this.audio.pause();this.waitingGesture=false;this.playing=false;}
      },
      next() {
        if (!this.enabled || !this.tracks.length) return;
        const i = this.preferredNextIndex();
        if (i >= 0) this.playIndex(i);
      },
      previous() {
        if (!this.enabled || !this.tracks.length)return;
        if(this.currentTime>3){this.audio.currentTime=0;return;}
        const old=this.tracks.findIndex(t=>t.id===this.currentId);
        this.playIndex((old-1+this.tracks.length)%this.tracks.length);
      },
      seek(e) {
        const v=Number(e.target.value);
        if (this.enabled && Number.isFinite(this.audio.duration) && this.audio.duration>0 && Number.isFinite(v)) {
          this.audio.currentTime=Math.max(0,Math.min(v,this.audio.duration));
          this.currentTime=this.audio.currentTime;
        }
      },
      onEnded() { if(this.mode==='repeat-one'){this.audio.currentTime=0;this.audio.play().catch(()=>{this.waitingGesture=true;});}else this.next(); },
      onMessage(event) {
        if(event.origin!==location.origin||event.source!==this.frame.contentWindow)return;
        const message=event.data||{};
        if(message.type==='credit-music:open'){this.drawer=true;if(!this.tracks.length)this.refreshTracks();}
        if(message.type==='credit-music:refresh'){this.refreshTracks();}
        if(message.type==='credit-music:play'&&typeof message.id==='string'){
          const i=this.tracks.findIndex(t=>t.id===message.id);
          if (i>=0) {this.enabled=true;this.saveSettings();this.playIndex(i);}
        }
        if(message.type==='credit-music:route')this.syncFrameURL();
        if(message.type==='credit-theme:changed')this.themeMode=window.CreditTheme?.set(message.mode) || 'light';
      },
      syncFrameURL() {
        try {
          if(!/^\/[a-z0-9-]+\.html$/i.test(this.frame.contentWindow.location.pathname))return;
          const url=new URL(this.frame.contentWindow.location.href);url.searchParams.delete('__music_embed');
          const path=url.pathname+url.search+url.hash;
          if(path==='/music-shell.html')return;
          const next='/music-shell.html?view='+encodeURIComponent(path);
          if(location.pathname+location.search!==next) history.replaceState({musicView:path},'',next);
          document.title=(this.frame.contentDocument.title||'学分服务中心')+' · NBS';
        }catch(_){}
      },
      frameLoaded() {
        this.frameBusy=false;
        this.syncFrameURL();
        try {
          // Same-origin frame: treat the next genuine user interaction as an autoplay gesture.
          // This is not a browser-policy bypass and requires the user's physical interaction.
          const doc=this.frame.contentDocument;
          if(doc){doc.addEventListener('pointerdown',()=>this.resumeOnGesture(),{capture:true});doc.addEventListener('keydown',()=>this.resumeOnGesture(),{capture:true});
            doc.defaultView?.addEventListener('beforeunload',()=>{this.frameBusy=true;},{once:true});}
        } catch (_) {}
      },
      changePage(path) {
        const url=new URL(path,location.origin);if(url.origin!==location.origin)return;
        const view=url.pathname+url.search+url.hash;
        this.frameBusy=true;
        this.frame.src=view+(url.search?'&':'?')+'__music_embed=1';
        history.pushState({musicView:view},'', '/music-shell.html?view='+encodeURIComponent(view));
      },
      onPopState() {
        const view=new URLSearchParams(location.search).get('view');
        if(view && view.startsWith('/')&&!view.startsWith('//')){this.frameBusy=true;this.frame.src=view+(view.includes('?')?'&':'?')+'__music_embed=1';}
      },
      onStorage(e) {
        if(e.key!==SETTINGS)return;
        const opt=safeRead(SETTINGS,{});
        this.enabled=!!opt.enabled;this.showIsland=opt.showIsland!==false;
        this.islandCollapsed=!!opt.islandCollapsed;this.mode=opt.mode||'sequence';this.autoPlay=!!opt.autoPlay;
        this.ballPosition=opt.ballPosition || (opt.islandCollapsed ? opt.islandPosition : null) || null;
        this.windowPosition=opt.windowPosition || (!opt.islandCollapsed ? opt.islandPosition : null) || null;
        if(!this.enabled)this.audio.pause(); else if(this.autoPlay)this.prepareAutoPlay();
      }
    },
    mounted() {
      this.audio=document.getElementById('nbs-audio');this.frame=document.getElementById('credit-view-frame');
      document.addEventListener('credit-theme-changed',this.updateTheme);
      if (!this.ballPosition) this.ballPosition={x:Math.max(40,innerWidth-44),y:Math.max(12,innerHeight-125)};
      this._playGeneration=0;this._cachedIds=new Set();this._blobUrl=null;this._warming=new Set();this._drag=null;this._warmScheduled=false;
      this._warmRunning=false;this._warmAgain=false;this._warmGeneration=0;this._cacheSaturated=false;
      const view=new URLSearchParams(location.search).get('view')||'/index.html';
      if(view.startsWith('/')&&!view.startsWith('//'))this.frame.src=view+(view.includes('?')?'&':'?')+'__music_embed=1';
      this.frame.addEventListener('load',this.frameLoaded);
      this.frame.addEventListener('load',()=>{
        resetHostNotice();
        try{
          const url=new URL(this.frame.contentWindow.location.href);
          if(url.pathname==='/index.html')this.frame.contentWindow.postMessage({type:'credit-fullscreen-announcement-sync'},location.origin);
        }catch(_){}
      });
      this.audio.addEventListener('timeupdate',()=>{this.currentTime=this.audio.currentTime;});
      this.audio.addEventListener('loadedmetadata',()=>{this.duration=Number.isFinite(this.audio.duration)?this.audio.duration:0;});
      this.audio.addEventListener('durationchange',()=>{this.duration=Number.isFinite(this.audio.duration)?this.audio.duration:0;});
      this.audio.addEventListener('ended',this.onEnded);
      this.audio.addEventListener('pause',()=>{this.playing=false;});
      this.audio.addEventListener('playing',()=>{this.playing=true;this.connecting=false;this.waitingGesture=false;this.scheduleWarm();});
      this.audio.addEventListener('play',()=>{this.playing=true;this.waitingGesture=false;});
      this.audio.addEventListener('error',()=>{if(this.audio.src)this.error='当前音频加载失败，请检查网络';this.playing=false;this.connecting=false;});
      window.addEventListener('message',this.onMessage);
      window.addEventListener('popstate',this.onPopState);
      window.addEventListener('storage',this.onStorage);
      window.addEventListener('resize',this.clampIsland,{passive:true});
      window.addEventListener('pointerdown',this.resumeOnGesture,{capture:true});
      window.addEventListener('keydown',this.resumeOnGesture,{capture:true});
      window.CreditMusicHost={
        getSettings:()=>({enabled:this.enabled,showIsland:this.showIsland,autoPlay:this.autoPlay,mode:this.mode,cacheCount:this.cacheCount}),
        updateSettings:partial=>{
          if(!partial || typeof partial!=='object')return;
          if(typeof partial.enabled==='boolean' && partial.enabled!==this.enabled){this.enabled=partial.enabled;this.onEnabledChange();}
          if(typeof partial.showIsland==='boolean')this.showIsland=partial.showIsland;
          if(typeof partial.autoPlay==='boolean'){this.autoPlay=partial.autoPlay;if(this.autoPlay&&this.enabled)this.prepareAutoPlay();}
          if(['sequence','shuffle','repeat-one'].includes(partial.mode))this.mode=partial.mode;
          this.saveSettings();
        },
        clearCache:()=>this.clearCache(),
        open:()=>{this.drawer=true;this.refreshTracks();},refresh:()=>this.refreshTracks(),play:id=>{const i=this.tracks.findIndex(t=>t.id===id);if(i>=0){this.enabled=true;this.saveSettings();this.playIndex(i);}},navigate:path=>this.changePage(path)};
      this.refreshCacheCount();
      if(!this.currentId && this.tracks[0])this.currentId=this.tracks[0].id;
      if(this.tracks.length)this.prepareAutoPlay();
      this.refreshTracks();
    },
    beforeUnmount() {
      document.removeEventListener('credit-theme-changed',this.updateTheme);
      window.removeEventListener('message',this.onMessage);
      window.removeEventListener('popstate',this.onPopState);
      window.removeEventListener('storage',this.onStorage);
      window.removeEventListener('resize',this.clampIsland);
      window.removeEventListener('pointerdown',this.resumeOnGesture,true);
      window.removeEventListener('keydown',this.resumeOnGesture,true);
      this._warmGeneration++;
      if(this._blobUrl)URL.revokeObjectURL(this._blobUrl);
    }
  });
  app.mount('#music-root');
})();
