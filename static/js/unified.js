(function() {
  "use strict";
  const state = {
    user: window.INIT?.user || null,
    tracks: [],
    albums: window.INIT?.albums || [],
    currentTrack: null,
    currentIndex: -1,
    isPlaying: false,
    isLyricsOpen: false,
    isShuffleOn: false,
    volume: parseFloat(localStorage.getItem("swag_volume") || "1"),
    lyricsData: [],
    shuffledIndices: [],
    lists: {
      main: (window.INIT?.tracks || []).slice(),
      my: [],
      album: (window.INIT?.albumTracks || []).slice()
    }
  };
  state.tracks = state.lists.main;
  const playerStateStore = window.SwagPlayerState;
  const $ = (id) => document.getElementById(id);
  const audio = $("audio");
  const miniPlayer = $("mini-player");
  const fullPlayer = $("full-player");
  const progressInput = $("progress");
  const volumeSlider = $("volume-slider");
  const miniVolSlider = $("mini-vol-slider");
  document.addEventListener("DOMContentLoaded", init);
  const lucideSafe = {
    createIcons() {
      try {
        if (typeof window.lucide !== "undefined" && window.lucide && typeof window.lucide.createIcons === "function") {
          window.lucide.createIcons();
        }
      } catch (e) {
      }
    }
  };
  const HAS_LUCIDE = () => typeof window.lucide !== "undefined";
  const LUCIDE_TO_ION = {
    "play": "play",
    "pause": "pause",
    "skip-back": "play-skip-back",
    "skip-forward": "play-skip-forward",
    "volume-2": "volume-medium-outline",
    "volume-1": "volume-low-outline",
    "volume-x": "volume-mute-outline",
    "heart": "heart",
    "x": "close",
    "chevron-down": "chevron-down"
  };
  function setIcon(el, name) {
    if (!el) return;
    if (HAS_LUCIDE() || el.tagName.toLowerCase() === "i") {
      el.setAttribute("data-lucide", name);
    } else {
      el.setAttribute("name", LUCIDE_TO_ION[name] || name);
    }
  }
  function iconHtml(name, klass) {
    if (HAS_LUCIDE()) {
      return `<i data-lucide="${name}" class="${klass || ""}"></i>`;
    }
    return `<ion-icon name="${LUCIDE_TO_ION[name] || name}"></ion-icon>`;
  }
  const gsapSafe = typeof window.gsap !== "undefined" && window.gsap ? window.gsap : { to: () => {
  }, set: () => {
  }, from: () => {
  } };
  function init() {
    lucideSafe.createIcons();
    initTelegram();
    initAudio();
    initMediaSession();
    initUI();
    loadContent();
    handleSharedContent();
    restoreVolume();
    restorePlaybackState();
    applyAdminVisibility();
    maybeAutoAuth();
    maybeReturnAfterAuth();
    initSeamlessNav();
  }
  function initTelegram() {
    if (window.tg) {
      window.tg.ready();
      window.tg.expand();
      try {
        window.tg.setHeaderColor("#000000");
        window.tg.setBackgroundColor("#000000");
      } catch (e) {
      }
    }
  }
  function initAudio() {
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audio.removeAttribute("crossorigin");
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onMetadataLoaded);
    audio.addEventListener("ended", () => nextTrack());
    audio.addEventListener("error", onAudioError);
    audio.addEventListener("play", () => {
      updatePlayState(true);
      updateMediaSessionPlaybackState("playing");
      persistPlaybackState(true);
    });
    audio.addEventListener("pause", () => {
      updatePlayState(false);
      updateMediaSessionPlaybackState("paused");
      persistPlaybackState(true);
    });
    progressInput.addEventListener("input", (e) => {
      const pct = e.target.value;
      if (audio.duration) audio.currentTime = pct / 100 * audio.duration;
      updateProgressBar(pct);
      persistPlaybackState();
    });
    if (volumeSlider) {
      volumeSlider.addEventListener("input", (e) => setVolume(parseFloat(e.target.value)));
    }
    if (miniVolSlider) {
      miniVolSlider.addEventListener("input", (e) => setVolume(parseFloat(e.target.value)));
    }
  }
  function initUI() {
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("pagehide", () => persistPlaybackState(true));
    window.addEventListener("beforeunload", () => persistPlaybackState(true));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        persistPlaybackState(true);
      }
    });
    document.addEventListener("click", (e) => {
      const popup = $("mini-vol-popup");
      const btn = $("mini-vol-btn");
      if (popup && !popup.contains(e.target) && !btn.contains(e.target)) {
        popup.classList.remove("visible");
      }
    });
    let lastWidth = window.innerWidth;
    window.addEventListener("resize", () => {
      const isLandscape = window.innerHeight < 500 && window.innerWidth > window.innerHeight;
      const widthChanged = Math.abs(window.innerWidth - lastWidth) > 100;
      lastWidth = window.innerWidth;
      if ((isLandscape || widthChanged) && state.isLyricsOpen) {
        closeLyrics();
      }
    });
    window.addEventListener("orientationchange", () => {
      setTimeout(() => {
        if (state.isLyricsOpen) {
          closeLyrics();
        }
      }, 100);
    });
  }
  function restoreVolume() {
    audio.volume = state.volume;
    if (volumeSlider) volumeSlider.value = state.volume;
    if (miniVolSlider) miniVolSlider.value = state.volume;
    updateVolumeIcon();
  }
  function buildMediaArtwork(src) {
    if (!src) return Promise.resolve([]);
    let abs;
    try {
      abs = new URL(src, window.location.origin).href;
    } catch (_) {
      abs = src;
    }
    const lower = abs.toLowerCase();
    let mime = "image/jpeg";
    if (lower.endsWith(".png")) mime = "image/png";
    else if (lower.endsWith(".webp")) mime = "image/webp";
    else if (lower.endsWith(".gif")) mime = "image/gif";
    else if (lower.endsWith(".svg")) mime = "image/svg+xml";
    return Promise.resolve([
      { src: abs, sizes: "96x96", type: mime },
      { src: abs, sizes: "192x192", type: mime },
      { src: abs, sizes: "256x256", type: mime },
      { src: abs, sizes: "384x384", type: mime },
      { src: abs, sizes: "512x512", type: mime }
    ]);
  }
  function initMediaSession() {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler("play", () => togglePlay());
      navigator.mediaSession.setActionHandler("pause", () => togglePlay());
      navigator.mediaSession.setActionHandler("previoustrack", () => prevTrack());
      navigator.mediaSession.setActionHandler("nexttrack", () => nextTrack());
      navigator.mediaSession.setActionHandler("seekto", (e) => {
        if (e.fastSeek && typeof audio.fastSeek === "function") {
          audio.fastSeek(e.seekTime);
          return;
        }
        audio.currentTime = e.seekTime;
      });
    } catch (e) {
    }
  }
  let _mediaSessionToken = 0;
  async function updateMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const token = ++_mediaSessionToken;
    const t = state.currentTrack;
    if (!t) {
      try {
        navigator.mediaSession.metadata = null;
      } catch (e) {
      }
      return;
    }
    const coverSrc = t.cover_url ? `${window.location.origin}${t.cover_url}` : `${window.location.origin}/static/img/icon-512.png`;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title || "\u0411\u0435\u0437 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F",
        artist: t.artist || "\u0411\u0435\u0437 \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044F",
        album: "SwagPlayer",
        artwork: [{ src: coverSrc, sizes: "512x512", type: "image/jpeg" }]
      });
    } catch (e) {
    }
    const artwork = await buildMediaArtwork(coverSrc);
    if (token !== _mediaSessionToken) return;
    if (state.currentTrack !== t) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title || "\u0411\u0435\u0437 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F",
        artist: t.artist || "\u0411\u0435\u0437 \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044F",
        album: "SwagPlayer",
        artwork
      });
    } catch (e) {
    }
  }
  function updateMediaSessionPlaybackState(s) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = s;
    } catch (e) {
    }
  }
  function updateMediaSessionPosition() {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!audio.duration || !isFinite(audio.duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.max(0, Math.min(audio.currentTime || 0, audio.duration))
      });
    } catch (e) {
    }
  }
  function applyAdminVisibility() {
    const isAdmin = !!(state.user && state.user.is_admin);
    document.body.classList.toggle("no-admin", !isAdmin);
    const myTab = document.querySelector('.tab[data-tab="my"]');
    if (myTab) myTab.style.display = isAdmin ? "" : "none";
  }
  function initSeamlessNav() {
    if (window.isTelegram) return;
    if (document.body.getAttribute("data-page") === "app") return;
    document.addEventListener("click", onLinkClick, { capture: true });
    window.addEventListener("popstate", onPopState);
  }
  const SEAMLESS_SELECTOR = 'a[href]:not([target="_blank"]):not([download]):not([data-no-nav])';
  function onLinkClick(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const a = e.target.closest(SEAMLESS_SELECTOR);
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;
    let url;
    try {
      url = new URL(href, window.location.href);
    } catch (_) {
      return;
    }
    if (url.origin !== window.location.origin) return;
    if (url.pathname.startsWith("/app") || url.pathname.startsWith("/admin")) return;
    if (url.pathname.startsWith("/auth/")) return;
    e.preventDefault();
    navigateTo(
      url.pathname + url.search,
      
      true
    );
  }
  function onPopState() {
    navigateTo(
      window.location.pathname + window.location.search,
      
      false
    );
  }
  let _navAbort = null;
  async function navigateTo(path, push) {
    if (_navAbort) {
      try {
        _navAbort.abort();
      } catch (_) {
      }
    }
    _navAbort = new AbortController();
    let html;
    try {
      const res = await fetch(path, {
        headers: { "X-Requested-With": "fetch", "Accept": "text/html" },
        credentials: "same-origin",
        signal: _navAbort.signal
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      html = await res.text();
    } catch (e) {
      if (e.name === "AbortError") return;
      window.location.assign(path);
      return;
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    const newApp = doc.querySelector("#app");
    const newScripts = doc.querySelector("script:not([src])");
    if (!newApp) {
      window.location.assign(path);
      return;
    }
    const newTitle = doc.querySelector("title")?.textContent || document.title;
    const apply = () => {
      const curApp = document.getElementById("app");
      if (curApp && newApp) {
        curApp.replaceWith(newApp);
      }
      ["album-view"].forEach((id) => {
        const cur = document.getElementById(id);
        const next = doc.getElementById(id);
        if (cur && !next) cur.remove();
        else if (cur && next) cur.replaceWith(next.cloneNode(true));
        else if (!cur && next) document.body.appendChild(next.cloneNode(true));
      });
      document.title = newTitle;
      const newBodyClass = doc.body.className || "";
      document.body.className = newBodyClass;
      const initRaw = newScripts?.textContent || "";
      const initMatch = initRaw.match(/window\.INIT\s*=\s*(\{[\s\S]*?\});/);
      if (initMatch) {
        try {
          const initObj = new Function("return " + initMatch[1])();
          window.INIT = initObj || window.INIT;
        } catch (_) {
        }
      }
      try {
        state.lists.main = (window.INIT?.tracks || []).slice();
        state.albums = window.INIT?.albums || [];
        state.user = window.INIT?.user || state.user;
        if (typeof loadContent === "function") loadContent();
        if (window.INIT?.sharedTrack || window.INIT?.sharedAlbum) {
          handleSharedContent();
        } else {
          document.body.classList.remove("shared-mode", "album-mode");
        }
        applyAdminVisibility();
      } catch (e) {
        console.warn("rehydrate failed:", e);
      }
      if (push) history.pushState({}, "", path);
      window.scrollTo(0, 0);
      try {
        lucideSafe.createIcons();
      } catch (_) {
      }
    };
    if (document.startViewTransition) {
      document.startViewTransition(apply);
    } else {
      apply();
    }
  }
  const RETURN_KEY = "swag_auth_next";
  function rememberReturnUrl() {
    const next = window.location.pathname + window.location.search;
    try {
      localStorage.setItem(RETURN_KEY, next);
    } catch (e) {
    }
    try {
      sessionStorage.setItem(RETURN_KEY, next);
    } catch (e) {
    }
  }
  function maybeReturnAfterAuth() {
    if (!state.user) return;
    let next = null;
    try {
      next = sessionStorage.getItem(RETURN_KEY) || localStorage.getItem(RETURN_KEY);
    } catch (e) {
    }
    if (!next) return;
    try {
      sessionStorage.removeItem(RETURN_KEY);
    } catch (e) {
    }
    try {
      localStorage.removeItem(RETURN_KEY);
    } catch (e) {
    }
    if (!next.startsWith("/") || next.startsWith("//")) return;
    const here = window.location.pathname + window.location.search;
    if (next === here) return;
    window.location.replace(next);
  }
  async function maybeAutoAuth() {
    if (document.body.getAttribute("data-page") === "app") return;
    if (state.user) return;
    const tg = window.Telegram?.WebApp || window.tg;
    if (!tg) {
      return;
    }
    let initData = (tg.initData || "").trim();
    if (!initData) {
      try {
        tg.ready && tg.ready();
      } catch (_) {
      }
      try {
        tg.expand && tg.expand();
      } catch (_) {
      }
      await new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          const d = (window.Telegram?.WebApp?.initData || "").trim();
          if (d) {
            initData = d;
            return resolve();
          }
          if (Date.now() - start > 2e3) return resolve();
          setTimeout(tick, 80);
        };
        try {
          tg.onEvent && tg.onEvent("ready", () => {
            initData = (tg.initData || "").trim();
            resolve();
          });
        } catch (_) {
        }
        tick();
      });
    }
    if (!initData) {
      return;
    }
    try {
      const res = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ initData })
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.success && data.user) {
        state.user = data.user;
        updateUserUI();
        applyAdminVisibility();
      } else {
        console.warn("[swag] auto-auth rejected:", data && data.error);
      }
    } catch (e) {
      console.warn("[swag] auto-auth network fail:", e);
    }
  }
  function handleSharedContent() {
    const init2 = window.INIT;
    if (init2.sharedTrack) {
      document.body.classList.add("shared-mode");
      state.lists.album = [init2.sharedTrack];
      state.tracks = state.lists.album;
      playTrack(0, state.tracks);
      expandPlayer();
    } else if (init2.sharedAlbum && init2.albumTracks?.length) {
      document.body.classList.add("album-mode");
      state.lists.album = init2.albumTracks.slice();
      state.tracks = state.lists.album;
    }
    if (init2.q) {
      $("search-input").value = init2.q;
      $("search-bar").style.display = "block";
    }
  }
  function isTrackPlayable(track) {
    return !!(track && (track.audio_url || track.filename) && track.audio_available !== false);
  }
  function trackAudioUrl(track) {
    if (track && track.audio_url) return track.audio_url;
    if (track && track.filename) return `/uploads/${encodeURIComponent(track.filename).replace(/%2F/g, "/")}`;
    return "";
  }
  function trackCoverUrl(track, fallback = "/static/img/default-cover.svg") {
    return track && track.cover_url ? track.cover_url : fallback;
  }
  let _audioErrorRetried = false;
  async function onAudioError() {
    const t = state.currentTrack;
    if (!t || !t.id || _audioErrorRetried) return;
    _audioErrorRetried = true;
    try {
      const res = await fetch(`/api/tracks?id=${t.id}&_t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const arr = await res.json();
      const fresh = Array.isArray(arr) ? arr.find((x) => x.id === t.id) : null;
      if (!fresh || !fresh.audio_url) return;
      const idx = state.tracks.findIndex((x) => x.id === t.id);
      if (idx >= 0) state.tracks[idx] = { ...state.tracks[idx], ...fresh };
      state.currentTrack = { ...t, ...fresh };
      const pos = audio.currentTime || 0;
      audio.src = fresh.audio_url;
      audio.load();
      if (pos > 0) {
        audio.addEventListener("loadedmetadata", function back() {
          audio.removeEventListener("loadedmetadata", back);
          try { audio.currentTime = pos; } catch (_) {}
        }, { once: true });
      }
      if (state.isPlaying) {
        audio.play().catch(() => {});
      }
    } catch (_) {
    } finally {
      setTimeout(() => { _audioErrorRetried = false; }, 2000);
    }
  }
  function persistPlaybackState(immediate = false) {
    if (!playerStateStore || !playerStateStore.write) {
      return;
    }
    const payload = {
      tracks: state.tracks,
      currentIndex: state.currentIndex,
      isPlaying: !audio.paused,
      currentTime: audio.currentTime || 0,
      volume: state.volume,
      trackId: state.currentTrack ? state.currentTrack.id : null,
      audioSrc: audio.src || ""
    };
    if (immediate) {
      playerStateStore.write(payload);
      return;
    }
    window.clearTimeout(window.__swagUnifiedPersistTimer);
    window.__swagUnifiedPersistTimer = window.setTimeout(() => {
      playerStateStore.write(payload);
    }, 250);
  }
  function restorePlaybackState() {
    const init2 = window.INIT || {};
    if (init2.sharedTrack || init2.sharedAlbum || !playerStateStore || !playerStateStore.read) {
      return;
    }
    const savedState = playerStateStore.read();
    if (!savedState) return;
    const allTracks = Array.isArray(state.tracks) && state.tracks.length ? state.tracks : Array.isArray(savedState.tracks) ? savedState.tracks : [];
    if (!allTracks.length) return;
    let idx = -1;
    if (savedState.trackId != null) {
      idx = allTracks.findIndex((t) => t.id === savedState.trackId);
    }
    if (idx < 0 && Number.isInteger(savedState.currentIndex) && savedState.currentIndex >= 0 && savedState.currentIndex < allTracks.length) {
      idx = savedState.currentIndex;
    }
    if (idx < 0) return;
    const savedTrack = allTracks[idx];
    if (!isTrackPlayable(savedTrack)) return;
    state.tracks = allTracks;
    state.currentIndex = idx;
    state.currentTrack = savedTrack;
    state.volume = Number.isFinite(savedState.volume) ? savedState.volume : state.volume;
    audio.src = trackAudioUrl(savedTrack);
    audio.load();
    updateTrackUI();
    updatePlayState(false);
    showMiniPlayer();
    if (savedState.currentTime > 0) {
      audio.addEventListener("loadedmetadata", function restoreTime() {
        audio.removeEventListener("loadedmetadata", restoreTime);
        audio.currentTime = savedState.currentTime;
      }, { once: true });
    }
    if (savedTrack.lyrics) {
      state.lyricsData = parseLRC(savedTrack.lyrics);
      renderLyrics();
    }
  }
  function playAlbumTracks() {
    const list = state.lists.album.length ? state.lists.album : state.tracks;
    if (list.length > 0) {
      playTrack(0, list);
      showMiniPlayer();
    }
  }
  function playAlbumTrack(index) {
    const list = state.lists.album.length ? state.lists.album : state.tracks;
    if (index >= 0 && index < list.length) {
      playTrack(index, list);
      showMiniPlayer();
    }
  }
  function loadContent() {
    renderTracks(state.tracks);
    renderAlbums(state.albums);
    updateUserUI();
  }
  function renderTracks(tracks) {
    const container = $("tracks-list");
    if (!container) return;
    if (!tracks?.length) {
      container.innerHTML = '<div class="empty-state"><p>\u041D\u0435\u0442 \u0442\u0440\u0435\u043A\u043E\u0432</p></div>';
      return;
    }
    state.lists.main = tracks.slice();
    container.innerHTML = tracks.map((t) => `
            <div class="track-card" onclick="window.SwagPlayer.playFromList('main', ${t.id})">
                <img src="${trackCoverUrl(t)}"
                     loading="lazy" decoding="async"
                     onerror="this.src='/static/img/default-cover.svg'">
                <div class="info">
                    <div class="title">${escHtml(t.title)}</div>
                    <div class="artist">${escHtml(t.artist || "")}</div>
                </div>
                <div class="stats">
                    <span><i data-lucide="play" class="w-3 h-3"></i>${t.plays_count || 0}</span>
                    <span><i data-lucide="heart" class="w-3 h-3"></i>${t.likes_count || 0}</span>
                </div>
            </div>
        `).join("");
    lucideSafe.createIcons();
  }
  function renderAlbums(albums) {
    const container = $("albums-grid");
    if (!container) return;
    if (!albums?.length) {
      container.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><p>\u041D\u0435\u0442 \u0430\u043B\u044C\u0431\u043E\u043C\u043E\u0432</p></div>';
      return;
    }
    container.innerHTML = albums.map((a) => `
            <a href="/album/${a.slug || a.id}" class="album-card">
                <div class="cover">
                    ${a.cover_url ? `<img src="${a.cover_url}" loading="lazy" decoding="async">` : `<div class="placeholder"><i data-lucide="disc-3" class="w-12 h-12"></i></div>`}
                </div>
                <div class="title">${escHtml(a.title)}</div>
                <div class="subtitle">${escHtml(a.description || "\u0410\u043B\u044C\u0431\u043E\u043C")}</div>
            </a>
        `).join("");
    lucideSafe.createIcons();
  }
  function playFromList(listKey, trackId) {
    const list = state.lists && state.lists[listKey] || [];
    const idx = list.findIndex((t) => t && t.id === trackId);
    if (idx < 0) {
      console.warn("playFromList: track not found", { listKey, trackId, listSize: list.length });
      return;
    }
    playTrack(idx, list);
  }
  let _playRetryCount = 0;
  function playTrack(index, queue) {
    if (Array.isArray(queue) && queue.length) {
      state.tracks = queue;
    }
    if (index < 0 || index >= state.tracks.length) return;
    const t = state.tracks[index];
    if (!t) return;
    if (!isTrackPlayable(t)) {
      updatePlayState(false);
      alert("\u042D\u0442\u043E\u0442 \u0442\u0440\u0435\u043A \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0434\u043B\u044F \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u044F.");
      persistPlaybackState(true);
      return;
    }
    if (state.currentTrack && state.currentTrack.id === t.id && !audio.error) {
      togglePlay();
      return;
    }
    state.currentIndex = index;
    state.currentTrack = t;
    try {
      audio.pause();
    } catch (_) {
    }
    const newSrc = trackAudioUrl(t);
    const wantHref = new URL(newSrc, window.location.origin).href;
    if (audio.src !== wantHref) {
      audio.src = newSrc;
    }
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.then(() => {
        _playRetryCount = 0;
        persistPlaybackState(true);
      }).catch((error) => {
        updatePlayState(false);
        console.warn("audio.play() rejected:", error && error.name, error && error.message);
        if (error && (error.name === "NotSupportedError" || error.name === "AbortError") && _playRetryCount < 1) {
          _playRetryCount += 1;
          audio.load();
          const retry = () => {
            audio.removeEventListener("canplay", retry);
            audio.removeEventListener("loadedmetadata", retry);
            audio.play().catch((e) => {
              console.error("retry play also failed:", e);
              _playRetryCount = 0;
            });
          };
          audio.addEventListener("canplay", retry, { once: true });
          audio.addEventListener("loadedmetadata", retry, { once: true });
        } else if (error && error.name === "NotAllowedError") {
        } else {
          _playRetryCount = 0;
        }
        persistPlaybackState(true);
      });
    } else {
      persistPlaybackState(true);
    }
    updateTrackUI();
    showMiniPlayer();
    _playCountedForTrack = null;
    _playAccumSeconds = 0;
    _playLastTime = null;
    if (t.lyrics) {
      state.lyricsData = parseLRC(t.lyrics);
      renderLyrics();
    } else {
      state.lyricsData = [];
      _lyricLineEls = null;
      _lyricActiveIdx = -1;
      $("lyrics-scroll").innerHTML = '<p style="text-align:center;color:#666;padding-top:20vh;">\u0422\u0435\u043A\u0441\u0442 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D</p>';
    }
  }
  function togglePlay() {
    if (!state.currentTrack) {
      const fallback = state.lists.main.length ? state.lists.main : state.tracks;
      if (fallback.length) playTrack(0, fallback);
      return;
    }
    if (!isTrackPlayable(state.currentTrack)) {
      updatePlayState(false);
      alert("\u042D\u0442\u043E\u0442 \u0442\u0440\u0435\u043A \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0434\u043B\u044F \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u044F.");
      persistPlaybackState(true);
      return;
    }
    if (audio.paused) {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.then(() => {
          persistPlaybackState(true);
        }).catch((error) => {
          updatePlayState(false);
          if (error && error.name === "NotSupportedError") {
            alert("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438 \u0442\u0440\u0435\u043A: \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0438\u043B\u0438 \u0444\u043E\u0440\u043C\u0430\u0442 \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F.");
          } else {
            console.error("Play error:", error);
          }
          persistPlaybackState(true);
        });
      } else {
        persistPlaybackState(true);
      }
      return;
    }
    audio.pause();
  }
  function prevTrack() {
    if (!state.tracks.length) return;
    let idx = state.currentIndex - 1;
    if (idx < 0) idx = state.tracks.length - 1;
    playTrack(idx);
  }
  function nextTrack() {
    if (!state.tracks.length) return;
    let idx;
    if (state.isShuffleOn && state.shuffledIndices.length) {
      const pos = state.shuffledIndices.indexOf(state.currentIndex);
      idx = state.shuffledIndices[(pos + 1) % state.shuffledIndices.length];
    } else {
      idx = (state.currentIndex + 1) % state.tracks.length;
    }
    playTrack(idx);
  }
  function toggleShuffle() {
    state.isShuffleOn = !state.isShuffleOn;
    if (state.isShuffleOn) {
      state.shuffledIndices = [...Array(state.tracks.length).keys()];
      for (let i = state.shuffledIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.shuffledIndices[i], state.shuffledIndices[j]] = [state.shuffledIndices[j], state.shuffledIndices[i]];
      }
    }
    $("shuffle-btn").classList.toggle("active", state.isShuffleOn);
  }
  async function loadAlbum(id) {
    try {
      const res = await fetch(`/api/album/${id}`, { credentials: "same-origin" });
      const data = await res.json();
      if (data.album && data.tracks?.length) {
        state.lists.album = data.tracks.slice();
        playTrack(0, state.lists.album);
        expandPlayer();
      }
    } catch (e) {
      console.error("Failed to load album:", e);
    }
  }
  function updatePlayState(isPlaying) {
    state.isPlaying = isPlaying;
    const icon = $("play-icon");
    if (icon) setIcon(icon, isPlaying ? "pause" : "play");
    const miniBtn = $("mini-play-btn");
    if (miniBtn) miniBtn.innerHTML = iconHtml(isPlaying ? "pause" : "play", "w-6 h-6 fill-white");
    lucideSafe.createIcons();
    const card = $("art-card");
    if (card) {
      if (isPlaying) {
        gsapSafe.to(card, { scale: 1, duration: 1.2, ease: "back.out(1.7)" });
        card.classList.add("playing");
      } else {
        gsapSafe.to(card, { scale: 0.9, duration: 1, ease: "power4.out" });
        card.classList.remove("playing");
      }
    }
  }
  function updateTrackUI() {
    const t = state.currentTrack;
    if (!t) return;
    const cover = trackCoverUrl(t);
    $("mini-cover").src = cover;
    $("mini-title").textContent = t.title;
    $("mini-artist").textContent = t.artist || "";
    $("art-card").style.backgroundImage = `url('${cover}')`;
    $("full-title").textContent = t.title;
    $("full-artist").textContent = t.artist || "";
    updateLikeUI();
    updateMediaSession();
    refreshTrackStats(t.id);
    document.title = `${t.artist || "Untitled"} \u2014 ${t.title} \xB7 SwagPlayer`;
  }
  async function refreshTrackStats(trackId) {
    if (!trackId) return;
    try {
      const res = await fetch(`/api/tracks?id=${trackId}`, { cache: "no-cache", credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json();
      const fresh = Array.isArray(data) ? data[0] : data;
      if (!fresh || fresh.id !== trackId) return;
      if (state.currentTrack && state.currentTrack.id === trackId) {
        state.currentTrack.likes_count = fresh.likes_count;
        state.currentTrack.plays_count = fresh.plays_count;
        state.currentTrack.is_liked = !!fresh.is_liked;
      }
      const same = state.tracks.find((x) => x.id === trackId);
      if (same) {
        same.likes_count = fresh.likes_count;
        same.plays_count = fresh.plays_count;
        same.is_liked = !!fresh.is_liked;
      }
      updateLikeUI();
    } catch (e) {
    }
  }
  function updateLikeUI() {
    const t = state.currentTrack;
    if (!t) return;
    const btn = $("like-btn");
    const icon = $("like-icon");
    const count = $("likes-count");
    count.textContent = t.likes_count || 0;
    btn.classList.toggle("liked", !!t.is_liked);
  }
  function onTimeUpdate() {
    if (!audio.duration) return;
    const pct = audio.currentTime / audio.duration * 100;
    progressInput.value = pct;
    updateProgressBar(pct);
    $("cur-time").textContent = formatTime(audio.currentTime);
    if (state.lyricsData.length && !_lyricsRafScheduled) {
      _lyricsRafScheduled = true;
      requestAnimationFrame(() => {
        _lyricsRafScheduled = false;
        updateActiveLyric();
      });
    }
    const now = audio.currentTime | 0;
    if (now !== updateTimeUpdate._last) {
      updateTimeUpdate._last = now;
      updateMediaSessionPosition();
    }
    trackPlayProgress();
    persistPlaybackState();
  }
  let _lyricsRafScheduled = false;
  const updateTimeUpdate = onTimeUpdate;
  let _playCountedForTrack = null;
  let _playAccumSeconds = 0;
  let _playLastTime = null;
  function trackPlayProgress() {
    const t = state.currentTrack;
    if (!t || audio.paused || !audio.duration) return;
    if (_playCountedForTrack === t.id) return;
    const cur = audio.currentTime;
    if (_playLastTime !== null) {
      const delta = cur - _playLastTime;
      if (delta > 0 && delta < 1.5) {
        _playAccumSeconds += delta;
      }
    }
    _playLastTime = cur;
    const threshold = audio.duration < 33 ? Math.max(10, audio.duration * 0.9) : 30;
    if (_playAccumSeconds >= threshold) {
      _playCountedForTrack = t.id;
      fetch(`/api/tracks/${t.id}/play`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listened_seconds: Math.round(_playAccumSeconds),
          duration: Math.round(audio.duration)
        })
      }).catch(() => {
      });
    }
  }
  function onMetadataLoaded() {
    $("total-time").textContent = formatTime(audio.duration);
  }
  function updateProgressBar(pct) {
    progressInput.style.background = `linear-gradient(to right, #fff ${pct}%, rgba(255,255,255,0.1) ${pct}%)`;
  }
  function setVolume(vol) {
    state.volume = Math.max(0, Math.min(1, vol));
    audio.volume = state.volume;
    localStorage.setItem("swag_volume", state.volume);
    if (volumeSlider) volumeSlider.value = state.volume;
    if (miniVolSlider) miniVolSlider.value = state.volume;
    updateVolumeIcon();
    persistPlaybackState(true);
  }
  function updateVolumeIcon() {
    const icon = $("volume-icon");
    if (!icon) return;
    const name = state.volume === 0 ? "volume-x" : state.volume < 0.5 ? "volume-1" : "volume-2";
    setIcon(icon, name);
    lucideSafe.createIcons();
  }
  function updateUserUI() {
    const avatar = $("user-avatar");
    const icon = $("user-icon");
    if (!avatar || !icon) return;
    if (state.user?.avatar_url) {
      avatar.src = state.user.avatar_url;
      avatar.style.display = "block";
      icon.style.display = "none";
    } else {
      avatar.style.display = "none";
      icon.style.display = "block";
    }
  }
  function showMiniPlayer() {
    if (miniPlayer) miniPlayer.classList.add("visible");
  }
  function closeTrack() {
    try {
      audio.pause();
    } catch (_) {
    }
    try {
      audio.removeAttribute("src");
      audio.load();
    } catch (_) {
    }
    state.currentTrack = null;
    state.currentIndex = -1;
    if (miniPlayer) miniPlayer.classList.remove("visible");
    if (fullPlayer) {
      fullPlayer.classList.remove("visible");
      fullPlayer.classList.remove("lyrics-open");
    }
    document.body.style.overflow = "";
    try {
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      }
    } catch (_) {
    }
    const setText = (id, v) => {
      const el = $(id);
      if (el) el.textContent = v;
    };
    setText("mini-title", "\u041D\u0435 \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0438\u0442\u0441\u044F");
    setText("mini-artist", "");
    setText("full-title", "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435");
    setText("full-artist", "\u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C");
    const miniCover = $("mini-cover");
    if (miniCover) miniCover.src = "/static/img/icon-192.png";
    const art = $("art-card");
    if (art) art.style.backgroundImage = "";
    persistPlaybackState(true);
  }
  function expandPlayer() {
    fullPlayer.classList.add("visible");
    document.body.style.overflow = "hidden";
  }
  function collapsePlayer() {
    fullPlayer.classList.remove("visible");
    fullPlayer.classList.remove("lyrics-open");
    document.body.style.overflow = "";
    closeLyrics();
  }
  function parseLRC(lrc) {
    if (!lrc) return [];
    const lines = lrc.split("\n");
    const result = [];
    const regex = /\[(\d+):(\d+\.?\d*)\]/;
    lines.forEach((line) => {
      const m = regex.exec(line);
      if (m) {
        const time = parseInt(m[1]) * 60 + parseFloat(m[2]);
        const text = line.replace(regex, "").trim();
        if (text) result.push({ t: time, text });
      }
    });
    return result;
  }
  function renderLyrics() {
    const container = $("lyrics-scroll");
    if (!container) return;
    container.innerHTML = state.lyricsData.map(
      (l) => `<div class="lyric-line" onclick="window.SwagPlayer.seekToLyric(${l.t})">${escHtml(l.text)}</div>`
    ).join("");
    _lyricLineEls = null;
    _lyricActiveIdx = -1;
    setupLyricsScrollUX(container);
  }
  const USER_IDLE_MS = 2800;
  let _lyricsUserScrolling = false;
  let _lyricsUserIdleTimer = null;
  let _lyricsAutoScrolling = false;
  let _lyricsAutoScrollEnd = 0;
  let _lyricsScrollRaf = null;
  function setupLyricsScrollUX(container) {
    if (container._uxBound) return;
    container._uxBound = true;
    const markUser = () => {
      if (_lyricsAutoScrolling || Date.now() < _lyricsAutoScrollEnd) return;
      if (_lyricsScrollRaf) {
        cancelAnimationFrame(_lyricsScrollRaf);
        _lyricsScrollRaf = null;
      }
      if (!_lyricsUserScrolling) {
        _lyricsUserScrolling = true;
        container.classList.add("user-scrolling");
      }
      if (_lyricsUserIdleTimer) clearTimeout(_lyricsUserIdleTimer);
      _lyricsUserIdleTimer = setTimeout(() => {
        _lyricsUserScrolling = false;
        container.classList.remove("user-scrolling");
        scrollToActiveLyric(true);
      }, USER_IDLE_MS);
    };
    container.addEventListener("wheel", markUser, { passive: true });
    container.addEventListener("touchstart", markUser, { passive: true });
    container.addEventListener("touchmove", markUser, { passive: true });
    container.addEventListener("keydown", markUser);
    container.addEventListener("mousedown", markUser);
  }
  function scrollToActiveLyric(smooth) {
    const container = $("lyrics-scroll");
    if (!container) return;
    const active = container.querySelector(".lyric-line.active");
    if (!active) return;
    const target = Math.max(0, active.offsetTop - container.offsetHeight / 2 + active.offsetHeight / 2);
    _lyricsAutoScrolling = true;
    if (!smooth) {
      container.scrollTop = target;
      _lyricsAutoScrollEnd = Date.now() + 100;
      setTimeout(() => {
        _lyricsAutoScrolling = false;
      }, 100);
      return;
    }
    if (_lyricsScrollRaf) cancelAnimationFrame(_lyricsScrollRaf);
    const from = container.scrollTop;
    const dist = target - from;
    if (Math.abs(dist) < 1) {
      _lyricsAutoScrolling = false;
      return;
    }
    const duration = Math.min(700, Math.max(300, Math.abs(dist) * 0.5));
    const startTime = performance.now();
    _lyricsAutoScrollEnd = Date.now() + duration + 100;
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      container.scrollTop = from + dist * easeOut(t);
      if (t < 1) {
        _lyricsScrollRaf = requestAnimationFrame(step);
      } else {
        _lyricsScrollRaf = null;
        _lyricsAutoScrolling = false;
      }
    };
    _lyricsScrollRaf = requestAnimationFrame(step);
  }
  let _lyricLineEls = null;
  let _lyricActiveIdx = -1;
  function updateActiveLyric() {
    if (!_lyricLineEls) {
      _lyricLineEls = Array.from(document.querySelectorAll(".lyric-line"));
    }
    const lines = _lyricLineEls;
    if (!lines.length) return;
    const time = audio.currentTime;
    let lo = 0, hi = state.lyricsData.length - 1, activeIdx = -1;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
      if (state.lyricsData[mid].t <= time) {
        activeIdx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (activeIdx === _lyricActiveIdx) return;
    if (_lyricActiveIdx >= 0 && _lyricActiveIdx < lines.length) {
      lines[_lyricActiveIdx].classList.remove("active");
    }
    if (activeIdx >= 0 && activeIdx < lines.length) {
      lines[activeIdx].classList.add("active");
    }
    _lyricActiveIdx = activeIdx;
    if (activeIdx >= 0 && !_lyricsUserScrolling) {
      scrollToActiveLyric(true);
    }
  }
  function seekToLyric(time) {
    audio.currentTime = time;
    if (audio.paused) audio.play();
  }
  function toggleLyrics() {
    state.isLyricsOpen = !state.isLyricsOpen;
    const section = $("lyrics-section");
    const btn = $("lyrics-btn");
    if (state.isLyricsOpen) {
      btn.classList.add("active");
      section.classList.add("visible");
      fullPlayer.classList.add("lyrics-open");
    } else {
      btn.classList.remove("active");
      section.classList.remove("visible");
      fullPlayer.classList.remove("lyrics-open");
    }
  }
  function closeLyrics() {
    if (state.isLyricsOpen) {
      state.isLyricsOpen = false;
      $("lyrics-section").classList.remove("visible");
      $("lyrics-btn").classList.remove("active");
      fullPlayer.classList.remove("lyrics-open");
    }
  }
  async function toggleLike() {
    if (!state.currentTrack) return;
    if (!state.user) {
      requestAuth();
      return;
    }
    const wantLike = !state.currentTrack.is_liked;
    state.currentTrack.is_liked = wantLike;
    state.currentTrack.likes_count = (state.currentTrack.likes_count || 0) + (wantLike ? 1 : -1);
    if (state.currentTrack.likes_count < 0) state.currentTrack.likes_count = 0;
    updateLikeUI();
    try {
      const res = await fetch(`/api/tracks/${state.currentTrack.id}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ like: wantLike })
      });
      const data = await res.json();
      if (data.success) {
        state.currentTrack.is_liked = data.liked;
        state.currentTrack.likes_count = data.likes_count;
        updateLikeUI();
      } else if (res.status === 401) {
        requestAuth();
      }
    } catch (e) {
      console.error("Like error:", e);
    }
  }
  function switchTab(tab) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    $("tracks-section").style.display = tab === "all" || tab === "tracks" ? "block" : "none";
    $("albums-section").style.display = tab === "all" || tab === "albums" ? "block" : "none";
    $("my-section").style.display = tab === "my" ? "block" : "none";
    if (tab === "my") loadMyContent();
  }
  async function loadMyContent() {
    if (!state.user) {
      $("my-auth-prompt").style.display = "block";
      $("my-content").style.display = "none";
      return;
    }
    $("my-auth-prompt").style.display = "none";
    $("my-content").style.display = "block";
    try {
      const [tracksRes, albumsRes] = await Promise.all([
        fetch(`/api/tracks?user_id=${state.user.id}&show_hidden=true`),
        fetch(`/api/albums?user_id=${state.user.id}`)
      ]);
      const myTracks = await tracksRes.json();
      const myAlbums = await albumsRes.json();
      renderMyTracks(myTracks);
      renderMyAlbums(myAlbums);
    } catch (e) {
      console.error("Load my content error:", e);
    }
  }
  function renderMyTracks(tracks) {
    const container = $("my-tracks-list");
    if (!tracks?.length) {
      container.innerHTML = '<div class="empty-state"><p>\u041D\u0435\u0442 \u0442\u0440\u0435\u043A\u043E\u0432</p></div>';
      return;
    }
    state.lists.my = tracks.slice();
    window._myTracks = tracks;
    container.innerHTML = tracks.map((t) => `
            <div class="track-card" onclick="window.SwagPlayer.playFromList('my', ${t.id})">
                <img src="${trackCoverUrl(t)}" loading="lazy" decoding="async">
                <div class="info">
                    <div class="title">${escHtml(t.title)}</div>
                    <div class="artist">${escHtml(t.artist || "")}</div>
                </div>
                ${t.hidden ? '<span style="color:#666;font-size:12px;">\u0441\u043A\u0440\u044B\u0442</span>' : ""}
            </div>
        `).join("");
  }
  function renderMyAlbums(albums) {
    const container = $("my-albums-grid");
    if (!albums?.length) {
      container.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><p>\u041D\u0435\u0442 \u0430\u043B\u044C\u0431\u043E\u043C\u043E\u0432</p></div>';
      return;
    }
    container.innerHTML = albums.map((a) => `
            <div class="album-card" onclick="window.SwagPlayer.loadAlbum('${a.slug || a.id}')">
                <div class="cover">
                    ${a.cover_url ? `<img src="${a.cover_url}" loading="lazy" decoding="async">` : `<div class="placeholder"><i data-lucide="disc-3" class="w-12 h-12"></i></div>`}
                </div>
                <div class="title">${escHtml(a.title)}</div>
            </div>
        `).join("");
    lucideSafe.createIcons();
  }
  function playMyTrack(index) {
    const list = state.lists.my.length ? state.lists.my : window._myTracks || [];
    if (index >= 0 && index < list.length) {
      playTrack(index, list);
    }
  }
  function toggleSearch() {
    const bar = $("search-bar");
    const visible = bar.style.display !== "none";
    bar.style.display = visible ? "none" : "block";
    if (!visible) $("search-input").focus();
  }
  function performSearch(e) {
    e.preventDefault();
    const q = $("search-input").value.trim();
    if (q) window.location.href = `/?q=${encodeURIComponent(q)}`;
  }
  function goBack() {
    window.history.back();
  }
  function openProfile() {
    if (!state.user) {
      requestAuth();
      return;
    }
    const modal = $("profile-modal");
    modal.classList.add("visible");
    const isAdmin = !!state.user.is_admin;
    $("profile-content").innerHTML = `
            <div style="text-align:center;margin-bottom:24px;">
                <div style="width:96px;height:96px;margin:0 auto 16px;border-radius:50%;overflow:hidden;background:#222;">
                    ${state.user.avatar_url ? `<img src="${state.user.avatar_url}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;"><i data-lucide="user" class="w-12 h-12" style="color:#444;"></i></div>`}
                </div>
                <h3 style="font-size:20px;font-weight:700;margin-bottom:4px;">${escHtml(state.user.display_name || state.user.first_name || "User")}</h3>
                ${state.user.nickname ? `<p style="color:#888;">@${state.user.nickname}</p>` : ""}
            </div>

            <div style="display:flex;flex-direction:column;gap:12px;">
                ${isAdmin && state.user.nickname ? `
                    <a href="/user/${state.user.nickname}" class="btn-secondary">
                        <i data-lucide="external-link" class="w-4 h-4"></i>
                        \u041C\u043E\u044F \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u0430\u044F \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430
                    </a>
                ` : ""}

                ${isAdmin ? `
                    <a href="/app" class="btn-secondary">
                        <i data-lucide="settings" class="w-4 h-4"></i>
                        \u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0442\u0440\u0435\u043A\u0430\u043C\u0438
                    </a>
                ` : ""}

                <button onclick="window.SwagPlayer.logout()" class="btn-secondary" style="color:#fa2d48;">
                    <i data-lucide="log-out" class="w-4 h-4"></i>
                    \u0412\u044B\u0439\u0442\u0438
                </button>
            </div>
        `;
    lucideSafe.createIcons();
  }
  function closeProfile() {
    $("profile-modal").classList.remove("visible");
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    state.user = null;
    updateUserUI();
    closeProfile();
    window.location.reload();
  }
  async function requestAuth() {
    if (window.tg?.initData) {
      $("auth-overlay").style.display = "flex";
      try {
        const res = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData: window.tg.initData })
        });
        const data = await res.json();
        if (data.success && data.user) {
          state.user = data.user;
          updateUserUI();
          applyAdminVisibility();
          $("auth-overlay").style.display = "none";
          if ($("my-section").style.display !== "none") {
            loadMyContent();
          }
        } else {
          throw new Error(data.error || "Auth failed");
        }
      } catch (e) {
        console.error("Auth error:", e);
        $("auth-overlay").style.display = "none";
        alert("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u043E\u0432\u0430\u0442\u044C\u0441\u044F. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435.");
      }
    } else {
      rememberReturnUrl();
      const url = "https://tg.swag.best/swagplayerobot?start=auth";
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        window.location.href = url;
      } else {
        window.open(url, "_blank");
      }
    }
  }
  function shareTrack() {
    const t = state.currentTrack;
    if (!t) return;
    const url = `${window.location.origin}/track/${t.slug || t.id}`;
    if (window.tg) {
      window.tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(t.title + " - " + t.artist)}`);
    } else if (navigator.share) {
      navigator.share({
        title: t.title,
        text: `${t.title} - ${t.artist}`,
        url
      }).catch(() => {
      });
    } else {
      navigator.clipboard.writeText(url).then(() => {
        alert("\u0421\u0441\u044B\u043B\u043A\u0430 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0430!");
      });
    }
  }
  function toggleMiniVolume() {
    $("mini-vol-popup").classList.toggle("visible");
  }
  function onKeyDown(e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    switch (e.code) {
      case "Space":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowLeft":
        audio.currentTime = Math.max(0, audio.currentTime - 5);
        break;
      case "ArrowRight":
        audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
        break;
      case "ArrowUp":
        e.preventDefault();
        setVolume(state.volume + 0.1);
        break;
      case "ArrowDown":
        e.preventDefault();
        setVolume(state.volume - 0.1);
        break;
    }
  }
  function formatTime(s) {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? "0" + sec : sec}`;
  }
  function escHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function __setList(key, list) {
    if (!state.lists[key]) state.lists[key] = [];
    if (Array.isArray(list)) state.lists[key] = list.slice();
  }
  window.SwagPlayer = {
    playTrack,
    playFromList,
    closeTrack,
    __setList,
    togglePlay,
    prevTrack,
    nextTrack,
    toggleShuffle,
    toggleLike,
    toggleLyrics,
    loadAlbum,
    playMyTrack,
    seekToLyric,
    switchTab,
    toggleSearch,
    performSearch,
    goBack,
    openProfile,
    closeProfile,
    logout,
    requestAuth,
    shareTrack,
    toggleMiniVolume,
    expandPlayer,
    collapsePlayer,
    playAlbumTracks,
    playAlbumTrack
  };
  window.togglePlay = togglePlay;
  window.prevTrack = prevTrack;
  window.nextTrack = nextTrack;
  window.toggleShuffle = toggleShuffle;
  window.toggleLike = toggleLike;
  window.toggleLyrics = toggleLyrics;
  window.toggleSearch = toggleSearch;
  window.performSearch = performSearch;
  window.goBack = goBack;
  window.openProfile = openProfile;
  window.closeProfile = closeProfile;
  window.shareTrack = shareTrack;
  window.toggleMiniVolume = toggleMiniVolume;
  window.expandPlayer = expandPlayer;
  window.collapsePlayer = collapsePlayer;
  window.requestAuth = requestAuth;
  window.switchTab = switchTab;
})();
