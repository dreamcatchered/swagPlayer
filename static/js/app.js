// Основной файл приложения SwagPlayer

// Глобальные переменные
window.currentUser = null;
let myTracks = [];
let myAlbums = [];
let currentPage = 'library';

// Вспомогательные функции для получения актуальных данных
// Используют window переменные если доступно, иначе локальные
function getMyTracks() {
    return (window.myTracks && Array.isArray(window.myTracks)) ? window.myTracks : myTracks;
}

function getMyAlbums() {
    return (window.myAlbums && Array.isArray(window.myAlbums)) ? window.myAlbums : myAlbums;
}

// Определяем Telegram WebView
// Проверяем не только наличие объекта, но и что это действительно Telegram WebApp
// (проверяем наличие initData или platform)
window.isTelegram = false;
window.tgWebApp = null;

if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    // Проверяем, что это действительно Telegram WebApp, а не просто загруженный скрипт
    // В настоящем Telegram WebApp всегда есть platform или initData
    if (tg.platform || tg.initData || tg.initDataUnsafe) {
        window.isTelegram = true;
        window.tgWebApp = tg;
    }
}

const isTelegram = window.isTelegram;
const tgWebApp = window.tgWebApp;

// Инициализация Telegram WebApp
if (isTelegram && tgWebApp) {
    document.documentElement.classList.add('tg-view');
    
    // Вызываем ready() для инициализации (как в рабочем проекте)
    tgWebApp.ready();
    tgWebApp.expand();
    
    // Ждем события ready от Telegram
    tgWebApp.onEvent('ready', () => {
        console.log('✅ Telegram WebApp ready event fired');
    });
    
    if (tgWebApp.version) {
        const version = tgWebApp.version.split('.').map(Number);
        if (version[0] > 6 || (version[0] === 6 && version[1] >= 1)) {
            try {
                tgWebApp.setHeaderColor('#000000');
                tgWebApp.setBackgroundColor('#000000');
            } catch(e) {}
        }
    }
}

// === АВТОРИЗАЦИЯ ===
function getInitData() {
    // Функция для получения initData из всех возможных источников
    let initData = '';
    
    // 1. Пробуем из tgWebApp.initData (основной источник)
    if (tgWebApp && tgWebApp.initData) {
        initData = tgWebApp.initData;
        if (initData && initData.trim() !== '') {
            console.log('✅ Got initData from tgWebApp.initData, length:', initData.length);
            return initData;
        }
    }
    
    // 2. Пробуем из query параметров
    const urlParams = new URLSearchParams(window.location.search);
    const initDataParam = urlParams.get('tgWebAppData');
    if (initDataParam) {
        initData = initDataParam;
        console.log('✅ Got initData from URL params, length:', initData.length);
        return initData;
    }
    
    // 3. Пробуем из глобальной переменной (переданной из шаблона)
    if (typeof INIT_DATA_FROM_URL !== 'undefined' && INIT_DATA_FROM_URL) {
        initData = INIT_DATA_FROM_URL;
        console.log('✅ Got initData from template variable, length:', initData.length);
        return initData;
    }
    
    // 4. Пробуем из hash (Telegram Desktop)
    if (window.location.hash) {
        const hash = window.location.hash.substring(1);
        const hashParams = new URLSearchParams(hash);
        const hashInitData = hashParams.get('tgWebAppData');
        if (hashInitData) {
            initData = decodeURIComponent(hashInitData);
            console.log('✅ Got initData from URL hash, length:', initData.length);
            return initData;
        }
        
        // Парсим hash как query string
        const hashParts = hash.split('&');
        const initDataParts = [];
        let foundHash = false;
        
        for (const part of hashParts) {
            if (part.includes('user=') || part.includes('query_id=') || 
                part.includes('auth_date=') || part.includes('hash=')) {
                if (!part.startsWith('tgWebApp') && !part.startsWith('tgWebAppVersion') && 
                    !part.startsWith('tgWebAppPlatform') && !part.startsWith('tgWebAppThemeParams')) {
                    initDataParts.push(part);
                    if (part.includes('hash=')) {
                        foundHash = true;
                    }
                }
            }
        }
        
        if (initDataParts.length > 0 && foundHash) {
            initData = initDataParts.join('&');
            console.log('✅ Got initData from URL hash (parsed), length:', initData.length);
            return initData;
        }
    }
    
    // 5. Пробуем преобразовать из initDataUnsafe
    if (tgWebApp && tgWebApp.initDataUnsafe && typeof tgWebApp.initDataUnsafe === 'object') {
        const unsafe = tgWebApp.initDataUnsafe;
        if (unsafe.user && unsafe.hash) {
            const parts = [];
            if (unsafe.query_id) parts.push(`query_id=${unsafe.query_id}`);
            if (unsafe.user) parts.push(`user=${encodeURIComponent(JSON.stringify(unsafe.user))}`);
            if (unsafe.auth_date) parts.push(`auth_date=${unsafe.auth_date}`);
            if (unsafe.hash) parts.push(`hash=${unsafe.hash}`);
            if (parts.length > 0) {
                initData = parts.join('&');
                console.log('✅ Got initData from initDataUnsafe (converted), length:', initData.length);
                return initData;
            }
        }
    }
    
    return '';
}

async function performAuth(initData) {
    const authScreen = document.getElementById('auth-screen');
    const mainApp = document.getElementById('main-app');
    const authLoading = document.getElementById('auth-loading');
    const authError = document.getElementById('auth-error');
    
    try {
        console.log('Attempting auth with initData length:', initData.length);
        console.log('initData preview:', initData.substring(0, 100) + '...');
        
        const res = await fetch('/api/auth/telegram', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({initData: initData})
        });
        
        console.log('Auth response status:', res.status);
        
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            const errorMsg = errorData.error || `HTTP ${res.status}`;
            console.error('Auth failed:', errorMsg);
            throw new Error(errorMsg);
        }
        
        const data = await res.json();
        console.log('Auth response data:', data);
        
        if (data.success && data.user) {
            window.currentUser = data.user;
            console.log('User authenticated:', window.currentUser);
            
            // Скрываем экран авторизации
            authScreen.style.display = 'none';
            mainApp.style.display = 'flex';
            
            // Загружаем данные пользователя
            console.log('Loading user data...');
            await loadUserData();
            console.log('User data loaded');
            
            // Показываем кнопку поделиться если есть nickname
            if (window.currentUser.nickname) {
                const shareBtn = document.getElementById('share-btn');
                if (shareBtn) shareBtn.style.display = 'block';
            }
        } else {
            const errorMsg = data.error || 'Invalid response';
            console.error('Auth failed:', errorMsg);
            throw new Error(errorMsg);
        }
    } catch(e) {
        console.error('Auth error:', e);
        authLoading.style.display = 'none';
        authError.style.display = 'block';
        document.getElementById('auth-error-text').textContent = 
            `Ошибка авторизации: ${e.message || 'Неизвестная ошибка'}. Попробуйте перезапустить приложение.`;
    }
}

async function initAuth() {
    console.log('initAuth called');
    const authScreen = document.getElementById('auth-screen');
    const mainApp = document.getElementById('main-app');
    const authLoading = document.getElementById('auth-loading');
    const authError = document.getElementById('auth-error');
    
    if (!authScreen || !mainApp || !authLoading || !authError) {
        console.error('Auth elements not found');
        return;
    }
    
    // Если не в Telegram - показываем ошибку сразу
    if (!isTelegram || !tgWebApp) {
        console.log('Not in Telegram WebApp, showing error immediately');
        authLoading.style.display = 'none';
        authError.style.display = 'block';
        document.getElementById('auth-error-text').textContent = 'Приложение доступно только через Telegram. Откройте его через бота @swagplayerobot';
        return;
    }
    
    // Проверяем, что это действительно Telegram (есть platform)
    if (!tgWebApp.platform) {
        console.log('No platform detected, not a real Telegram WebApp');
        authLoading.style.display = 'none';
        authError.style.display = 'block';
        document.getElementById('auth-error-text').textContent = 'Приложение доступно только через Telegram. Откройте его через бота @swagplayerobot';
        return;
    }
    
    // Устанавливаем таймаут максимум 3 секунды
    let authTimeout = setTimeout(() => {
        authLoading.style.display = 'none';
        authError.style.display = 'block';
        document.getElementById('auth-error-text').textContent = 'Таймаут авторизации. Убедитесь, что открываете приложение через бота @swagplayerobot';
    }, 3000);
    
    try {
        // Пробуем получить initData сразу
        let initData = getInitData();
        
        // Если не получили, ждем события ready от Telegram WebApp
        if (!initData || initData.trim() === '') {
            console.log('initData not available immediately, waiting for ready event...');
            
            // Ждем события ready (максимум 2.5 секунды)
            const readyPromise = new Promise((resolve) => {
                if (tgWebApp.isReady) {
                    console.log('tgWebApp already ready');
                    resolve();
                } else {
                    console.log('Waiting for ready event...');
                    const readyHandler = () => {
                        console.log('✅ Telegram WebApp ready event received');
                        resolve();
                    };
                    tgWebApp.onEvent('ready', readyHandler);
                    
                    // Fallback таймаут
                    setTimeout(() => {
                        console.log('Ready event timeout, proceeding anyway');
                        resolve();
                    }, 2500);
                }
            });
            
            await readyPromise;
            
            // Пробуем получить initData после ready
            initData = getInitData();
        }
        
        // Очищаем таймаут если получили данные
        clearTimeout(authTimeout);
        authTimeout = null;
        
        if (!initData || initData.trim() === '') {
            console.error('❌ No initData available');
            console.error('tgWebApp:', tgWebApp);
            console.error('tgWebApp.platform:', tgWebApp?.platform);
            console.error('tgWebApp.initData:', tgWebApp?.initData);
            console.error('tgWebApp.initDataUnsafe:', tgWebApp?.initDataUnsafe);
            console.error('URL:', window.location.href);
            // Если нет initData, редиректим на бота
        const botUrl = 'https://t.me/swagplayerobot?start=auth';
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.openTelegramLink(botUrl);
        } else {
            window.location.href = botUrl;
        }
        throw new Error('No initData from Telegram. Убедитесь, что открываете приложение через бота @swagplayerobot');
        }
        
        // Выполняем авторизацию
        await performAuth(initData);
    } catch(e) {
        if (authTimeout) {
            clearTimeout(authTimeout);
        }
        console.error('Auth error:', e);
        authLoading.style.display = 'none';
        authError.style.display = 'block';
        document.getElementById('auth-error-text').textContent = 
            `Ошибка авторизации: ${e.message || 'Неизвестная ошибка'}. Попробуйте перезапустить приложение.`;
    }
}

function retryAuth() {
    document.getElementById('auth-loading').style.display = 'block';
    document.getElementById('auth-error').style.display = 'none';
    initAuth();
}

// === ЗАГРУЗКА ДАННЫХ ===
async function loadUserData() {
    console.log('loadUserData called, currentUser:', window.currentUser);
    if (!window.currentUser) {
        console.warn('loadUserData: No currentUser, skipping');
        return;
    }
    
    // Загружаем все данные параллельно
    await Promise.all([
        loadMyTracks(),
        loadMyAlbums()
    ]);
    
    // Профиль рендерим сразу, т.к. currentUser уже есть
    renderProfile();
    
    console.log('loadUserData completed');
}

async function loadMyTracks() {
    try {
        if (!window.currentUser || !window.currentUser.id) {
            console.warn('Cannot load tracks: user not authenticated');
            return;
        }
        const res = await fetch(`/api/tracks?user_id=${window.currentUser.id}&show_hidden=true`);
        if (res.ok) {
            const tracks = await res.json();
            // Синхронизируем и локальные, и window переменные
            myTracks = tracks;
            window.myTracks = tracks;
            renderMyTracks();
            updateStats();
        }
    } catch(e) {
        console.error('Error loading tracks:', e);
    }
}

