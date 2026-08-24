window.currentUser = null;
let myTracks = [];
let myAlbums = [];
let currentPage = "library";
function getMyTracks() {
  return window.myTracks && Array.isArray(window.myTracks) ? window.myTracks : myTracks;
}
function getMyAlbums() {
  return window.myAlbums && Array.isArray(window.myAlbums) ? window.myAlbums : myAlbums;
}
window.isTelegram = false;
window.tgWebApp = null;
if (window.Telegram && window.Telegram.WebApp) {
  const tg = window.Telegram.WebApp;
  if (tg.platform || tg.initData || tg.initDataUnsafe) {
    window.isTelegram = true;
    window.tgWebApp = tg;
  }
}
const isTelegram = window.isTelegram;
const tgWebApp = window.tgWebApp;
if (isTelegram && tgWebApp) {
  document.documentElement.classList.add("tg-view");
  tgWebApp.ready();
  tgWebApp.expand();
  tgWebApp.onEvent("ready", () => {
    console.log("\u2705 Telegram WebApp ready event fired");
  });
  if (tgWebApp.version) {
    const version = tgWebApp.version.split(".").map(Number);
    if (version[0] > 6 || version[0] === 6 && version[1] >= 1) {
      try {
        tgWebApp.setHeaderColor("#000000");
        tgWebApp.setBackgroundColor("#000000");
      } catch (e) {
      }
    }
  }
}
function getInitData() {
  let initData = "";
  if (tgWebApp && tgWebApp.initData) {
    initData = tgWebApp.initData;
    if (initData && initData.trim() !== "") {
      console.log("\u2705 Got initData from tgWebApp.initData, length:", initData.length);
      return initData;
    }
  }
  const urlParams = new URLSearchParams(window.location.search);
  const initDataParam = urlParams.get("tgWebAppData");
  if (initDataParam) {
    initData = initDataParam;
    console.log("\u2705 Got initData from URL params, length:", initData.length);
    return initData;
  }
  if (typeof INIT_DATA_FROM_URL !== "undefined" && INIT_DATA_FROM_URL) {
    initData = INIT_DATA_FROM_URL;
    console.log("\u2705 Got initData from template variable, length:", initData.length);
    return initData;
  }
  if (window.location.hash) {
    const hash = window.location.hash.substring(1);
    const hashParams = new URLSearchParams(hash);
    const hashInitData = hashParams.get("tgWebAppData");
    if (hashInitData) {
      initData = decodeURIComponent(hashInitData);
      console.log("\u2705 Got initData from URL hash, length:", initData.length);
      return initData;
    }
    const hashParts = hash.split("&");
    const initDataParts = [];
    let foundHash = false;
    for (const part of hashParts) {
      if (part.includes("user=") || part.includes("query_id=") || part.includes("auth_date=") || part.includes("hash=")) {
        if (!part.startsWith("tgWebApp") && !part.startsWith("tgWebAppVersion") && !part.startsWith("tgWebAppPlatform") && !part.startsWith("tgWebAppThemeParams")) {
          initDataParts.push(part);
          if (part.includes("hash=")) {
            foundHash = true;
          }
        }
      }
    }
    if (initDataParts.length > 0 && foundHash) {
      initData = initDataParts.join("&");
      console.log("\u2705 Got initData from URL hash (parsed), length:", initData.length);
      return initData;
    }
  }
  if (tgWebApp && tgWebApp.initDataUnsafe && typeof tgWebApp.initDataUnsafe === "object") {
    const unsafe = tgWebApp.initDataUnsafe;
    if (unsafe.user && unsafe.hash) {
      const parts = [];
      if (unsafe.query_id) parts.push(`query_id=${unsafe.query_id}`);
      if (unsafe.user) parts.push(`user=${encodeURIComponent(JSON.stringify(unsafe.user))}`);
      if (unsafe.auth_date) parts.push(`auth_date=${unsafe.auth_date}`);
      if (unsafe.hash) parts.push(`hash=${unsafe.hash}`);
      if (parts.length > 0) {
        initData = parts.join("&");
        console.log("\u2705 Got initData from initDataUnsafe (converted), length:", initData.length);
        return initData;
      }
    }
  }
  return "";
}
async function performAuth(initData) {
  const authScreen = document.getElementById("auth-screen");
  const mainApp = document.getElementById("main-app");
  const authLoading = document.getElementById("auth-loading");
  const authError = document.getElementById("auth-error");
  try {
    console.log("Attempting auth with initData length:", initData.length);
    console.log("initData preview:", initData.substring(0, 100) + "...");
    const res = await fetch("/api/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData })
    });
    console.log("Auth response status:", res.status);
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMsg = errorData.error || `HTTP ${res.status}`;
      console.error("Auth failed:", errorMsg);
      throw new Error(errorMsg);
    }
    const data = await res.json();
    console.log("Auth response data:", data);
    if (data.success && data.user) {
      window.currentUser = data.user;
      console.log("User authenticated:", window.currentUser);
      authScreen.style.display = "none";
      mainApp.style.display = "flex";
      console.log("Loading user data...");
      await loadUserData();
      console.log("User data loaded");
      if (window.currentUser.nickname) {
        const shareBtn = document.getElementById("share-btn");
        if (shareBtn) shareBtn.style.display = "block";
      }
    } else {
      const errorMsg = data.error || "Invalid response";
      console.error("Auth failed:", errorMsg);
      throw new Error(errorMsg);
    }
  } catch (e) {
    console.error("Auth error:", e);
    authLoading.style.display = "none";
    authError.style.display = "block";
    document.getElementById("auth-error-text").textContent = `\u041E\u0448\u0438\u0431\u043A\u0430 \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u0438: ${e.message || "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430"}. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435.`;
  }
}
async function initAuth() {
  console.log("initAuth called");
  const authScreen = document.getElementById("auth-screen");
  const mainApp = document.getElementById("main-app");
  const authLoading = document.getElementById("auth-loading");
  const authError = document.getElementById("auth-error");
  if (!authScreen || !mainApp || !authLoading || !authError) {
    console.error("Auth elements not found");
    return;
  }
  if (!isTelegram || !tgWebApp) {
    console.log("Not in Telegram WebApp, showing error immediately");
    authLoading.style.display = "none";
    authError.style.display = "block";
    document.getElementById("auth-error-text").textContent = "\u041F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0435\u0440\u0435\u0437 Telegram. \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0435\u0433\u043E \u0447\u0435\u0440\u0435\u0437 \u0431\u043E\u0442\u0430 @swagplayerobot";
    return;
  }
  if (!tgWebApp.platform) {
    console.log("No platform detected, not a real Telegram WebApp");
    authLoading.style.display = "none";
    authError.style.display = "block";
    document.getElementById("auth-error-text").textContent = "\u041F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0435\u0440\u0435\u0437 Telegram. \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0435\u0433\u043E \u0447\u0435\u0440\u0435\u0437 \u0431\u043E\u0442\u0430 @swagplayerobot";
    return;
  }
  let authTimeout = setTimeout(() => {
    authLoading.style.display = "none";
    authError.style.display = "block";
    document.getElementById("auth-error-text").textContent = "\u0422\u0430\u0439\u043C\u0430\u0443\u0442 \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u0438. \u0423\u0431\u0435\u0434\u0438\u0442\u0435\u0441\u044C, \u0447\u0442\u043E \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0435 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0447\u0435\u0440\u0435\u0437 \u0431\u043E\u0442\u0430 @swagplayerobot";
  }, 3e3);
  try {
    let initData = getInitData();
    if (!initData || initData.trim() === "") {
      console.log("initData not available immediately, waiting for ready event...");
      const readyPromise = new Promise((resolve) => {
        if (tgWebApp.isReady) {
          console.log("tgWebApp already ready");
          resolve();
        } else {
          console.log("Waiting for ready event...");
          const readyHandler = () => {
            console.log("\u2705 Telegram WebApp ready event received");
            resolve();
          };
          tgWebApp.onEvent("ready", readyHandler);
          setTimeout(() => {
            console.log("Ready event timeout, proceeding anyway");
            resolve();
          }, 2500);
        }
      });
      await readyPromise;
      initData = getInitData();
    }
    clearTimeout(authTimeout);
    authTimeout = null;
    if (!initData || initData.trim() === "") {
      console.error("\u274C No initData available");
      console.error("tgWebApp:", tgWebApp);
      console.error("tgWebApp.platform:", tgWebApp?.platform);
      console.error("tgWebApp.initData:", tgWebApp?.initData);
      console.error("tgWebApp.initDataUnsafe:", tgWebApp?.initDataUnsafe);
      console.error("URL:", window.location.href);
      const botUrl = "https://tg.swag.best/swagplayerobot?start=auth";
    const botUrlTme = "https://t.me/swagplayerobot?start=auth";
      if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.openTelegramLink(botUrlTme);
      } else {
        window.location.href = botUrl;
      }
      throw new Error("No initData from Telegram. \u0423\u0431\u0435\u0434\u0438\u0442\u0435\u0441\u044C, \u0447\u0442\u043E \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0435 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0447\u0435\u0440\u0435\u0437 \u0431\u043E\u0442\u0430 @swagplayerobot");
    }
    await performAuth(initData);
  } catch (e) {
    if (authTimeout) {
      clearTimeout(authTimeout);
    }
    console.error("Auth error:", e);
    authLoading.style.display = "none";
    authError.style.display = "block";
    document.getElementById("auth-error-text").textContent = `\u041E\u0448\u0438\u0431\u043A\u0430 \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u0438: ${e.message || "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430"}. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435.`;
  }
}
function retryAuth() {
  document.getElementById("auth-loading").style.display = "block";
  document.getElementById("auth-error").style.display = "none";
  initAuth();
}
async function loadUserData() {
  console.log("loadUserData called, currentUser:", window.currentUser);
  if (!window.currentUser) {
    console.warn("loadUserData: No currentUser, skipping");
    return;
  }
  await Promise.all([
    loadMyTracks(),
    loadMyAlbums()
  ]);
  renderProfile();
  console.log("loadUserData completed");
}
async function loadMyTracks() {
  try {
    if (!window.currentUser || !window.currentUser.id) {
      console.warn("Cannot load tracks: user not authenticated");
      return;
    }
    const timestamp = Date.now();
    const res = await fetch(`/api/tracks?user_id=${window.currentUser.id}&show_hidden=true&_t=${timestamp}`, {
      cache: "no-cache",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache"
      }
    });
    if (res.ok) {
      const tracks = await res.json();
      myTracks = tracks;
      window.myTracks = tracks;
      renderMyTracks();
      updateStats();
    }
  } catch (e) {
    console.error("Error loading tracks:", e);
  }
}
async function loadMyAlbums() {
  try {
    if (!window.currentUser || !window.currentUser.id) {
      console.warn("Cannot load albums: user not authenticated");
      return;
    }
    const timestamp = Date.now();
    const res = await fetch(`/api/albums?user_id=${window.currentUser.id}&show_hidden=true&_t=${timestamp}`, {
      cache: "no-cache",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache"
      }
    });
    if (res.ok) {
      const albums = await res.json();
      myAlbums = albums;
      window.myAlbums = albums;
      renderMyAlbums();
      updateStats();
    }
  } catch (e) {
    console.error("Error loading albums:", e);
  }
}
async function loadProfile() {
  console.log("loadProfile called");
  try {
    const res = await fetch("/api/user/profile");
    console.log("Profile API response status:", res.status);
    if (res.ok) {
      const userData = await res.json();
      console.log("Profile data received:", userData);
      window.currentUser = userData;
      return userData;
    } else {
      console.log("Profile API returned error, trying Telegram data");
      if (tgWebApp && tgWebApp.initDataUnsafe && tgWebApp.initDataUnsafe.user) {
        const tgUser = tgWebApp.initDataUnsafe.user;
        window.currentUser = {
          first_name: tgUser.first_name || "",
          last_name: tgUser.last_name || "",
          username: tgUser.username || "",
          display_name: `${tgUser.first_name || ""} ${tgUser.last_name || ""}`.trim(),
          avatar_url: tgUser.photo_url || "",
          nickname: tgUser.username || ""
        };
        console.log("Created currentUser from Telegram in loadProfile");
        return window.currentUser;
      } else {
        console.log("No Telegram data available");
        return null;
      }
    }
  } catch (e) {
    console.error("Error loading profile:", e);
    if (tgWebApp && tgWebApp.initDataUnsafe && tgWebApp.initDataUnsafe.user) {
      const tgUser = tgWebApp.initDataUnsafe.user;
      window.currentUser = {
        first_name: tgUser.first_name || "",
        last_name: tgUser.last_name || "",
        username: tgUser.username || "",
        display_name: `${tgUser.first_name || ""} ${tgUser.last_name || ""}`.trim(),
        avatar_url: tgUser.photo_url || "",
        nickname: tgUser.username || ""
      };
      console.log("Created currentUser from Telegram in catch block");
      return window.currentUser;
    }
    return null;
  }
}
window.renderMyTracks = function renderMyTracks2() {
  const container = document.getElementById("my-tracks-list");
  const emptyState = document.getElementById("empty-tracks");
  const tracksToRender = window.myTracks && Array.isArray(window.myTracks) ? window.myTracks : myTracks;
  if (tracksToRender.length === 0) {
    container.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";
  container.innerHTML = tracksToRender.map((track) => `
        <div class="track-card ${track.hidden ? "track-hidden" : ""}" id="track-card-${track.id}">
            <input type="checkbox" class="bulk-check" data-track-id="${track.id}"
                   onclick="event.stopPropagation(); bulkTrackToggled(${track.id}, this.checked)">
            <img src="${track.cover_url || ""}" 
                 class="track-card-cover" 
                 loading="lazy" decoding="async"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div style="display:none; width:100%; aspect-ratio:1/1; background:#333; align-items:center; justify-content:center;">
                <ion-icon name="musical-notes" style="font-size:32px; color:#666;"></ion-icon>
            </div>
            <div class="track-card-info">
                <div class="track-card-title">${track.title}</div>
                <div class="track-card-artist">${track.artist}</div>
                <div style="display: flex; gap: 12px; margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.5);">
                    <span><ion-icon name="play" style="font-size: 12px; vertical-align: middle;"></ion-icon> ${track.plays_count || 0}</span>
                    <span class="track-like-btn ${track.is_liked ? "liked" : ""}" data-track-id="${track.id}" onclick="event.stopPropagation(); toggleTrackLike(${track.id})" style="cursor: pointer; display: flex; align-items: center; gap: 4px; transition: color 0.2s;" onmouseover="if(!this.classList.contains('liked')) this.style.color='#fa2d48'" onmouseout="if(!this.classList.contains('liked')) this.style.color='rgba(255,255,255,0.5)'">
                        <ion-icon name="${track.is_liked ? "heart" : "heart-outline"}" style="font-size: 12px; vertical-align: middle;"></ion-icon> 
                        <span class="track-likes-count">${track.likes_count || 0}</span>
                    </span>
                </div>
            </div>
            <div class="track-card-actions">
                <div class="track-move-btns" title="\u041F\u043E\u0440\u044F\u0434\u043E\u043A \u043D\u0430 \u0433\u043B\u0430\u0432\u043D\u043E\u0439">
                    <button onclick="event.stopPropagation(); moveTrack(${track.id}, 'up')" title="\u0412\u044B\u0448\u0435">
                        <ion-icon name="chevron-up"></ion-icon>
                    </button>
                    <button onclick="event.stopPropagation(); moveTrack(${track.id}, 'down')" title="\u041D\u0438\u0436\u0435">
                        <ion-icon name="chevron-down"></ion-icon>
                    </button>
                </div>
                <button onclick="playMyTrack(${track.id})" title="\u0412\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0441\u0442\u0438">
                    <ion-icon name="play"></ion-icon>
                </button>
                <button onclick="editTrack(${track.id})" title="\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C">
                    <ion-icon name="create"></ion-icon>
                </button>
                <button onclick="showAddToAlbum(${track.id})" title="\u0412 \u0430\u043B\u044C\u0431\u043E\u043C">
                    <ion-icon name="albums"></ion-icon>
                </button>
                <button onclick="shareTrack(${track.id}, '${track.slug || track.id}')" title="\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F">
                    <ion-icon name="share"></ion-icon>
                </button>
            </div>
        </div>
    `).join("");
};
window.renderMyAlbums = function renderMyAlbums2() {
  const container = document.getElementById("my-albums-list");
  const emptyState = document.getElementById("empty-albums");
  const albumsToRender = window.myAlbums && Array.isArray(window.myAlbums) ? window.myAlbums : myAlbums;
  if (albumsToRender.length === 0) {
    container.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";
  container.innerHTML = albumsToRender.map((album) => `
        <div class="album-card">
            <div onclick="viewAlbum(${album.id})" style="cursor:pointer;">
                ${album.cover_url ? `<img src="${album.cover_url}" class="album-card-cover">` : `<div style="width:100%; aspect-ratio:1/1; background:linear-gradient(135deg, #333 0%, #1c1c1e 100%); display:flex; align-items:center; justify-content:center; border-radius:8px; margin-bottom:12px;">
                        <ion-icon name="albums" style="font-size:48px; color:#666;"></ion-icon>
                    </div>`}
                <div class="album-card-info">
                    <div class="album-card-title">${album.title}</div>
                    ${album.description ? `<div class="album-card-description">${album.description}</div>` : ""}
                    <div style="display: flex; gap: 12px; margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.5);">
                        <span><ion-icon name="play" style="font-size: 12px; vertical-align: middle;"></ion-icon> ${album.plays_count || 0}</span>
                        <span class="album-like-btn ${album.is_liked ? "liked" : ""}" data-album-id="${album.id}" onclick="event.stopPropagation(); toggleAlbumLike(${album.id})" style="cursor: pointer; display: flex; align-items: center; gap: 4px; transition: color 0.2s;" onmouseover="if(!this.classList.contains('liked')) this.style.color='#fa2d48'" onmouseout="if(!this.classList.contains('liked')) this.style.color='rgba(255,255,255,0.5)'">
                            <ion-icon name="${album.is_liked ? "heart" : "heart-outline"}" style="font-size: 12px; vertical-align: middle;"></ion-icon> 
                            <span class="album-likes-count">${album.likes_count || 0}</span>
                        </span>
                    </div>
                </div>
            </div>
            <div class="album-card-actions" style="padding:8px; border-top:1px solid rgba(255,255,255,0.1); display:flex; gap:5px;">
                <button onclick="editAlbum(${album.id})" title="\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C" style="flex:1; background:rgba(255,255,255,0.1); border:none; color:white; padding:8px; border-radius:6px; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px;">
                    <ion-icon name="create"></ion-icon>
                </button>
                <button onclick="manageAlbumTracks(${album.id})" title="\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0442\u0440\u0435\u043A\u0430\u043C\u0438" style="flex:1; background:rgba(255,255,255,0.1); border:none; color:white; padding:8px; border-radius:6px; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px;">
                    <ion-icon name="musical-notes"></ion-icon>
                </button>
                <button onclick="toggleAlbumVisibility(${album.id})" title="${album.hidden ? "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C" : "\u0421\u043A\u0440\u044B\u0442\u044C"}" style="flex:1; background:${album.hidden ? "rgba(250,45,72,0.25)" : "rgba(255,255,255,0.1)"}; border:none; color:white; padding:8px; border-radius:6px; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px;">
                    <ion-icon name="${album.hidden ? "eye" : "eye-off"}"></ion-icon>
                </button>
            </div>
            ${album.hidden ? `<div style="text-align:center; padding:6px; background:rgba(250,45,72,0.15); color:#ff8091; font-size:11px; border-radius:0 0 8px 8px;">\u0421\u043A\u0440\u044B\u0442 \u043E\u0442 \u043F\u0443\u0431\u043B\u0438\u043A\u0438</div>` : ""}
        </div>
    `).join("");
};
const bulkSelected = new Set();
function bulkToolbarRefresh() {
  const toolbar = document.getElementById("bulk-toolbar");
  if (!toolbar) return;
  toolbar.style.display = "flex";
  const countEl = document.getElementById("bulk-count");
  if (countEl) countEl.textContent = `\u0412\u044B\u0431\u0440\u0430\u043D\u043E: ${bulkSelected.size}`;
}
function bulkTrackToggled(trackId, checked) {
  if (checked) bulkSelected.add(trackId);
  else bulkSelected.delete(trackId);
  const card = document.getElementById(`track-card-${trackId}`);
  if (card) card.classList.toggle("bulk-selected", checked);
  bulkToolbarRefresh();
}
function bulkToggleAll(checked) {
  document.querySelectorAll("#my-tracks-list .bulk-check").forEach((cb) => {
    cb.checked = checked;
    const id = parseInt(cb.dataset.trackId, 10);
    if (checked) bulkSelected.add(id);
    else bulkSelected.delete(id);
    const card = document.getElementById(`track-card-${id}`);
    if (card) card.classList.toggle("bulk-selected", checked);
  });
  bulkToolbarRefresh();
}
function bulkSelectedIds() {
  return Array.from(bulkSelected);
}
async function bulkRequest(formData) {
  const res = await fetch("/api/tracks/bulk", {
    method: "POST",
    credentials: "same-origin",
    body: formData
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    alert(data.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043C\u0430\u0441\u0441\u043E\u0432\u043E\u0433\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F");
    return null;
  }
  return data;
}
function bulkFormData(action, extra) {
  const fd = new FormData();
  fd.append("action", action);
  bulkSelectedIds().forEach((id) => fd.append("track_ids[]", id));
  if (extra) Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
  return fd;
}
function bulkClearSelection() {
  bulkSelected.clear();
  const all = document.getElementById("bulk-select-all");
  if (all) all.checked = false;
  document.querySelectorAll("#my-tracks-list .bulk-check").forEach((cb) => {
    cb.checked = false;
  });
  document.querySelectorAll("#my-tracks-list .track-card.bulk-selected").forEach((c) => c.classList.remove("bulk-selected"));
  bulkToolbarRefresh();
}
function bulkSetCover() {
  if (!bulkSelected.size) {
    alert("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0440\u0435\u043A\u0438");
    return;
  }
  document.getElementById("bulk-cover-input").click();
}
async function bulkCoverPicked(input) {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  if (!confirm(`\u041F\u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u043E\u0434\u043D\u0443 \u043E\u0431\u043B\u043E\u0436\u043A\u0443 \u043D\u0430 ${bulkSelected.size} \u0442\u0440\u0435\u043A(\u043E\u0432)?`)) return;
  const fd = bulkFormData("cover");
  fd.append("cover", file);
  const data = await bulkRequest(fd);
  if (data) {
    alert(`\u041E\u0431\u043B\u043E\u0436\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0430 \u0443 ${data.updated} \u0442\u0440\u0435\u043A(\u043E\u0432)`);
    bulkClearSelection();
    loadMyTracks();
  }
}
async function bulkSetArtist() {
  if (!bulkSelected.size) {
    alert("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0440\u0435\u043A\u0438");
    return;
  }
  const artist = prompt("\u0418\u043C\u044F \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044F \u0434\u043B\u044F \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0445 \u0442\u0440\u0435\u043A\u043E\u0432:");
  if (!artist || !artist.trim()) return;
  const data = await bulkRequest(bulkFormData("artist", { artist: artist.trim() }));
  if (data) {
    alert(`\u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D \u0443 ${data.updated} \u0442\u0440\u0435\u043A(\u043E\u0432)`);
    bulkClearSelection();
    loadMyTracks();
  }
}
async function bulkHide(hide) {
  if (!bulkSelected.size) {
    alert("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0440\u0435\u043A\u0438");
    return;
  }
  const data = await bulkRequest(bulkFormData(hide ? "hide" : "show"));
  if (data) {
    bulkClearSelection();
    loadMyTracks();
  }
}
async function bulkDelete() {
  if (!bulkSelected.size) {
    alert("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0440\u0435\u043A\u0438");
    return;
  }
  if (!confirm(`\u0423\u0434\u0430\u043B\u0438\u0442\u044C ${bulkSelected.size} \u0442\u0440\u0435\u043A(\u043E\u0432)? \u042D\u0442\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043D\u0435\u043E\u0431\u0440\u0430\u0442\u0438\u043C\u043E.`)) return;
  const data = await bulkRequest(bulkFormData("delete"));
  if (data) {
    alert(`\u0423\u0434\u0430\u043B\u0435\u043D\u043E ${data.deleted} \u0442\u0440\u0435\u043A(\u043E\u0432)`);
    bulkClearSelection();
    loadMyTracks();
  }
}
window.bulkTrackToggled = bulkTrackToggled;
window.bulkToggleAll = bulkToggleAll;
window.bulkSetCover = bulkSetCover;
window.bulkCoverPicked = bulkCoverPicked;
window.bulkSetArtist = bulkSetArtist;

let coverPickerMode = "track";
async function loadCoverLibrary() {
  const res = await fetch("/api/covers/library", { credentials: "same-origin" });
  if (!res.ok) {
    alert("\u041D\u0435\u0442 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u0445 \u043E\u0431\u043B\u043E\u0436\u0435\u043A");
    return [];
  }
  return await res.json();
}
function openCoverPicker(mode) {
  coverPickerMode = mode || "track";
  const grid = document.getElementById("cover-picker-grid");
  grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:rgba(255,255,255,0.5); padding:20px;">\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...</div>';
  document.getElementById("modal-cover-picker").classList.add("active");
  loadCoverLibrary().then((covers) => {
    if (!covers.length) {
      grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:rgba(255,255,255,0.5); padding:20px;">\u0417\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u0445 \u043E\u0431\u043B\u043E\u0436\u0435\u043A \u043D\u0435\u0442</div>';
      return;
    }
    grid.innerHTML = covers.map((c) => `
      <div style="cursor:pointer; border:2px solid rgba(255,255,255,0.1); border-radius:8px; overflow:hidden; position:relative;"
           onclick="applyCoverFromLibrary('${c.key}', this)">
        <img src="${c.url}" style="width:100%; aspect-ratio:1/1; object-fit:cover; display:block;">
        <div style="position:absolute; bottom:0; left:0; right:0; background:rgba(0,0,0,0.6); color:white; font-size:11px; padding:3px 6px; text-align:center;">
            ${c.used_by} \u0442\u0440\u0435\u043A(\u0430)
        </div>
      </div>`).join("");
  });
}
function closeCoverPicker() {
  document.getElementById("modal-cover-picker").classList.remove("active");
}
async function applyCoverFromLibrary(key, el) {
  document.querySelectorAll("#cover-picker-grid > div").forEach((d) => d.style.borderColor = "rgba(255,255,255,0.1)");
  el.style.borderColor = "#00ff9d";
  if (coverPickerMode === "bulk") {
    const fd = bulkFormData("cover_existing", { cover_key: key });
    const data = await bulkRequest(fd);
    if (data) {
      alert(`\u041E\u0431\u043B\u043E\u0436\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0430 \u0443 ${data.updated} \u0442\u0440\u0435\u043A(\u043E\u0432)`);
      closeCoverPicker();
      bulkClearSelection();
      loadMyTracks();
    }
  } else {
    document.getElementById("edit-track-cover-key").value = key;
    const img = new Image();
    img.onload = () => {
      const pv = document.getElementById("edit-track-cover-preview");
      if (pv) pv.innerHTML = `<img src="${img.src}" alt="Cover" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
    };
    img.src = `/api/cover/${key}?v=${Date.now()}`;
    closeCoverPicker();
  }
}
function bulkSetCoverExisting() {
  if (!bulkSelected.size) {
    alert("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0440\u0435\u043A\u0438");
    return;
  }
  openCoverPicker("bulk");
}
window.openCoverPicker = openCoverPicker;
window.closeCoverPicker = closeCoverPicker;
window.applyCoverFromLibrary = applyCoverFromLibrary;
window.bulkSetCoverExisting = bulkSetCoverExisting;
window.bulkHide = bulkHide;
window.bulkDelete = bulkDelete;
function renderProfile() {
  console.log("renderProfile called, currentUser:", window.currentUser);
  if (!window.currentUser) {
    if (tgWebApp && tgWebApp.initDataUnsafe && tgWebApp.initDataUnsafe.user) {
      const tgUser = tgWebApp.initDataUnsafe.user;
      window.currentUser = {
        first_name: tgUser.first_name || "",
        last_name: tgUser.last_name || "",
        username: tgUser.username || "",
        display_name: `${tgUser.first_name || ""} ${tgUser.last_name || ""}`.trim() || tgUser.first_name || "",
        avatar_url: tgUser.photo_url || "",
        nickname: tgUser.username || ""
      };
      console.log("Created currentUser from Telegram in renderProfile");
    } else {
      console.log("No user data available");
      return;
    }
  }
  const profileNameEl = document.getElementById("profile-name");
  const profileNicknameEl = document.getElementById("profile-nickname");
  const profileDisplayNameInput = document.getElementById("profile-display-name");
  const profileNicknameInputEl = document.getElementById("profile-nickname-input");
  const profileSlugPreview = document.getElementById("profile-slug-preview");
  const profileLinkInput = document.getElementById("profile-link-input");
  const avatarImg = document.getElementById("avatar-img");
  const avatarPlaceholder = document.querySelector(".avatar-placeholder");
  if (profileNameEl) {
    profileNameEl.textContent = window.currentUser.display_name || window.currentUser.first_name || "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C";
  }
  if (profileNicknameEl) {
    if (window.currentUser.nickname) {
      profileNicknameEl.textContent = `@${window.currentUser.nickname}`;
      profileNicknameEl.style.display = "block";
    } else {
      profileNicknameEl.style.display = "none";
    }
  }
  if (profileDisplayNameInput) {
    profileDisplayNameInput.value = window.currentUser.display_name || window.currentUser.first_name || "";
  }
  if (profileNicknameInputEl) {
    const nickname = sanitizeNicknameValue(window.currentUser.nickname || window.currentUser.username || "");
    profileNicknameInputEl.value = nickname;
    if (profileSlugPreview) {
      profileSlugPreview.textContent = nickname || "...";
    }
    if (profileLinkInput) {
      if (nickname) {
        profileLinkInput.value = `${window.location.origin}/user/${nickname}`;
      } else {
        profileLinkInput.value = "";
      }
    }
  }
  if (window.currentUser.avatar_url && avatarImg) {
    avatarImg.src = window.currentUser.avatar_url;
    avatarImg.style.display = "block";
    if (avatarPlaceholder) avatarPlaceholder.style.display = "none";
  } else if (avatarImg) {
    avatarImg.style.display = "none";
    if (avatarPlaceholder) avatarPlaceholder.style.display = "flex";
  }
  const profileLibraryLinkEl = document.getElementById("profile-library-link");
  if (profileLibraryLinkEl) {
    const nickname = sanitizeNicknameValue(window.currentUser.nickname || window.currentUser.username || "");
    if (nickname) {
      profileLibraryLinkEl.href = `/user/${nickname}`;
      profileLibraryLinkEl.target = "_blank";
    }
  }
  loadProfileStats();
  console.log("Profile rendered successfully");
}
async function loadProfileStats() {
  if (!window.currentUser || !window.currentUser.id) return;
  try {
    const timestamp = Date.now();
    const tracksRes = await fetch(`/api/tracks?user_id=${window.currentUser.id}&_t=${timestamp}`, {
      cache: "no-cache",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache"
      }
    });
    const tracks = await tracksRes.json();
    const albumsRes = await fetch(`/api/albums?user_id=${window.currentUser.id}&_t=${timestamp}`, {
      cache: "no-cache",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache"
      }
    });
    const albums = await albumsRes.json();
    const totalPlays = tracks.reduce((sum, t) => sum + (t.plays_count || 0), 0) + albums.reduce((sum, a) => sum + (a.plays_count || 0), 0);
    const totalLikes = tracks.reduce((sum, t) => sum + (t.likes_count || 0), 0) + albums.reduce((sum, a) => sum + (a.likes_count || 0), 0);
    const totalPlaysEl = document.getElementById("profile-total-plays");
    const totalLikesEl = document.getElementById("profile-total-likes");
    if (totalPlaysEl) totalPlaysEl.textContent = totalPlays;
    if (totalLikesEl) totalLikesEl.textContent = totalLikes;
  } catch (e) {
    console.error("Error loading profile stats:", e);
  }
}
function updateStats() {
  const tracksCount = window.myTracks && Array.isArray(window.myTracks) ? window.myTracks.length : myTracks.length;
  const albumsCount = window.myAlbums && Array.isArray(window.myAlbums) ? window.myAlbums.length : myAlbums.length;
  const tracksCountEl = document.getElementById("tracks-count");
  const albumsCountEl = document.getElementById("albums-count");
  if (tracksCountEl) tracksCountEl.textContent = tracksCount;
  if (albumsCountEl) albumsCountEl.textContent = albumsCount;
}
async function switchPage(page) {
  console.log("switchPage called:", page);
  if ((page === "profile" || page === "upload" || page === "albums") && !window.currentUser) {
    const botUrl = "https://tg.swag.best/swagplayerobot?start=auth";
    const botUrlTme = "https://t.me/swagplayerobot?start=auth";
    if (confirm("\u0414\u043B\u044F \u0434\u043E\u0441\u0442\u0443\u043F\u0430 \u043A \u044D\u0442\u043E\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u043E\u0432\u0430\u0442\u044C\u0441\u044F.\n\n\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0431\u043E\u0442\u0430 \u0434\u043B\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u0438?")) {
      if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.openTelegramLink(botUrlTme);
      } else {
        window.location.href = botUrl;
      }
    }
    return;
  }
  currentPage = page;
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("active");
    if (item.dataset.page === page) {
      item.classList.add("active");
    }
  });
  document.querySelectorAll(".page").forEach((p) => {
    p.classList.remove("active");
  });
  document.getElementById(`page-${page}`).classList.add("active");
  const titles = {
    library: "\u041C\u043E\u044F \u0431\u0438\u0431\u043B\u0438\u043E\u0442\u0435\u043A\u0430",
    upload: "\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0442\u0440\u0435\u043A",
    albums: "\u041C\u043E\u0438 \u0430\u043B\u044C\u0431\u043E\u043C\u044B",
    profile: "\u041F\u0440\u043E\u0444\u0438\u043B\u044C"
  };
  document.getElementById("page-title").textContent = titles[page] || "SwagPlayer";
  const backBtn = document.querySelector(".app-header .back-btn") || document.getElementById("header-back-btn");
  if (backBtn) {
    const hasHistory = window.SPANavigation && window.SPANavigation.getHistoryLength && window.SPANavigation.getHistoryLength() > 1;
    const canGoBack = window.history.length > 1 || hasHistory;
    backBtn.style.display = canGoBack ? "flex" : "none";
  }
  if (page === "profile") {
    console.log("Switching to profile page, currentUser:", window.currentUser);
    if (!window.currentUser || !window.currentUser.id) {
      console.log("No currentUser, loading profile from API...");
      await loadProfile();
    }
    console.log("Rendering profile, currentUser after load:", window.currentUser);
    renderProfile();
    if (!window.myTracks || window.myTracks.length === 0) {
      loadMyTracks();
    }
    if (!window.myAlbums || window.myAlbums.length === 0) {
      loadMyAlbums();
    }
  }
  if (page === "library") {
    if (!window.myTracks || window.myTracks.length === 0) {
      await loadMyTracks();
    } else {
      renderMyTracks();
    }
  }
  if (page === "albums") {
    if (!window.myAlbums || window.myAlbums.length === 0) {
      await loadMyAlbums();
    } else {
      renderMyAlbums();
    }
  }
}
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    switchPage(item.dataset.page);
  });
});
document.addEventListener("DOMContentLoaded", () => {
  const artistInput = document.getElementById("track-artist");
  if (artistInput && window.currentUser) {
    if (!artistInput.value && window.currentUser.display_name) {
      artistInput.value = window.currentUser.display_name;
    }
  }
});
const uploadForm = document.getElementById("upload-form");
if (uploadForm) {
  uploadForm.addEventListener("submit", async (e) => {
  });
}
let bulkUploadFiles = [];
async function handleFilesSelect(input) {
  if (!input.files || input.files.length === 0) return;
  const files = Array.from(input.files).slice(0, 10);
  if (input.files.length > 10) {
    alert("\u041C\u043E\u0436\u043D\u043E \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C 10 \u0444\u0430\u0439\u043B\u043E\u0432 \u0437\u0430 \u0440\u0430\u0437. \u0411\u0443\u0434\u0443\u0442 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u044B \u043F\u0435\u0440\u0432\u044B\u0435 10.");
  }
  document.getElementById("upload-initial-state").style.display = "none";
  document.getElementById("upload-preview-container").style.display = "block";
  document.getElementById("upload-count-label").textContent = `\u0412\u044B\u0431\u0440\u0430\u043D\u043E \u0444\u0430\u0439\u043B\u043E\u0432: ${files.length}`;
  const list = document.getElementById("upload-tracks-list");
  list.innerHTML = '<div style="text-align:center; padding:20px;"><div class="spinner"></div><p>\u041E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u0444\u0430\u0439\u043B\u043E\u0432...</p></div>';
  bulkUploadFiles = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileData = {
      id: i,
      file,
      title: file.name.replace(/\.[^/.]+$/, ""),
      artist: window.currentUser && window.currentUser.display_name || "Unknown Artist",
      cover: null,
      status: "pending"
    };
    try {
      const meta = await extractMetadata(file);
      if (meta) {
        if (meta.title) fileData.title = meta.title;
        if (meta.artist) fileData.artist = meta.artist;
        if (meta.cover) fileData.cover = meta.cover;
      }
    } catch (e) {
      console.error("Error processing metadata:", e);
    }
    bulkUploadFiles.push(fileData);
  }
  renderBulkUploadList();
}
function renderBulkUploadList() {
  const list = document.getElementById("upload-tracks-list");
  if (!list) return;
  list.innerHTML = bulkUploadFiles.map((track, index) => `
        <div class="bulk-track-card" id="bulk-track-${index}" style="background: #1c1c1e; padding: 15px; border-radius: 12px; display: flex; gap: 15px; align-items: flex-start; border: 1px solid rgba(255,255,255,0.1);">
            <div style="width: 80px; height: 80px; border-radius: 8px; background: #333; overflow: hidden; flex-shrink: 0; position: relative;">
                ${track.cover ? `<img src="${track.cover}" style="width:100%; height:100%; object-fit:cover;">` : '<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center;"><ion-icon name="musical-notes" style="font-size:32px; color:#666;"></ion-icon></div>'}
                <div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.6); padding: 4px; text-align: center; cursor: pointer;" onclick="document.getElementById('cover-input-${index}').click()">
                    <ion-icon name="camera" style="font-size: 14px; color: white;"></ion-icon>
                </div>
                <input type="file" id="cover-input-${index}" accept="image/*" style="display:none" onchange="updateBulkCover(${index}, this)">
            </div>
            
            <div style="flex: 1; display: flex; flex-direction: column; gap: 10px;">
                <div class="form-row" style="display: flex; gap: 10px;">
                    <div style="flex: 1;">
                        <label style="font-size: 12px; color: rgba(255,255,255,0.5); display: block; margin-bottom: 4px;">\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435</label>
                        <input type="text" value="${escapeHtml(track.title)}" onchange="updateBulkField(${index}, 'title', this.value)" 
                               style="width: 100%; padding: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: white;">
                    </div>
                    <div style="flex: 1;">
                        <label style="font-size: 12px; color: rgba(255,255,255,0.5); display: block; margin-bottom: 4px;">\u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C</label>
                        <input type="text" value="${escapeHtml(track.artist)}" onchange="updateBulkField(${index}, 'artist', this.value)"
                               style="width: 100%; padding: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: white;">
                    </div>
                </div>
                <div style="font-size: 12px; color: rgba(255,255,255,0.4); display: flex; justify-content: space-between;">
                    <span>\u0424\u0430\u0439\u043B: ${track.file.name}</span>
                    <span class="status-text" id="status-${index}" style="color: #faa935;">\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435</span>
                </div>
            </div>
            
            <button onclick="removeBulkTrack(${index})" style="background: transparent; border: none; color: #ff453a; cursor: pointer; padding: 5px;">
                <ion-icon name="close-circle" style="font-size: 24px;"></ion-icon>
            </button>
        </div>
    `).join("");
}
function updateBulkField(index, field, value) {
  if (bulkUploadFiles[index]) {
    bulkUploadFiles[index][field] = value;
  }
}
function updateBulkCover(index, input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      bulkUploadFiles[index].coverData = input.files[0];
      bulkUploadFiles[index].cover = e.target.result;
      renderBulkUploadList();
    };
    reader.readAsDataURL(input.files[0]);
  }
}
function removeBulkTrack(index) {
  bulkUploadFiles.splice(index, 1);
  document.getElementById("upload-count-label").textContent = `\u0412\u044B\u0431\u0440\u0430\u043D\u043E \u0444\u0430\u0439\u043B\u043E\u0432: ${bulkUploadFiles.length}`;
  if (bulkUploadFiles.length === 0) {
    resetUpload();
  } else {
    renderBulkUploadList();
  }
}
function resetUpload() {
  bulkUploadFiles = [];
  document.getElementById("upload-initial-state").style.display = "block";
  document.getElementById("upload-preview-container").style.display = "none";
  document.getElementById("audio-files-input").value = "";
}
async function publishAllTracks() {
  const btn = document.querySelector(".upload-actions .btn-primary");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner small"></div> \u041F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u044F...';
  let successCount = 0;
  for (let i = 0; i < bulkUploadFiles.length; i++) {
    const track = bulkUploadFiles[i];
    if (track.status === "success") continue;
    const card = document.getElementById(`bulk-track-${i}`);
    const statusEl = document.getElementById(`status-${i}`);
    if (statusEl) {
      statusEl.textContent = "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...";
      statusEl.style.color = "#0a84ff";
    }
    const formData = new FormData();
    formData.append("audio", track.file);
    formData.append("title", track.title);
    formData.append("artist", track.artist);
    if (track.coverData) {
      formData.append("cover", track.coverData);
    } else if (track.cover && track.cover.startsWith("data:image")) {
      try {
        const res = await fetch(track.cover);
        const blob = await res.blob();
        formData.append("cover", new File([blob], "cover.jpg", { type: "image/jpeg" }));
      } catch (e) {
        console.error("Error converting cover:", e);
      }
    }
    try {
      const res = await fetch("/api/tracks", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        track.status = "success";
        if (statusEl) {
          statusEl.textContent = "\u041E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D\u043E";
          statusEl.style.color = "#30d158";
        }
        if (card) {
          card.style.opacity = "0.5";
          card.style.borderColor = "#30d158";
        }
        successCount++;
      } else {
        track.status = "error";
        if (statusEl) {
          statusEl.textContent = "\u041E\u0448\u0438\u0431\u043A\u0430: " + (data.error || "Unknown");
          statusEl.style.color = "#ff453a";
        }
      }
    } catch (err) {
      console.error(err);
      track.status = "error";
      if (statusEl) {
        statusEl.textContent = "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0442\u0438";
        statusEl.style.color = "#ff453a";
      }
    }
  }
  btn.disabled = false;
  btn.innerHTML = '<ion-icon name="checkmark-done"></ion-icon> \u041E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u0442\u044C \u0432\u0441\u0435';
  if (successCount === bulkUploadFiles.length) {
    alert(`\u0412\u0441\u0435 \u0442\u0440\u0435\u043A\u0438 (${successCount}) \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D\u044B!`);
    resetUpload();
    await loadMyTracks();
    switchPage("library");
  } else {
    alert(`\u041E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D\u043E ${successCount} \u0438\u0437 ${bulkUploadFiles.length}. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u043E\u0448\u0438\u0431\u043A\u0438.`);
  }
}
async function extractMetadata(file) {
  const formData = new FormData();
  formData.append("audio", file);
  try {
    const res = await fetch("/api/extract-metadata", {
      method: "POST",
      body: formData
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.error("Error extracting metadata:", e);
  }
  return null;
}
function escapeHtml(text) {
  if (!text) return "";
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
const trackSlugInput = document.getElementById("track-slug");
if (trackSlugInput) {
  trackSlugInput.addEventListener("input", (e) => {
    const preview = document.getElementById("slug-preview");
    if (preview) preview.textContent = e.target.value || "...";
  });
}
function showCreateAlbum() {
  const modal = document.getElementById("modal-create-album");
  if (modal) modal.classList.add("active");
}
const createAlbumForm = document.getElementById("create-album-form");
if (createAlbumForm) {
  createAlbumForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append("title", document.getElementById("album-title").value);
    formData.append("description", document.getElementById("album-description").value);
    const slug = document.getElementById("album-slug").value;
    if (slug) formData.append("slug", slug);
    const coverFile = document.getElementById("album-cover-file").files[0];
    if (coverFile) formData.append("cover", coverFile);
    try {
      const res = await fetch("/api/albums", {
        method: "POST",
        body: formData
      });
      const result = await res.json();
      if (result.success) {
        alert("\u0410\u043B\u044C\u0431\u043E\u043C \u0441\u043E\u0437\u0434\u0430\u043D! \u0422\u0435\u043F\u0435\u0440\u044C \u0432\u044B \u043C\u043E\u0436\u0435\u0442\u0435 \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u043D\u0435\u0433\u043E \u0442\u0440\u0435\u043A\u0438.");
        closeModal("modal-create-album");
        e.target.reset();
        document.getElementById("album-cover-preview").innerHTML = "";
        await loadMyAlbums();
        switchPage("albums");
        if (result.album_id) {
          setTimeout(() => manageAlbumTracks(result.album_id), 500);
        }
      } else {
        alert(result.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F \u0430\u043B\u044C\u0431\u043E\u043C\u0430");
      }
    } catch (err) {
      alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F \u0430\u043B\u044C\u0431\u043E\u043C\u0430");
      console.error(err);
    }
  });
}
const albumCoverFile = document.getElementById("album-cover-file");
if (albumCoverFile) {
  albumCoverFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const preview = document.getElementById("album-cover-preview");
        if (preview) {
          preview.innerHTML = `<img src="${event.target.result}" alt="Cover">`;
        }
      };
      reader.readAsDataURL(file);
    }
  });
}
const albumSlugInput = document.getElementById("album-slug");
if (albumSlugInput) {
  albumSlugInput.addEventListener("input", (e) => {
    const preview = document.getElementById("album-slug-preview");
    if (preview) preview.textContent = e.target.value || "...";
  });
}
let currentEditTrackId = null;
async function editTrack(trackId) {
  const track = myTracks.find((t) => t.id === trackId);
  if (!track) return;
  currentEditTrackId = trackId;
  document.getElementById("edit-track-id").value = trackId;
  document.getElementById("edit-track-title").value = track.title;
  document.getElementById("edit-track-artist").value = track.artist;
  document.getElementById("edit-track-slug").value = track.slug || "";
  document.getElementById("edit-track-lyrics").value = track.lyrics || "";
  const coverPreview = document.getElementById("edit-track-cover-preview");
  document.getElementById("edit-track-cover-key").value = "";
  if (track.cover_url) {
    coverPreview.innerHTML = `<img src="${track.cover_url}" alt="Cover" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
  } else {
    coverPreview.innerHTML = '<div style="width: 100%; height: 100px; background: #333; border-radius: 8px; display: flex; align-items: center; justify-content: center;"><ion-icon name="image-outline" style="font-size: 32px; color: #666;"></ion-icon></div>';
  }
  document.getElementById("edit-track-audio-file").value = "";
  document.getElementById("edit-track-audio-info").textContent = "";
  const visBtnText = document.getElementById("visibility-btn-text");
  if (visBtnText) {
    visBtnText.textContent = track.hidden ? "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C" : "\u0421\u043A\u0440\u044B\u0442\u044C";
  }
  document.getElementById("modal-edit-track").classList.add("active");
}
const editTrackAudioFile = document.getElementById("edit-track-audio-file");
if (editTrackAudioFile) {
  editTrackAudioFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const info = document.getElementById("edit-track-audio-info");
      if (info) {
        info.textContent = `\u0424\u0430\u0439\u043B: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
      }
    }
  });
}
const editTrackForm = document.getElementById("edit-track-form");
if (editTrackForm) {
  editTrackForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append("title", document.getElementById("edit-track-title").value);
    formData.append("artist", document.getElementById("edit-track-artist").value);
    formData.append("slug", document.getElementById("edit-track-slug").value);
    formData.append("lyrics", document.getElementById("edit-track-lyrics").value);
    const coverKey = document.getElementById("edit-track-cover-key").value;
    if (coverKey) formData.append("cover_key", coverKey);
    const coverFile = document.getElementById("edit-track-cover-file").files[0];
    if (coverFile) formData.append("cover", coverFile);
    const audioFile = document.getElementById("edit-track-audio-file").files[0];
    if (audioFile) formData.append("audio", audioFile);
    try {
      const res = await fetch(`/api/tracks/${currentEditTrackId}`, {
        method: "PUT",
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        alert("\u0422\u0440\u0435\u043A \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D!");
        closeModal("modal-edit-track");
        await loadMyTracks();
      } else {
        alert(data.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0442\u0440\u0435\u043A\u0430");
      }
    } catch (err) {
      alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0442\u0440\u0435\u043A\u0430");
      console.error(err);
    }
  });
}
async function deleteCurrentTrack() {
  if (!confirm("\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u044D\u0442\u043E\u0442 \u0442\u0440\u0435\u043A?")) return;
  try {
    const res = await fetch(`/api/tracks/${currentEditTrackId}`, {
      method: "DELETE"
    });
    const data = await res.json();
    if (data.success) {
      alert("\u0422\u0440\u0435\u043A \u0443\u0434\u0430\u043B\u0435\u043D!");
      closeModal("modal-edit-track");
      await loadMyTracks();
    } else {
      alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0442\u0440\u0435\u043A\u0430");
    }
  } catch (err) {
    alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0442\u0440\u0435\u043A\u0430");
    console.error(err);
  }
}
async function toggleTrackVisibility() {
  const track = myTracks.find((t) => t.id === currentEditTrackId);
  if (!track) return;
  try {
    const res = await fetch(`/api/tracks/${currentEditTrackId}/toggle-visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: !track.hidden })
    });
    const data = await res.json();
    if (data.success) {
      await loadMyTracks();
      const visBtnText = document.getElementById("visibility-btn-text");
      if (visBtnText) {
        visBtnText.textContent = track.hidden ? "\u0421\u043A\u0440\u044B\u0442\u044C" : "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C";
      }
      alert(track.hidden ? "\u0422\u0440\u0435\u043A \u043F\u043E\u043A\u0430\u0437\u0430\u043D" : "\u0422\u0440\u0435\u043A \u0441\u043A\u0440\u044B\u0442");
    }
  } catch (err) {
    alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0432\u0438\u0434\u0438\u043C\u043E\u0441\u0442\u0438");
  }
}
function previewAvatar(input) {
  const file = input && input.files ? input.files[0] : null;
  if (!file) {
    return;
  }
  if (!file.type || !file.type.startsWith("image/")) {
    alert("\u041C\u043E\u0436\u043D\u043E \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 \u0434\u043B\u044F \u0430\u0432\u0430\u0442\u0430\u0440\u0430.");
    input.value = "";
    return;
  }
  const avatarImg = document.getElementById("avatar-img");
  const avatarPlaceholder = document.querySelector(".avatar-placeholder");
  if (!avatarImg || !avatarPlaceholder) {
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    avatarImg.src = e.target.result;
    avatarImg.style.display = "block";
    avatarPlaceholder.style.display = "none";
  };
  reader.readAsDataURL(file);
}
window.previewAvatar = previewAvatar;
function sanitizeNicknameValue(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "").slice(0, 32);
}
async function saveProfile() {
  const displayNameInput = document.getElementById("profile-display-name");
  const nicknameInput = document.getElementById("profile-nickname-input");
  const avatarInput = document.getElementById("profile-avatar-input");
  const saveButton = document.querySelector('#page-profile .btn-primary[onclick="saveProfile()"]');
  if (!displayNameInput || !nicknameInput) {
    console.error("Profile form fields not found");
    alert("\u0424\u043E\u0440\u043C\u0430 \u043F\u0440\u043E\u0444\u0438\u043B\u044F \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430. \u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443.");
    return;
  }
  const displayName = displayNameInput.value.trim();
  const nickname = sanitizeNicknameValue(nicknameInput.value);
  nicknameInput.value = nickname;
  const slugPreview = document.getElementById("profile-slug-preview");
  if (slugPreview) {
    slugPreview.textContent = nickname || "...";
  }
  const formData = new FormData();
  formData.append("display_name", displayName);
  formData.append("nickname", nickname);
  if (avatarInput && avatarInput.files && avatarInput.files[0]) {
    formData.append("avatar", avatarInput.files[0]);
  }
  try {
    if (saveButton) {
      saveButton.disabled = true;
    }
    const res = await fetch("/api/user/profile", {
      method: "PUT",
      body: formData
    });
    let data = {};
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error("Failed to parse profile response:", parseError, text);
      }
    }
    if (data.success) {
      alert("\u041F\u0440\u043E\u0444\u0438\u043B\u044C \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D!");
      await loadProfile();
      renderProfile();
      if (nickname) {
        const shareBtn = document.getElementById("share-btn");
        if (shareBtn) {
          shareBtn.style.display = "block";
        }
      }
    } else {
      alert(data.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u043F\u0440\u043E\u0444\u0438\u043B\u044F");
    }
  } catch (err) {
    alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u043F\u0440\u043E\u0444\u0438\u043B\u044F");
    console.error(err);
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
    }
  }
}
const profileNicknameInput = document.getElementById("profile-nickname-input");
if (profileNicknameInput) {
  profileNicknameInput.addEventListener("input", (e) => {
    const sanitized = sanitizeNicknameValue(e.target.value);
    if (e.target.value !== sanitized) {
      e.target.value = sanitized;
    }
    const preview = document.getElementById("profile-slug-preview");
    if (preview) preview.textContent = sanitized || "...";
  });
}
function copyProfileLink() {
  const input = document.getElementById("profile-link-input");
  if (!input || !input.value) {
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(input.value).then(() => alert("\u0421\u0441\u044B\u043B\u043A\u0430 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0430!")).catch((error) => {
      console.error("Clipboard copy failed:", error);
      input.select();
      document.execCommand("copy");
      alert("\u0421\u0441\u044B\u043B\u043A\u0430 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0430!");
    });
    return;
  }
  input.select();
  document.execCommand("copy");
  alert("\u0421\u0441\u044B\u043B\u043A\u0430 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0430!");
}
function showShareLibrary() {
  if (window.currentUser && window.currentUser.nickname) {
    const link = `${window.location.origin}/user/${window.currentUser.nickname}`;
    if (tgWebApp && tgWebApp.shareUrl) {
      tgWebApp.shareUrl(link);
    } else {
      navigator.clipboard.writeText(link).then(() => {
        alert("\u0421\u0441\u044B\u043B\u043A\u0430 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0430!");
      });
    }
  }
}
function shareTrack(trackId, slug) {
  const link = `${window.location.origin}/track/${slug}`;
  if (tgWebApp && tgWebApp.shareUrl) {
    tgWebApp.shareUrl(link);
  } else {
    navigator.clipboard.writeText(link).then(() => {
      alert("\u0421\u0441\u044B\u043B\u043A\u0430 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0430!");
    });
  }
}
function viewAlbum(albumId) {
  const link = `${window.location.origin}/album/${albumId}`;
  if (tgWebApp && tgWebApp.openLink) {
    tgWebApp.openLink(link);
  } else {
    window.open(link, "_blank");
  }
}
async function addTrackToAlbum(trackId, albumId) {
  try {
    const res = await fetch(`/api/albums/${albumId}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track_id: trackId })
    });
    const data = await res.json();
    if (data.success) {
      alert("\u0422\u0440\u0435\u043A \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D \u0432 \u0430\u043B\u044C\u0431\u043E\u043C!");
    } else {
      alert(data.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0442\u0440\u0435\u043A\u0430");
    }
  } catch (err) {
    alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0442\u0440\u0435\u043A\u0430");
    console.error(err);
  }
}
function showAddToAlbum(trackId) {
  if (myAlbums.length === 0) {
    alert("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0441\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u0430\u043B\u044C\u0431\u043E\u043C");
    switchPage("albums");
    return;
  }
  const albumList = myAlbums.map(
    (album) => `<button onclick="addTrackToAlbum(${trackId}, ${album.id}); this.closest('.modal').classList.remove('active');" 
                 style="width:100%; padding:12px; background:#1c1c1e; border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:white; text-align:left; margin-bottom:8px; cursor:pointer;">
            ${album.title}
        </button>`
  ).join("");
  const modal = document.createElement("div");
  modal.className = "modal active";
  modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u0430\u043B\u044C\u0431\u043E\u043C</h2>
                <button class="btn-icon" onclick="this.closest('.modal').remove()">
                    <ion-icon name="close"></ion-icon>
                </button>
            </div>
            <div style="max-height:400px; overflow-y:auto;">
                ${albumList}
            </div>
        </div>
    `;
  document.body.appendChild(modal);
}
function playMyTrack(trackId) {
  const tracksToUse = window.myTracks && Array.isArray(window.myTracks) ? window.myTracks : myTracks;
  const trackIndex = tracksToUse.findIndex((t) => t.id === trackId);
  if (trackIndex === -1) {
    console.error("Track not found:", trackId);
    return;
  }
  console.log("playMyTrack called:", trackId, "index:", trackIndex, "total tracks:", tracksToUse.length);
  window.tracks = tracksToUse;
  if (typeof window.setTracks === "function") {
    window.setTracks(tracksToUse);
  }
  if (typeof window.playTrack === "function") {
    window.playTrack(trackIndex, true);
  } else {
    console.error("playTrack function not available");
  }
}
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("active");
  }
  document.querySelectorAll(".modal.active").forEach((m) => {
    if (m.id === modalId || !m.id) {
      m.classList.remove("active");
    }
  });
}
document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal")) {
      e.target.classList.remove("active");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal.active").forEach((modal) => {
        modal.classList.remove("active");
      });
    }
  });
});
let lsLines = [];
let lsAudio = null;
let activeLineIndex = 0;
let isSyncing = false;
let editingIndex = -1;
let editingTimeIndex = -1;
let lyricsStudioTrackId = null;
function openLyricsStudioLegacy() {
  let existingLyrics = "";
  let audioFile = null;
  let audioUrl = null;
  const pageUpload = document.getElementById("page-upload");
  const modalEdit = document.getElementById("modal-edit-track");
  if (pageUpload && pageUpload.classList.contains("active")) {
    existingLyrics = document.getElementById("track-lyrics").value || "";
    const audioInput = document.getElementById("audio-file");
    if (audioInput && audioInput.files && audioInput.files[0]) {
      audioFile = audioInput.files[0];
      audioUrl = URL.createObjectURL(audioFile);
    }
  } else if (modalEdit && modalEdit.classList.contains("active")) {
    existingLyrics = document.getElementById("edit-track-lyrics").value || "";
    lyricsStudioTrackId = currentEditTrackId;
    const track = myTracks.find((t) => t.id === lyricsStudioTrackId);
    if (track) {
      audioUrl = track.audio_url || (track.filename ? `/uploads/${track.filename}` : "");
    }
  }
  if (!audioUrl && !lyricsStudioTrackId) {
    alert("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0430\u0443\u0434\u0438\u043E\u0444\u0430\u0439\u043B \u0438\u043B\u0438 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0442\u0440\u0435\u043A \u0434\u043B\u044F \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F");
    return;
  }
  document.getElementById("ls-raw-input").value = existingLyrics || "";
  if (existingLyrics) {
    parseLRC(existingLyrics, true);
  } else {
    lsLines = [];
    renderLsLines();
  }
  const audioEl = document.getElementById("ls-audio");
  if (audioUrl) {
    audioEl.src = audioUrl;
    lsAudio = audioEl;
    setupLsAudio();
  }
  document.getElementById("modal-lyrics-studio").classList.add("active");
}
function closeLyricsStudioLegacy() {
  closeModal("modal-lyrics-studio");
  if (lsAudio) {
    lsAudio.pause();
    lsAudio.src = "";
    lsAudio = null;
  }
  lyricsStudioTrackId = null;
}
function setupLsAudioLegacy() {
  if (!lsAudio) return;
  lsAudio.addEventListener("timeupdate", () => {
    if (!lsAudio) return;
    const t = lsAudio.currentTime;
    if (!isNaN(t)) {
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      document.getElementById("ls-time-display").innerText = `${m}:${s.toString().padStart(2, "0")}`;
      const duration = lsAudio.duration;
      if (!isNaN(duration) && duration > 0) {
        document.getElementById("ls-seek").value = t / duration * 100;
      }
      updateActiveLine();
    }
  });
  document.getElementById("ls-seek").addEventListener("input", (e) => {
    const pct = e.target.value;
    if (lsAudio && !isNaN(lsAudio.duration)) {
      lsAudio.currentTime = pct / 100 * lsAudio.duration;
    }
  });
}
function updateActiveLineLegacy() {
  if (!lsAudio) return;
  const currentTime = lsAudio.currentTime;
  let newActiveIndex = -1;
  lsLines.forEach((line, idx) => {
    if (line.time !== null && line.time <= currentTime) {
      newActiveIndex = idx;
    }
  });
  if (newActiveIndex !== activeLineIndex) {
    activeLineIndex = newActiveIndex;
    renderLsLines();
  }
}
function lsParseText() {
  syncFromRawText();
}
function parseLRCLegacy(lrc, skipSync = false) {
  const lines = lrc.split("\n");
  const regex1 = /\[(\d{1,2}):(\d{2})\.(\d+)\](.*)/;
  const regex2 = /\[(\d{1,2}):(\d{2}):(\d+)\](.*)/;
  const regex3 = /\[(\d{1,2}):(\d{2})\](.*)/;
  lsLines = [];
  const seen = new Set();
  let lastTime = 0;
  let spacerCounter = 0;
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      spacerCounter++;
      lsLines.push({ time: lastTime + 1e-4 * spacerCounter, text: "", isSpacer: true });
      return;
    }
    let match = trimmed.match(regex1);
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const ms = parseInt(match[3]);
      const time = minutes * 60 + seconds + ms / 100;
      const text = match[4].trim();
      const key = `${time}:${text}`;
      if (!seen.has(key)) {
        seen.add(key);
        lsLines.push({ time, text: text || "" });
        lastTime = time;
        spacerCounter = 0;
      }
      return;
    }
    match = trimmed.match(regex2);
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const ms = parseInt(match[3]);
      const time = minutes * 60 + seconds + ms / 100;
      const text = match[4].trim();
      const key = `${time}:${text}`;
      if (!seen.has(key)) {
        seen.add(key);
        lsLines.push({ time, text: text || "" });
        lastTime = time;
        spacerCounter = 0;
      }
      return;
    }
    match = trimmed.match(regex3);
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const time = minutes * 60 + seconds;
      const text = match[3].trim();
      const key = `${time}:${text}`;
      if (!seen.has(key)) {
        seen.add(key);
        lsLines.push({ time, text: text || "" });
        lastTime = time;
        spacerCounter = 0;
      }
      return;
    }
    if (!trimmed.startsWith("[")) {
      const key = `null:${trimmed}`;
      if (!seen.has(key)) {
        seen.add(key);
        spacerCounter++;
        lsLines.push({ time: lastTime + 1e-4 * spacerCounter, text: trimmed });
      }
    }
  });
  activeLineIndex = 0;
  renderLsLines();
  if (!skipSync) {
    syncRawText();
  }
}
function syncRawTextLegacy() {
  if (isSyncing) return;
  isSyncing = true;
  const sortedLines = [...lsLines].sort((a, b) => {
    if (a.time === null && b.time === null) return 0;
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    return a.time - b.time;
  });
  const lrcParts = [];
  sortedLines.forEach((l) => {
    if (l.time !== null && !isNaN(l.time)) {
      if (l.isSpacer) {
        lrcParts.push("");
      } else {
        const m = Math.floor(l.time / 60);
        const s = (l.time % 60).toFixed(2);
        const mm = m < 10 ? "0" + m : m.toString();
        const ss = parseFloat(s).toFixed(2);
        const ssFormatted = ss < 10 ? "0" + ss : ss;
        const text = (l.text || "").trim();
        lrcParts.push(`[${mm}:${ssFormatted}]${text}`);
      }
    } else if (l.text && l.text.trim()) {
      lrcParts.push(l.text.trim());
    } else if (!l.text || !l.text.trim()) {
      lrcParts.push("");
    }
  });
  while (lrcParts.length > 0 && lrcParts[lrcParts.length - 1] === "") {
    lrcParts.pop();
  }
  const lrc = lrcParts.join("\n");
  document.getElementById("ls-raw-input").value = lrc;
  setTimeout(() => {
    isSyncing = false;
  }, 100);
}
function syncFromRawTextLegacy() {
  if (isSyncing) return;
  isSyncing = true;
  const raw = document.getElementById("ls-raw-input").value;
  if (!raw.trim()) {
    lsLines = [];
    renderLsLines();
    setTimeout(() => {
      isSyncing = false;
    }, 100);
    return;
  }
  const lines = raw.split("\n");
  const regex1 = /\[(\d{1,2}):(\d{2})\.(\d+)\](.*)/;
  const regex2 = /\[(\d{1,2}):(\d{2}):(\d+)\](.*)/;
  const regex3 = /\[(\d{1,2}):(\d{2})\](.*)/;
  const newLines = [];
  const seen = new Set();
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      newLines.push({ time: null, text: "" });
      return;
    }
    let match = trimmed.match(regex1);
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const ms = parseInt(match[3]);
      const time = minutes * 60 + seconds + ms / 100;
      const text = match[4].trim();
      const key = `${time}:${text}`;
      if (!seen.has(key)) {
        seen.add(key);
        newLines.push({ time, text: text || "" });
      }
      return;
    }
    match = trimmed.match(regex2);
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const ms = parseInt(match[3]);
      const time = minutes * 60 + seconds + ms / 100;
      const text = match[4].trim();
      const key = `${time}:${text}`;
      if (!seen.has(key)) {
        seen.add(key);
        newLines.push({ time, text: text || "" });
      }
      return;
    }
    match = trimmed.match(regex3);
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const time = minutes * 60 + seconds;
      const text = match[3].trim();
      const key = `${time}:${text}`;
      if (!seen.has(key)) {
        seen.add(key);
        newLines.push({ time, text: text || "" });
      }
      return;
    }
    if (!trimmed.startsWith("[")) {
      const key = `null:${trimmed}`;
      if (!seen.has(key)) {
        seen.add(key);
        newLines.push({ time: null, text: trimmed });
      }
    }
  });
  lsLines = newLines;
  if (activeLineIndex >= lsLines.length) {
    activeLineIndex = Math.max(0, lsLines.length - 1);
  }
  if (editingIndex >= lsLines.length) {
    editingIndex = -1;
  }
  renderLsLines();
  setTimeout(() => {
    isSyncing = false;
  }, 100);
}
function renderLsLinesLegacy() {
  const container = document.getElementById("ls-lines-container");
  if (!container) return;
  container.innerHTML = "";
  const seen = new Map();
  const uniqueLines = [];
  const indexMap = new Map();
  lsLines.forEach((line, oldIdx) => {
    const timeKey = line.time !== null ? Math.round(line.time * 100) / 100 : null;
    const key = `${timeKey}:${line.text || ""}`;
    if (seen.has(key)) {
      const existingIdx = seen.get(key);
      indexMap.set(oldIdx, existingIdx);
    } else {
      const newIdx = uniqueLines.length;
      uniqueLines.push(line);
      seen.set(key, newIdx);
      indexMap.set(oldIdx, newIdx);
    }
  });
  if (activeLineIndex >= 0 && indexMap.has(activeLineIndex)) {
    activeLineIndex = indexMap.get(activeLineIndex);
  }
  if (editingIndex >= 0 && indexMap.has(editingIndex)) {
    editingIndex = indexMap.get(editingIndex);
  }
  if (editingTimeIndex >= 0 && indexMap.has(editingTimeIndex)) {
    editingTimeIndex = indexMap.get(editingTimeIndex);
  }
  lsLines = uniqueLines;
  const sortedLines = [...lsLines].sort((a, b) => {
    if (a.time === null && b.time === null) return 0;
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    return a.time - b.time;
  });
  const originalToSorted = new Map();
  sortedLines.forEach((sortedLine, sortedIdx) => {
    const originalIdx = lsLines.findIndex((l, idx) => l === sortedLine);
    if (originalIdx >= 0) {
      originalToSorted.set(originalIdx, sortedIdx);
    }
  });
  let sortedActiveIndex = -1;
  if (activeLineIndex >= 0 && activeLineIndex < lsLines.length) {
    sortedActiveIndex = originalToSorted.get(activeLineIndex) || -1;
  }
  sortedLines.forEach((line, sortedIdx) => {
    const idx = lsLines.findIndex((l) => l === line);
    const isEmpty = !line.text || !line.text.trim();
    if (isEmpty && line.time === null) {
      return;
    }
    const isActive = sortedIdx === sortedActiveIndex;
    const div = document.createElement("div");
    div.className = `ls-line ${isActive ? "active" : ""}`;
    if (editingIndex === idx) {
      div.innerHTML = `
                <div class="ls-time">${line.time !== null ? formatTime(line.time) : "--:--"}</div>
                <input type="text" class="ls-text-input" value="${escapeHtml(line.text)}" 
                       oninput="updateLineText(${idx}, this.value)"
                       onblur="finishEdit(${idx}, this.value)" 
                       onkeydown="handleEditKey(event, ${idx}, this)">
                <div class="ls-actions">
                    <button class="ls-btn-small" onclick="event.stopPropagation(); const input = this.closest('.ls-line').querySelector('.ls-text-input'); if(input) finishEdit(${idx}, input.value)" title="Save">
                        <ion-icon name="checkmark"></ion-icon>
                    </button>
                    <button class="ls-btn-small" onclick="event.stopPropagation(); cancelEdit()" title="Cancel">
                        <ion-icon name="close"></ion-icon>
                    </button>
                </div>
            `;
    } else if (editingTimeIndex === idx) {
      const currentTime = line.time !== null ? line.time : lsAudio ? lsAudio.currentTime : 0;
      const m = Math.floor(currentTime / 60);
      const s = (currentTime % 60).toFixed(2);
      const mm = m < 10 ? "0" + m : m.toString();
      const ss = parseFloat(s).toFixed(2);
      const ssFormatted = ss < 10 ? "0" + ss : ss;
      div.innerHTML = `
                <input type="text" class="ls-time-input" value="${mm}:${ssFormatted}" 
                       onblur="finishTimeEdit(${idx}, this.value)" 
                       onkeydown="handleTimeEditKey(event, ${idx}, this)"
                       placeholder="mm:ss.xx">
                <div class="ls-text" style="${!line.text ? "opacity: 0.5; font-style: italic;" : ""}">${escapeHtml(line.text || "(empty)")}</div>
                <div class="ls-actions">
                    <button class="ls-btn-small" onclick="event.stopPropagation(); const input = this.closest('.ls-line').querySelector('.ls-time-input'); if(input) finishTimeEdit(${idx}, input.value)" title="Save">
                        <ion-icon name="checkmark"></ion-icon>
                    </button>
                    <button class="ls-btn-small" onclick="event.stopPropagation(); cancelTimeEdit()" title="Cancel">
                        <ion-icon name="close"></ion-icon>
                    </button>
                </div>
            `;
    } else {
      const isEmpty2 = !line.text || !line.text.trim();
      div.onclick = () => {
        activeLineIndex = idx;
        renderLsLines();
        if (line.time !== null && lsAudio) lsAudio.currentTime = line.time;
      };
      div.innerHTML = `
                <div class="ls-time" onclick="event.stopPropagation(); startTimeEdit(${idx})" style="cursor: pointer;" title="Click to edit time">${line.time !== null ? formatTime(line.time) : "--:--"}</div>
                <div class="ls-text" ondblclick="startEdit(${idx})" style="${isEmpty2 ? "opacity: 0.5; font-style: italic;" : ""}">${escapeHtml(line.text || "(empty)")}</div>
                <div class="ls-actions">
                    <button class="ls-btn-small" onclick="event.stopPropagation(); startEdit(${idx})" title="Edit text">
                        <ion-icon name="create"></ion-icon>
                    </button>
                    ${line.time === null ? `<button class="ls-btn-small" onclick="event.stopPropagation(); setCurrentTime(${idx})" title="Set current time">\u23F1</button>` : ""}
                    <button class="ls-btn-small" onclick="event.stopPropagation(); deleteLine(${idx})" title="Delete">
                        <ion-icon name="trash"></ion-icon>
                    </button>
                </div>
            `;
    }
    container.appendChild(div);
  });
  const addBtn = document.createElement("div");
  addBtn.className = "ls-line";
  addBtn.style.justifyContent = "center";
  addBtn.style.cursor = "pointer";
  addBtn.style.background = "rgba(250, 45, 72, 0.1)";
  addBtn.innerHTML = `
        <button class="ls-btn-small" onclick="addNewLine()" style="background: var(--accent); width: auto; padding: 5px 15px;">
            <ion-icon name="add"></ion-icon> Add Line
        </button>
    `;
  container.appendChild(addBtn);
  const activeEl = container.querySelector(".ls-line.active");
  if (activeEl) {
    activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
function formatTime(s) {
  if (s === null || isNaN(s)) return "--:--";
  const m = Math.floor(s / 60);
  const s_float = s % 60;
  const sec = Math.floor(s_float);
  const ms = Math.floor(s_float % 1 * 100);
  return `[${m < 10 ? "0" + m : m}:${sec < 10 ? "0" + sec : sec}.${ms < 10 ? "0" + ms : ms}]`;
}
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
function startEditLegacy(idx) {
  editingIndex = idx;
  editingTimeIndex = -1;
  renderLsLines();
  setTimeout(() => {
    const input = document.querySelector(".ls-text-input");
    if (input) input.focus();
  }, 50);
}
function updateLineTextLegacy(idx, newText) {
  if (idx >= 0 && idx < lsLines.length) {
    lsLines[idx].text = newText;
    clearTimeout(updateLineText.timeout);
    updateLineText.timeout = setTimeout(() => {
      syncRawText();
    }, 100);
  }
}
function finishEditLegacy(idx, newText) {
  if (idx >= 0 && idx < lsLines.length) {
    const trimmed = (newText || "").trim();
    lsLines[idx].text = trimmed;
  }
  editingIndex = -1;
  renderLsLines();
  setTimeout(() => {
    syncRawText();
  }, 10);
}
function cancelEditLegacy() {
  editingIndex = -1;
  renderLsLines();
}
function handleEditKeyLegacy(e, idx, input) {
  if (e.key === "Enter") {
    e.preventDefault();
    finishEdit(idx, input.value);
  } else if (e.key === "Escape") {
    e.preventDefault();
    cancelEdit();
  }
}
function addNewLineLegacy() {
  const currentTime = lsAudio ? lsAudio.currentTime : 0;
  const newLine = { text: "", time: currentTime };
  lsLines.push(newLine);
  syncRawText();
  renderLsLines();
  const sortedIndex = lsLines.findIndex((l) => l === newLine);
  if (sortedIndex >= 0) {
    activeLineIndex = sortedIndex;
    editingTimeIndex = sortedIndex;
    renderLsLines();
    setTimeout(() => {
      syncRawText();
    }, 10);
  }
  setTimeout(() => {
    const input = document.querySelector(".ls-time-input");
    if (input) {
      input.focus();
      input.select();
    }
  }, 50);
}
function deleteLineLegacy(idx) {
  if (confirm("Delete this line?")) {
    lsLines.splice(idx, 1);
    if (activeLineIndex >= lsLines.length) activeLineIndex = lsLines.length - 1;
    if (activeLineIndex < 0) activeLineIndex = 0;
    editingIndex = -1;
    editingTimeIndex = -1;
    renderLsLines();
    syncRawText();
  }
}
function startTimeEditLegacy(idx) {
  editingTimeIndex = idx;
  editingIndex = -1;
  renderLsLines();
  setTimeout(() => {
    const input = document.querySelector(".ls-time-input");
    if (input) {
      input.focus();
      input.select();
    }
  }, 50);
}
function finishTimeEditLegacy(idx, timeStr) {
  if (idx >= 0 && idx < lsLines.length) {
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2}(?:\.\d+)?)/);
    if (timeMatch) {
      const minutes = parseInt(timeMatch[1]);
      const seconds = parseFloat(timeMatch[2]);
      const time = minutes * 60 + seconds;
      lsLines[idx].time = time;
    } else {
      lsLines[idx].time = lsAudio ? lsAudio.currentTime : 0;
    }
  }
  editingTimeIndex = -1;
  renderLsLines();
  setTimeout(() => {
    syncRawText();
  }, 10);
}
function cancelTimeEditLegacy() {
  editingTimeIndex = -1;
  renderLsLines();
}
function handleTimeEditKeyLegacy(e, idx, input) {
  if (e.key === "Enter") {
    e.preventDefault();
    finishTimeEdit(idx, input.value);
  } else if (e.key === "Escape") {
    e.preventDefault();
    cancelTimeEdit();
  }
}
function setCurrentTimeLegacy(idx) {
  if (idx >= 0 && idx < lsLines.length && lsAudio) {
    lsLines[idx].time = lsAudio.currentTime || 0;
    renderLsLines();
    syncRawText();
  }
}
function lsPlayPauseLegacy() {
  if (!lsAudio) return;
  if (lsAudio.paused) {
    lsAudio.play();
    document.getElementById("ls-play-btn").innerHTML = '<ion-icon name="pause"></ion-icon>';
  } else {
    lsAudio.pause();
    document.getElementById("ls-play-btn").innerHTML = '<ion-icon name="play"></ion-icon>';
  }
}
function lsSyncCurrentLineLegacy() {
  if (!lsAudio) return;
  const currentTime = lsAudio.currentTime;
  const newLine = { text: "", time: currentTime };
  lsLines.push(newLine);
  syncRawText();
  renderLsLines();
  const sortedIndex = lsLines.findIndex((l) => l === newLine);
  if (sortedIndex >= 0) {
    activeLineIndex = sortedIndex;
    editingIndex = sortedIndex;
    renderLsLines();
    setTimeout(() => {
      syncRawText();
    }, 10);
  }
  setTimeout(() => {
    const input = document.querySelector(".ls-text-input");
    if (input) input.focus();
  }, 50);
}
function lsExportLegacy() {
  syncRawText();
  const rawText = document.getElementById("ls-raw-input").value;
  const lines = rawText.split("\n");
  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  const lrc = lines.join("\n");
  if (lyricsStudioTrackId) {
    document.getElementById("edit-track-lyrics").value = lrc;
  } else {
    document.getElementById("track-lyrics").value = lrc;
  }
  closeLyricsStudio();
}
document.addEventListener("keydown", (e) => {
  const modal = document.getElementById("modal-lyrics-studio");
  if (!modal || !modal.classList.contains("active")) return;
  const target = e.target;
  const isTypingTarget = target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable);
  if (isTypingTarget) return;
  if (e.code === "Enter" && editingIndex === -1) {
    e.preventDefault();
    const targetIdx = typeof lsResolveStampTargetIndex === "function" ? lsResolveStampTargetIndex() : -1;
    if (targetIdx >= 0) {
      lsStampLine(lsLines[targetIdx].id);
    } else if (typeof lsSyncCurrentLine === "function") {
      lsSyncCurrentLine();
    }
  }
  if (e.code === "Space" && editingIndex === -1) {
    e.preventDefault();
    lsPlayPause();
  }
});
async function initApp() {
  const sharedMode = typeof SHARED_MODE !== "undefined" ? SHARED_MODE : false;
  const initialTrack = typeof INITIAL_TRACK !== "undefined" ? INITIAL_TRACK : null;
  console.log("initApp called, SHARED_MODE:", sharedMode, "INITIAL_TRACK:", initialTrack);
  console.log("isTelegram:", window.isTelegram, "tgWebApp:", window.tgWebApp);
  if (sharedMode && initialTrack) {
    const authScreen = document.getElementById("auth-screen");
    const mainApp = document.getElementById("main-app");
    if (authScreen) authScreen.style.display = "none";
    if (mainApp) mainApp.style.display = "none";
    return;
  }
  if (window.preloadedTracks && window.preloadedTracks.length > 0) {
    console.log("Using preloaded tracks:", window.preloadedTracks.length);
    myTracks = window.preloadedTracks;
    window.myTracks = window.preloadedTracks;
  }
  if (window.preloadedAlbums && window.preloadedAlbums.length > 0) {
    console.log("Using preloaded albums:", window.preloadedAlbums.length);
    myAlbums = window.preloadedAlbums;
    window.myAlbums = window.preloadedAlbums;
  }
  try {
    console.log("Checking browser session...");
    await loadProfile();
    if (window.currentUser && window.currentUser.id) {
      console.log("\u2705 User authenticated via Cookie/Session");
      if (window.myTracks && window.myTracks.length > 0) {
        console.log("Rendering preloaded tracks");
        renderMyTracks();
        updateStats();
      } else {
        console.log("Loading tracks from API");
        await loadMyTracks();
      }
      if (window.myAlbums && window.myAlbums.length > 0) {
        console.log("Rendering preloaded albums");
        renderMyAlbums();
        updateStats();
      } else {
        console.log("Loading albums from API");
        await loadMyAlbums();
      }
      renderProfile();
      const authScreen = document.getElementById("auth-screen");
      const mainApp = document.getElementById("main-app");
      if (authScreen) authScreen.style.display = "none";
      if (mainApp) mainApp.style.display = "flex";
      if (window.currentUser.nickname) {
        const shareBtn = document.getElementById("share-btn");
        if (shareBtn) shareBtn.style.display = "block";
      }
      return;
    }
  } catch (e) {
    console.log("Session check failed:", e);
  }
  const isTg = window.isTelegram || window.Telegram && window.Telegram.WebApp;
  const tgApp = window.tgWebApp || (window.Telegram ? window.Telegram.WebApp : null);
  if (isTg && tgApp) {
    console.log("Starting Telegram auth initialization...");
    initAuth().catch((err) => {
      console.error("Auth initialization error:", err);
      const botUrl = "https://tg.swag.best/swagplayerobot?start=auth";
    const botUrlTme = "https://t.me/swagplayerobot?start=auth";
      if (window.Telegram && window.Telegram.WebApp) {
        if (confirm("\u0414\u043B\u044F \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u044F \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u043E\u0432\u0430\u0442\u044C\u0441\u044F.\n\n\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0431\u043E\u0442\u0430 \u0434\u043B\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u0438?")) {
          window.Telegram.WebApp.openTelegramLink(botUrlTme);
        } else {
          showAuthError(err);
        }
      } else {
        showAuthError(err);
      }
    });
  } else {
    const botUrl = "https://tg.swag.best/swagplayerobot?start=auth";
    const botUrlTme = "https://t.me/swagplayerobot?start=auth";
    if (confirm("\u0414\u043B\u044F \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u044F \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u043E\u0432\u0430\u0442\u044C\u0441\u044F.\n\n\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0431\u043E\u0442\u0430 \u0434\u043B\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u0438?")) {
      window.location.href = botUrl;
    } else {
      showAuthError(new Error("\u041F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0435\u0440\u0435\u0437 Telegram \u0438\u043B\u0438 \u043F\u043E \u0441\u043F\u0435\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0439 \u0441\u0441\u044B\u043B\u043A\u0435 \u0432\u0445\u043E\u0434\u0430 (\u0437\u0430\u043F\u0440\u043E\u0441\u0438\u0442\u0435 \u0432 \u0431\u043E\u0442\u0435 /login)"));
    }
  }
}
document.addEventListener("DOMContentLoaded", async () => {
  await initApp();
});
function showAuthError(err) {
  const authLoading = document.getElementById("auth-loading");
  const authError = document.getElementById("auth-error");
  if (authLoading) authLoading.style.display = "none";
  if (authError) {
    authError.style.display = "block";
    const errorText = document.getElementById("auth-error-text");
    if (errorText) {
      errorText.textContent = `\u041E\u0448\u0438\u0431\u043A\u0430: ${err.message || "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430"}`;
    }
  }
}
const originalRenderMyTracks = window.renderMyTracks;
window.renderMyTracks = function(...args) {
  originalRenderMyTracks.apply(this, args);
  const container = document.getElementById("my-tracks-list");
  const tracksToRender = window.myTracks && Array.isArray(window.myTracks) ? window.myTracks : myTracks;
  if (!container) {
    return;
  }
  Array.from(container.children).forEach((card, index) => {
    const track = tracksToRender[index];
    if (!track || track.audio_available !== false && (track.audio_url || track.filename)) {
      return;
    }
    const actions = card.querySelectorAll(".track-card-actions button");
    [actions[0], actions[3]].forEach((button) => {
      if (!button) {
        return;
      }
      button.disabled = true;
      button.style.opacity = "0.5";
      button.style.cursor = "not-allowed";
    });
    const metaRow = card.querySelector(".track-card-info div:last-child");
    if (metaRow && !metaRow.querySelector("[data-audio-missing]")) {
      const badge = document.createElement("span");
      badge.dataset.audioMissing = "true";
      badge.style.color = "#ff9f0a";
      badge.textContent = "\u0444\u0430\u0439\u043B \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D";
      metaRow.appendChild(badge);
    }
  });
};
const originalPlayMyTrack = playMyTrack;
window.playMyTrack = function(trackId) {
  const tracksToUse = window.myTracks && Array.isArray(window.myTracks) ? window.myTracks : myTracks;
  const track = tracksToUse.find((item) => item.id === trackId);
  if (track && (track.audio_available === false || !(track.audio_url || track.filename))) {
    alert("\u042D\u0442\u043E\u0442 \u0442\u0440\u0435\u043A \u0441\u0435\u0439\u0447\u0430\u0441 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0434\u043B\u044F \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u044F.");
    return;
  }
  return originalPlayMyTrack(trackId);
};
const originalShareTrack = shareTrack;
window.shareTrack = function(trackId, slug) {
  const tracksToUse = window.myTracks && Array.isArray(window.myTracks) ? window.myTracks : myTracks;
  const track = tracksToUse.find((item) => item.id === trackId);
  if (track && (track.audio_available === false || !(track.audio_url || track.filename))) {
    alert("\u041D\u0435\u043B\u044C\u0437\u044F \u043F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F \u0442\u0440\u0435\u043A\u043E\u043C, \u043F\u043E\u043A\u0430 \u0430\u0443\u0434\u0438\u043E\u0444\u0430\u0439\u043B \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D.");
    return;
  }
  return originalShareTrack(trackId, slug);
};
window.switchPage = switchPage;
let lsAudioObjectUrl = null;
let lsPixelsPerSecond = 84;
let lsIsMagnetOn = true;
let lsMagnetThreshold = 0.18;
let lsAnimationFrame = null;
let lsListenersReady = false;
let lsCurrentTab = "preview";
let lsPlaybackLineIndex = -1;
let lsPreviewUserScrolled = false;
let lsPreviewScrollTimeout = null;
let lsSelectedLineIds = new Set();
function lsGenerateLineId() {
  return `ls_${Math.random().toString(36).slice(2, 10)}`;
}
function lsSanitizeTime(value) {
  return Number.isFinite(value) ? Math.max(0, value) : null;
}
function lsCreateLine(text = "", time = null, options = {}) {
  return {
    id: options.id || lsGenerateLineId(),
    text: text || "",
    time: lsSanitizeTime(time),
    duration: Number.isFinite(options.duration) ? Math.max(0.6, options.duration) : null,
    isSpacer: Boolean(options.isSpacer),
    rawOrder: Number.isFinite(options.rawOrder) ? options.rawOrder : 0
  };
}
function lsBuildDurationMap() {
  const map = new Map();
  lsLines.forEach((line) => {
    if (line && line.time !== null && line.text && line.text.trim()) {
      map.set(`${Math.round(line.time * 100)}|${line.text}`, line.duration || 0);
    }
  });
  return map;
}
function lsGetEntries(includeUntimed = false) {
  return lsLines.map((line, index) => ({ line, index })).filter(({ line }) => line && (includeUntimed || line.time !== null && line.text && line.text.trim())).sort((a, b) => {
    if (a.line.time === null && b.line.time === null) {
      return a.line.rawOrder - b.line.rawOrder;
    }
    if (a.line.time === null) return 1;
    if (b.line.time === null) return -1;
    if (a.line.time !== b.line.time) return a.line.time - b.line.time;
    return a.line.rawOrder - b.line.rawOrder;
  });
}
function lsHydrateDurations(preservedDurations = new Map()) {
  const entries = lsGetEntries(false);
  entries.forEach((entry, idx) => {
    const current = entry.line;
    const next = entries[idx + 1] ? entries[idx + 1].line : null;
    const gap = next ? Math.max(0.35, next.time - current.time) : null;
    const key = `${Math.round(current.time * 100)}|${current.text}`;
    const preserved = preservedDurations.get(key);
    let duration = Number.isFinite(preserved) && preserved > 0 ? preserved : null;
    if (!duration) {
      if (gap !== null) {
        duration = Math.max(0.6, Math.min(gap, 4.8));
      } else {
        duration = 3.2;
      }
    }
    if (gap !== null) {
      duration = Math.min(duration, Math.max(0.6, gap));
    }
    current.duration = Math.max(0.6, duration);
  });
}
function lsFormatTimecode(seconds, brackets = true) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
  const secs = Math.floor(safe % 60).toString().padStart(2, "0");
  const hundredths = Math.floor(safe % 1 * 100).toString().padStart(2, "0");
  const value = `${minutes}:${secs}.${hundredths}`;
  return brackets ? `[${value}]` : value;
}
function lsFindLineIndexById(lineId) {
  return lsLines.findIndex((line) => line && line.id === lineId);
}
function lsFindNextUnsyncedIndex(fromIndex = -1) {
  for (let idx = fromIndex + 1; idx < lsLines.length; idx++) {
    const line = lsLines[idx];
    if (!line || line.isSpacer) continue;
    if (line.text && line.text.trim() && line.time === null) {
      return idx;
    }
  }
  for (let idx = 0; idx <= fromIndex && idx < lsLines.length; idx++) {
    const line = lsLines[idx];
    if (!line || line.isSpacer) continue;
    if (line.text && line.text.trim() && line.time === null) {
      return idx;
    }
  }
  return -1;
}
function lsFindNextEditableIndex(fromIndex = -1) {
  for (let idx = fromIndex + 1; idx < lsLines.length; idx++) {
    const line = lsLines[idx];
    if (line && !line.isSpacer) {
      return idx;
    }
  }
  return fromIndex >= 0 && fromIndex < lsLines.length ? fromIndex : -1;
}
function lsReindexRawOrder() {
  lsLines.forEach((line, idx) => {
    if (line) {
      line.rawOrder = idx;
    }
  });
}
function lsBuildLrc() {
  const sorted = lsGetEntries(true).map((entry) => entry.line);
  const parts = [];
  sorted.forEach((line) => {
    const text = (line.text || "").trim();
    if (line.time !== null) {
      parts.push(`${lsFormatTimecode(line.time)}${text}`);
      return;
    }
    if (line.isSpacer && !text) {
      parts.push("");
      return;
    }
    parts.push(text);
  });
  while (parts.length > 0 && !parts[parts.length - 1].trim()) {
    parts.pop();
  }
  return parts.join("\n");
}
function lsUpdatePreviewStatus() {
  const status = document.getElementById("ls-preview-status");
  if (!status) return;
  const synced = lsLines.filter((line) => line.time !== null && line.text && line.text.trim()).length;
  const total = lsLines.filter((line) => !line.isSpacer && (line.text && line.text.trim() || line.time !== null)).length;
  status.textContent = `${synced} synced / ${total} lines`;
}
function lsSetTrackLabel(label) {
  const title = document.getElementById("ls-track-label");
  if (title) {
    title.textContent = label || "Lyrics Studio";
  }
}
function parseLRC(lrc, skipSync = false) {
  const preservedDurations = lsBuildDurationMap();
  const rows = String(lrc || "").replace(/\r/g, "").split("\n");
  const parsed = [];
  const timestampRegex = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  rows.forEach((rawRow, rowIndex) => {
    const line = rawRow || "";
    const trimmed = line.trim();
    if (!trimmed) {
      parsed.push(lsCreateLine("", null, { isSpacer: true, rawOrder: rowIndex }));
      return;
    }
    const matches = [...line.matchAll(timestampRegex)];
    if (matches.length > 0) {
      const text = line.replace(timestampRegex, "").trim();
      matches.forEach((match, matchIndex) => {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const fractionRaw = match[3] || "";
        const fraction = fractionRaw ? parseInt(fractionRaw, 10) / Math.pow(10, fractionRaw.length) : 0;
        const time = minutes * 60 + seconds + fraction;
        parsed.push(lsCreateLine(text, time, { rawOrder: rowIndex + matchIndex / 100 }));
      });
      return;
    }
    parsed.push(lsCreateLine(trimmed, null, { rawOrder: rowIndex }));
  });
  lsLines = parsed;
  lsHydrateDurations(preservedDurations);
  if (activeLineIndex >= lsLines.length) {
    activeLineIndex = lsLines.length - 1;
  }
  if (activeLineIndex < 0 && lsLines.length > 0) {
    const firstEditableIndex = lsLines.findIndex((line) => !line.isSpacer);
    activeLineIndex = firstEditableIndex >= 0 ? firstEditableIndex : 0;
  }
  renderLsPreview(true);
  renderLsTimeline();
  lsRefreshTransport(true);
  lsUpdatePreviewStatus();
  if (!skipSync) {
    syncRawText();
  }
}
function syncRawText() {
  if (isSyncing) return;
  isSyncing = true;
  const textarea = document.getElementById("ls-raw-input");
  if (textarea) {
    textarea.value = lsBuildLrc();
  }
  lsUpdatePreviewStatus();
  setTimeout(() => {
    isSyncing = false;
  }, 0);
}
function syncFromRawText() {
  if (isSyncing) return;
  isSyncing = true;
  const textarea = document.getElementById("ls-raw-input");
  const raw = textarea ? textarea.value : "";
  parseLRC(raw, true);
  setTimeout(() => {
    isSyncing = false;
  }, 0);
}
function lsGetTimelineDuration() {
  const entries = lsGetEntries(false);
  const audioDuration = lsAudio && Number.isFinite(lsAudio.duration) ? lsAudio.duration : 0;
  const lastLineEnd = entries.reduce((max, entry) => {
    const lineEnd = entry.line.time + (entry.line.duration || 3.2);
    return Math.max(max, lineEnd);
  }, 0);
  return Math.max(30, audioDuration, lastLineEnd + 4);
}
function lsFindPlaybackLineIndex(currentTime) {
  let playbackIndex = -1;
  lsGetEntries(false).forEach((entry) => {
    if (entry.line.time <= currentTime + 1e-3) {
      playbackIndex = entry.index;
    }
  });
  return playbackIndex;
}
function lsUpdateActiveClasses(forceScroll = false) {
  const preview = document.getElementById("ls-preview");
  if (preview) {
    preview.querySelectorAll(".ls-preview-line").forEach((node) => {
      const lineId = node.dataset.lineId;
      const idx = lsFindLineIndexById(lineId);
      node.classList.toggle("selected", lsSelectedLineIds.has(lineId) || idx === activeLineIndex);
      node.classList.toggle("playing", idx === lsPlaybackLineIndex);
    });
    if (forceScroll && !lsPreviewUserScrolled) {
      const selectedOrPlaying = preview.querySelector(".ls-preview-line.playing") || preview.querySelector(".ls-preview-line.selected");
      if (selectedOrPlaying) {
        selectedOrPlaying.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }
  const track = document.getElementById("ls-track");
  if (track) {
    track.querySelectorAll(".ls-block").forEach((node) => {
      const lineId = node.dataset.lineId;
      const idx = lsFindLineIndexById(lineId);
      node.classList.toggle("selected", lsSelectedLineIds.has(lineId) || idx === activeLineIndex);
      node.classList.toggle("playing", idx === lsPlaybackLineIndex);
    });
  }
}
function lsHandlePreviewUserScroll() {
  lsPreviewUserScrolled = true;
  if (lsPreviewScrollTimeout) {
    clearTimeout(lsPreviewScrollTimeout);
  }
  lsPreviewScrollTimeout = setTimeout(() => {
    lsPreviewUserScrolled = false;
    lsUpdateActiveClasses(true);
  }, 2e3);
}
function lsSetupPreviewScrollTracking() {
  const preview = document.getElementById("ls-preview");
  if (!preview || preview.dataset.boundScroll) return;
  preview.dataset.boundScroll = "1";
  preview.addEventListener("wheel", lsHandlePreviewUserScroll, { passive: true });
  preview.addEventListener("touchstart", lsHandlePreviewUserScroll, { passive: true });
  preview.addEventListener("mousedown", lsHandlePreviewUserScroll, { passive: true });
  preview.addEventListener("keydown", lsHandlePreviewUserScroll, { passive: true });
}
function updateActiveLine(forceScroll = false) {
  const currentTime = lsAudio && Number.isFinite(lsAudio.currentTime) ? lsAudio.currentTime : 0;
  const nextPlaybackIndex = lsFindPlaybackLineIndex(currentTime);
  if (nextPlaybackIndex !== lsPlaybackLineIndex) {
    lsPlaybackLineIndex = nextPlaybackIndex;
    lsUpdateActiveClasses(forceScroll || lsAudio && !lsAudio.paused);
    return;
  }
  if (forceScroll) {
    lsUpdateActiveClasses(true);
  }
}
function lsSelectLine(lineRef, seek = true, multi = false) {
  const idx = typeof lineRef === "string" ? lsFindLineIndexById(lineRef) : lineRef;
  if (idx < 0 || idx >= lsLines.length) return;
  activeLineIndex = idx;
  const lineId = lsLines[idx].id;
  if (multi) {
    if (lsSelectedLineIds.has(lineId)) {
      lsSelectedLineIds.delete(lineId);
    } else {
      lsSelectedLineIds.add(lineId);
    }
  } else {
    lsSelectedLineIds.clear();
    lsSelectedLineIds.add(lineId);
  }
  lsUpdateActiveClasses(true);
  if (seek && lsAudio && lsLines[idx].time !== null) {
    lsAudio.currentTime = lsLines[idx].time;
    lsRefreshTransport(true);
  }
}
function lsUpdateInlineText(lineId, value) {
  const idx = lsFindLineIndexById(lineId);
  if (idx < 0) return;
  lsLines[idx].text = value;
}
function lsCommitInlineText(lineId, value) {
  const idx = lsFindLineIndexById(lineId);
  if (idx < 0) return;
  lsLines[idx].text = (value || "").trim();
  editingIndex = -1;
  syncRawText();
  renderLsPreview(false);
  renderLsTimeline();
}
function lsCancelInlineText() {
  editingIndex = -1;
  renderLsPreview(false);
}
function lsHandleInlineEditKey(event, lineId, input) {
  if (event.key === "Enter") {
    event.preventDefault();
    lsCommitInlineText(lineId, input.value);
  } else if (event.key === "Escape") {
    event.preventDefault();
    lsCancelInlineText();
  }
}
function renderLsPreview(forceScroll = false) {
  const container = document.getElementById("ls-preview");
  if (!container) return;
  const entries = lsGetEntries(true);
  if (entries.length === 0) {
    container.innerHTML = '<div class="ls-preview-empty">\u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u0442\u0435\u043A\u0441\u0442 \u0441\u043B\u0435\u0432\u0430 \u0438\u043B\u0438 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0443\u044E \u043B\u0438\u0440\u0438\u043A\u0443.</div>';
    lsUpdatePreviewStatus();
    return;
  }
  container.innerHTML = `
        <div class="ls-preview-spacer" aria-hidden="true"></div>
        ${entries.map((entry) => {
    const { line, index } = entry;
    const isUnsynced = line.time === null;
    const timeLabel = isUnsynced ? "No time" : lsFormatTimecode(line.time, false);
    const isEditing = editingIndex === index;
    const textLabel = line.text && line.text.trim() ? escapeHtml(line.text) : '<span class="ls-preview-placeholder">\u041D\u043E\u0432\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430</span>';
    const classes = [
      "ls-preview-line",
      index === activeLineIndex ? "selected" : "",
      index === lsPlaybackLineIndex ? "playing" : "",
      isUnsynced ? "unsynced" : ""
    ].filter(Boolean).join(" ");
    return `
            <div class="${classes}" data-line-id="${line.id}" onclick="lsSelectLine('${line.id}', true)">
                <div class="ls-preview-time" ondblclick="event.stopPropagation(); lsEditLineTime('${line.id}')">${timeLabel}</div>
                ${isEditing ? `
                    <input
                        class="ls-preview-input"
                        data-line-id="${line.id}"
                        value="${escapeHtml(line.text || "")}"
                        placeholder="\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0441\u0442\u0440\u043E\u043A\u0443..."
                        oninput="lsUpdateInlineText('${line.id}', this.value)"
                        onblur="lsCommitInlineText('${line.id}', this.value)"
                        onkeydown="lsHandleInlineEditKey(event, '${line.id}', this)"
                    >
                ` : `<div class="ls-preview-text" ondblclick="event.stopPropagation(); lsEditLineText('${line.id}')">${textLabel}</div>`}
                <div class="ls-preview-actions">
                    <button class="ls-btn-small" onclick="event.stopPropagation(); lsStampLine('${line.id}')" title="Stamp current time">
                        <ion-icon name="finger-print"></ion-icon>
                    </button>
                    <button class="ls-btn-small" onclick="event.stopPropagation(); lsEditLineText('${line.id}')" title="Edit text">
                        <ion-icon name="create"></ion-icon>
                    </button>
                    <button class="ls-btn-small" onclick="event.stopPropagation(); deleteLine('${line.id}')" title="Delete line">
                        <ion-icon name="trash"></ion-icon>
                    </button>
                </div>
            </div>
        `;
  }).join("")}
        <div class="ls-preview-spacer" aria-hidden="true"></div>
    `;
  lsUpdatePreviewStatus();
  lsSetupPreviewScrollTracking();
  lsUpdateActiveClasses(forceScroll);
  if (editingIndex >= 0) {
    requestAnimationFrame(() => {
      const input = container.querySelector(".ls-preview-input");
      if (input) {
        input.focus();
        input.select();
      }
    });
  }
}
function lsApplyBlockStyles(block, line) {
  if (!block || !line) return;
  const left = (line.time || 0) * lsPixelsPerSecond;
  const width = Math.max((line.duration || 0.6) * lsPixelsPerSecond, 84);
  block.style.left = `${left}px`;
  block.style.width = `${width}px`;
}
function lsSnapTime(targetTime, lineId) {
  if (!lsIsMagnetOn) return targetTime;
  const points = [0];
  const rounded = Math.round(targetTime);
  if (Number.isFinite(rounded)) {
    points.push(rounded);
  }
  if (lsAudio && Number.isFinite(lsAudio.currentTime)) {
    points.push(lsAudio.currentTime);
  }
  lsGetEntries(false).forEach(({ line }) => {
    if (line.id === lineId) return;
    points.push(line.time);
    points.push(line.time + (line.duration || 0));
  });
  let closest = targetTime;
  let minDiff = lsMagnetThreshold;
  points.forEach((point) => {
    const diff = Math.abs(targetTime - point);
    if (diff < minDiff) {
      minDiff = diff;
      closest = point;
    }
  });
  return closest;
}
function lsBindBlockPointer(block, lineId) {
  block.addEventListener("pointerdown", (event) => {
    const index = lsFindLineIndexById(lineId);
    if (index < 0) return;
    const line = lsLines[index];
    const action = event.target.classList.contains("ls-block-handle") ? event.target.classList.contains("left") ? "trim-left" : "trim-right" : "move";
    const startX = event.clientX;
    let hasDragged = false;
    event.preventDefault();
    event.stopPropagation();
    const isMultiSelect = event.ctrlKey || event.metaKey;
    if (!lsSelectedLineIds.has(line.id)) {
      if (!isMultiSelect) {
        lsSelectedLineIds.clear();
      }
      lsSelectedLineIds.add(line.id);
    } else if (isMultiSelect) {
      lsSelectedLineIds.delete(line.id);
      lsUpdateActiveClasses(false);
      return;
    }
    activeLineIndex = index;
    lsUpdateActiveClasses(false);
    block.classList.add("dragging");
    block.setPointerCapture(event.pointerId);
    const selectedLinesData = Array.from(lsSelectedLineIds).map((id) => {
      const idx = lsFindLineIndexById(id);
      return {
        line: lsLines[idx],
        startTime: lsLines[idx].time || 0,
        startDuration: lsLines[idx].duration || 2.4
      };
    });
    const mainLineData = selectedLinesData.find((d) => d.line.id === lineId);
    if (!mainLineData) return;
    const onPointerMove = (moveEvent) => {
      if (Math.abs(moveEvent.clientX - startX) > 3) hasDragged = true;
      const deltaSeconds = (moveEvent.clientX - startX) / lsPixelsPerSecond;
      const currentMinDuration = moveEvent.shiftKey ? 0.01 : 0.45;
      if (action === "move") {
        let nextTimeMain = Math.max(0, mainLineData.startTime + deltaSeconds);
        nextTimeMain = lsSnapTime(nextTimeMain, line.id);
        const actualDelta = nextTimeMain - mainLineData.startTime;
        selectedLinesData.forEach((item) => {
          item.line.time = Math.max(0, item.startTime + actualDelta);
        });
      } else if (action === "trim-left") {
        let nextTimeMain = Math.max(0, mainLineData.startTime + deltaSeconds);
        nextTimeMain = Math.min(nextTimeMain, mainLineData.startTime + mainLineData.startDuration - currentMinDuration);
        nextTimeMain = lsSnapTime(nextTimeMain, line.id);
        const actualDelta = nextTimeMain - mainLineData.startTime;
        selectedLinesData.forEach((item) => {
          item.line.time = Math.max(0, item.startTime + actualDelta);
          item.line.duration = Math.max(currentMinDuration, item.startDuration - actualDelta);
        });
      } else if (action === "trim-right") {
        const endTime = Math.max(mainLineData.startTime + currentMinDuration, mainLineData.startTime + mainLineData.startDuration + deltaSeconds);
        const snappedEnd = lsSnapTime(endTime, line.id);
        const actualDelta = snappedEnd - (mainLineData.startTime + mainLineData.startDuration);
        selectedLinesData.forEach((item) => {
          item.line.duration = Math.max(currentMinDuration, item.startDuration + actualDelta);
        });
      }
      selectedLinesData.forEach((item) => {
        const b = document.querySelector(`.ls-block[data-line-id="${item.line.id}"]`);
        if (b) lsApplyBlockStyles(b, item.line);
      });
      lsRefreshTransport(false);
    };
    const onPointerUp = (upEvent) => {
      block.classList.remove("dragging");
      block.releasePointerCapture(upEvent.pointerId);
      block.removeEventListener("pointermove", onPointerMove);
      block.removeEventListener("pointerup", onPointerUp);
      block.removeEventListener("pointercancel", onPointerUp);
      if (hasDragged) {
        block.dataset.preventClick = "true";
        setTimeout(() => block.dataset.preventClick = "false", 100);
      }
      syncRawText();
      renderLsPreview(false);
      renderLsTimeline();
      lsRefreshTransport(true);
    };
    block.addEventListener("pointermove", onPointerMove);
    block.addEventListener("pointerup", onPointerUp);
    block.addEventListener("pointercancel", onPointerUp);
  });
}
function renderLsTimeline() {
  const wrapper = document.getElementById("ls-timeline-wrapper");
  const ruler = document.getElementById("ls-ruler");
  const track = document.getElementById("ls-track");
  const container = document.getElementById("ls-timeline-container");
  if (!wrapper || !ruler || !track || !container) return;
  const totalDuration = lsGetTimelineDuration();
  const totalWidth = Math.max(container.clientWidth, totalDuration * lsPixelsPerSecond + 120);
  wrapper.style.width = `${totalWidth}px`;
  ruler.innerHTML = "";
  const seconds = Math.ceil(totalDuration);
  for (let second = 0; second <= seconds; second++) {
    const tick = document.createElement("div");
    tick.className = `ls-ruler-tick ${second % 5 === 0 ? "large" : ""}`;
    tick.style.left = `${second * lsPixelsPerSecond}px`;
    ruler.appendChild(tick);
    if (second % 5 === 0) {
      const label = document.createElement("div");
      label.className = "ls-ruler-time";
      label.style.left = `${second * lsPixelsPerSecond}px`;
      label.textContent = `${Math.floor(second / 60)}:${String(second % 60).padStart(2, "0")}`;
      ruler.appendChild(label);
    }
  }
  const layoutEntries = [];
  lsGetEntries(false).forEach((entry) => {
    const lane = entry.index % 3;
    layoutEntries.push({ ...entry, lane });
  });
  const laneHeight = 68;
  const laneCount = 3;
  track.style.height = `${Math.max(180, laneCount * laneHeight + 34)}px`;
  track.innerHTML = "";
  layoutEntries.forEach(({ line, index, lane }) => {
    const block = document.createElement("div");
    const classes = [
      "ls-block",
      lsSelectedLineIds.has(line.id) || index === activeLineIndex ? "selected" : "",
      index === lsPlaybackLineIndex ? "playing" : ""
    ].filter(Boolean).join(" ");
    block.className = classes;
    block.dataset.lineId = line.id;
    block.innerHTML = `
            <div class="ls-block-handle left"></div>
            <div class="ls-block-text">${escapeHtml(line.text || "...")}</div>
            <div class="ls-block-handle right"></div>
        `;
    lsApplyBlockStyles(block, line);
    block.style.top = `${18 + lane * laneHeight}px`;
    block.addEventListener("click", (event) => {
      event.stopPropagation();
      if (block.dataset.preventClick === "true") return;
      lsSelectLine(line.id, true, event.ctrlKey || event.metaKey);
    });
    lsBindBlockPointer(block, line.id);
    track.appendChild(block);
  });
  lsUpdateActiveClasses(false);
}
function lsRefreshTransport(forceScroll = false) {
  const currentTime = lsAudio && Number.isFinite(lsAudio.currentTime) ? lsAudio.currentTime : 0;
  const totalDuration = lsAudio && Number.isFinite(lsAudio.duration) ? lsAudio.duration : lsGetTimelineDuration();
  const timeDisplay = document.getElementById("ls-time-display");
  const durationDisplay = document.getElementById("ls-duration-display");
  const playhead = document.getElementById("ls-playhead");
  const container = document.getElementById("ls-timeline-container");
  if (timeDisplay) {
    timeDisplay.textContent = lsFormatTimecode(currentTime, false);
  }
  if (durationDisplay) {
    durationDisplay.textContent = `/ ${lsFormatTimecode(totalDuration, false)}`;
  }
  if (playhead) {
    playhead.style.left = `${currentTime * lsPixelsPerSecond}px`;
  }
  if (container) {
    const playheadLeft = currentTime * lsPixelsPerSecond;
    const viewWidth = container.clientWidth;
    if (forceScroll) {
      container.scrollTo({
        left: Math.max(0, playheadLeft - viewWidth * 0.45),
        behavior: "smooth"
      });
    } else if (lsAudio && !lsAudio.paused) {
      const currentScroll = container.scrollLeft;
      if (playheadLeft > currentScroll + viewWidth * 0.72 || playheadLeft < currentScroll + viewWidth * 0.2) {
        container.scrollLeft = Math.max(0, playheadLeft - viewWidth * 0.35);
      }
    }
  }
  updateActiveLine(forceScroll);
}
function lsSetPlayButtonState() {
  const button = document.getElementById("ls-play-btn");
  if (!button) return;
  button.innerHTML = lsAudio && !lsAudio.paused ? '<ion-icon name="pause"></ion-icon>' : '<ion-icon name="play"></ion-icon>';
}
function lsStopPlaybackLoop() {
  if (lsAnimationFrame) {
    cancelAnimationFrame(lsAnimationFrame);
    lsAnimationFrame = null;
  }
}
function lsStartPlaybackLoop() {
  lsStopPlaybackLoop();
  const tick = () => {
    if (!lsAudio || lsAudio.paused) {
      lsStopPlaybackLoop();
      return;
    }
    lsRefreshTransport(false);
    lsAnimationFrame = requestAnimationFrame(tick);
  };
  lsAnimationFrame = requestAnimationFrame(tick);
}
function setupLsAudio() {
  lsAudio = document.getElementById("ls-audio");
  if (!lsAudio || lsListenersReady) return;
  lsListenersReady = true;
  lsAudio.preload = "metadata";
  lsAudio.addEventListener("loadedmetadata", () => {
    renderLsTimeline();
    lsRefreshTransport(true);
  });
  lsAudio.addEventListener("timeupdate", () => {
    lsRefreshTransport(false);
  });
  lsAudio.addEventListener("play", () => {
    lsSetPlayButtonState();
    lsStartPlaybackLoop();
  });
  lsAudio.addEventListener("pause", () => {
    lsSetPlayButtonState();
    lsStopPlaybackLoop();
  });
  lsAudio.addEventListener("ended", () => {
    lsSetPlayButtonState();
    lsStopPlaybackLoop();
    lsRefreshTransport(true);
  });
  const zoomInput = document.getElementById("ls-zoom");
  if (zoomInput && !zoomInput.dataset.bound) {
    zoomInput.dataset.bound = "1";
    zoomInput.addEventListener("input", (event) => {
      const timelineContainer2 = document.getElementById("ls-timeline-container");
      const previousScale = lsPixelsPerSecond;
      const anchorTime = lsAudio && Number.isFinite(lsAudio.currentTime) ? lsAudio.currentTime : timelineContainer2 ? (timelineContainer2.scrollLeft + timelineContainer2.clientWidth / 2) / previousScale : 0;
      lsPixelsPerSecond = parseInt(event.target.value, 10);
      renderLsTimeline();
      if (timelineContainer2) {
        timelineContainer2.scrollLeft = Math.max(0, anchorTime * lsPixelsPerSecond - timelineContainer2.clientWidth / 2);
      }
      lsRefreshTransport(false);
    });
  }
  const timelineContainer = document.getElementById("ls-timeline-container");
  if (timelineContainer && !timelineContainer.dataset.bound) {
    timelineContainer.dataset.bound = "1";
    timelineContainer.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".ls-block")) return;
      const rect = timelineContainer.getBoundingClientRect();
      const offsetX = event.clientX - rect.left + timelineContainer.scrollLeft;
      if (offsetX >= 0 && lsAudio) {
        lsAudio.currentTime = Math.max(0, offsetX / lsPixelsPerSecond);
        lsRefreshTransport(true);
      }
    });
  }
}
function lsSwitchTab(tab) {
  lsCurrentTab = tab;
  const previewTab = document.getElementById("ls-mobile-tab-preview");
  const editorTab = document.getElementById("ls-mobile-tab-editor");
  const previewPanel = document.getElementById("ls-preview-panel");
  const editorPanel = document.getElementById("ls-editor-panel");
  if (previewTab) previewTab.classList.toggle("active", tab === "preview");
  if (editorTab) editorTab.classList.toggle("active", tab === "editor");
  if (previewPanel) previewPanel.classList.toggle("hidden-mobile", tab !== "preview");
  if (editorPanel) editorPanel.classList.toggle("hidden-mobile", tab !== "editor");
}
function lsUpdateMagnetButton() {
  const button = document.getElementById("ls-magnet-btn");
  if (button) {
    button.classList.toggle("active", lsIsMagnetOn);
  }
}
function lsToggleMagnet() {
  lsIsMagnetOn = !lsIsMagnetOn;
  lsUpdateMagnetButton();
}
function openLyricsStudio() {
  let existingLyrics = "";
  let audioUrl = "";
  let trackLabel = "";
  lyricsStudioTrackId = null;
  editingIndex = -1;
  editingTimeIndex = -1;
  lsPlaybackLineIndex = -1;
  lsPreviewUserScrolled = false;
  const pageUpload = document.getElementById("page-upload");
  const modalEdit = document.getElementById("modal-edit-track");
  if (lsAudioObjectUrl) {
    URL.revokeObjectURL(lsAudioObjectUrl);
    lsAudioObjectUrl = null;
  }
  if (pageUpload && pageUpload.classList.contains("active")) {
    existingLyrics = document.getElementById("track-lyrics").value || "";
    const audioInput = document.getElementById("audio-file");
    if (audioInput && audioInput.files && audioInput.files[0]) {
      lsAudioObjectUrl = URL.createObjectURL(audioInput.files[0]);
      audioUrl = lsAudioObjectUrl;
      trackLabel = audioInput.files[0].name;
    }
  } else if (modalEdit && modalEdit.classList.contains("active")) {
    existingLyrics = document.getElementById("edit-track-lyrics").value || "";
    lyricsStudioTrackId = currentEditTrackId;
    const track = myTracks.find((item) => item.id === lyricsStudioTrackId);
    if (track) {
      audioUrl = track.audio_url || (track.filename ? `/uploads/${track.filename}` : "");
      const artist = track.artist ? ` - ${track.artist}` : "";
      trackLabel = `${track.title || "Track"}${artist}`;
    }
  }
  if (!audioUrl) {
    alert("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0430\u0443\u0434\u0438\u043E\u0444\u0430\u0439\u043B \u0438\u043B\u0438 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0442\u0440\u0435\u043A \u0434\u043B\u044F \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F");
    return;
  }
  const rawInput = document.getElementById("ls-raw-input");
  if (rawInput) {
    rawInput.value = existingLyrics || "";
  }
  setupLsAudio();
  lsSetTrackLabel(trackLabel);
  lsSwitchTab("preview");
  lsUpdateMagnetButton();
  if (lsAudio) {
    lsStopPlaybackLoop();
    lsAudio.pause();
    lsAudio.src = audioUrl;
    lsAudio.load();
  }
  if (existingLyrics && existingLyrics.trim()) {
    parseLRC(existingLyrics, true);
  } else {
    lsLines = [];
    activeLineIndex = -1;
    renderLsPreview(true);
    renderLsTimeline();
    lsRefreshTransport(true);
    lsUpdatePreviewStatus();
  }
  const zoomInput = document.getElementById("ls-zoom");
  if (zoomInput) {
    zoomInput.value = String(lsPixelsPerSecond);
  }
  document.getElementById("modal-lyrics-studio").classList.add("active");
  requestAnimationFrame(() => {
    renderLsPreview(true);
    renderLsTimeline();
    lsRefreshTransport(true);
  });
}
function closeLyricsStudio() {
  closeModal("modal-lyrics-studio");
  lsStopPlaybackLoop();
  if (lsAudio) {
    lsAudio.pause();
    lsAudio.removeAttribute("src");
    lsAudio.load();
  }
  if (lsAudioObjectUrl) {
    URL.revokeObjectURL(lsAudioObjectUrl);
    lsAudioObjectUrl = null;
  }
  lyricsStudioTrackId = null;
  activeLineIndex = -1;
  lsPlaybackLineIndex = -1;
  editingIndex = -1;
  editingTimeIndex = -1;
}
function lsParseText() {
  syncFromRawText();
}
function lsPlayPause() {
  if (!lsAudio || !lsAudio.src) return;
  if (lsAudio.paused) {
    lsAudio.play().catch((error) => {
      console.error("Lyrics Studio play failed:", error);
    });
  } else {
    lsAudio.pause();
  }
}
function lsResolveStampTargetIndex() {
  if (activeLineIndex >= 0 && activeLineIndex < lsLines.length) {
    const activeLine = lsLines[activeLineIndex];
    if (activeLine && !activeLine.isSpacer && activeLine.text && activeLine.text.trim() && activeLine.time === null) {
      return activeLineIndex;
    }
    const nextAfterActive = lsFindNextUnsyncedIndex(activeLineIndex);
    if (nextAfterActive !== -1) {
      return nextAfterActive;
    }
  }
  return lsFindNextUnsyncedIndex(-1);
}
function lsStampLine(lineId) {
  const idx = lsFindLineIndexById(lineId);
  if (idx < 0 || !lsAudio) return;
  lsLines[idx].time = lsAudio.currentTime || 0;
  if (!lsLines[idx].duration) {
    lsLines[idx].duration = 2.4;
  }
  editingIndex = -1;
  activeLineIndex = lsFindNextUnsyncedIndex(idx);
  if (activeLineIndex === -1) {
    activeLineIndex = lsFindNextEditableIndex(idx);
  }
  syncRawText();
  renderLsPreview(true);
  renderLsTimeline();
  lsRefreshTransport(true);
}
function lsSyncCurrentLine() {
  if (!lsAudio) return;
  addNewLine({
    time: lsAudio.currentTime || 0,
    text: "",
    startEditing: true,
    insertAfterActive: true
  });
}
function lsEditLineText(lineId) {
  const idx = lsFindLineIndexById(lineId);
  if (idx < 0) return;
  activeLineIndex = idx;
  editingIndex = idx;
  renderLsPreview(true);
}
function lsEditLineTime(lineId) {
  const idx = lsFindLineIndexById(lineId);
  if (idx < 0) return;
  const currentValue = lsLines[idx].time !== null ? lsFormatTimecode(lsLines[idx].time, false) : "00:00.00";
  const nextValue = prompt("\u0412\u0440\u0435\u043C\u044F \u0441\u0442\u0440\u043E\u043A\u0438 (mm:ss.xx)", currentValue);
  if (nextValue === null) return;
  const match = nextValue.trim().match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return;
  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  const fractionRaw = match[3] || "";
  const fraction = fractionRaw ? parseInt(fractionRaw, 10) / Math.pow(10, fractionRaw.length) : 0;
  lsLines[idx].time = minutes * 60 + seconds + fraction;
  if (!lsLines[idx].duration) {
    lsLines[idx].duration = 2.4;
  }
  activeLineIndex = idx;
  syncRawText();
  renderLsPreview(false);
  renderLsTimeline();
  lsRefreshTransport(true);
}
function addNewLine(options = {}) {
  const currentTime = options.time ?? (lsAudio && Number.isFinite(lsAudio.currentTime) ? lsAudio.currentTime : 0);
  const insertAfterActive = options.insertAfterActive !== false;
  const insertIndex = insertAfterActive && activeLineIndex >= 0 ? activeLineIndex + 1 : lsLines.length;
  const newLine = lsCreateLine(options.text || "", currentTime, {
    duration: 2.4,
    rawOrder: insertIndex
  });
  lsLines.splice(insertIndex, 0, newLine);
  lsReindexRawOrder();
  activeLineIndex = insertIndex;
  editingIndex = options.startEditing ? insertIndex : -1;
  syncRawText();
  renderLsPreview(true);
  renderLsTimeline();
  lsRefreshTransport(true);
}
function deleteLine(lineRef) {
  const idx = typeof lineRef === "string" ? lsFindLineIndexById(lineRef) : lineRef;
  if (idx < 0 || idx >= lsLines.length) return;
  if (!confirm("\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u044D\u0442\u0443 \u0441\u0442\u0440\u043E\u043A\u0443?")) return;
  lsLines.splice(idx, 1);
  editingIndex = -1;
  if (activeLineIndex >= lsLines.length) {
    activeLineIndex = lsLines.length - 1;
  }
  syncRawText();
  renderLsPreview(false);
  renderLsTimeline();
  lsRefreshTransport(false);
}
function lsExport() {
  syncRawText();
  const rawInput = document.getElementById("ls-raw-input");
  const lrc = rawInput ? rawInput.value.trimEnd() : "";
  if (lyricsStudioTrackId) {
    document.getElementById("edit-track-lyrics").value = lrc;
  } else {
    document.getElementById("track-lyrics").value = lrc;
  }
  closeLyricsStudio();
}
window.openLyricsStudio = openLyricsStudio;
window.closeLyricsStudio = closeLyricsStudio;
window.lsSwitchTab = lsSwitchTab;
window.lsToggleMagnet = lsToggleMagnet;
window.lsPlayPause = lsPlayPause;
window.lsSyncCurrentLine = lsSyncCurrentLine;
window.lsParseText = lsParseText;
window.lsExport = lsExport;
window.editTrack = editTrack;
window.playMyTrack = window.playMyTrack;
window.shareTrack = window.shareTrack;
window.moveTrack = async function (trackId, direction) {
  if (direction !== "up" && direction !== "down") return;
  try {
    const res = await fetch(`/api/tracks/${trackId}/move`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F");
      return;
    }
    loadMyTracks();
  } catch (e) {
    console.error("moveTrack error:", e);
  }
};
window.toggleAlbumVisibility = async function (albumId) {
  try {
    const res = await fetch(`/api/albums/${albumId}/toggle-visibility`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.error || "\u041E\u0448\u0438\u0431\u043A\u0430");
      return;
    }
    loadMyAlbums();
  } catch (e) {
    console.error("toggleAlbumVisibility error:", e);
  }
};
if (typeof renderMyTracks !== "undefined") {
  renderMyTracks = window.renderMyTracks;
}
if (typeof playMyTrack !== "undefined") {
  playMyTrack = window.playMyTrack;
}
if (typeof shareTrack !== "undefined") {
  shareTrack = window.shareTrack;
}
window.showCreateAlbum = showCreateAlbum;
window.showProfile = () => switchPage("profile");
window.saveProfile = saveProfile;
window.copyProfileLink = copyProfileLink;
window.showShareLibrary = showShareLibrary;
window.closeModal = closeModal;
window.openLyricsStudio = openLyricsStudio;
window.loadProfile = loadProfile;
window.loadMyTracks = loadMyTracks;
window.loadMyAlbums = loadMyAlbums;
window.loadUserData = loadUserData;
window.initApp = initApp;
function toggleMiniVolume() {
  const miniVolumeContainer = document.getElementById("mini-volume-container");
  if (miniVolumeContainer) {
    const isVisible = miniVolumeContainer.style.display === "flex";
    miniVolumeContainer.style.display = isVisible ? "none" : "flex";
  }
}
window.toggleMiniVolume = toggleMiniVolume;
document.addEventListener("DOMContentLoaded", () => {
  const miniVolumeSlider = document.getElementById("mini-volume-slider");
  const audio = document.getElementById("audio-element");
  if (miniVolumeSlider && audio) {
    let isInteracting = false;
    const preventScroll = (e) => {
      if (isInteracting) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    miniVolumeSlider.addEventListener("touchstart", (e) => {
      isInteracting = true;
      e.stopPropagation();
    }, { passive: false });
    miniVolumeSlider.addEventListener("touchmove", (e) => {
      if (isInteracting) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { passive: false });
    miniVolumeSlider.addEventListener("touchend", (e) => {
      isInteracting = false;
      e.stopPropagation();
    }, { passive: false });
    miniVolumeSlider.addEventListener("touchcancel", (e) => {
      isInteracting = false;
      e.stopPropagation();
    }, { passive: false });
    miniVolumeSlider.addEventListener("input", (e) => {
      if (audio) {
        audio.volume = parseFloat(e.target.value);
      }
    });
    if (audio) {
      audio.addEventListener("volumechange", () => {
        if (miniVolumeSlider) {
          miniVolumeSlider.value = audio.volume;
        }
      });
    }
  }
});
window.lyricsStudioTogglePlay = lsPlayPause;
window.lyricsStudioInsertTimestamp = lsSyncCurrentLine;
window.lyricsStudioSave = lsExport;
window.deleteCurrentTrack = deleteCurrentTrack;
window.toggleTrackVisibility = toggleTrackVisibility;
async function toggleTrackLike(trackId) {
  if (!window.currentUser) {
    const botUrl = "https://tg.swag.best/swagplayerobot?start=auth";
    const botUrlTme = "https://t.me/swagplayerobot?start=auth";
    if (window.Telegram && window.Telegram.WebApp) {
      window.Telegram.WebApp.openTelegramLink(botUrlTme);
    } else {
      window.location.href = botUrl;
    }
    return;
  }
  const trackLikeEl = document.querySelector(`.track-like-btn[data-track-id="${trackId}"]`);
  const wantLike = trackLikeEl ? !trackLikeEl.classList.contains("liked") : true;
  try {
    const res = await fetch(`/api/tracks/${trackId}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ like: wantLike })
    });
    if (!res.ok) {
      if (res.status === 401) {
        let errorData = {};
        try {
          const clonedRes = res.clone();
          const text = await clonedRes.text();
          errorData = text ? JSON.parse(text) : {};
        } catch (e) {
          console.log("Failed to parse error response:", e);
        }
        const botUrl = errorData.auth_url || "https://tg.swag.best/swagplayerobot?start=auth";
        const botUrlTme = botUrl.replace("https://tg.swag.best", "https://t.me");
        const message = errorData.message || "\u0414\u043B\u044F \u0442\u043E\u0433\u043E \u0447\u0442\u043E\u0431\u044B \u0441\u0442\u0430\u0432\u0438\u0442\u044C \u043B\u0430\u0439\u043A\u0438, \u043F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0443\u0439\u0442\u0435\u0441\u044C.";
        const shouldRedirect = confirm(message + "\n\n\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0431\u043E\u0442\u0430 \u0434\u043B\u044F \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446\u0438\u0438?");
        if (shouldRedirect) {
          if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.openTelegramLink(botUrlTme);
          } else {
            window.location.href = botUrl;
          }
        }
      } else {
        alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043F\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0435 \u043B\u0430\u0439\u043A\u0430.");
      }
      return;
    }
    const data = await res.json();
    if (data.success) {
      const trackElement = document.querySelector(`.track-like-btn[data-track-id="${trackId}"]`);
      if (trackElement) {
        const likeIcon = trackElement.querySelector("ion-icon");
        const likesCountSpan = trackElement.querySelector(".track-likes-count");
        if (likeIcon) likeIcon.name = data.liked ? "heart" : "heart-outline";
        if (likesCountSpan) likesCountSpan.textContent = data.likes_count;
        if (data.liked) {
          trackElement.classList.add("liked");
        } else {
          trackElement.classList.remove("liked");
        }
      }
      const track = myTracks.find((t) => t.id === trackId);
      if (track) {
        track.is_liked = data.liked;
        track.likes_count = data.likes_count;
      }
    } else {
      alert(data.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043F\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0435 \u043B\u0430\u0439\u043A\u0430.");
    }
  } catch (e) {
    console.error("Error toggling track like:", e);
    alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0442\u0438 \u043F\u0440\u0438 \u043F\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0435 \u043B\u0430\u0439\u043A\u0430.");
  }
}
async function toggleAlbumLike(albumId) {
  if (!window.currentUser) {
    alert("\u0414\u043B\u044F \u0442\u043E\u0433\u043E \u0447\u0442\u043E\u0431\u044B \u0441\u0442\u0430\u0432\u0438\u0442\u044C \u043B\u0430\u0439\u043A\u0438, \u043F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0443\u0439\u0442\u0435\u0441\u044C.");
    return;
  }
  const albumLikeEl = document.querySelector(`.album-like-btn[data-album-id="${albumId}"]`);
  const wantLike = albumLikeEl ? !albumLikeEl.classList.contains("liked") : true;
  try {
    const res = await fetch(`/api/albums/${albumId}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ like: wantLike })
    });
    const data = await res.json();
    if (data.success) {
      const albumElement = document.querySelector(`.album-like-btn[data-album-id="${albumId}"]`);
      if (albumElement) {
        const likeIcon = albumElement.querySelector("ion-icon");
        const likesCountSpan = albumElement.querySelector(".album-likes-count");
        if (likeIcon) likeIcon.name = data.liked ? "heart" : "heart-outline";
        if (likesCountSpan) likesCountSpan.textContent = data.likes_count;
        if (data.liked) {
          albumElement.classList.add("liked");
        } else {
          albumElement.classList.remove("liked");
        }
      }
      const album = myAlbums.find((a) => a.id === albumId);
      if (album) {
        album.is_liked = data.liked;
        album.likes_count = data.likes_count;
      }
    } else {
      alert(data.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043F\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0435 \u043B\u0430\u0439\u043A\u0430.");
    }
  } catch (e) {
    console.error("Error toggling album like:", e);
    alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0442\u0438 \u043F\u0440\u0438 \u043F\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0435 \u043B\u0430\u0439\u043A\u0430.");
  }
}
async function toggleCurrentTrackLike() {
  if (!window.currentUser) {
    const botUrl = "https://tg.swag.best/swagplayerobot?start=auth";
    const botUrlTme = "https://t.me/swagplayerobot?start=auth";
    if (window.Telegram && window.Telegram.WebApp) {
      window.Telegram.WebApp.openTelegramLink(botUrlTme);
    } else {
      window.location.href = botUrl;
    }
    return;
  }
  let track = null;
  if (typeof window.getCurrentTrack === "function") {
    track = window.getCurrentTrack();
  } else if (typeof window.tracks !== "undefined" && typeof window.currentIndex !== "undefined" && window.currentIndex >= 0 && window.currentIndex < window.tracks.length) {
    track = window.tracks[window.currentIndex];
  }
  if (!track || !track.id) {
    return;
  }
  if (track && track.id) {
    try {
      const res = await fetch(`/api/tracks/${track.id}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ like: !track.is_liked })
      });
      if (!res.ok) {
        if (res.status === 401) {
          let errorData = {};
          try {
            const clonedRes = res.clone();
            const text = await clonedRes.text();
            errorData = text ? JSON.parse(text) : {};
          } catch (e) {
            console.log("Failed to parse error response:", e);
          }
          const botUrl = errorData.auth_url || "https://tg.swag.best/swagplayerobot?start=auth";
          const botUrlTme = botUrl.replace("https://tg.swag.best", "https://t.me");
          if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.openTelegramLink(botUrlTme);
          } else {
            window.location.href = botUrl;
          }
        } else {
          alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043F\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0435 \u043B\u0430\u0439\u043A\u0430.");
        }
        return;
      }
      const data = await res.json();
      if (data.success) {
        window.currentTrackLiked = data.liked || false;
        if (data.likes_count !== void 0) {
          window.currentTrackLikesCount = data.likes_count || 0;
        }
        if (typeof window.updateLikeUI === "function") {
          window.updateLikeUI();
        } else {
          const playerLikeIcon = document.getElementById("player-like-icon");
          const playerLikesCount = document.getElementById("player-likes-count");
          const playerLikeBtn = document.getElementById("player-like-btn");
          if (playerLikeIcon) {
            playerLikeIcon.name = window.currentTrackLiked ? "heart" : "heart-outline";
            if (window.currentTrackLiked) {
              playerLikeIcon.setAttribute("fill", "solid");
              playerLikeIcon.style.color = "#fa2d48";
            } else {
              playerLikeIcon.removeAttribute("fill");
              playerLikeIcon.style.color = "white";
            }
          }
          if (playerLikesCount) {
            playerLikesCount.textContent = window.currentTrackLikesCount || 0;
          }
          if (playerLikeBtn) {
            if (window.currentTrackLiked) {
              playerLikeBtn.classList.add("liked");
              playerLikeBtn.style.background = "rgba(250, 45, 72, 0.2)";
            } else {
              playerLikeBtn.classList.remove("liked");
              playerLikeBtn.style.background = "rgba(255,255,255,0.1)";
            }
          }
        }
        if (typeof window.tracks !== "undefined" && window.tracks.length > 0) {
          const trackIndex = window.tracks.findIndex((t) => t.id === track.id);
          if (trackIndex >= 0) {
            window.tracks[trackIndex].is_liked = data.liked;
            window.tracks[trackIndex].likes_count = data.likes_count;
          }
        }
      } else {
        alert(data.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043F\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0435 \u043B\u0430\u0439\u043A\u0430.");
      }
    } catch (e) {
      console.error("Error toggling current track like:", e);
      alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u0435\u0442\u0438 \u043F\u0440\u0438 \u043F\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0435 \u043B\u0430\u0439\u043A\u0430.");
    }
  }
}
window.toggleTrackLike = toggleTrackLike;
window.toggleAlbumLike = toggleAlbumLike;
window.toggleCurrentTrackLike = toggleCurrentTrackLike;
window.retryAuth = retryAuth;
window.viewAlbum = viewAlbum;
window.addTrackToAlbum = addTrackToAlbum;
window.showAddToAlbum = showAddToAlbum;
window.removeTrackFromAlbum = removeTrackFromAlbum;
window.deleteAlbum = deleteAlbum;
window.showAddTracksToAlbum = showAddTracksToAlbum;
let currentEditAlbumId = null;
async function editAlbum(albumId) {
  const album = myAlbums.find((a) => a.id === albumId);
  if (!album) return;
  currentEditAlbumId = albumId;
  const modal = document.createElement("div");
  modal.className = "modal active";
  modal.id = "modal-edit-album";
  modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0430\u043B\u044C\u0431\u043E\u043C</h2>
                <button class="btn-icon" onclick="closeModal('modal-edit-album')">
                    <ion-icon name="close"></ion-icon>
                </button>
            </div>
            <form id="edit-album-form">
                <div class="form-group">
                    <label>\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0430\u043B\u044C\u0431\u043E\u043C\u0430</label>
                    <input type="text" id="edit-album-title" value="${album.title}" required>
                </div>
                <div class="form-group">
                    <label>\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435</label>
                    <textarea id="edit-album-description" rows="3">${album.description || ""}</textarea>
                </div>
                <div class="form-group">
                    <label>\u041E\u0431\u043B\u043E\u0436\u043A\u0430 \u0430\u043B\u044C\u0431\u043E\u043C\u0430</label>
                    <input type="file" id="edit-album-cover-file" accept="image/*">
                    <div class="cover-preview" id="edit-album-cover-preview">
                        ${album.cover_url ? `<img src="${album.cover_url}" alt="Cover">` : ""}
                    </div>
                </div>
                <div class="form-group">
                    <label>\u041A\u043E\u0440\u043E\u0442\u043A\u0430\u044F \u0441\u0441\u044B\u043B\u043A\u0430</label>
                    <input type="text" id="edit-album-slug" value="${album.slug || ""}">
                </div>
                <div class="form-actions" style="display:flex; gap:10px; margin-top:20px;">
                    <button type="button" class="btn-danger" onclick="deleteAlbum(${albumId})" style="flex:1;">
                        <ion-icon name="trash"></ion-icon>
                        \u0423\u0434\u0430\u043B\u0438\u0442\u044C
                    </button>
                    <button type="button" class="btn-secondary" onclick="closeModal('modal-edit-album')" style="flex:1;">
                        \u041E\u0442\u043C\u0435\u043D\u0430
                    </button>
                    <button type="submit" class="btn-primary" style="flex:1;">
                        <ion-icon name="save"></ion-icon>
                        \u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C
                    </button>
                </div>
            </form>
        </div>
    `;
  document.body.appendChild(modal);
  document.getElementById("edit-album-cover-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        document.getElementById("edit-album-cover-preview").innerHTML = `<img src="${event.target.result}" alt="Cover">`;
      };
      reader.readAsDataURL(file);
    }
  });
  document.getElementById("edit-album-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append("title", document.getElementById("edit-album-title").value);
    formData.append("description", document.getElementById("edit-album-description").value);
    const slug = document.getElementById("edit-album-slug").value;
    if (slug) formData.append("slug", slug);
    const coverFile = document.getElementById("edit-album-cover-file").files[0];
    if (coverFile) formData.append("cover", coverFile);
    try {
      const res = await fetch(`/api/albums/${albumId}`, {
        method: "PUT",
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        alert("\u0410\u043B\u044C\u0431\u043E\u043C \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D!");
        document.getElementById("modal-edit-album").remove();
        await loadMyAlbums();
      } else {
        alert(data.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0430\u043B\u044C\u0431\u043E\u043C\u0430");
      }
    } catch (err) {
      alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F \u0430\u043B\u044C\u0431\u043E\u043C\u0430");
      console.error(err);
    }
  });
}
async function manageAlbumTracks(albumId) {
  const album = myAlbums.find((a) => a.id === albumId);
  if (!album) return;
  const oldModal = document.getElementById("modal-manage-album-tracks");
  if (oldModal) {
    oldModal.remove();
  }
  let albumTracks = [];
  try {
    const res = await fetch(`/api/albums/${albumId}/tracks?t=${Date.now()}`);
    if (res.ok) {
      albumTracks = await res.json();
    }
  } catch (e) {
    console.error("Error loading album tracks:", e);
  }
  const modal = document.createElement("div");
  modal.className = "modal active";
  modal.id = "modal-manage-album-tracks";
  modal.innerHTML = `
        <div class="modal-content modal-large">
            <div class="modal-header">
                <h2>\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0442\u0440\u0435\u043A\u0430\u043C\u0438: ${album.title}</h2>
                <button class="btn-icon" onclick="closeModal('modal-manage-album-tracks')">
                    <ion-icon name="close"></ion-icon>
                </button>
            </div>
            <div style="margin-bottom: 20px; display:flex; gap:10px;">
                <button class="btn-primary" onclick="showAddTracksToAlbum(${albumId})" style="flex:1;">
                    <ion-icon name="add"></ion-icon>
                    \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u0440\u0435\u043A\u0438
                </button>
                <button class="btn-secondary" onclick="closeModal('modal-manage-album-tracks')" style="flex:1;">
                    \u0417\u0430\u043A\u0440\u044B\u0442\u044C
                </button>
            </div>
            <div id="album-tracks-list" style="max-height: 500px; overflow-y: auto; padding: 10px 0;">
                ${albumTracks.length === 0 ? '<p style="text-align:center; color:rgba(255,255,255,0.5); padding: 40px 20px;">\u0412 \u0430\u043B\u044C\u0431\u043E\u043C\u0435 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0442\u0440\u0435\u043A\u043E\u0432. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u0440\u0435\u043A\u0438" \u0447\u0442\u043E\u0431\u044B \u043D\u0430\u0447\u0430\u0442\u044C.</p>' : ""}
            </div>
        </div>
    `;
  document.body.appendChild(modal);
  renderAlbumTracks(albumId, albumTracks);
}
function renderAlbumTracks(albumId, tracks) {
  const container = document.getElementById("album-tracks-list");
  if (!container) return;
  if (tracks.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:rgba(255,255,255,0.5);">\u0412 \u0430\u043B\u044C\u0431\u043E\u043C\u0435 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0442\u0440\u0435\u043A\u043E\u0432</p>';
    return;
  }
  container.innerHTML = tracks.map((track, index) => `
        <div class="album-track-item" data-track-id="${track.id}" style="display:flex; align-items:center; justify-content:space-between; padding:14px; background:#1c1c1e; border-radius:10px; margin-bottom:10px; transition:all 0.2s; border: 1px solid rgba(255,255,255,0.05);" 
             onmouseover="this.style.background='#232e3c'; this.style.borderColor='rgba(255,255,255,0.1)'" 
             onmouseout="this.style.background='#1c1c1e'; this.style.borderColor='rgba(255,255,255,0.05)'">
            <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">
                <div style="display:flex; flex-direction:column; gap:6px; flex-shrink:0;">
                    ${index > 0 ? `<button onclick="moveTrackInAlbum(${albumId}, ${track.id}, 'up')" style="background:rgba(255,255,255,0.1); border:none; color:white; padding:6px; border-radius:6px; cursor:pointer; width:32px; height:32px; display:flex; align-items:center; justify-content:center; transition:background 0.2s;" 
                        onmouseover="this.style.background='rgba(255,255,255,0.2)'" 
                        onmouseout="this.style.background='rgba(255,255,255,0.1)'" 
                        title="\u0412\u0432\u0435\u0440\u0445">
                        <ion-icon name="chevron-up" style="font-size:18px;"></ion-icon>
                    </button>` : '<div style="width:32px; height:32px;"></div>'}
                    ${index < tracks.length - 1 ? `<button onclick="moveTrackInAlbum(${albumId}, ${track.id}, 'down')" style="background:rgba(255,255,255,0.1); border:none; color:white; padding:6px; border-radius:6px; cursor:pointer; width:32px; height:32px; display:flex; align-items:center; justify-content:center; transition:background 0.2s;" 
                        onmouseover="this.style.background='rgba(255,255,255,0.2)'" 
                        onmouseout="this.style.background='rgba(255,255,255,0.1)'" 
                        title="\u0412\u043D\u0438\u0437">
                        <ion-icon name="chevron-down" style="font-size:18px;"></ion-icon>
                    </button>` : '<div style="width:32px; height:32px;"></div>'}
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; margin-bottom:4px; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(track.title)}</div>
                    <div style="font-size:13px; color:rgba(255,255,255,0.6); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(track.artist || "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C")}</div>
                </div>
                <div style="color:rgba(255,255,255,0.4); font-size:12px; margin-right:8px; flex-shrink:0;">#${index + 1}</div>
            </div>
            <button onclick="removeTrackFromAlbum(${albumId}, ${track.id})" 
                    style="background:#ff453a; border:none; color:white; padding:10px 16px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px; transition:all 0.2s; font-size:14px; font-weight:500; flex-shrink:0;"
                    onmouseover="this.style.background='#ff5c4d'; this.style.transform='scale(1.02)'"
                    onmouseout="this.style.background='#ff453a'; this.style.transform='scale(1)'">
                <ion-icon name="trash" style="font-size:16px;"></ion-icon>
                <span>\u0423\u0434\u0430\u043B\u0438\u0442\u044C</span>
            </button>
        </div>
    `).join("");
}
function showAddTracksToAlbum(albumId) {
  const oldModal = document.getElementById("modal-add-tracks-to-album");
  if (oldModal) {
    oldModal.remove();
  }
  const modal = document.createElement("div");
  modal.className = "modal active";
  modal.id = "modal-add-tracks-to-album";
  fetch(`/api/albums/${albumId}/tracks?t=${Date.now()}`).then((res) => res.json()).then((albumTracks) => {
    const albumTrackIds = albumTracks.map((t) => t.id);
    const availableTracks = myTracks.filter((t) => !albumTrackIds.includes(t.id));
    modal.innerHTML = `
            <div class="modal-content modal-large">
                <div class="modal-header">
                    <h2>\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u0440\u0435\u043A\u0438 \u0432 \u0430\u043B\u044C\u0431\u043E\u043C</h2>
                    <button class="btn-icon" onclick="closeModal('modal-add-tracks-to-album')">
                        <ion-icon name="close"></ion-icon>
                    </button>
                </div>
                
                <div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; gap: 10px;">
                        <button class="btn-secondary small" onclick="selectAllAlbumTracks(true)">\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u0435</button>
                        <button class="btn-secondary small" onclick="selectAllAlbumTracks(false)">\u0421\u043D\u044F\u0442\u044C \u0432\u044B\u0434\u0435\u043B\u0435\u043D\u0438\u0435</button>
                    </div>
                    <span id="selected-count">\u0412\u044B\u0431\u0440\u0430\u043D\u043E: 0</span>
                </div>

                <div style="max-height: 400px; overflow-y: auto;" id="album-add-list">
                    ${availableTracks.length === 0 ? '<p style="text-align:center; color:rgba(255,255,255,0.5); padding:20px;">\u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0445 \u0442\u0440\u0435\u043A\u043E\u0432 \u0434\u043B\u044F \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F</p>' : availableTracks.map((track) => `
                            <div class="track-select-item" onclick="toggleTrackSelection(${track.id})" 
                                 style="display:flex; align-items:center; justify-content:space-between; padding:12px; background:#1c1c1e; border-radius:8px; margin-bottom:8px; cursor:pointer; transition:background 0.2s; border: 1px solid transparent;" 
                                 onmouseover="this.style.background='#232e3c'" 
                                 onmouseout="this.classList.contains('selected') ? this.style.background='#2c2c2e' : this.style.background='#1c1c1e'">
                                <div style="display:flex; align-items:center; gap:12px; flex:1;">
                                    <div class="checkbox-circle" id="check-${track.id}" style="width:20px; height:20px; border-radius:50%; border:2px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; transition:all 0.2s;">
                                        <ion-icon name="checkmark" style="opacity:0; font-size:14px;"></ion-icon>
                                    </div>
                                <div style="flex:1;">
                                        <div style="font-weight:600; margin-bottom:4px;">${escapeHtml(track.title)}</div>
                                        <div style="font-size:12px; color:rgba(255,255,255,0.6);">${escapeHtml(track.artist)}</div>
                                </div>
                                </div>
                            </div>
                        `).join("")}
                </div>
                
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); display: flex; gap: 10px;">
                    <button class="btn-secondary" onclick="closeModal('modal-add-tracks-to-album')" style="flex: 1;">
                        \u041E\u0442\u043C\u0435\u043D\u0430
                    </button>
                    <button class="btn-primary" onclick="addSelectedTracksToAlbum(${albumId})" style="flex: 2;" id="btn-add-selected" disabled>
                        \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435
                    </button>
                </div>
            </div>
        `;
    document.body.appendChild(modal);
    const style = document.createElement("style");
    style.innerHTML = `
            .track-select-item.selected { background: #2c2c2e !important; border-color: #fa2d48 !important; }
            .track-select-item.selected .checkbox-circle { background: #fa2d48; border-color: #fa2d48; }
            .track-select-item.selected .checkbox-circle ion-icon { opacity: 1 !important; }
        `;
    modal.appendChild(style);
  });
}
let selectedTracksForAlbum = new Set();
function toggleTrackSelection(trackId) {
  const el = document.querySelector(`.track-select-item[onclick*="${trackId}"]`);
  if (!el) return;
  if (selectedTracksForAlbum.has(trackId)) {
    selectedTracksForAlbum.delete(trackId);
    el.classList.remove("selected");
  } else {
    selectedTracksForAlbum.add(trackId);
    el.classList.add("selected");
  }
  updateSelectionUI();
}
function selectAllAlbumTracks(select) {
  const items = document.querySelectorAll(".track-select-item");
  items.forEach((item) => {
    const onclick = item.getAttribute("onclick");
    const match = onclick.match(/toggleTrackSelection\((\d+)\)/);
    if (match && match[1]) {
      const trackId = parseInt(match[1]);
      if (select) {
        selectedTracksForAlbum.add(trackId);
        item.classList.add("selected");
      } else {
        selectedTracksForAlbum.delete(trackId);
        item.classList.remove("selected");
      }
    }
  });
  updateSelectionUI();
}
function updateSelectionUI() {
  document.getElementById("selected-count").textContent = `\u0412\u044B\u0431\u0440\u0430\u043D\u043E: ${selectedTracksForAlbum.size}`;
  const btn = document.getElementById("btn-add-selected");
  if (btn) {
    btn.disabled = selectedTracksForAlbum.size === 0;
    btn.textContent = selectedTracksForAlbum.size > 0 ? `\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435 (${selectedTracksForAlbum.size})` : "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435";
    btn.style.opacity = selectedTracksForAlbum.size > 0 ? "1" : "0.5";
  }
}
async function addSelectedTracksToAlbum(albumId) {
  if (selectedTracksForAlbum.size === 0) return;
  const btn = document.getElementById("btn-add-selected");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner small"></div> \u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0435...';
  const tracks = Array.from(selectedTracksForAlbum);
  let successCount = 0;
  for (const trackId of tracks) {
    try {
      const res = await fetch(`/api/albums/${albumId}/tracks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_id: trackId })
      });
      if (res.ok) successCount++;
    } catch (e) {
      console.error(e);
    }
  }
  closeModal("modal-add-tracks-to-album");
  selectedTracksForAlbum.clear();
  await manageAlbumTracks(albumId);
  alert(`\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E \u0442\u0440\u0435\u043A\u043E\u0432: ${successCount}`);
}
async function removeTrackFromAlbum(albumId, trackId) {
  if (!confirm("\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0442\u0440\u0435\u043A \u0438\u0437 \u0430\u043B\u044C\u0431\u043E\u043C\u0430?")) return;
  try {
    const res = await fetch(`/api/albums/${albumId}/tracks/${trackId}`, {
      method: "DELETE"
    });
    const data = await res.json();
    if (data.success) {
      const tracksRes = await fetch(`/api/albums/${albumId}/tracks?t=${Date.now()}`);
      if (tracksRes.ok) {
        const tracks = await tracksRes.json();
        renderAlbumTracks(albumId, tracks);
      }
    } else {
      alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0442\u0440\u0435\u043A\u0430");
    }
  } catch (err) {
    alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0442\u0440\u0435\u043A\u0430");
    console.error(err);
  }
}
async function moveTrackInAlbum(albumId, trackId, direction) {
  try {
    const res = await fetch(`/api/albums/${albumId}/tracks/${trackId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction })
    });
    const data = await res.json();
    if (data.success) {
      const tracksRes = await fetch(`/api/albums/${albumId}/tracks?t=${Date.now()}`);
      if (tracksRes.ok) {
        const tracks = await tracksRes.json();
        renderAlbumTracks(albumId, tracks);
      }
    } else {
      alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F \u0442\u0440\u0435\u043A\u0430");
    }
  } catch (err) {
    alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F \u0442\u0440\u0435\u043A\u0430");
    console.error(err);
  }
}
async function deleteAlbum(albumId) {
  if (!confirm("\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u044D\u0442\u043E\u0442 \u0430\u043B\u044C\u0431\u043E\u043C? \u0412\u0441\u0435 \u0442\u0440\u0435\u043A\u0438 \u043E\u0441\u0442\u0430\u043D\u0443\u0442\u0441\u044F, \u043D\u043E \u0431\u0443\u0434\u0443\u0442 \u0443\u0434\u0430\u043B\u0435\u043D\u044B \u0438\u0437 \u0430\u043B\u044C\u0431\u043E\u043C\u0430.")) return;
  try {
    const res = await fetch(`/api/albums/${albumId}`, {
      method: "DELETE"
    });
    const data = await res.json();
    if (data.success) {
      alert("\u0410\u043B\u044C\u0431\u043E\u043C \u0443\u0434\u0430\u043B\u0435\u043D!");
      document.getElementById("modal-edit-album").remove();
      await loadMyAlbums();
    } else {
      alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0430\u043B\u044C\u0431\u043E\u043C\u0430");
    }
  } catch (err) {
    alert("\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0430\u043B\u044C\u0431\u043E\u043C\u0430");
    console.error(err);
  }
}
window.editAlbum = editAlbum;
window.manageAlbumTracks = manageAlbumTracks;
window.showAddTracksToAlbum = showAddTracksToAlbum;
window.removeTrackFromAlbum = removeTrackFromAlbum;
window.deleteAlbum = deleteAlbum;
window.moveTrackInAlbum = moveTrackInAlbum;
