(function() {
  "use strict";
  const history = [];
  let isNavigating = false;
  function navTrackAudioUrl(track) {
    if (track && track.audio_url) return track.audio_url;
    if (track && track.filename) return `/uploads/${track.filename}`;
    return "";
  }
  function navTrackCoverUrl(track) {
    return track && track.cover_url ? track.cover_url : "";
  }
  let _navAudioRetried = false;
  async function navRefreshAudioSrc(audioEl) {
    if (_navAudioRetried) return;
    const tracks = typeof window.tracks !== "undefined" ? window.tracks : [];
    const idx = typeof window.currentIndex !== "undefined" ? window.currentIndex : -1;
    const track = tracks[idx];
    if (!track || !track.id) return;
    _navAudioRetried = true;
    try {
      const res = await fetch(`/api/tracks?id=${track.id}&_t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const arr = await res.json();
      const fresh = Array.isArray(arr) ? arr.find((x) => x.id === track.id) : null;
      if (!fresh || !fresh.audio_url) return;
      tracks[idx] = { ...track, ...fresh };
      const pos = audioEl.currentTime || 0;
      audioEl.src = fresh.audio_url;
      audioEl.load();
      if (pos > 0) {
        audioEl.addEventListener("loadedmetadata", function back() {
          audioEl.removeEventListener("loadedmetadata", back);
          try { audioEl.currentTime = pos; } catch (_) {}
        }, { once: true });
      }
    } catch (_) {
    } finally {
      setTimeout(() => { _navAudioRetried = false; }, 2000);
    }
  }
  function handle401Error(response, url) {
    if (response && response.status === 401) {
      console.log("401 Unauthorized, redirecting to bot");
      const botUrl = "https://tg.swag.best/swagplayerobot?start=auth";
      const botUrlTme = "https://t.me/swagplayerobot?start=auth";
      if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openTelegramLink) {
        window.Telegram.WebApp.openTelegramLink(botUrlTme);
      } else {
        window.location.href = botUrl;
      }
      return true;
    }
    return false;
  }
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    return originalFetch.apply(this, args).then((response) => {
      if (response.status === 401 && args[0] && typeof args[0] === "string" && args[0].includes("/api/")) {
        if (!args[0].includes("/api/user/profile")) {
          handle401Error(response, args[0]);
        }
      }
      return response;
    });
  };
  const PlayerStateStore = window.SwagPlayerState || {
    read: () => {
      try {
        const raw = localStorage.getItem("playerState");
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        console.log("Failed to parse player state:", error);
        return null;
      }
    },
    write: (state) => {
      try {
        localStorage.setItem("playerState", JSON.stringify(state));
      } catch (error) {
        console.log("Failed to persist player state:", error);
      }
      return state;
    },
    clear: () => {
      try {
        localStorage.removeItem("playerState");
      } catch (error) {
        console.log("Failed to clear player state:", error);
      }
    }
  };
  function initSPANavigation() {
    document.addEventListener("click", handleLinkClick, true);
    document.addEventListener("click", (e) => {
      const target = e.target;
      if (target.onclick && target.onclick.toString().includes("location.href")) {
        const onclickStr = target.getAttribute("onclick") || "";
        const match = onclickStr.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
        if (match && match[1]) {
          const url = match[1];
          if (url.startsWith("/") && !url.startsWith("/admin")) {
            e.preventDefault();
            e.stopPropagation();
            navigateTo(url);
          }
        }
      }
    }, true);
    window.navigateToPage = function(url) {
      if (url && url.startsWith("/") && !url.startsWith("/admin")) {
        navigateTo(url);
      } else {
        window.location.href = url;
      }
    };
    window.addEventListener("popstate", handlePopState);
    const initialUrl = window.location.pathname + window.location.search;
    const isSharedMode = typeof window.SHARED_MODE !== "undefined" && window.SHARED_MODE === true;
    if (history.length === 0) {
      if (!isSharedMode) {
        try {
          const savedState = PlayerStateStore.read();
          if (savedState) {
            window.playerState = savedState;
            console.log("Restored player state from localStorage on init");
          }
        } catch (e) {
          console.log("Failed to restore player state from localStorage:", e);
        }
      } else {
        console.log("SHARED_MODE detected, skipping localStorage restore in navigation");
      }
      savePlayerState();
      history.push({
        url: initialUrl,
        title: document.title,
        content: getPageContent(),
        styles: getPageStyles(),
        playerState: window.playerState ? JSON.parse(JSON.stringify(window.playerState)) : null
      });
      console.log("SPA Navigation initialized, initial URL:", initialUrl, "history length:", history.length);
    } else {
      console.log("SPA Navigation already initialized, history length:", history.length);
    }
  }
  function getPageContent() {
    const mainContent = document.querySelector(".container") || document.querySelector(".main-app") || document.querySelector("body > .container") || document.body;
    return mainContent ? mainContent.innerHTML : "";
  }
  function getPageStyles() {
    const styles = Array.from(document.querySelectorAll("head > style"));
    return styles.map((style) => style.textContent).join("\n");
  }
  function handleLinkClick(e) {
    const link = e.target.closest("a");
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href || href.startsWith("http") && !href.includes(window.location.hostname) || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:") || link.hasAttribute("data-no-spa") || link.target === "_blank") {
      return;
    }
    if (href.startsWith("/admin")) {
      return;
    }
    if (link.closest(".modal")) {
      return;
    }
    if (href === "/app" || href.startsWith("/app?") || href.startsWith("/app#")) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    navigateTo(href);
  }
  async function navigateTo(url) {
    if (isNavigating) {
      console.log("Navigation already in progress, ignoring:", url);
      return;
    }
    let cleanUrl = url;
    if (cleanUrl.startsWith("http")) {
      try {
        const urlObj = new URL(cleanUrl);
        cleanUrl = urlObj.pathname + urlObj.search;
      } catch (e) {
        console.error("Invalid URL:", cleanUrl);
        return;
      }
    }
    const urlPath = cleanUrl.split("?")[0];
    if (urlPath === window.location.pathname) {
      console.log("Same page, ignoring navigation:", urlPath);
      return;
    }
    console.log("Navigating to:", cleanUrl, "from:", window.location.pathname);
    isNavigating = true;
    try {
      showLoadingIndicator();
      const fetchUrl = cleanUrl.includes("?") ? cleanUrl : cleanUrl;
      console.log("Fetching URL:", fetchUrl);
      const response = await fetch(fetchUrl, {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "text/html",
          "Cache-Control": "no-cache"
        },
        cache: "no-cache"
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const styles = doc.querySelectorAll("head style");
      if (styles.length > 0) {
        const existingInlineStyles = Array.from(document.querySelectorAll("head > style"));
        existingInlineStyles.forEach((oldStyle) => {
          const styleText = oldStyle.textContent || "";
          if (styleText.includes(".container") || styleText.includes("body {") || styleText.includes(":root")) {
            oldStyle.remove();
          }
        });
        styles.forEach((style) => {
          const styleContent = style.textContent;
          const newStyle = document.createElement("style");
          newStyle.textContent = styleContent;
          document.head.appendChild(newStyle);
        });
      }
      let newContent = null;
      if (urlPath === "/app" || urlPath.startsWith("/app")) {
        newContent = doc.querySelector(".main-app");
        if (!newContent) {
          newContent = doc.querySelector("#main-app");
        }
      } else {
        newContent = doc.querySelector(".container");
      }
      if (!newContent) {
        newContent = doc.querySelector(".main-app");
      }
      if (!newContent) {
        newContent = doc.querySelector("body > .container");
      }
      if (!newContent) {
        newContent = doc.body;
      }
      if (!newContent || !newContent.innerHTML || newContent.innerHTML.trim() === "") {
        console.error("Content not found or empty, full HTML:", html.substring(0, 500));
        throw new Error("Content not found");
      }
      console.log("Content extracted, length:", newContent.innerHTML.length);
      const currentUrl = window.location.pathname + window.location.search;
      const lastHistoryItem = history.length > 0 ? history[history.length - 1] : null;
      if (!lastHistoryItem || lastHistoryItem.url !== currentUrl) {
        savePlayerState();
        history.push({
          url: currentUrl,
          title: document.title,
          content: getPageContent(),
          styles: getPageStyles(),
          playerState: window.playerState ? JSON.parse(JSON.stringify(window.playerState)) : null
        });
        console.log("Saved to history:", currentUrl, "history length:", history.length);
      }
      const isFirstNavigation = history.length === 0;
      if (isFirstNavigation) {
        window.history.replaceState({ url: urlPath, timestamp: Date.now() }, "", cleanUrl);
      } else {
        window.history.pushState({ url: urlPath, timestamp: Date.now() }, "", cleanUrl);
      }
      const currentContent = document.querySelector(".container") || document.querySelector(".main-app") || document.querySelector("body > .container") || document.body;
      if (currentContent) {
        savePlayerState();
        const audio = document.getElementById("audio-element");
        let wasPlaying = false;
        let savedTime = 0;
        let savedVolume = 1;
        let savedSrc = "";
        let savedTracks = null;
        let savedCurrentIndex = -1;
        if (audio) {
          wasPlaying = !audio.paused && audio.currentTime > 0;
          savedTime = audio.currentTime;
          savedVolume = audio.volume;
          savedSrc = audio.src;
          if (typeof window.getPlayerState === "function") {
            const playerState = window.getPlayerState();
            savedTracks = playerState.tracks;
            savedCurrentIndex = playerState.currentIndex;
          } else if (window.tracks && window.currentIndex !== void 0) {
            savedTracks = window.tracks;
            savedCurrentIndex = window.currentIndex;
          }
        }
        let contentToSet = "";
        if (currentContent === document.body) {
          const bodyContent = newContent.querySelector(".container") || newContent.querySelector(".main-app") || newContent;
          contentToSet = bodyContent ? bodyContent.innerHTML : newContent.innerHTML;
        } else {
          contentToSet = newContent.innerHTML;
        }
        if (!contentToSet || contentToSet.trim() === "") {
          console.error("Content is empty, trying full page reload");
          window.location.href = url;
          return;
        }
        currentContent.innerHTML = contentToSet;
        if (urlPath === "/app" || urlPath.startsWith("/app")) {
          const mainApp = document.getElementById("main-app");
          if (mainApp) {
            if (mainApp.style.display === "none") {
              mainApp.style.display = "flex";
            }
          }
          const authScreen = document.getElementById("auth-screen");
          if (authScreen && authScreen.style.display !== "none") {
            authScreen.style.display = "none";
          }
        } else {
          const mainApp = document.getElementById("main-app");
          if (mainApp) {
            mainApp.style.display = "none";
          }
          const authScreen = document.getElementById("auth-screen");
          if (authScreen) {
            authScreen.style.display = "none";
          }
        }
        document.title = doc.title || document.title;
        if (urlPath !== "/app" && document.body.hasAttribute("data-page")) {
          document.body.removeAttribute("data-page");
          document.body.classList.remove("app-mode");
        } else if (urlPath === "/app" && !document.body.hasAttribute("data-page")) {
          document.body.setAttribute("data-page", "app");
          document.body.classList.add("app-mode");
        }
        requestAnimationFrame(() => {
          void document.body.offsetHeight;
        });
        requestAnimationFrame(() => {
          const newAudio = document.getElementById("audio-element");
          if (wasPlaying && newAudio && savedSrc) {
            if (savedTracks && savedTracks.length > 0) {
              window.tracks = savedTracks;
              window.currentIndex = savedCurrentIndex;
              if (typeof window.setTracks === "function") {
                window.setTracks(savedTracks);
              }
            }
            if (newAudio.src !== savedSrc) {
              const currentTime = newAudio.currentTime;
              newAudio.src = savedSrc;
              newAudio.addEventListener("loadedmetadata", function restoreAudioState() {
                newAudio.removeEventListener("loadedmetadata", restoreAudioState);
                newAudio.currentTime = savedTime;
                newAudio.volume = savedVolume;
                const playPromise = newAudio.play();
                if (playPromise !== void 0) {
                  playPromise.catch((e) => {
                    console.log("Auto-play prevented, but audio is ready:", e);
                  });
                }
              }, { once: true });
              newAudio.load();
            } else {
              newAudio.currentTime = savedTime;
              newAudio.volume = savedVolume;
              const playPromise = newAudio.play();
              if (playPromise !== void 0) {
                playPromise.catch((e) => console.log("Auto-play prevented:", e));
              }
            }
          } else {
            restorePlayerState();
          }
          setTimeout(() => {
            initPageScripts();
          }, 100);
        });
        window.scrollTo(0, 0);
      }
      updateBackButtons();
    } catch (error) {
      console.error("Navigation error:", error);
      window.location.href = url;
    } finally {
      isNavigating = false;
      hideLoadingIndicator();
    }
  }
  function handlePopState(e) {
    console.log("PopState event, history length:", history.length, "state:", e.state);
    if (history.length > 1) {
      const audio = document.getElementById("audio-element");
      let wasPlaying = false;
      let savedTime = 0;
      let savedVolume = 1;
      let savedSrc = "";
      let savedTracks = null;
      let savedCurrentIndex = -1;
      if (audio) {
        wasPlaying = !audio.paused && audio.currentTime > 0;
        savedTime = audio.currentTime;
        savedVolume = audio.volume;
        savedSrc = audio.src;
        if (typeof window.getPlayerState === "function") {
          const playerState = window.getPlayerState();
          savedTracks = playerState.tracks;
          savedCurrentIndex = playerState.currentIndex;
        } else if (window.tracks && window.currentIndex !== void 0) {
          savedTracks = window.tracks;
          savedCurrentIndex = window.currentIndex;
        }
      }
      savePlayerState();
      const currentState = history.pop();
      console.log("Removed current state:", currentState.url);
      const prevState = history[history.length - 1];
      console.log("Restoring previous state:", prevState ? prevState.url : "none");
      if (prevState) {
        window.history.replaceState({ url: prevState.url, timestamp: prevState.timestamp || Date.now() }, prevState.title || document.title, prevState.url);
        if (prevState.playerState) {
          if (wasPlaying && savedTracks && savedTracks.length > 0) {
            window.playerState = {
              ...prevState.playerState,
              tracks: savedTracks,
              currentIndex: savedCurrentIndex,
              isPlaying: true,
              currentTime: savedTime,
              volume: savedVolume
            };
          } else {
            window.playerState = prevState.playerState;
          }
        }
        const currentContent = document.querySelector(".container") || document.querySelector(".main-app") || document.querySelector("body > .container") || document.body;
        if (currentContent) {
          currentContent.innerHTML = prevState.content;
          document.title = prevState.title || document.title;
          const prevUrlPath = prevState.url.split("?")[0];
          if (prevUrlPath !== "/app" && document.body.hasAttribute("data-page")) {
            document.body.removeAttribute("data-page");
            document.body.classList.remove("app-mode");
          } else if (prevUrlPath === "/app" && !document.body.hasAttribute("data-page")) {
            document.body.setAttribute("data-page", "app");
            document.body.classList.add("app-mode");
          }
          if (prevState.styles) {
            const existingInlineStyles = Array.from(document.querySelectorAll("head > style"));
            existingInlineStyles.forEach((oldStyle) => {
              const styleText = oldStyle.textContent || "";
              if (styleText.includes(".container") || styleText.includes("body {") || styleText.includes(":root")) {
                oldStyle.remove();
              }
            });
            if (prevState.styles.trim()) {
              const newStyle = document.createElement("style");
              newStyle.textContent = prevState.styles;
              document.head.appendChild(newStyle);
            }
          }
          requestAnimationFrame(() => {
            void document.body.offsetHeight;
          });
          requestAnimationFrame(() => {
            const newAudio = document.getElementById("audio-element");
            if (wasPlaying && newAudio && savedSrc) {
              if (savedTracks && savedTracks.length > 0) {
                window.tracks = savedTracks;
                window.currentIndex = savedCurrentIndex;
                if (typeof window.setTracks === "function") {
                  window.setTracks(savedTracks);
                }
              }
              if (newAudio.src !== savedSrc) {
                newAudio.src = savedSrc;
                newAudio.addEventListener("loadedmetadata", function restoreAudioState() {
                  newAudio.removeEventListener("loadedmetadata", restoreAudioState);
                  newAudio.currentTime = savedTime;
                  newAudio.volume = savedVolume;
                  const playPromise = newAudio.play();
                  if (playPromise !== void 0) {
                    playPromise.catch((e2) => console.log("Auto-play prevented:", e2));
                  }
                }, { once: true });
                newAudio.load();
              } else {
                newAudio.currentTime = savedTime;
                newAudio.volume = savedVolume;
                const playPromise = newAudio.play();
                if (playPromise !== void 0) {
                  playPromise.catch((e2) => console.log("Auto-play prevented:", e2));
                }
              }
            } else {
              restorePlayerState();
            }
            setTimeout(() => {
              initPageScripts();
            }, 100);
          });
          updateBackButtons();
        }
      }
    } else if (history.length === 1) {
      console.log("Only one item in history, navigating to home");
      navigateTo("/");
    } else {
      console.log("No history, navigating to home");
      navigateTo("/");
    }
  }
  function savePlayerState() {
    const audio = document.getElementById("audio-element");
    const tracksList = typeof window.tracks !== "undefined" ? window.tracks : [];
    const currentIdx = typeof window.currentIndex !== "undefined" ? window.currentIndex : -1;
    window.playerState = {
      tracks: tracksList,
      currentIndex: currentIdx,
      isPlaying: false,
      currentTime: 0,
      volume: 1,
      trackId: null
    };
    if (audio) {
      window.playerState.volume = audio.volume || 1;
      if (currentIdx >= 0 && tracksList[currentIdx]) {
        window.playerState.isPlaying = !audio.paused;
        window.playerState.currentTime = audio.currentTime || 0;
        window.playerState.trackId = tracksList[currentIdx].id;
        window.playerState.audioSrc = audio.src;
        console.log("Player state saved:", {
          trackId: window.playerState.trackId,
          isPlaying: window.playerState.isPlaying,
          currentTime: window.playerState.currentTime,
          currentIndex: currentIdx,
          tracksCount: tracksList.length
        });
      } else if (currentIdx >= 0) {
        window.playerState.currentIndex = currentIdx;
        console.log("Player state saved (index only):", {
          currentIndex: currentIdx,
          tracksCount: tracksList.length
        });
      } else if (tracksList.length > 0) {
        console.log("Player state saved (tracks only):", {
          tracksCount: tracksList.length
        });
      }
    }
    if (typeof window.getPlayerState === "function") {
      const playerState = window.getPlayerState();
      window.playerState = { ...window.playerState, ...playerState };
    }
    window.playerState = PlayerStateStore.write(window.playerState);
  }
  function restorePlayerState() {
    if (!window.playerState) {
      try {
        const savedState = PlayerStateStore.read();
        if (savedState) {
          window.playerState = savedState;
          console.log("Restored player state from localStorage");
        }
      } catch (e) {
        console.log("Failed to restore player state from localStorage:", e);
      }
    }
    if (!window.playerState) {
      console.log("No player state to restore");
      return;
    }
    const audio = document.getElementById("audio-element");
    if (!audio) {
      console.log("Audio element not found, cannot restore state");
      return;
    }
    const state = window.playerState;
    console.log("Restoring player state:", state);
    if (state.tracks && state.tracks.length > 0) {
      const validateTracks = async (tracks) => {
        if (!tracks || tracks.length === 0) return [];
        try {
          const timestamp = Date.now();
          const res = await fetch(`/api/tracks?_t=${timestamp}`, {
            cache: "no-cache",
            headers: {
              "Cache-Control": "no-cache, no-store, must-revalidate",
              "Pragma": "no-cache"
            }
          });
          if (!res.ok) {
            console.error("Failed to fetch tracks for validation");
            return tracks;
          }
          const allTracks = await res.json();
          const freshById = new Map(allTracks.map((t) => [t.id, t]));
          const validTracks = tracks.filter((track) => {
            if (!track.id) return false;
            return freshById.has(track.id);
          }).map((track) => ({ ...track, ...freshById.get(track.id) }));
          console.log(`Validated tracks: ${validTracks.length}/${tracks.length} valid`);
          return validTracks.length > 0 ? validTracks : tracks;
        } catch (e) {
          console.error("Error validating tracks:", e);
          return tracks;
        }
      };
      validateTracks(state.tracks).then((validTracks) => {
        if (validTracks.length > 0) {
          const currentTracks = window.tracks || [];
          const currentIndex = window.currentIndex !== void 0 ? window.currentIndex : -1;
          const isCurrentlyPlaying = audio && !audio.paused && audio.currentTime > 0;
          const hasCurrentTracks = currentTracks.length > 0 && currentIndex >= 0;
          if (!isCurrentlyPlaying && !hasCurrentTracks && currentTracks.length === 0) {
            state.tracks = validTracks;
            if (state.currentIndex >= validTracks.length) {
              state.currentIndex = -1;
            }
            window.playerState = state;
            if (typeof window.setTracks === "function") {
              window.setTracks(validTracks);
            } else {
              window.tracks = validTracks;
            }
            console.log("Tracks restored from state (validated):", validTracks.length);
            PlayerStateStore.write(state);
          } else {
            console.log("Player is playing or has tracks, keeping current tracks:", {
              isPlaying: isCurrentlyPlaying,
              hasTracks: hasCurrentTracks,
              tracksCount: currentTracks.length
            });
            window.playerState = { ...window.playerState, tracks: currentTracks, currentIndex };
          }
        } else {
          console.log("No valid tracks found, clearing state");
          window.tracks = [];
          window.currentIndex = -1;
          PlayerStateStore.clear();
        }
      });
    }
    if (state.currentIndex !== void 0) {
      window.currentIndex = state.currentIndex;
      if (typeof window.setCurrentIndex === "function") {
        window.setCurrentIndex(state.currentIndex);
      }
      console.log("Current index restored:", state.currentIndex);
    }
    if (state.volume !== void 0) {
      audio.volume = state.volume;
    }
    if (state.trackId && state.tracks && state.tracks.length > 0) {
      const track = state.tracks.find((t) => t.id === state.trackId) || (state.currentIndex >= 0 && state.currentIndex < state.tracks.length ? state.tracks[state.currentIndex] : null);
      if (track) {
        console.log("Restoring track:", track.title, "isPlaying:", state.isPlaying, "currentTime:", state.currentTime, "index:", state.currentIndex);
        const audioSrc = navTrackAudioUrl(track);
        if (audio.src !== audioSrc) {
          audio.src = audioSrc;
        }
        if (typeof window.updatePlayerUI === "function") {
          window.updatePlayerUI();
        } else if (typeof window.updateUI === "function") {
          window.updateUI(track);
        } else if (typeof window.updateLikeUI === "function") {
          window.updateLikeUI();
        }
        updatePlayerElements(track);
        const miniPlayer = document.getElementById("mini-player");
        if (miniPlayer) {
          miniPlayer.classList.remove("hidden");
        }
        const restoreTime = () => {
          if (state.currentTime !== void 0 && state.currentTime > 0) {
            audio.currentTime = state.currentTime;
          }
          console.log("Track loaded but NOT auto-playing (autoplay completely disabled)");
          if (typeof window.updatePlayerUI === "function") {
            window.updatePlayerUI();
          }
          const miniPlayBtn = document.getElementById("mini-play-btn");
          const fullPlayBtn = document.getElementById("play-btn");
          if (miniPlayBtn) {
            const icon = miniPlayBtn.querySelector("ion-icon");
            if (icon) icon.name = "play";
          }
          if (fullPlayBtn) {
            const icon = fullPlayBtn.querySelector("ion-icon");
            if (icon) icon.name = "play";
          }
        };
        if (audio.readyState >= 1) {
          restoreTime();
        } else {
          const metadataHandler = () => {
            restoreTime();
          };
          audio.addEventListener("loadedmetadata", metadataHandler, { once: true });
          audio.addEventListener("canplay", metadataHandler, { once: true });
          audio.load();
        }
      }
    } else if (state.audioSrc) {
      console.log("Restoring from audioSrc (no autoplay):", state.audioSrc);
      audio.src = state.audioSrc;
      if (state.currentTime > 0) {
        audio.currentTime = state.currentTime;
      }
    } else if (state.tracks && state.tracks.length > 0 && state.currentIndex >= 0) {
      const track = state.tracks[state.currentIndex];
      if (track) {
        console.log("Restoring track by index (no autoplay):", track.title, "index:", state.currentIndex);
        const audioSrc = navTrackAudioUrl(track);
        audio.src = audioSrc;
        if (state.currentTime > 0) {
          audio.currentTime = state.currentTime;
        }
        const miniPlayer = document.getElementById("mini-player");
        if (miniPlayer) {
          miniPlayer.classList.remove("hidden");
        }
        updatePlayerElements(track);
      }
    }
    if (state.trackId && state.tracks && state.tracks.length > 0) {
      const track = state.tracks.find((t) => t.id === state.trackId) || (state.currentIndex >= 0 ? state.tracks[state.currentIndex] : null);
      if (track) {
        updatePlayerElements(track);
      }
    }
  }
  function initPageScripts() {
    const links = document.querySelectorAll("a");
    links.forEach((link) => {
    });
    if (!document.getElementById("audio-element")) {
      const audio = document.createElement("audio");
      audio.id = "audio-element";
      audio.playsinline = true;
      audio.preload = "metadata";
      audio.style.display = "none";
      audio.addEventListener("error", () => navRefreshAudioSrc(audio));
      document.body.appendChild(audio);
      console.log("Audio element created");
    }
    if (window.location.pathname === "/app" || window.location.pathname.startsWith("/app")) {
      console.log("SPA navigation to /app detected");
      if (window.currentUser && window.currentUser.id) {
        console.log("User already authenticated, loading app data directly");
        const authScreen = document.getElementById("auth-screen");
        const mainApp = document.getElementById("main-app");
        if (authScreen) authScreen.style.display = "none";
        if (mainApp) mainApp.style.display = "flex";
        if (typeof window.loadMyTracks === "function") {
          window.loadMyTracks().then(() => {
            console.log("Tracks loaded after SPA navigation");
          });
        }
        if (typeof window.loadMyAlbums === "function") {
          window.loadMyAlbums().then(() => {
            console.log("Albums loaded after SPA navigation");
          });
        }
        if (typeof window.renderProfile === "function") {
          window.renderProfile();
        }
      } else {
        if (typeof window.initApp === "function") {
          console.log("Initializing app after SPA navigation to /app");
          window.initApp().catch((err) => {
            console.error("Error initializing app:", err);
          });
        }
      }
    }
    if (window.location.pathname === "/" || window.location.pathname === "") {
      const trackItems = document.querySelectorAll(".track-item[data-track-index]");
      trackItems.forEach((item) => {
        const trackIndex = item.dataset.trackIndex;
        const trackId = item.dataset.trackId;
        item.onclick = function(e) {
          e.stopPropagation();
          const idx = parseInt(trackIndex);
          if (!isNaN(idx) && window.tracks && window.tracks[idx]) {
            playTrackFromList(idx);
          }
        };
        const playBtn = item.querySelector(".btn-play-track");
        if (playBtn) {
          playBtn.onclick = function(e) {
            e.stopPropagation();
            const idx = parseInt(trackIndex);
            if (!isNaN(idx) && window.tracks && window.tracks[idx]) {
              playTrackFromList(idx);
            }
          };
        }
      });
      window.playTrackFromList = function(index) {
        const idx = typeof index === "string" ? parseInt(index) : typeof index === "number" ? index : -1;
        console.log("playTrackFromList called with index:", idx, "tracks length:", window.tracks ? window.tracks.length : 0);
        if (!window.tracks || !Array.isArray(window.tracks) || window.tracks.length === 0) {
          console.error("Tracks not loaded");
          return;
        }
        if (idx < 0 || idx >= window.tracks.length) {
          console.error("Invalid track index:", idx, "tracks length:", window.tracks.length);
          return;
        }
        if (typeof window.setTracks === "function") {
          window.setTracks(window.tracks);
        }
        setTimeout(() => {
          if (typeof window.playTrack === "function") {
            console.log("Calling playTrack with index:", idx, "track:", window.tracks[idx]?.title);
            window.playTrack(idx, true);
          } else {
            console.error("playTrack function not available");
            const track = window.tracks[idx];
            if (track) {
              if (window.navigateToPage) {
                window.navigateToPage("/track/" + (track.slug || track.id));
              } else {
                window.location.href = "/track/" + (track.slug || track.id);
              }
            }
          }
        }, 100);
      };
      console.log("playTrackFromList reinitialized, track items:", trackItems.length);
    }
    if (window.location.pathname.startsWith("/album/")) {
      if (typeof window.playTrackFromAlbum !== "function") {
        console.warn("playTrackFromAlbum not found, trying to reinitialize");
      }
    }
    const likeButtons = document.querySelectorAll(".track-like-btn, .album-like-btn, #mini-like-btn, #player-like-btn");
    likeButtons.forEach((btn) => {
      const trackId = btn.dataset.trackId;
      const albumId = btn.dataset.albumId;
      if (trackId) {
        btn.onclick = (e) => {
          e.stopPropagation();
          if (typeof window.toggleTrackLike === "function") {
            window.toggleTrackLike(parseInt(trackId));
          }
        };
      } else if (albumId) {
        btn.onclick = (e) => {
          e.stopPropagation();
          if (typeof window.toggleAlbumLike === "function") {
            window.toggleAlbumLike(parseInt(albumId));
          }
        };
      } else if (btn.id === "mini-like-btn" || btn.id === "player-like-btn") {
        btn.onclick = (e) => {
          e.stopPropagation();
          if (typeof window.toggleCurrentTrackLike === "function") {
            window.toggleCurrentTrackLike();
          }
        };
      }
    });
    if (window.location.pathname.startsWith("/album/")) {
      const trackItems = document.querySelectorAll(".track-item[data-track-id]");
      trackItems.forEach((item) => {
        const trackId = parseInt(item.dataset.trackId);
        const tracksData = item.dataset.tracks;
        if (trackId && tracksData) {
          item.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              const tracksList = JSON.parse(tracksData);
              if (typeof window.playTrackFromAlbum === "function") {
                window.playTrackFromAlbum(trackId, tracksList);
              } else {
                const index = tracksList.findIndex((t) => t.id === trackId);
                if (index !== -1 && typeof window.playTrack === "function") {
                  window.tracks = tracksList;
                  window.currentIndex = index;
                  window.playTrack(index, true);
                }
              }
            } catch (err) {
              console.error("Error parsing tracks data:", err);
            }
          };
        }
      });
      if (window.playerState && window.playerState.isPlaying) {
        console.log("Player is playing, keeping current tracks");
        return;
      }
      const albumId = window.location.pathname.split("/album/")[1];
      if (albumId) {
        setTimeout(() => {
          if (typeof window.setTracks === "function" && window.tracks && window.tracks.length > 0) {
            window.setTracks(window.tracks);
          }
        }, 200);
      }
    }
    if (typeof window.initPage === "function") {
      window.initPage();
    }
  }
  function updateBackButtons() {
    const backButtons = document.querySelectorAll(".back-btn");
    backButtons.forEach((btn) => {
      btn.style.display = "flex";
      btn.onclick = null;
      if (history.length > 1) {
        btn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log("Back button clicked, history length:", history.length);
          window.history.back();
        };
      } else {
        btn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log("Back button clicked, no history, navigating to home");
          navigateTo("/");
        };
      }
    });
  }
  function updatePlayerElements(track) {
    if (!track) return;
    const miniCover = document.getElementById("mini-cover");
    const miniTitle = document.getElementById("mini-title");
    const miniArtist = document.getElementById("mini-artist");
    const miniPlayer = document.getElementById("mini-player");
    if (miniCover && navTrackCoverUrl(track)) {
      miniCover.src = navTrackCoverUrl(track);
    }
    if (miniTitle) miniTitle.textContent = track.title || "Not Playing";
    if (miniArtist) miniArtist.textContent = track.artist || "";
    if (miniPlayer && !miniPlayer.classList.contains("hidden")) {
      miniPlayer.classList.remove("hidden");
    }
    const fullCover = document.getElementById("full-cover");
    const fullTitle = document.getElementById("full-title");
    const fullArtist = document.getElementById("full-artist");
    const playerBg = document.getElementById("player-bg");
    if (fullCover && navTrackCoverUrl(track)) {
      fullCover.src = navTrackCoverUrl(track);
    }
    if (fullTitle) fullTitle.textContent = track.title || "Title";
    if (fullArtist) fullArtist.textContent = track.artist || "Artist";
    if (playerBg && navTrackCoverUrl(track)) {
      playerBg.style.backgroundImage = `url(${navTrackCoverUrl(track)})`;
    }
  }
  function showLoadingIndicator() {
    document.body.style.opacity = "0.95";
  }
  function hideLoadingIndicator() {
    document.body.style.opacity = "1";
  }
  function getHistoryLength() {
    return history.length;
  }
  window.SPANavigation = {
    navigate: navigateTo,
    init: initSPANavigation,
    goBack: () => window.history.back(),
    savePlayerState,
    restorePlayerState,
    getHistoryLength
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(initSPANavigation, 100);
    });
  } else {
    setTimeout(initSPANavigation, 100);
  }
  window.savePlayerStateForSPA = savePlayerState;
  window.restorePlayerStateForSPA = restorePlayerState;
})();