async function loadMyAlbums() {
    try {
        if (!window.currentUser || !window.currentUser.id) {
            console.warn('Cannot load albums: user not authenticated');
            return;
        }
        const res = await fetch(`/api/albums?user_id=${window.currentUser.id}`);
        if (res.ok) {
            const albums = await res.json();
            // Синхронизируем и локальные, и window переменные
            myAlbums = albums;
            window.myAlbums = albums;
            renderMyAlbums();
            updateStats();
        }
    } catch(e) {
        console.error('Error loading albums:', e);
    }
}

async function loadProfile() {
    console.log('loadProfile called');
    try {
        const res = await fetch('/api/user/profile');
        console.log('Profile API response status:', res.status);
        if (res.ok) {
            const userData = await res.json();
            console.log('Profile data received:', userData);
            window.currentUser = userData;
            return userData;
        } else {
            console.log('Profile API returned error, trying Telegram data');
            // Если не авторизован, пробуем получить данные из Telegram
            if (tgWebApp && tgWebApp.initDataUnsafe && tgWebApp.initDataUnsafe.user) {
                const tgUser = tgWebApp.initDataUnsafe.user;
                window.currentUser = {
                    first_name: tgUser.first_name || '',
                    last_name: tgUser.last_name || '',
                    username: tgUser.username || '',
                    display_name: `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim(),
                    avatar_url: tgUser.photo_url || '',
                    nickname: tgUser.username || ''
                };
                console.log('Created currentUser from Telegram in loadProfile');
                return window.currentUser;
            } else {
                console.log('No Telegram data available');
                return null;
            }
        }
    } catch(e) {
        console.error('Error loading profile:', e);
        // Пробуем получить данные из Telegram
        if (tgWebApp && tgWebApp.initDataUnsafe && tgWebApp.initDataUnsafe.user) {
            const tgUser = tgWebApp.initDataUnsafe.user;
            window.currentUser = {
                first_name: tgUser.first_name || '',
                last_name: tgUser.last_name || '',
                username: tgUser.username || '',
                display_name: `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim(),
                avatar_url: tgUser.photo_url || '',
                nickname: tgUser.username || ''
            };
            console.log('Created currentUser from Telegram in catch block');
            return window.currentUser;
        }
        return null;
    }
}

// === РЕНДЕРИНГ ===
window.renderMyTracks = function renderMyTracks() {
    const container = document.getElementById('my-tracks-list');
    const emptyState = document.getElementById('empty-tracks');
    
    // Используем window.myTracks если доступно, иначе локальную переменную
    const tracksToRender = (window.myTracks && Array.isArray(window.myTracks)) ? window.myTracks : myTracks;
    
    if (tracksToRender.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }
    
    emptyState.style.display = 'none';
    container.innerHTML = tracksToRender.map(track => `
        <div class="track-card ${track.hidden ? 'track-hidden' : ''}">
            <img src="/uploads/${track.cover_filename || ''}" 
                 class="track-card-cover" 
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div style="display:none; width:100%; aspect-ratio:1/1; background:#333; align-items:center; justify-content:center;">
                <ion-icon name="musical-notes" style="font-size:32px; color:#666;"></ion-icon>
            </div>
            <div class="track-card-info">
                <div class="track-card-title">${track.title}</div>
                <div class="track-card-artist">${track.artist}</div>
                <div style="display: flex; gap: 12px; margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.5);">
                    <span><ion-icon name="play" style="font-size: 12px; vertical-align: middle;"></ion-icon> ${track.plays_count || 0}</span>
                    <span class="track-like-btn ${track.is_liked ? 'liked' : ''}" data-track-id="${track.id}" onclick="event.stopPropagation(); toggleTrackLike(${track.id})" style="cursor: pointer; display: flex; align-items: center; gap: 4px; transition: color 0.2s;" onmouseover="if(!this.classList.contains('liked')) this.style.color='#fa2d48'" onmouseout="if(!this.classList.contains('liked')) this.style.color='rgba(255,255,255,0.5)'">
                        <ion-icon name="${track.is_liked ? 'heart' : 'heart-outline'}" style="font-size: 12px; vertical-align: middle;"></ion-icon> 
                        <span class="track-likes-count">${track.likes_count || 0}</span>
                    </span>
                </div>
            </div>
            <div class="track-card-actions">
                <button onclick="playMyTrack(${track.id})" title="Воспроизвести">
                    <ion-icon name="play"></ion-icon>
                </button>
                <button onclick="editTrack(${track.id})" title="Редактировать">
                    <ion-icon name="create"></ion-icon>
                </button>
                <button onclick="showAddToAlbum(${track.id})" title="В альбом">
                    <ion-icon name="albums"></ion-icon>
                </button>
                <button onclick="shareTrack(${track.id}, '${track.slug || track.id}')" title="Поделиться">
                    <ion-icon name="share"></ion-icon>
                </button>
            </div>
        </div>
    `).join('');
}

window.renderMyAlbums = function renderMyAlbums() {
    const container = document.getElementById('my-albums-list');
    const emptyState = document.getElementById('empty-albums');
    
    // Используем window.myAlbums если доступно, иначе локальную переменную
    const albumsToRender = (window.myAlbums && Array.isArray(window.myAlbums)) ? window.myAlbums : myAlbums;
    
    if (albumsToRender.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }
    
    emptyState.style.display = 'none';
    container.innerHTML = albumsToRender.map(album => `
        <div class="album-card">
            <div onclick="viewAlbum(${album.id})" style="cursor:pointer;">
                ${album.cover_filename ? 
                    `<img src="/uploads/${album.cover_filename}" class="album-card-cover">` :
                    `<div style="width:100%; aspect-ratio:1/1; background:linear-gradient(135deg, #333 0%, #1c1c1e 100%); display:flex; align-items:center; justify-content:center; border-radius:8px; margin-bottom:12px;">
                        <ion-icon name="albums" style="font-size:48px; color:#666;"></ion-icon>
                    </div>`
                }
                <div class="album-card-info">
                    <div class="album-card-title">${album.title}</div>
                    ${album.description ? `<div class="album-card-description">${album.description}</div>` : ''}
                    <div style="display: flex; gap: 12px; margin-top: 8px; font-size: 12px; color: rgba(255,255,255,0.5);">
                        <span><ion-icon name="play" style="font-size: 12px; vertical-align: middle;"></ion-icon> ${album.plays_count || 0}</span>
                        <span class="album-like-btn ${album.is_liked ? 'liked' : ''}" data-album-id="${album.id}" onclick="event.stopPropagation(); toggleAlbumLike(${album.id})" style="cursor: pointer; display: flex; align-items: center; gap: 4px; transition: color 0.2s;" onmouseover="if(!this.classList.contains('liked')) this.style.color='#fa2d48'" onmouseout="if(!this.classList.contains('liked')) this.style.color='rgba(255,255,255,0.5)'">
                            <ion-icon name="${album.is_liked ? 'heart' : 'heart-outline'}" style="font-size: 12px; vertical-align: middle;"></ion-icon> 
                            <span class="album-likes-count">${album.likes_count || 0}</span>
                        </span>
                    </div>
                </div>
            </div>
            <div class="album-card-actions" style="padding:8px; border-top:1px solid rgba(255,255,255,0.1); display:flex; gap:5px;">
                <button onclick="editAlbum(${album.id})" title="Редактировать" style="flex:1; background:rgba(255,255,255,0.1); border:none; color:white; padding:8px; border-radius:6px; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px;">
                    <ion-icon name="create"></ion-icon>
                </button>
                <button onclick="manageAlbumTracks(${album.id})" title="Управление треками" style="flex:1; background:rgba(255,255,255,0.1); border:none; color:white; padding:8px; border-radius:6px; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px;">
                    <ion-icon name="musical-notes"></ion-icon>
                </button>
            </div>
        </div>
    `).join('');
}

function renderProfile() {
    console.log('renderProfile called, currentUser:', window.currentUser);
    
    if (!window.currentUser) {
        // Пробуем получить данные из Telegram
        if (tgWebApp && tgWebApp.initDataUnsafe && tgWebApp.initDataUnsafe.user) {
            const tgUser = tgWebApp.initDataUnsafe.user;
            window.currentUser = {
                first_name: tgUser.first_name || '',
                last_name: tgUser.last_name || '',
                username: tgUser.username || '',
                display_name: `${tgUser.first_name || ''} ${tgUser.last_name || ''}`.trim() || tgUser.first_name || '',
                avatar_url: tgUser.photo_url || '',
                nickname: tgUser.username || '' // Используем username как nickname
            };
            console.log('Created currentUser from Telegram in renderProfile');
        } else {
            console.log('No user data available');
            return;
        }
    }
    
    // Заполняем данные профиля
    const profileNameEl = document.getElementById('profile-name');
    const profileNicknameEl = document.getElementById('profile-nickname');
    const profileDisplayNameInput = document.getElementById('profile-display-name');
    const profileNicknameInputEl = document.getElementById('profile-nickname-input');
    const profileSlugPreview = document.getElementById('profile-slug-preview');
    const profileLinkInput = document.getElementById('profile-link-input');
    const avatarImg = document.getElementById('avatar-img');
    const avatarPlaceholder = document.querySelector('.avatar-placeholder');
    
    if (profileNameEl) {
        profileNameEl.textContent = window.currentUser.display_name || 
                                   window.currentUser.first_name || 
                                   'Пользователь';
    }
    
    if (profileNicknameEl) {
        if (window.currentUser.nickname) {
            profileNicknameEl.textContent = `@${window.currentUser.nickname}`;
            profileNicknameEl.style.display = 'block';
        } else {
            profileNicknameEl.style.display = 'none';
        }
    }
    
    if (profileDisplayNameInput) {
        profileDisplayNameInput.value = window.currentUser.display_name || 
                                       window.currentUser.first_name || 
                                       '';
    }
    
    if (profileNicknameInputEl) {
        // Если nickname пустой, но есть username из Telegram - используем его
        const nickname = window.currentUser.nickname || window.currentUser.username || '';
        profileNicknameInputEl.value = nickname;
        
        // Обновляем превью ссылки
        if (profileSlugPreview) {
            profileSlugPreview.textContent = nickname || '...';
        }
        
        // Обновляем полную ссылку
        if (profileLinkInput) {
            if (nickname) {
                profileLinkInput.value = `https://swag.dreampartners.online/user/${nickname}`;
            } else {
                profileLinkInput.value = '';
            }
        }
    }
    
    // Загружаем аватар
    if (window.currentUser.avatar_url && avatarImg) {
        avatarImg.src = window.currentUser.avatar_url;
        avatarImg.style.display = 'block';
        if (avatarPlaceholder) avatarPlaceholder.style.display = 'none';
    } else if (avatarImg) {
        avatarImg.style.display = 'none';
        if (avatarPlaceholder) avatarPlaceholder.style.display = 'flex';
    }
    
    // Обновляем ссылку на библиотеку
    const profileLibraryLinkEl = document.getElementById('profile-library-link');
    if (profileLibraryLinkEl) {
        const nickname = window.currentUser.nickname || window.currentUser.username || '';
        if (nickname) {
            profileLibraryLinkEl.href = `/user/${nickname}`;
            profileLibraryLinkEl.target = '_blank';
        }
    }
    
    // Загружаем статистику
    loadProfileStats();
    
    console.log('Profile rendered successfully');
}

async function loadProfileStats() {
    if (!window.currentUser || !window.currentUser.id) return;
    
    try {
        // Получаем все треки пользователя
        const tracksRes = await fetch(`/api/tracks?user_id=${window.currentUser.id}`);
        const tracks = await tracksRes.json();
        
        // Получаем все альбомы пользователя
        const albumsRes = await fetch(`/api/albums?user_id=${window.currentUser.id}`);
        const albums = await albumsRes.json();
        
        // Считаем общую статистику
        const totalPlays = tracks.reduce((sum, t) => sum + (t.plays_count || 0), 0) + 
                          albums.reduce((sum, a) => sum + (a.plays_count || 0), 0);
        const totalLikes = tracks.reduce((sum, t) => sum + (t.likes_count || 0), 0) + 
                          albums.reduce((sum, a) => sum + (a.likes_count || 0), 0);
        
        const totalPlaysEl = document.getElementById('profile-total-plays');
        const totalLikesEl = document.getElementById('profile-total-likes');
        if (totalPlaysEl) totalPlaysEl.textContent = totalPlays;
        if (totalLikesEl) totalLikesEl.textContent = totalLikes;
    } catch(e) {
        console.error('Error loading profile stats:', e);
    }
}

function updateStats() {
    // Используем window переменные если доступно, иначе локальные
    const tracksCount = (window.myTracks && Array.isArray(window.myTracks)) ? window.myTracks.length : myTracks.length;
    const albumsCount = (window.myAlbums && Array.isArray(window.myAlbums)) ? window.myAlbums.length : myAlbums.length;
    
    const tracksCountEl = document.getElementById('tracks-count');
    const albumsCountEl = document.getElementById('albums-count');
    if (tracksCountEl) tracksCountEl.textContent = tracksCount;
    if (albumsCountEl) albumsCountEl.textContent = albumsCount;
}

// === НАВИГАЦИЯ ===
async function switchPage(page) {
    console.log('switchPage called:', page);
    
    // Проверяем авторизацию для страниц, требующих авторизации
    if ((page === 'profile' || page === 'upload' || page === 'albums') && !window.currentUser) {
        const botUrl = 'https://t.me/swagplayerobot?start=auth';
        if (confirm('Для доступа к этой странице необходимо авторизоваться.\n\nОткрыть бота для авторизации?')) {
            // В Telegram WebApp открываем бота через tg://
            if (window.Telegram && window.Telegram.WebApp) {
                window.Telegram.WebApp.openTelegramLink(botUrl);
            } else {
                window.location.href = botUrl;
            }
        }
        return; // Не переключаем страницу
    }
    
    currentPage = page;
    
    // Обновляем активную кнопку навигации
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === page) {
            item.classList.add('active');
        }
    });
    
    // Показываем нужную страницу
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
    });
    document.getElementById(`page-${page}`).classList.add('active');
    
    // Обновляем заголовок
    const titles = {
        library: 'Моя библиотека',
        upload: 'Загрузить трек',
        albums: 'Мои альбомы',
        profile: 'Профиль'
    };
    document.getElementById('page-title').textContent = titles[page] || 'SwagPlayer';
    
    // Показываем/скрываем кнопку "назад" - показываем всегда если есть история
    const backBtn = document.querySelector('.app-header .back-btn') || document.getElementById('header-back-btn');
    if (backBtn) {
        // Проверяем историю навигации
        const hasHistory = window.SPANavigation && window.SPANavigation.getHistoryLength && window.SPANavigation.getHistoryLength() > 1;
        const canGoBack = window.history.length > 1 || hasHistory;
        backBtn.style.display = canGoBack ? 'flex' : 'none';
    }
    
    // Загружаем данные при переключении на профиль
    if (page === 'profile') {
        console.log('Switching to profile page, currentUser:', window.currentUser);
        
        // ВАЖНО: Сначала загружаем профиль с сервера, потом рендерим
        if (!window.currentUser || !window.currentUser.id) {
            console.log('No currentUser, loading profile from API...');
            await loadProfile();
        }
        
        // Теперь рендерим профиль
        console.log('Rendering profile, currentUser after load:', window.currentUser);
            renderProfile();
        
        // Также загружаем треки и альбомы если еще не загружены
        if (!window.myTracks || window.myTracks.length === 0) {
            loadMyTracks();
        }
        if (!window.myAlbums || window.myAlbums.length === 0) {
            loadMyAlbums();
        }
    }
    
    // Загружаем данные при переключении на библиотеку
    if (page === 'library') {
        if (!window.myTracks || window.myTracks.length === 0) {
            await loadMyTracks();
        } else {
            renderMyTracks();
        }
    }
    
    // Загружаем данные при переключении на альбомы
    if (page === 'albums') {
        if (!window.myAlbums || window.myAlbums.length === 0) {
            await loadMyAlbums();
        } else {
            renderMyAlbums();
        }
    }
}

// Навигация по клику
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        switchPage(item.dataset.page);
    });
});

// === ЗАГРУЗКА ТРЕКА ===
// Автозаполнение имени исполнителя при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    const artistInput = document.getElementById('track-artist');
    if (artistInput && window.currentUser) {
        // Если поле пустое, заполняем именем пользователя
        if (!artistInput.value && window.currentUser.display_name) {
            artistInput.value = window.currentUser.display_name;
        }
    }
});

// Добавляем обработчик формы только если она существует
const uploadForm = document.getElementById('upload-form');
if (uploadForm) {
    uploadForm.addEventListener('submit', async (e) => {
        // ... (этот код уже не используется в новом дизайне, но оставим для совместимости)
    });
}

// === BULK UPLOAD LOGIC ===
let bulkUploadFiles = [];

async function handleFilesSelect(input) {
    if (!input.files || input.files.length === 0) return;
    
    // Ограничение до 10 файлов
    const files = Array.from(input.files).slice(0, 10);
    if (input.files.length > 10) {
        alert('Можно выбрать максимум 10 файлов за раз. Будут загружены первые 10.');
    }
    
    // Показываем интерфейс загрузки
    document.getElementById('upload-initial-state').style.display = 'none';
    document.getElementById('upload-preview-container').style.display = 'block';
    document.getElementById('upload-count-label').textContent = `Выбрано файлов: ${files.length}`;
    
    const list = document.getElementById('upload-tracks-list');
    list.innerHTML = '<div style="text-align:center; padding:20px;"><div class="spinner"></div><p>Обработка файлов...</p></div>';
    
    bulkUploadFiles = [];
    
    // Обрабатываем файлы последовательно
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileData = {
            id: i,
            file: file,
            title: file.name.replace(/\.[^/.]+$/, ""), // Имя без расширения
            artist: (window.currentUser && window.currentUser.display_name) || 'Unknown Artist',
            cover: null,
            status: 'pending' // pending, uploading, success, error
        };
        
        // Пытаемся извлечь метаданные
        try {
            const meta = await extractMetadata(file);
            if (meta) {
                if (meta.title) fileData.title = meta.title;
                if (meta.artist) fileData.artist = meta.artist;
                if (meta.cover) fileData.cover = meta.cover;
            }
        } catch (e) {
            console.error('Error processing metadata:', e);
        }
        
        bulkUploadFiles.push(fileData);
    }
    
    renderBulkUploadList();
}

function renderBulkUploadList() {
    const list = document.getElementById('upload-tracks-list');
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
                        <label style="font-size: 12px; color: rgba(255,255,255,0.5); display: block; margin-bottom: 4px;">Название</label>
                        <input type="text" value="${escapeHtml(track.title)}" onchange="updateBulkField(${index}, 'title', this.value)" 
                               style="width: 100%; padding: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: white;">
                    </div>
                    <div style="flex: 1;">
                        <label style="font-size: 12px; color: rgba(255,255,255,0.5); display: block; margin-bottom: 4px;">Исполнитель</label>
                        <input type="text" value="${escapeHtml(track.artist)}" onchange="updateBulkField(${index}, 'artist', this.value)"
                               style="width: 100%; padding: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: white;">
                    </div>
                </div>
                <div style="font-size: 12px; color: rgba(255,255,255,0.4); display: flex; justify-content: space-between;">
                    <span>Файл: ${track.file.name}</span>
                    <span class="status-text" id="status-${index}" style="color: #faa935;">Ожидание</span>
                </div>
            </div>
            
            <button onclick="removeBulkTrack(${index})" style="background: transparent; border: none; color: #ff453a; cursor: pointer; padding: 5px;">
                <ion-icon name="close-circle" style="font-size: 24px;"></ion-icon>
            </button>
        </div>
    `).join('');
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
            bulkUploadFiles[index].coverData = input.files[0]; // Файл обложки
            bulkUploadFiles[index].cover = e.target.result; // URL для превью
            renderBulkUploadList();
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function removeBulkTrack(index) {
    bulkUploadFiles.splice(index, 1);
    document.getElementById('upload-count-label').textContent = `Выбрано файлов: ${bulkUploadFiles.length}`;
    if (bulkUploadFiles.length === 0) {
        resetUpload();
    } else {
        renderBulkUploadList();
    }
}

function resetUpload() {
    bulkUploadFiles = [];
    document.getElementById('upload-initial-state').style.display = 'block';
    document.getElementById('upload-preview-container').style.display = 'none';
    document.getElementById('audio-files-input').value = '';
}

async function publishAllTracks() {
    const btn = document.querySelector('.upload-actions .btn-primary');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner small"></div> Публикация...';
    
    let successCount = 0;
    
    for (let i = 0; i < bulkUploadFiles.length; i++) {
        const track = bulkUploadFiles[i];
        if (track.status === 'success') continue; // Skip already uploaded
        
        const card = document.getElementById(`bulk-track-${i}`);
        const statusEl = document.getElementById(`status-${i}`);
        
        if (statusEl) {
            statusEl.textContent = 'Загрузка...';
            statusEl.style.color = '#0a84ff';
        }
        
        const formData = new FormData();
        formData.append('audio', track.file);
        formData.append('title', track.title);
        formData.append('artist', track.artist);
        
        // Добавляем обложку если есть (либо загруженную, либо из метаданных base64 - но сервер ждет файл)
        // Если coverData есть (пользователь выбрал файл) - отправляем
        if (track.coverData) {
            formData.append('cover', track.coverData);
        } else if (track.cover && track.cover.startsWith('data:image')) {
            // Если обложка из метаданных (base64), конвертируем в файл
            try {
                const res = await fetch(track.cover);
                const blob = await res.blob();
                formData.append('cover', new File([blob], "cover.jpg", { type: "image/jpeg" }));
            } catch (e) {
                console.error('Error converting cover:', e);
            }
        }
    
    try {
        const res = await fetch('/api/tracks', {
            method: 'POST',
            body: formData
        });
        
        const data = await res.json();
        
        if (data.success) {
                track.status = 'success';
                if (statusEl) {
                    statusEl.textContent = 'Опубликовано';
                    statusEl.style.color = '#30d158';
                }
                if (card) {
                    card.style.opacity = '0.5';
                    card.style.borderColor = '#30d158';
                }
                successCount++;
        } else {
                track.status = 'error';
                if (statusEl) {
                    statusEl.textContent = 'Ошибка: ' + (data.error || 'Unknown');
                    statusEl.style.color = '#ff453a';
        }
            }
        } catch (err) {
        console.error(err);
            track.status = 'error';
            if (statusEl) {
                statusEl.textContent = 'Ошибка сети';
                statusEl.style.color = '#ff453a';
            }
        }
    }
    
    btn.disabled = false;
    btn.innerHTML = '<ion-icon name="checkmark-done"></ion-icon> Опубликовать все';
    
    if (successCount === bulkUploadFiles.length) {
        alert(`Все треки (${successCount}) успешно опубликованы!`);
        resetUpload();
        await loadMyTracks();
        switchPage('library');
    } else {
        alert(`Опубликовано ${successCount} из ${bulkUploadFiles.length}. Проверьте ошибки.`);
    }
}

// Модифицированная extractMetadata (возвращает данные, а не меняет DOM)
async function extractMetadata(file) {
    const formData = new FormData();
    formData.append('audio', file);
    
    try {
        const res = await fetch('/api/extract-metadata', {
            method: 'POST',
            body: formData
        });
        if (res.ok) {
            return await res.json();
        }
    } catch(e) {
        console.error('Error extracting metadata:', e);
    }
    return null;
}

// Удаляем старые обработчики (форма скрыта и переименована, так что старый код не сработает)
/*
document.getElementById('upload-form').addEventListener('submit', async (e) => {
    // ... Legacy code removed ...
});
*/

// Вспомогательная функция для экранирования HTML
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Превью slug
const trackSlugInput = document.getElementById('track-slug');
if (trackSlugInput) {
    trackSlugInput.addEventListener('input', (e) => {
        const preview = document.getElementById('slug-preview');
        if (preview) preview.textContent = e.target.value || '...';
    });
}

// === СОЗДАНИЕ АЛЬБОМА ===
function showCreateAlbum() {
    const modal = document.getElementById('modal-create-album');
    if (modal) modal.classList.add('active');
}

const createAlbumForm = document.getElementById('create-album-form');
if (createAlbumForm) {
    createAlbumForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData();
    formData.append('title', document.getElementById('album-title').value);
    formData.append('description', document.getElementById('album-description').value);
    const slug = document.getElementById('album-slug').value;
    if (slug) formData.append('slug', slug);
    
    const coverFile = document.getElementById('album-cover-file').files[0];
    if (coverFile) formData.append('cover', coverFile);
    
    try {
        const res = await fetch('/api/albums', {
            method: 'POST',
            body: formData
        });
        
        const result = await res.json();
        
        if (result.success) {
            alert('Альбом создан! Теперь вы можете добавить в него треки.');
            closeModal('modal-create-album');
            e.target.reset();
            document.getElementById('album-cover-preview').innerHTML = '';
            await loadMyAlbums();
            switchPage('albums');
            // Автоматически открываем управление треками для нового альбома
            if (result.album_id) {
                setTimeout(() => manageAlbumTracks(result.album_id), 500);
            }
        } else {
            alert(result.error || 'Ошибка создания альбома');
        }
    } catch(err) {
        alert('Ошибка создания альбома');
        console.error(err);
    }
});
}

// Предпросмотр обложки альбома
const albumCoverFile = document.getElementById('album-cover-file');
if (albumCoverFile) {
    albumCoverFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
                const preview = document.getElementById('album-cover-preview');
                if (preview) {
                    preview.innerHTML = `<img src="${event.target.result}" alt="Cover">`;
                }
        };
        reader.readAsDataURL(file);
    }
});
}

const albumSlugInput = document.getElementById('album-slug');
if (albumSlugInput) {
    albumSlugInput.addEventListener('input', (e) => {
        const preview = document.getElementById('album-slug-preview');
        if (preview) preview.textContent = e.target.value || '...';
    });
}

// === РЕДАКТИРОВАНИЕ ТРЕКА ===
let currentEditTrackId = null;

async function editTrack(trackId) {
    const track = myTracks.find(t => t.id === trackId);
    if (!track) return;
    
    currentEditTrackId = trackId;
    document.getElementById('edit-track-id').value = trackId;
    document.getElementById('edit-track-title').value = track.title;
    document.getElementById('edit-track-artist').value = track.artist;
    document.getElementById('edit-track-slug').value = track.slug || '';
    document.getElementById('edit-track-lyrics').value = track.lyrics || '';
    
    // Показываем текущую обложку
    const coverPreview = document.getElementById('edit-track-cover-preview');
    if (track.cover_filename) {
        coverPreview.innerHTML = `<img src="/uploads/${track.cover_filename}" alt="Cover" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`;
    } else {
        coverPreview.innerHTML = '<div style="width: 100%; height: 100px; background: #333; border-radius: 8px; display: flex; align-items: center; justify-content: center;"><ion-icon name="image-outline" style="font-size: 32px; color: #666;"></ion-icon></div>';
    }
    
    // Сбрасываем аудио файл
    document.getElementById('edit-track-audio-file').value = '';
    document.getElementById('edit-track-audio-info').textContent = '';
    
    // Обновляем текст кнопки видимости
    const visBtnText = document.getElementById('visibility-btn-text');
    if (visBtnText) {
        visBtnText.textContent = track.hidden ? 'Показать' : 'Скрыть';
    }
    
    document.getElementById('modal-edit-track').classList.add('active');
}

// Информация об аудиофайле при редактировании
const editTrackAudioFile = document.getElementById('edit-track-audio-file');
if (editTrackAudioFile) {
    editTrackAudioFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
            const info = document.getElementById('edit-track-audio-info');
            if (info) {
                info.textContent = `Файл: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
            }
        }
    });
}

const editTrackForm = document.getElementById('edit-track-form');
if (editTrackForm) {
    editTrackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData();
    formData.append('title', document.getElementById('edit-track-title').value);
    formData.append('artist', document.getElementById('edit-track-artist').value);
    formData.append('slug', document.getElementById('edit-track-slug').value);
    formData.append('lyrics', document.getElementById('edit-track-lyrics').value);
    
    const coverFile = document.getElementById('edit-track-cover-file').files[0];
    if (coverFile) formData.append('cover', coverFile);
    
    const audioFile = document.getElementById('edit-track-audio-file').files[0];
    if (audioFile) formData.append('audio', audioFile);
    
    try {
        const res = await fetch(`/api/tracks/${currentEditTrackId}`, {
            method: 'PUT',
            body: formData
        });
        
        const data = await res.json();
        
        if (data.success) {
            alert('Трек обновлен!');
            closeModal('modal-edit-track');
            await loadMyTracks();
        } else {
            alert(data.error || 'Ошибка обновления трека');
        }
    } catch(err) {
        alert('Ошибка обновления трека');
        console.error(err);
    }
});
}

async function deleteCurrentTrack() {
    if (!confirm('Удалить этот трек?')) return;
    
    try {
        const res = await fetch(`/api/tracks/${currentEditTrackId}`, {
            method: 'DELETE'
        });
        
        const data = await res.json();
        
        if (data.success) {
            alert('Трек удален!');
            closeModal('modal-edit-track');
            await loadMyTracks();
        } else {
            alert('Ошибка удаления трека');
        }
    } catch(err) {
        alert('Ошибка удаления трека');
        console.error(err);
    }
}

async function toggleTrackVisibility() {
    const track = myTracks.find(t => t.id === currentEditTrackId);
    if (!track) return;
    
    try {
        const res = await fetch(`/api/tracks/${currentEditTrackId}/toggle-visibility`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({hidden: !track.hidden})
        });
        
        const data = await res.json();
        
        if (data.success) {
            await loadMyTracks();
            
            // Обновляем текст кнопки если модалка открыта
            const visBtnText = document.getElementById('visibility-btn-text');
            if (visBtnText) {
                // track.hidden - это старое значение
                visBtnText.textContent = track.hidden ? 'Скрыть' : 'Показать';
            }
            
            alert(track.hidden ? 'Трек показан' : 'Трек скрыт');
        }
    } catch(err) {
        alert('Ошибка изменения видимости');
    }
}

// === ПРОФИЛЬ ===
function previewAvatar(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('avatar-img').src = e.target.result;
            document.getElementById('avatar-img').style.display = 'block';
            document.querySelector('.avatar-placeholder').style.display = 'none';
        }
        reader.readAsDataURL(input.files[0]);
    }
}
window.previewAvatar = previewAvatar;

async function saveProfile() {
    const displayName = document.getElementById('profile-display-name').value;
    const nickname = document.getElementById('profile-nickname-input').value.toLowerCase().trim();
    const avatarInput = document.getElementById('profile-avatar-input');
    
    const formData = new FormData();
    formData.append('display_name', displayName);
    formData.append('nickname', nickname);
    
    if (avatarInput && avatarInput.files && avatarInput.files[0]) {
        formData.append('avatar', avatarInput.files[0]);
    }
    
    try {
        const res = await fetch('/api/user/profile', {
            method: 'PUT',
            body: formData // fetch automatically sets Content-Type to multipart/form-data
        });
        
        const data = await res.json();
        
        if (data.success) {
            alert('Профиль обновлен!');
            await loadProfile();
            if (nickname) {
                document.getElementById('share-btn').style.display = 'block';
            }
        } else {
            alert(data.error || 'Ошибка обновления профиля');
        }
    } catch(err) {
        alert('Ошибка обновления профиля');
        console.error(err);
    }
}

const profileNicknameInput = document.getElementById('profile-nickname-input');
if (profileNicknameInput) {
    profileNicknameInput.addEventListener('input', (e) => {
        const preview = document.getElementById('profile-slug-preview');
        if (preview) preview.textContent = e.target.value || '...';
    });
}

function copyProfileLink() {
    const input = document.getElementById('profile-link-input');
    input.select();
    document.execCommand('copy');
    alert('Ссылка скопирована!');
}

function showShareLibrary() {
    if (window.currentUser && window.currentUser.nickname) {
        const link = `https://swag.dreampartners.online/user/${window.currentUser.nickname}`;
        if (tgWebApp && tgWebApp.shareUrl) {
            tgWebApp.shareUrl(link);
        } else {
            navigator.clipboard.writeText(link).then(() => {
                alert('Ссылка скопирована!');
            });
        }
    }
}

function shareTrack(trackId, slug) {
    const link = `https://swag.dreampartners.online/track/${slug}`;
    if (tgWebApp && tgWebApp.shareUrl) {
        tgWebApp.shareUrl(link);
    } else {
        navigator.clipboard.writeText(link).then(() => {
            alert('Ссылка скопирована!');
        });
    }
}

function viewAlbum(albumId) {
    const link = `https://swag.dreampartners.online/album/${albumId}`;
    if (tgWebApp && tgWebApp.openLink) {
        tgWebApp.openLink(link);
    } else {
        window.open(link, '_blank');
    }
}

async function addTrackToAlbum(trackId, albumId) {
    try {
        const res = await fetch(`/api/albums/${albumId}/tracks`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({track_id: trackId})
        });
        
        const data = await res.json();
        
        if (data.success) {
            alert('Трек добавлен в альбом!');
        } else {
            alert(data.error || 'Ошибка добавления трека');
        }
    } catch(err) {
        alert('Ошибка добавления трека');
        console.error(err);
    }
}

function showAddToAlbum(trackId) {
    if (myAlbums.length === 0) {
        alert('Сначала создайте альбом');
        switchPage('albums');
        return;
    }
    
    const albumList = myAlbums.map(album => 
        `<button onclick="addTrackToAlbum(${trackId}, ${album.id}); this.closest('.modal').classList.remove('active');" 
                 style="width:100%; padding:12px; background:#1c1c1e; border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:white; text-align:left; margin-bottom:8px; cursor:pointer;">
            ${album.title}
        </button>`
    ).join('');
    
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Добавить в альбом</h2>
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

// === ВОСПРОИЗВЕДЕНИЕ ===
function playMyTrack(trackId) {
    // Используем window.myTracks если доступно
    const tracksToUse = (window.myTracks && Array.isArray(window.myTracks)) ? window.myTracks : myTracks;
    const trackIndex = tracksToUse.findIndex(t => t.id === trackId);
    
    if (trackIndex === -1) {
        console.error('Track not found:', trackId);
        return;
    }
    
    console.log('playMyTrack called:', trackId, 'index:', trackIndex, 'total tracks:', tracksToUse.length);
    
    // ВАЖНО: Устанавливаем ВСЕ треки библиотеки в плеер, а не только один
    window.tracks = tracksToUse;
    
    if (typeof window.setTracks === 'function') {
        window.setTracks(tracksToUse);
    }
    
    // Воспроизводим по индексу
    if (typeof window.playTrack === 'function') {
        window.playTrack(trackIndex, true);
    } else {
        console.error('playTrack function not available');
    }
}

// === МОДАЛЬНЫЕ ОКНА ===
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
    // Также закрываем динамически созданные модалки
    document.querySelectorAll('.modal.active').forEach(m => {
        if (m.id === modalId || !m.id) {
            m.classList.remove('active');
        }
    });
}

// Закрытие по клику вне модалки и ESC
document.addEventListener('DOMContentLoaded', () => {
    // Используем делегирование событий для всех модалок
    document.addEventListener('click', (e) => {
        // Проверяем клик на модалку (но не на её содержимое)
        if (e.target.classList.contains('modal')) {
            e.target.classList.remove('active');
        }
    });
    
    // Обработчик ESC для закрытия модалок
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(modal => {
                modal.classList.remove('active');
            });
        }
    });
});

// === LYRICS STUDIO (как в админке) ===
let lsLines = []; // { text: string, time: float | null }
let lsAudio = null;
let activeLineIndex = 0;
let isSyncing = false;
let editingIndex = -1;
let editingTimeIndex = -1;
let lyricsStudioTrackId = null;

function openLyricsStudio() {
    let existingLyrics = '';
    let audioFile = null;
    let audioUrl = null;
    
    const pageUpload = document.getElementById('page-upload');
    const modalEdit = document.getElementById('modal-edit-track');
    
    if (pageUpload && pageUpload.classList.contains('active')) {
        existingLyrics = document.getElementById('track-lyrics').value || '';
        const audioInput = document.getElementById('audio-file');
        if (audioInput && audioInput.files && audioInput.files[0]) {
            audioFile = audioInput.files[0];
            audioUrl = URL.createObjectURL(audioFile);
        }
    } else if (modalEdit && modalEdit.classList.contains('active')) {
        existingLyrics = document.getElementById('edit-track-lyrics').value || '';
        lyricsStudioTrackId = currentEditTrackId;
        const track = myTracks.find(t => t.id === lyricsStudioTrackId);
        if (track) {
            audioUrl = `/uploads/${track.filename}`;
        }
    }
    
    if (!audioUrl && !lyricsStudioTrackId) {
        alert('Сначала выберите аудиофайл или откройте трек для редактирования');
        return;
    }
    
    // Устанавливаем Raw Input
    document.getElementById('ls-raw-input').value = existingLyrics || '';
    
    if (existingLyrics) {
        parseLRC(existingLyrics, true);
    } else {
        lsLines = [];
        renderLsLines();
    }
    
    // Инициализируем аудио
    const audioEl = document.getElementById('ls-audio');
    if (audioUrl) {
        audioEl.src = audioUrl;
        lsAudio = audioEl;
        setupLsAudio();
    }
    
    // Открываем модальное окно
    document.getElementById('modal-lyrics-studio').classList.add('active');
}

function closeLyricsStudio() {
    closeModal('modal-lyrics-studio');
    if (lsAudio) {
        lsAudio.pause();
        lsAudio.src = '';
        lsAudio = null;
    }
    lyricsStudioTrackId = null;
}

function setupLsAudio() {
    if (!lsAudio) return;
    
    lsAudio.addEventListener('timeupdate', () => {
        if (!lsAudio) return; // Проверяем что audio еще существует
        const t = lsAudio.currentTime;
        if (!isNaN(t)) {
            const m = Math.floor(t / 60);
            const s = Math.floor(t % 60);
            document.getElementById('ls-time-display').innerText = `${m}:${s.toString().padStart(2, '0')}`;
            const duration = lsAudio.duration;
            if (!isNaN(duration) && duration > 0) {
                document.getElementById('ls-seek').value = (t / duration) * 100;
            }
            updateActiveLine();
        }
    });
    
    document.getElementById('ls-seek').addEventListener('input', (e) => {
        const pct = e.target.value;
        if (lsAudio && !isNaN(lsAudio.duration)) {
            lsAudio.currentTime = (pct / 100) * lsAudio.duration;
        }
    });
}

function updateActiveLine() {
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

function parseLRC(lrc, skipSync = false) {
    const lines = lrc.split('\n');
    const regex1 = /\[(\d{1,2}):(\d{2})\.(\d+)\](.*)/;
    const regex2 = /\[(\d{1,2}):(\d{2}):(\d+)\](.*)/;
    const regex3 = /\[(\d{1,2}):(\d{2})\](.*)/;
    lsLines = [];
    const seen = new Set();
    let lastTime = 0;
    let spacerCounter = 0;
    
    lines.forEach(line => {
        const trimmed = line.trim();
        
        if (!trimmed) {
            spacerCounter++;
            lsLines.push({ time: lastTime + (0.0001 * spacerCounter), text: '', isSpacer: true });
            return;
        }
        
        let match = trimmed.match(regex1);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const ms = parseInt(match[3]);
            const time = minutes * 60 + seconds + (ms / 100);
            const text = match[4].trim();
            const key = `${time}:${text}`;
            if (!seen.has(key)) {
                seen.add(key);
                lsLines.push({ time, text: text || '' });
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
            const time = minutes * 60 + seconds + (ms / 100);
            const text = match[4].trim();
            const key = `${time}:${text}`;
            if (!seen.has(key)) {
                seen.add(key);
                lsLines.push({ time, text: text || '' });
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
                lsLines.push({ time, text: text || '' });
                lastTime = time;
                spacerCounter = 0;
            }
            return;
        }
        
        if (!trimmed.startsWith('[')) {
            const key = `null:${trimmed}`;
            if (!seen.has(key)) {
                seen.add(key);
                spacerCounter++;
                lsLines.push({ time: lastTime + (0.0001 * spacerCounter), text: trimmed });
            }
        }
    });
    
    activeLineIndex = 0;
    renderLsLines();
    if (!skipSync) {
        syncRawText();
    }
}

function syncRawText() {
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
                lrcParts.push('');
            } else {
                const m = Math.floor(l.time / 60);
                const s = (l.time % 60).toFixed(2);
                const mm = m < 10 ? '0' + m : m.toString();
                const ss = parseFloat(s).toFixed(2);
                const ssFormatted = ss < 10 ? '0' + ss : ss;
                const text = (l.text || '').trim();
                lrcParts.push(`[${mm}:${ssFormatted}]${text}`);
            }
        } else if (l.text && l.text.trim()) {
            lrcParts.push(l.text.trim());
        } else if (!l.text || !l.text.trim()) {
            lrcParts.push('');
        }
    });
    
    while (lrcParts.length > 0 && lrcParts[lrcParts.length - 1] === '') {
        lrcParts.pop();
    }
    
    const lrc = lrcParts.join('\n');
    document.getElementById('ls-raw-input').value = lrc;
    
    setTimeout(() => { isSyncing = false; }, 100);
}

function syncFromRawText() {
    if (isSyncing) return;
    isSyncing = true;
    
    const raw = document.getElementById('ls-raw-input').value;
    if (!raw.trim()) {
        lsLines = [];
        renderLsLines();
        setTimeout(() => { isSyncing = false; }, 100);
        return;
    }
    
    const lines = raw.split('\n');
    const regex1 = /\[(\d{1,2}):(\d{2})\.(\d+)\](.*)/;
    const regex2 = /\[(\d{1,2}):(\d{2}):(\d+)\](.*)/;
    const regex3 = /\[(\d{1,2}):(\d{2})\](.*)/;
    const newLines = [];
    const seen = new Set();
    
    lines.forEach(line => {
        const trimmed = line.trim();
        
        if (!trimmed) {
            newLines.push({ time: null, text: '' });
            return;
        }
        
        let match = trimmed.match(regex1);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const ms = parseInt(match[3]);
            const time = minutes * 60 + seconds + (ms / 100);
            const text = match[4].trim();
            const key = `${time}:${text}`;
            if (!seen.has(key)) {
                seen.add(key);
                newLines.push({ time, text: text || '' });
            }
            return;
        }
        
        match = trimmed.match(regex2);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const ms = parseInt(match[3]);
            const time = minutes * 60 + seconds + (ms / 100);
            const text = match[4].trim();
            const key = `${time}:${text}`;
            if (!seen.has(key)) {
                seen.add(key);
                newLines.push({ time, text: text || '' });
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
                newLines.push({ time, text: text || '' });
            }
            return;
        }
        
        if (!trimmed.startsWith('[')) {
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
    
    setTimeout(() => { isSyncing = false; }, 100);
}

function renderLsLines() {
    const container = document.getElementById('ls-lines-container');
    if (!container) return;
    container.innerHTML = '';
    
    const seen = new Map();
    const uniqueLines = [];
    const indexMap = new Map();
    
    lsLines.forEach((line, oldIdx) => {
        const timeKey = line.time !== null ? Math.round(line.time * 100) / 100 : null;
        const key = `${timeKey}:${line.text || ''}`;
        
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
        const idx = lsLines.findIndex(l => l === line);
        
        const isEmpty = !line.text || !line.text.trim();
        if (isEmpty && line.time === null) {
            return;
        }
        
        const isActive = sortedIdx === sortedActiveIndex;
        const div = document.createElement('div');
        div.className = `ls-line ${isActive ? 'active' : ''}`;
        
        if (editingIndex === idx) {
            div.innerHTML = `
                <div class="ls-time">${line.time !== null ? formatTime(line.time) : '--:--'}</div>
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
            const currentTime = line.time !== null ? line.time : (lsAudio ? lsAudio.currentTime : 0);
            const m = Math.floor(currentTime / 60);
            const s = (currentTime % 60).toFixed(2);
            const mm = m < 10 ? '0' + m : m.toString();
            const ss = parseFloat(s).toFixed(2);
            const ssFormatted = ss < 10 ? '0' + ss : ss;
            
            div.innerHTML = `
                <input type="text" class="ls-time-input" value="${mm}:${ssFormatted}" 
                       onblur="finishTimeEdit(${idx}, this.value)" 
                       onkeydown="handleTimeEditKey(event, ${idx}, this)"
                       placeholder="mm:ss.xx">
                <div class="ls-text" style="${!line.text ? 'opacity: 0.5; font-style: italic;' : ''}">${escapeHtml(line.text || '(empty)')}</div>
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
            const isEmpty = !line.text || !line.text.trim();
            div.onclick = () => {
                activeLineIndex = idx;
                renderLsLines();
                if (line.time !== null && lsAudio) lsAudio.currentTime = line.time;
            };
            
            div.innerHTML = `
                <div class="ls-time" onclick="event.stopPropagation(); startTimeEdit(${idx})" style="cursor: pointer;" title="Click to edit time">${line.time !== null ? formatTime(line.time) : '--:--'}</div>
                <div class="ls-text" ondblclick="startEdit(${idx})" style="${isEmpty ? 'opacity: 0.5; font-style: italic;' : ''}">${escapeHtml(line.text || '(empty)')}</div>
                <div class="ls-actions">
                    <button class="ls-btn-small" onclick="event.stopPropagation(); startEdit(${idx})" title="Edit text">
                        <ion-icon name="create"></ion-icon>
                    </button>
                    ${line.time === null ? `<button class="ls-btn-small" onclick="event.stopPropagation(); setCurrentTime(${idx})" title="Set current time">⏱</button>` : ''}
                    <button class="ls-btn-small" onclick="event.stopPropagation(); deleteLine(${idx})" title="Delete">
                        <ion-icon name="trash"></ion-icon>
                    </button>
                </div>
            `;
        }
        
        container.appendChild(div);
    });
    
    const addBtn = document.createElement('div');
    addBtn.className = 'ls-line';
    addBtn.style.justifyContent = 'center';
    addBtn.style.cursor = 'pointer';
    addBtn.style.background = 'rgba(250, 45, 72, 0.1)';
    addBtn.innerHTML = `
        <button class="ls-btn-small" onclick="addNewLine()" style="background: var(--accent); width: auto; padding: 5px 15px;">
            <ion-icon name="add"></ion-icon> Add Line
        </button>
    `;
    container.appendChild(addBtn);
    
    const activeEl = container.querySelector('.ls-line.active');
    if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function formatTime(s) {
    if (s === null || isNaN(s)) return '--:--';
    const m = Math.floor(s / 60);
    const s_float = s % 60;
    const sec = Math.floor(s_float);
    const ms = Math.floor((s_float % 1) * 100);
    return `[${m < 10 ? '0' + m : m}:${sec < 10 ? '0' + sec : sec}.${ms < 10 ? '0' + ms : ms}]`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function startEdit(idx) {
    editingIndex = idx;
    editingTimeIndex = -1;
    renderLsLines();
    setTimeout(() => {
        const input = document.querySelector('.ls-text-input');
        if (input) input.focus();
    }, 50);
}

function updateLineText(idx, newText) {
    if (idx >= 0 && idx < lsLines.length) {
        lsLines[idx].text = newText;
        clearTimeout(updateLineText.timeout);
        updateLineText.timeout = setTimeout(() => {
            syncRawText();
        }, 100);
    }
}

function finishEdit(idx, newText) {
    if (idx >= 0 && idx < lsLines.length) {
        const trimmed = (newText || '').trim();
        lsLines[idx].text = trimmed;
    }
    editingIndex = -1;
    renderLsLines();
    setTimeout(() => {
        syncRawText();
    }, 10);
}

function cancelEdit() {
    editingIndex = -1;
    renderLsLines();
}

function handleEditKey(e, idx, input) {
    if (e.key === 'Enter') {
        e.preventDefault();
        finishEdit(idx, input.value);
    } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
    }
}

function addNewLine() {
    const currentTime = lsAudio ? lsAudio.currentTime : 0;
    const newLine = { text: '', time: currentTime };
    lsLines.push(newLine);
    syncRawText();
    renderLsLines();
    const sortedIndex = lsLines.findIndex(l => l === newLine);
    if (sortedIndex >= 0) {
        activeLineIndex = sortedIndex;
        editingTimeIndex = sortedIndex;
        renderLsLines();
        setTimeout(() => {
            syncRawText();
        }, 10);
    }
    setTimeout(() => {
        const input = document.querySelector('.ls-time-input');
        if (input) {
            input.focus();
            input.select();
        }
    }, 50);
}

function deleteLine(idx) {
    if (confirm('Delete this line?')) {
        lsLines.splice(idx, 1);
        if (activeLineIndex >= lsLines.length) activeLineIndex = lsLines.length - 1;
        if (activeLineIndex < 0) activeLineIndex = 0;
        editingIndex = -1;
        editingTimeIndex = -1;
        renderLsLines();
        syncRawText();
    }
}

function startTimeEdit(idx) {
    editingTimeIndex = idx;
    editingIndex = -1;
    renderLsLines();
    setTimeout(() => {
        const input = document.querySelector('.ls-time-input');
        if (input) {
            input.focus();
            input.select();
        }
    }, 50);
}

function finishTimeEdit(idx, timeStr) {
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

function cancelTimeEdit() {
    editingTimeIndex = -1;
    renderLsLines();
}

function handleTimeEditKey(e, idx, input) {
    if (e.key === 'Enter') {
        e.preventDefault();
        finishTimeEdit(idx, input.value);
    } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelTimeEdit();
    }
}

function setCurrentTime(idx) {
    if (idx >= 0 && idx < lsLines.length && lsAudio) {
        lsLines[idx].time = lsAudio.currentTime || 0;
        renderLsLines();
        syncRawText();
    }
}

function lsPlayPause() {
    if (!lsAudio) return;
    if (lsAudio.paused) {
        lsAudio.play();
        document.getElementById('ls-play-btn').innerHTML = '<ion-icon name="pause"></ion-icon>';
    } else {
        lsAudio.pause();
        document.getElementById('ls-play-btn').innerHTML = '<ion-icon name="play"></ion-icon>';
    }
}

function lsSyncCurrentLine() {
    if (!lsAudio) return;
    const currentTime = lsAudio.currentTime;
    const newLine = { text: '', time: currentTime };
    lsLines.push(newLine);
    syncRawText();
    renderLsLines();
    const sortedIndex = lsLines.findIndex(l => l === newLine);
    if (sortedIndex >= 0) {
        activeLineIndex = sortedIndex;
        editingIndex = sortedIndex;
        renderLsLines();
        setTimeout(() => {
            syncRawText();
        }, 10);
    }
    setTimeout(() => {
        const input = document.querySelector('.ls-text-input');
        if (input) input.focus();
    }, 50);
}

function lsExport() {
    syncRawText();
    const rawText = document.getElementById('ls-raw-input').value;
    const lines = rawText.split('\n');
    while (lines.length > 0 && !lines[lines.length - 1].trim()) {
        lines.pop();
    }
    const lrc = lines.join('\n');
    
    if (lyricsStudioTrackId) {
        document.getElementById('edit-track-lyrics').value = lrc;
    } else {
        document.getElementById('track-lyrics').value = lrc;
    }
    
    closeLyricsStudio();
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('modal-lyrics-studio');
    if (!modal || !modal.classList.contains('active')) return;
    
    if (e.code === 'Space' && editingIndex === -1) {
        e.preventDefault();
        lsSyncCurrentLine();
    }
    if (e.code === 'KeyP' && editingIndex === -1) {
        e.preventDefault();
        lsPlayPause();
    }
});

// === ЕДИНАЯ ФУНКЦИЯ ИНИЦИАЛИЗАЦИИ ПРИЛОЖЕНИЯ ===
// Эта функция может быть вызвана как при DOMContentLoaded, так и при SPA переходе
async function initApp() {
    // Проверяем SHARED_MODE безопасно (может быть undefined при SPA переходе)
    const sharedMode = typeof SHARED_MODE !== 'undefined' ? SHARED_MODE : false;
    const initialTrack = typeof INITIAL_TRACK !== 'undefined' ? INITIAL_TRACK : null;
    
    console.log('initApp called, SHARED_MODE:', sharedMode, 'INITIAL_TRACK:', initialTrack);
    console.log('isTelegram:', window.isTelegram, 'tgWebApp:', window.tgWebApp);
    
    // Если это shared mode - не показываем авторизацию, показываем только плеер
    if (sharedMode && initialTrack) {
        const authScreen = document.getElementById('auth-screen');
        const mainApp = document.getElementById('main-app');
        if (authScreen) authScreen.style.display = 'none';
        if (mainApp) mainApp.style.display = 'none';
        // Плеер будет инициализирован в player.js через fetchTracks
        return;
    }
    
    // Проверяем, есть ли уже предзагруженные данные (от главной страницы)
    if (window.preloadedTracks && window.preloadedTracks.length > 0) {
        console.log('Using preloaded tracks:', window.preloadedTracks.length);
        myTracks = window.preloadedTracks;
        window.myTracks = window.preloadedTracks;
    }
    if (window.preloadedAlbums && window.preloadedAlbums.length > 0) {
        console.log('Using preloaded albums:', window.preloadedAlbums.length);
        myAlbums = window.preloadedAlbums;
        window.myAlbums = window.preloadedAlbums;
    }
    
    // 1. Пробуем проверить сессию в браузере (Cookie)
    try {
        console.log('Checking browser session...');
        await loadProfile(); // Попытка загрузить профиль через API (cookie)
        
        if (window.currentUser && window.currentUser.id) {
            console.log('✅ User authenticated via Cookie/Session');
            
            // Если есть предзагруженные данные - используем их, иначе загружаем
            if (window.myTracks && window.myTracks.length > 0) {
                console.log('Rendering preloaded tracks');
                renderMyTracks();
                updateStats();
            } else {
                console.log('Loading tracks from API');
                await loadMyTracks();
            }
            
            if (window.myAlbums && window.myAlbums.length > 0) {
                console.log('Rendering preloaded albums');
                renderMyAlbums();
                updateStats();
            } else {
                console.log('Loading albums from API');
                await loadMyAlbums();
            }
            
            // Рендерим профиль
            renderProfile();
            
            // Только после загрузки данных показываем приложение
            const authScreen = document.getElementById('auth-screen');
            const mainApp = document.getElementById('main-app');
            if (authScreen) authScreen.style.display = 'none';
            if (mainApp) mainApp.style.display = 'flex';
            
            // Если есть nickname, показываем кнопку share
            if (window.currentUser.nickname) {
                const shareBtn = document.getElementById('share-btn');
                if (shareBtn) shareBtn.style.display = 'block';
            }
            return; // Выходим, авторизация успешна
        }
    } catch (e) {
        console.log('Session check failed:', e);
    }

    // 2. Если сессии нет, пробуем Telegram WebApp
    const isTg = window.isTelegram || (window.Telegram && window.Telegram.WebApp);
    const tgApp = window.tgWebApp || (window.Telegram ? window.Telegram.WebApp : null);
    
    if (isTg && tgApp) {
        console.log('Starting Telegram auth initialization...');
        initAuth().catch(err => {
            console.error('Auth initialization error:', err);
            // Если авторизация не удалась, редиректим на бота
            const botUrl = 'https://t.me/swagplayerobot?start=auth';
            if (window.Telegram && window.Telegram.WebApp) {
                // В Telegram WebApp открываем бота
                if (confirm('Для использования приложения необходимо авторизоваться.\n\nОткрыть бота для авторизации?')) {
                    window.Telegram.WebApp.openTelegramLink(botUrl);
                } else {
                    showAuthError(err);
                }
            } else {
                showAuthError(err);
            }
        });
    } else {
        // Не в Telegram и нет сессии - редиректим на бота
        const botUrl = 'https://t.me/swagplayerobot?start=auth';
        if (confirm('Для использования приложения необходимо авторизоваться.\n\nОткрыть бота для авторизации?')) {
            window.location.href = botUrl;
        } else {
            showAuthError(new Error('Приложение доступно только через Telegram или по специальной ссылке входа (запросите в боте /login)'));
        }
    }
}

// === ИНИЦИАЛИЗАЦИЯ ===
document.addEventListener('DOMContentLoaded', async () => {
    await initApp();
});

function showAuthError(err) {
    const authLoading = document.getElementById('auth-loading');
    const authError = document.getElementById('auth-error');
    if (authLoading) authLoading.style.display = 'none';
    if (authError) {
        authError.style.display = 'block';
        const errorText = document.getElementById('auth-error-text');
        if (errorText) {
            errorText.textContent = `Ошибка: ${err.message || 'Неизвестная ошибка'}`;
        }
    }
}

// Экспортируем функции для использования в других скриптах
window.switchPage = switchPage;
window.editTrack = editTrack;
window.playMyTrack = playMyTrack;
window.shareTrack = shareTrack;
window.showCreateAlbum = showCreateAlbum;
window.showProfile = () => switchPage('profile');
window.saveProfile = saveProfile;
window.copyProfileLink = copyProfileLink;
window.showShareLibrary = showShareLibrary;
window.closeModal = closeModal;
window.openLyricsStudio = openLyricsStudio;

// Экспортируем функции загрузки данных для использования в navigation.js
window.loadProfile = loadProfile;
window.loadMyTracks = loadMyTracks;
window.loadMyAlbums = loadMyAlbums;
window.loadUserData = loadUserData;
window.initApp = initApp;
// Функция для переключения громкости в миниплеере
function toggleMiniVolume() {
    const miniVolumeContainer = document.getElementById('mini-volume-container');
    if (miniVolumeContainer) {
        const isVisible = miniVolumeContainer.style.display === 'flex';
        miniVolumeContainer.style.display = isVisible ? 'none' : 'flex';
    }
}
window.toggleMiniVolume = toggleMiniVolume;

// Инициализация регулятора громкости в мини-плеере
document.addEventListener('DOMContentLoaded', () => {
    const miniVolumeSlider = document.getElementById('mini-volume-slider');
    const audio = document.getElementById('audio-element');
    if (miniVolumeSlider && audio) {
        // Предотвращаем скролл страницы при взаимодействии со слайдером
        let isInteracting = false;
        
        const preventScroll = (e) => {
            if (isInteracting) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        
        miniVolumeSlider.addEventListener('touchstart', (e) => {
            isInteracting = true;
            e.stopPropagation();
        }, { passive: false });
        
        miniVolumeSlider.addEventListener('touchmove', (e) => {
            if (isInteracting) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, { passive: false });
        
        miniVolumeSlider.addEventListener('touchend', (e) => {
            isInteracting = false;
            e.stopPropagation();
        }, { passive: false });
        
        miniVolumeSlider.addEventListener('touchcancel', (e) => {
            isInteracting = false;
            e.stopPropagation();
        }, { passive: false });
        
        // Обновление громкости
        miniVolumeSlider.addEventListener('input', (e) => {
            if (audio) {
                audio.volume = parseFloat(e.target.value);
            }
        });
        
        // Синхронизируем значение при изменении громкости извне
        if (audio) {
            audio.addEventListener('volumechange', () => {
                if (miniVolumeSlider) {
                    miniVolumeSlider.value = audio.volume;
                }
            });
        }
    }
});

// Используем lsPlayPause как lyricsStudioTogglePlay
window.lyricsStudioTogglePlay = lsPlayPause;
window.lyricsStudioInsertTimestamp = lsSyncCurrentLine; // Используем lsSyncCurrentLine
window.lyricsStudioSave = lsExport;
window.deleteCurrentTrack = deleteCurrentTrack;
window.toggleTrackVisibility = toggleTrackVisibility;

// Функции для лайков треков и альбомов
async function toggleTrackLike(trackId) {
    if (!window.currentUser) {
        const botUrl = 'https://t.me/swagplayerobot?start=auth';
        // Сразу редиректим без диалога
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.openTelegramLink(botUrl);
        } else {
            window.location.href = botUrl;
        }
        return;
    }
    try {
        const res = await fetch(`/api/tracks/${trackId}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!res.ok) {
            if (res.status === 401) {
                let errorData = {};
                try {
                    // Клонируем response чтобы можно было прочитать дважды
                    const clonedRes = res.clone();
                    const text = await clonedRes.text();
                    errorData = text ? JSON.parse(text) : {};
                } catch (e) {
                    console.log('Failed to parse error response:', e);
                }
                const botUrl = errorData.auth_url || 'https://t.me/swagplayerobot?start=auth';
                const message = errorData.message || 'Для того чтобы ставить лайки, пожалуйста, авторизуйтесь.';
                
                // Показываем диалог и редиректим
                const shouldRedirect = confirm(message + '\n\nОткрыть бота для авторизации?');
                if (shouldRedirect) {
                    // В Telegram WebApp открываем бота через tg://
                    if (window.Telegram && window.Telegram.WebApp) {
                        window.Telegram.WebApp.openTelegramLink(botUrl);
                    } else {
                        window.location.href = botUrl;
                    }
                }
            } else {
                alert('Ошибка при постановке лайка.');
            }
            return;
        }
        
        const data = await res.json();
        if (data.success) {
            // Обновляем UI
            const trackElement = document.querySelector(`.track-like-btn[data-track-id="${trackId}"]`);
            if (trackElement) {
                const likeIcon = trackElement.querySelector('ion-icon');
                const likesCountSpan = trackElement.querySelector('.track-likes-count');
                if (likeIcon) likeIcon.name = data.liked ? 'heart' : 'heart-outline';
                if (likesCountSpan) likesCountSpan.textContent = data.likes_count;
                if (data.liked) {
                    trackElement.classList.add('liked');
                } else {
                    trackElement.classList.remove('liked');
                }
            }
            // Обновляем данные в массиве
            const track = myTracks.find(t => t.id === trackId);
            if (track) {
                track.is_liked = data.liked;
                track.likes_count = data.likes_count;
            }
        } else {
            alert(data.error || 'Ошибка при постановке лайка.');
        }
    } catch (e) {
        console.error('Error toggling track like:', e);
        alert('Ошибка сети при постановке лайка.');
    }
}

async function toggleAlbumLike(albumId) {
    if (!window.currentUser) {
        alert('Для того чтобы ставить лайки, пожалуйста, авторизуйтесь.');
        return;
    }
    try {
        const res = await fetch(`/api/albums/${albumId}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success) {
            // Обновляем UI
            const albumElement = document.querySelector(`.album-like-btn[data-album-id="${albumId}"]`);
            if (albumElement) {
                const likeIcon = albumElement.querySelector('ion-icon');
                const likesCountSpan = albumElement.querySelector('.album-likes-count');
                if (likeIcon) likeIcon.name = data.liked ? 'heart' : 'heart-outline';
                if (likesCountSpan) likesCountSpan.textContent = data.likes_count;
                if (data.liked) {
                    albumElement.classList.add('liked');
                } else {
                    albumElement.classList.remove('liked');
                }
            }
            // Обновляем данные в массиве
            const album = myAlbums.find(a => a.id === albumId);
            if (album) {
                album.is_liked = data.liked;
                album.likes_count = data.likes_count;
            }
        } else {
            alert(data.error || 'Ошибка при постановке лайка.');
        }
    } catch (e) {
        console.error('Error toggling album like:', e);
        alert('Ошибка сети при постановке лайка.');
    }
}

// Функция для лайка текущего трека в плеере
// Теперь сохраняет лайк в базе данных
async function toggleCurrentTrackLike() {
    if (!window.currentUser) {
        const botUrl = 'https://t.me/swagplayerobot?start=auth';
        // Сразу редиректим без диалога
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.openTelegramLink(botUrl);
        } else {
            window.location.href = botUrl;
        }
        return;
    }
    
    // Получаем текущий трек из player.js
    let track = null;
    
    // Проверяем наличие трека по currentIndex, а не только по isPlaying
    // Трек может быть загружен и готов, даже если еще не начал играть
    if (typeof window.getCurrentTrack === 'function') {
        track = window.getCurrentTrack();
    } else if (typeof window.tracks !== 'undefined' && typeof window.currentIndex !== 'undefined' && window.currentIndex >= 0 && window.currentIndex < window.tracks.length) {
        track = window.tracks[window.currentIndex];
    }
    
    if (!track || !track.id) {
        // Убираем предупреждение - это нормально если трек еще не выбран
        return;
    }
    
    if (track && track.id) {
        try {
            const res = await fetch(`/api/tracks/${track.id}/like`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!res.ok) {
                if (res.status === 401) {
                    let errorData = {};
                    try {
                        // Клонируем response чтобы можно было прочитать дважды
                        const clonedRes = res.clone();
                        const text = await clonedRes.text();
                        errorData = text ? JSON.parse(text) : {};
                    } catch (e) {
                        console.log('Failed to parse error response:', e);
                    }
                    const botUrl = errorData.auth_url || 'https://t.me/swagplayerobot?start=auth';
                    
                    // Сразу редиректим без диалога
                    if (window.Telegram && window.Telegram.WebApp) {
                        window.Telegram.WebApp.openTelegramLink(botUrl);
                    } else {
                        window.location.href = botUrl;
                    }
                } else {
                    alert('Ошибка при постановке лайка.');
                }
                return;
            }
            
            const data = await res.json();
            if (data.success) {
                // Обновляем состояние лайка
                window.currentTrackLiked = data.liked || false;
                
                if (data.likes_count !== undefined) {
                    window.currentTrackLikesCount = data.likes_count || 0;
                }
                
                // Обновляем локальные переменные в player.js если они доступны
                if (typeof window.updateLikeUI === 'function') {
                    // Обновляем переменные через функцию updateLikeUI
                    window.updateLikeUI();
                } else {
                    // Если функция недоступна, обновляем напрямую
                    const playerLikeIcon = document.getElementById('player-like-icon');
                    const playerLikesCount = document.getElementById('player-likes-count');
                    const playerLikeBtn = document.getElementById('player-like-btn');
                    
                    if (playerLikeIcon) {
                        playerLikeIcon.name = window.currentTrackLiked ? 'heart' : 'heart-outline';
                        if (window.currentTrackLiked) {
                            playerLikeIcon.setAttribute('fill', 'solid');
                            playerLikeIcon.style.color = '#fa2d48';
                        } else {
                            playerLikeIcon.removeAttribute('fill');
                            playerLikeIcon.style.color = 'white';
                        }
                    }
                    
                    if (playerLikesCount) {
                        playerLikesCount.textContent = window.currentTrackLikesCount || 0;
                    }
                    
                    if (playerLikeBtn) {
                        if (window.currentTrackLiked) {
                            playerLikeBtn.classList.add('liked');
                            playerLikeBtn.style.background = 'rgba(250, 45, 72, 0.2)';
                        } else {
                            playerLikeBtn.classList.remove('liked');
                            playerLikeBtn.style.background = 'rgba(255,255,255,0.1)';
                        }
                    }
                }
                
                // Обновляем данные в массиве треков если есть
                if (typeof window.tracks !== 'undefined' && window.tracks.length > 0) {
                    const trackIndex = window.tracks.findIndex(t => t.id === track.id);
                    if (trackIndex >= 0) {
                        window.tracks[trackIndex].is_liked = data.liked;
                        window.tracks[trackIndex].likes_count = data.likes_count;
                    }
                }
            } else {
                alert(data.error || 'Ошибка при постановке лайка.');
            }
        } catch (e) {
            console.error('Error toggling current track like:', e);
            alert('Ошибка сети при постановке лайка.');
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

// === УПРАВЛЕНИЕ АЛЬБОМАМИ ===
let currentEditAlbumId = null;

async function editAlbum(albumId) {
    const album = myAlbums.find(a => a.id === albumId);
    if (!album) return;
    
    currentEditAlbumId = albumId;
    
    // Создаем модальное окно редактирования
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'modal-edit-album';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Редактировать альбом</h2>
                <button class="btn-icon" onclick="closeModal('modal-edit-album')">
                    <ion-icon name="close"></ion-icon>
                </button>
            </div>
            <form id="edit-album-form">
                <div class="form-group">
                    <label>Название альбома</label>
                    <input type="text" id="edit-album-title" value="${album.title}" required>
                </div>
                <div class="form-group">
                    <label>Описание</label>
                    <textarea id="edit-album-description" rows="3">${album.description || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>Обложка альбома</label>
                    <input type="file" id="edit-album-cover-file" accept="image/*">
                    <div class="cover-preview" id="edit-album-cover-preview">
                        ${album.cover_filename ? `<img src="/uploads/${album.cover_filename}" alt="Cover">` : ''}
                    </div>
                </div>
                <div class="form-group">
                    <label>Короткая ссылка</label>
                    <input type="text" id="edit-album-slug" value="${album.slug || ''}">
                </div>
                <div class="form-actions" style="display:flex; gap:10px; margin-top:20px;">
                    <button type="button" class="btn-danger" onclick="deleteAlbum(${albumId})" style="flex:1;">
                        <ion-icon name="trash"></ion-icon>
                        Удалить
                    </button>
                    <button type="button" class="btn-secondary" onclick="closeModal('modal-edit-album')" style="flex:1;">
                        Отмена
                    </button>
                    <button type="submit" class="btn-primary" style="flex:1;">
                        <ion-icon name="save"></ion-icon>
                        Сохранить
                    </button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Предпросмотр обложки
    document.getElementById('edit-album-cover-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                document.getElementById('edit-album-cover-preview').innerHTML = 
                    `<img src="${event.target.result}" alt="Cover">`;
            };
            reader.readAsDataURL(file);
        }
    });
    
    // Обработка формы
    document.getElementById('edit-album-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData();
        formData.append('title', document.getElementById('edit-album-title').value);
        formData.append('description', document.getElementById('edit-album-description').value);
        const slug = document.getElementById('edit-album-slug').value;
        if (slug) formData.append('slug', slug);
        
        const coverFile = document.getElementById('edit-album-cover-file').files[0];
        if (coverFile) formData.append('cover', coverFile);
        
        try {
            const res = await fetch(`/api/albums/${albumId}`, {
                method: 'PUT',
                body: formData
            });
            
            const data = await res.json();
            
            if (data.success) {
                alert('Альбом обновлен!');
                document.getElementById('modal-edit-album').remove();
                await loadMyAlbums();
            } else {
                alert(data.error || 'Ошибка обновления альбома');
            }
        } catch(err) {
            alert('Ошибка обновления альбома');
            console.error(err);
        }
    });
}

async function manageAlbumTracks(albumId) {
    const album = myAlbums.find(a => a.id === albumId);
    if (!album) return;
    
    // Удаляем старую модалку если есть, чтобы избежать дубликатов ID
    const oldModal = document.getElementById('modal-manage-album-tracks');
    if (oldModal) {
        oldModal.remove();
    }
    
    // Загружаем треки альбома
    let albumTracks = [];
    try {
        const res = await fetch(`/api/albums/${albumId}/tracks?t=${Date.now()}`);
        if (res.ok) {
            albumTracks = await res.json();
        }
    } catch(e) {
        console.error('Error loading album tracks:', e);
    }
    
    // Создаем модальное окно управления треками
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'modal-manage-album-tracks';
    modal.innerHTML = `
        <div class="modal-content modal-large">
            <div class="modal-header">
                <h2>Управление треками: ${album.title}</h2>
                <button class="btn-icon" onclick="closeModal('modal-manage-album-tracks')">
                    <ion-icon name="close"></ion-icon>
                </button>
            </div>
            <div style="margin-bottom: 20px; display:flex; gap:10px;">
                <button class="btn-primary" onclick="showAddTracksToAlbum(${albumId})" style="flex:1;">
                    <ion-icon name="add"></ion-icon>
                    Добавить треки
                </button>
                <button class="btn-secondary" onclick="closeModal('modal-manage-album-tracks')" style="flex:1;">
                    Закрыть
                </button>
            </div>
            <div id="album-tracks-list" style="max-height: 500px; overflow-y: auto; padding: 10px 0;">
                ${albumTracks.length === 0 ? '<p style="text-align:center; color:rgba(255,255,255,0.5); padding: 40px 20px;">В альбоме пока нет треков. Нажмите "Добавить треки" чтобы начать.</p>' : ''}
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Рендерим треки альбома
    renderAlbumTracks(albumId, albumTracks);
}

function renderAlbumTracks(albumId, tracks) {
    const container = document.getElementById('album-tracks-list');
    if (!container) return;
    
    if (tracks.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:rgba(255,255,255,0.5);">В альбоме пока нет треков</p>';
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
                        title="Вверх">
                        <ion-icon name="chevron-up" style="font-size:18px;"></ion-icon>
                    </button>` : '<div style="width:32px; height:32px;"></div>'}
                    ${index < tracks.length - 1 ? `<button onclick="moveTrackInAlbum(${albumId}, ${track.id}, 'down')" style="background:rgba(255,255,255,0.1); border:none; color:white; padding:6px; border-radius:6px; cursor:pointer; width:32px; height:32px; display:flex; align-items:center; justify-content:center; transition:background 0.2s;" 
                        onmouseover="this.style.background='rgba(255,255,255,0.2)'" 
                        onmouseout="this.style.background='rgba(255,255,255,0.1)'" 
                        title="Вниз">
                        <ion-icon name="chevron-down" style="font-size:18px;"></ion-icon>
                    </button>` : '<div style="width:32px; height:32px;"></div>'}
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; margin-bottom:4px; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(track.title)}</div>
                    <div style="font-size:13px; color:rgba(255,255,255,0.6); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(track.artist || 'Неизвестный исполнитель')}</div>
                </div>
                <div style="color:rgba(255,255,255,0.4); font-size:12px; margin-right:8px; flex-shrink:0;">#${index + 1}</div>
            </div>
            <button onclick="removeTrackFromAlbum(${albumId}, ${track.id})" 
                    style="background:#ff453a; border:none; color:white; padding:10px 16px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px; transition:all 0.2s; font-size:14px; font-weight:500; flex-shrink:0;"
                    onmouseover="this.style.background='#ff5c4d'; this.style.transform='scale(1.02)'"
                    onmouseout="this.style.background='#ff453a'; this.style.transform='scale(1)'">
                <ion-icon name="trash" style="font-size:16px;"></ion-icon>
                <span>Удалить</span>
            </button>
        </div>
    `).join('');
}

function showAddTracksToAlbum(albumId) {
    // Удаляем старую модалку если есть
    const oldModal = document.getElementById('modal-add-tracks-to-album');
    if (oldModal) {
        oldModal.remove();
    }

    // Показываем список всех треков пользователя для добавления
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'modal-add-tracks-to-album';
    
    // Получаем треки, которых еще нет в альбоме
    fetch(`/api/albums/${albumId}/tracks?t=${Date.now()}`).then(res => res.json()).then(albumTracks => {
        const albumTrackIds = albumTracks.map(t => t.id);
        const availableTracks = myTracks.filter(t => !albumTrackIds.includes(t.id));
        
        modal.innerHTML = `
            <div class="modal-content modal-large">
                <div class="modal-header">
                    <h2>Добавить треки в альбом</h2>
                    <button class="btn-icon" onclick="closeModal('modal-add-tracks-to-album')">
                        <ion-icon name="close"></ion-icon>
                    </button>
                </div>
                
                <div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; gap: 10px;">
                        <button class="btn-secondary small" onclick="selectAllAlbumTracks(true)">Выбрать все</button>
                        <button class="btn-secondary small" onclick="selectAllAlbumTracks(false)">Снять выделение</button>
                    </div>
                    <span id="selected-count">Выбрано: 0</span>
                </div>

                <div style="max-height: 400px; overflow-y: auto;" id="album-add-list">
                    ${availableTracks.length === 0 ? 
                        '<p style="text-align:center; color:rgba(255,255,255,0.5); padding:20px;">Нет доступных треков для добавления</p>' :
                        availableTracks.map(track => `
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
                        `).join('')
                    }
                </div>
                
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); display: flex; gap: 10px;">
                    <button class="btn-secondary" onclick="closeModal('modal-add-tracks-to-album')" style="flex: 1;">
                        Отмена
                    </button>
                    <button class="btn-primary" onclick="addSelectedTracksToAlbum(${albumId})" style="flex: 2;" id="btn-add-selected" disabled>
                        Добавить выбранные
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // CSS для выделения
        const style = document.createElement('style');
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
        el.classList.remove('selected');
    } else {
        selectedTracksForAlbum.add(trackId);
        el.classList.add('selected');
    }
    
    updateSelectionUI();
}

function selectAllAlbumTracks(select) {
    const items = document.querySelectorAll('.track-select-item');
    items.forEach(item => {
        const onclick = item.getAttribute('onclick');
        const match = onclick.match(/toggleTrackSelection\((\d+)\)/);
        if (match && match[1]) {
            const trackId = parseInt(match[1]);
            if (select) {
                selectedTracksForAlbum.add(trackId);
                item.classList.add('selected');
            } else {
                selectedTracksForAlbum.delete(trackId);
                item.classList.remove('selected');
            }
        }
    });
    updateSelectionUI();
}

function updateSelectionUI() {
    document.getElementById('selected-count').textContent = `Выбрано: ${selectedTracksForAlbum.size}`;
    const btn = document.getElementById('btn-add-selected');
    if (btn) {
        btn.disabled = selectedTracksForAlbum.size === 0;
        btn.textContent = selectedTracksForAlbum.size > 0 ? `Добавить выбранные (${selectedTracksForAlbum.size})` : 'Добавить выбранные';
        btn.style.opacity = selectedTracksForAlbum.size > 0 ? '1' : '0.5';
    }
}

async function addSelectedTracksToAlbum(albumId) {
    if (selectedTracksForAlbum.size === 0) return;
    
    const btn = document.getElementById('btn-add-selected');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner small"></div> Добавление...';
    
    const tracks = Array.from(selectedTracksForAlbum);
    let successCount = 0;
    
    // Добавляем последовательно
    for (const trackId of tracks) {
        try {
            const res = await fetch(`/api/albums/${albumId}/tracks`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ track_id: trackId })
            });
            if (res.ok) successCount++;
        } catch (e) {
            console.error(e);
        }
    }
    
    closeModal('modal-add-tracks-to-album');
    selectedTracksForAlbum.clear();
    
    // Обновляем список
    await manageAlbumTracks(albumId);
    
    // Показываем уведомление
    alert(`Добавлено треков: ${successCount}`);
}

async function removeTrackFromAlbum(albumId, trackId) {
    if (!confirm('Удалить трек из альбома?')) return;
    
    try {
        const res = await fetch(`/api/albums/${albumId}/tracks/${trackId}`, {
            method: 'DELETE'
        });
        
        const data = await res.json();
        
        if (data.success) {
            // Обновляем список треков
            const tracksRes = await fetch(`/api/albums/${albumId}/tracks?t=${Date.now()}`);
            if (tracksRes.ok) {
                const tracks = await tracksRes.json();
                renderAlbumTracks(albumId, tracks);
            }
        } else {
            alert('Ошибка удаления трека');
        }
    } catch(err) {
        alert('Ошибка удаления трека');
        console.error(err);
    }
}

async function moveTrackInAlbum(albumId, trackId, direction) {
    try {
        const res = await fetch(`/api/albums/${albumId}/tracks/${trackId}/move`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ direction })
        });
        
        const data = await res.json();
        
        if (data.success) {
            // Обновляем список треков
            const tracksRes = await fetch(`/api/albums/${albumId}/tracks?t=${Date.now()}`);
            if (tracksRes.ok) {
                const tracks = await tracksRes.json();
                renderAlbumTracks(albumId, tracks);
            }
        } else {
            alert('Ошибка перемещения трека');
        }
    } catch(err) {
        alert('Ошибка перемещения трека');
        console.error(err);
    }
}

async function deleteAlbum(albumId) {
    if (!confirm('Удалить этот альбом? Все треки останутся, но будут удалены из альбома.')) return;
    
    try {
        const res = await fetch(`/api/albums/${albumId}`, {
            method: 'DELETE'
        });
        
        const data = await res.json();
        
        if (data.success) {
            alert('Альбом удален!');
            document.getElementById('modal-edit-album').remove();
            await loadMyAlbums();
        } else {
            alert('Ошибка удаления альбома');
        }
    } catch(err) {
        alert('Ошибка удаления альбома');
        console.error(err);
    }
}

window.editAlbum = editAlbum;
window.manageAlbumTracks = manageAlbumTracks;
window.showAddTracksToAlbum = showAddTracksToAlbum;
window.removeTrackFromAlbum = removeTrackFromAlbum;
window.deleteAlbum = deleteAlbum;
window.moveTrackInAlbum = moveTrackInAlbum;

