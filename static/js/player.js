// Базовый путь убран - все пути работают напрямую

let tracks = [];
let currentIndex = -1;
window.currentIndex = -1;
let currentTrackLiked = false;
let currentTrackLikesCount = 0;
window.currentTrackLiked = false;
window.currentTrackLikesCount = 0;

// Функция для установки треков извне
window.setTracks = function(newTracks) {
    tracks = newTracks;
};
let lyricsData = [];
let isLyricsOpen = false;
let isFirstTrackClick = true;
let userScrolledLyrics = false;
let lyricsScrollTimeout = null;
let webAudioInitialized = false;

// Получаем элементы только если они существуют (для альбомов может не быть)
let audio = null;
let fullPlayer = null;
let isIOS = false;

// Функция инициализации плеера
function initPlayer() {
    audio = document.getElementById('audio-element');
    fullPlayer = document.getElementById('full-player');
    
    // Определяем iOS
    isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    
    // Инициализируем слушатели событий
    setupAudioListeners();
    
    // Восстанавливаем состояние плеера из localStorage при загрузке
    // ВАЖНО: НЕ восстанавливаем в SHARED_MODE - там должен быть только shared трек!
    // ВАЖНО: Валидируем треки перед восстановлением
    
    // Проверяем SHARED_MODE - если true, НЕ восстанавливаем из localStorage
    const isSharedMode = typeof window.SHARED_MODE !== 'undefined' && window.SHARED_MODE === true;
    if (isSharedMode) {
        console.log('SHARED_MODE detected, skipping localStorage restore - will use INITIAL_TRACK');
    }
    
    try {
        const savedState = localStorage.getItem('playerState');
        if (savedState && !isSharedMode) {
            const state = JSON.parse(savedState);
            if (state.tracks && state.tracks.length > 0) {
                console.log('Restoring player state from localStorage on init', state);
                
                // Валидируем треки - проверяем их существование через API
                const validateTracks = async (tracks) => {
                    if (!tracks || tracks.length === 0) return [];
                    
                    // Проверяем каждый трек
                    const validTracks = [];
                    for (const track of tracks) {
                        if (!track.id) continue;
                        
                        try {
                            // Проверяем существование трека через список треков с фильтром
                            const res = await fetch(`/api/tracks?id=${track.id}`);
                            if (res.ok) {
                                const tracks = await res.json();
                                const foundTrack = Array.isArray(tracks) ? tracks.find(t => t.id === track.id) : null;
                                if (foundTrack) {
                                    validTracks.push(foundTrack);
                                } else {
                                    console.log(`Track ${track.id} no longer exists, skipping`);
                                }
                            } else {
                                console.log(`Track ${track.id} validation failed, skipping`);
                            }
                        } catch (e) {
                            console.log(`Error validating track ${track.id}:`, e);
                        }
                    }
                    
                    return validTracks;
                };
                
                // Валидируем треки асинхронно
                validateTracks(state.tracks).then(validTracks => {
                    if (validTracks.length > 0) {
                        // Обновляем состояние с валидными треками
                        state.tracks = validTracks;
                        // Корректируем индекс если нужно
                        if (state.currentIndex >= validTracks.length) {
                            state.currentIndex = -1;
                        }
                        window.tracks = validTracks;
                        window.currentIndex = state.currentIndex !== undefined ? state.currentIndex : -1;
                        window.playerState = state;
                        
                        // Сохраняем обновленное состояние
                        try {
                            localStorage.setItem('playerState', JSON.stringify(state));
                        } catch (e) {
                            console.log('Failed to update player state:', e);
                        }
                        
                        // НЕ восстанавливаем автоматически - только загружаем данные
                        // Автозапуск отключен для предотвращения резкого запуска при загрузке
                        console.log('Player state loaded, but not auto-playing');
                        
                        // Показываем миниплеер если есть трек для показа
                        if (state.currentIndex >= 0 && state.currentIndex < validTracks.length) {
                            const track = validTracks[state.currentIndex];
                            if (track) {
                                // Обновляем UI миниплеера
                                const miniPlayer = document.getElementById('mini-player');
                                const miniCover = document.getElementById('mini-cover');
                                const miniTitle = document.getElementById('mini-title');
                                const miniArtist = document.getElementById('mini-artist');
                                
                                if (miniPlayer) miniPlayer.classList.remove('hidden');
                                if (miniCover && track.cover_filename) {
                                    miniCover.src = `/uploads/${track.cover_filename}`;
                                }
                                if (miniTitle) miniTitle.textContent = track.title || 'Unknown';
                                if (miniArtist) miniArtist.textContent = track.artist || '';
                                
                                // Устанавливаем src аудио но НЕ запускаем
                                if (audio && track.filename) {
                                    audio.src = `/uploads/${track.filename}`;
                                    // Восстанавливаем время если было сохранено
                                    if (state.currentTime > 0) {
                                        audio.addEventListener('loadedmetadata', function restoreTime() {
                                            audio.removeEventListener('loadedmetadata', restoreTime);
                                            audio.currentTime = state.currentTime;
                                        }, { once: true });
                                    }
                                }
                                
                                console.log('Mini player shown with track:', track.title);
                            }
                        }
                    } else {
                        // Если нет валидных треков, очищаем localStorage
                        console.log('No valid tracks found, clearing localStorage');
                        localStorage.removeItem('playerState');
                        window.tracks = [];
                        window.currentIndex = -1;
                    }
                });
            }
        }
    } catch (e) {
        console.log('Failed to restore player state from localStorage:', e);
        // Очищаем поврежденное состояние
        try {
            localStorage.removeItem('playerState');
        } catch (e2) {
            console.log('Failed to clear localStorage:', e2);
        }
    }
    
    // Start - загружаем треки если не в режиме приложения или в shared mode
    if (window.SHARED_MODE && typeof INITIAL_TRACK !== 'undefined' && INITIAL_TRACK) {
        // В shared mode сразу загружаем трек
        // Устанавливаем трек напрямую, минуя fetchTracks для скорости и надежности
        console.log('Initializing Shared Mode with track:', INITIAL_TRACK);
        
        // Скрываем скелетон немедленно
        const skeletonLoader = document.getElementById('skeleton-loader');
        if (skeletonLoader) {
            skeletonLoader.style.display = 'none';
        }
        
        // Устанавливаем треки
        tracks = [INITIAL_TRACK];
        currentIndex = 0;
        
        // Запускаем плеер
        playTrack(0, false);
        
        // Раскрываем плеер
        if (fullPlayer) {
            fullPlayer.classList.add('open');
            fullPlayer.classList.add('loaded');
        }
        
    } else if (!document.getElementById('main-app') || (document.getElementById('main-app') && document.getElementById('main-app').style.display === 'none')) {
        // Обычный режим - загружаем все треки
        // Проверяем, что мы не на странице с уже заданными треками (например, альбом)
        // Синхронизируем tracks с window.tracks если он определен
        if (typeof window.tracks !== 'undefined' && Array.isArray(window.tracks) && window.tracks.length > 0) {
            tracks = window.tracks;
            console.log('Tracks synced from window.tracks:', tracks.length);
        }
        
        if (tracks.length === 0 && (typeof window.tracks === 'undefined' || window.tracks.length === 0)) {
             fetchTracks();
        }
    }
    
    // Инициализация слайдера прогресса
    const progressArea = document.getElementById('progress-area');
    if (progressArea) {
        // Удаляем старые слушатели (клонируем узел) - это грубо, но работает для удаления анонимных слушателей
        // Но лучше просто добавить проверку, чтобы не добавлять дважды.
        // В данном случае, так как init вызывается один раз, все ок.
        
        // Делаем элемент доступным для touch-событий
        progressArea.style.touchAction = 'none';
        progressArea.style.webkitUserSelect = 'none';
        progressArea.style.userSelect = 'none';
        
        // Удаляем старые event listeners клонированием (если это безопасно для child elements)
        // const newProgressArea = progressArea.cloneNode(true);
        // progressArea.parentNode.replaceChild(newProgressArea, progressArea);
        // const activeProgressArea = newProgressArea;
        
        // Но клонирование убьет ссылки на progress-fill, так что лучше просто добавим флаг
        if (!progressArea.getAttribute('data-initialized')) {
            progressArea.setAttribute('data-initialized', 'true');
            
            progressArea.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                seekToPosition(e.clientX, progressArea);
            });
            
            let isSeeking = false;
            
            progressArea.addEventListener('touchstart', (e) => {
                if (e.touches.length === 1) {
                    e.preventDefault();
                    e.stopPropagation();
                    isSeeking = true;
                    seekToPosition(e.touches[0].clientX, progressArea);
                }
            }, { passive: false });
            
            progressArea.addEventListener('touchmove', (e) => {
                if (isSeeking && e.touches.length === 1) {
                    e.preventDefault();
                    e.stopPropagation();
                    seekToPosition(e.touches[0].clientX, progressArea);
                }
            }, { passive: false });
            
            progressArea.addEventListener('touchend', (e) => {
                if (isSeeking) {
                    e.preventDefault();
                    e.stopPropagation();
                    isSeeking = false;
                }
            }, { passive: false });
            
            progressArea.addEventListener('touchcancel', (e) => {
                isSeeking = false;
            });
        }
    }
}

// Инициализируем элементы при загрузке DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPlayer);
} else {
    // Если DOM уже готов, инициализируем сразу
    initPlayer();
}

// Определяем iOS (включая iPad) - будет установлено в DOMContentLoaded
// isIOS объявлен выше в initPlayer

// Определяем Telegram WebView - используем глобальные переменные из app.js
// const isTelegram и const tgWebApp уже определены в app.js

// Функция сравнения версий
function isVersionAtLeast(ver) {
    if (!window.tgWebApp || !window.tgWebApp.version) return false;
    const v1 = window.tgWebApp.version.split('.');
    const v2 = ver.split('.');
    for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
        const n1 = parseInt(v1[i] || 0);
        const n2 = parseInt(v2[i] || 0);
        if (n1 > n2) return true;
        if (n1 < n2) return false;
    }
    return true;
}

// Используем глобальные переменные из app.js (не объявляем заново)
// Просто используем глобальные переменные, которые должны быть определены в app.js
// Если они не определены, определяем их здесь
if (typeof window.isTelegram === 'undefined') {
    window.isTelegram = window.Telegram && window.Telegram.WebApp;
    window.tgWebApp = window.isTelegram ? window.Telegram.WebApp : null;
}

// Используем глобальные переменные напрямую через window (не создаем локальные const/let)
// Это позволяет избежать конфликтов объявления
// Просто обращаемся к window.isTelegram и window.tgWebApp напрямую

// Определяем SHARED_MODE если не определен
if (typeof window.SHARED_MODE === 'undefined') {
    window.SHARED_MODE = false;
}
// Используем window.SHARED_MODE напрямую, не создаем локальную переменную

// Инициализация Telegram WebApp
if (window.isTelegram && window.tgWebApp) {
    document.documentElement.classList.add('tg-view');
    
    // Расширяем приложение на весь экран
    window.tgWebApp.expand();
    
    // Настраиваем цветовую схему и другие функции с проверкой версии
    if (isVersionAtLeast('6.1')) {
        try {
            window.tgWebApp.setHeaderColor('#000000');
            window.tgWebApp.setBackgroundColor('#000000');
        } catch(e) {}
    }
    
    // Включаем вибрацию при необходимости (доступно с 6.2)
    if (isVersionAtLeast('6.2')) {
        try {
            window.tgWebApp.enableClosingConfirmation();
        } catch(e) {}
    }
    
    // Обработка изменения размера окна
    window.tgWebApp.onEvent('viewportChanged', () => {
        // Обновляем размеры при изменении viewport
        const viewportHeight = window.tgWebApp.viewportHeight;
        if (viewportHeight) {
            document.documentElement.style.setProperty('--tg-viewport-height', `${viewportHeight}px`);
        }
    });
    
    // Применяем высоту viewport если доступна
    if (window.tgWebApp.viewportHeight) {
        document.documentElement.style.setProperty('--tg-viewport-height', `${window.tgWebApp.viewportHeight}px`);
        document.documentElement.style.height = `${window.tgWebApp.viewportHeight}px`;
        document.body.style.height = `${window.tgWebApp.viewportHeight}px`;
    }
    
    // Обработка закрытия приложения и кнопки Назад (доступна с 6.1)
    if (isVersionAtLeast('6.1') && window.tgWebApp.BackButton) {
        window.tgWebApp.onEvent('backButtonClicked', () => {
            const fullPlayer = document.getElementById('full-player');
            // В Shared Mode мы не позволяем закрывать плеер кнопкой назад
            if (!window.SHARED_MODE && fullPlayer && fullPlayer.classList.contains('open')) {
                collapsePlayer();
            } else {
                window.tgWebApp.close();
            }
        });
    }
    
    // Показываем кнопку "Назад" когда нужно
    function updateBackButton() {
        if (!window.tgWebApp || !window.tgWebApp.BackButton || !isVersionAtLeast('6.1')) return;
        
        // В Shared Mode кнопку назад не трогаем или скрываем если есть
        if (window.SHARED_MODE) {
            window.tgWebApp.BackButton.hide();
            return;
        }
        
        const fullPlayer = document.getElementById('full-player');
        const shouldShow = fullPlayer && fullPlayer.classList.contains('open');
        if (shouldShow) {
            window.tgWebApp.BackButton.show();
        } else {
            window.tgWebApp.BackButton.hide();
        }
    }
    
    // Обновляем кнопку "Назад" при изменении состояния
    const observer = new MutationObserver(updateBackButton);
    observer.observe(document.body, { 
        childList: true, 
        subtree: true, 
        attributes: true, 
        attributeFilter: ['class', 'style'] 
    });
    updateBackButton();
}

// Web Audio API - отключаем для iOS, так как он мешает стандартному воспроизведению
let audioContext = null;
let gainNode = null;
let sourceNode = null;
let useWebAudio = false;

// Инициализация Web Audio API - отключена для iOS
function initWebAudio() {
    // Для iOS не используем Web Audio API, так как он мешает стандартному воспроизведению
    if (isIOS) {
        useWebAudio = false;
        return;
    }
    
    if (audioContext) {
        if (audioContext.state === 'suspended') {
            audioContext.resume().catch(() => {
                useWebAudio = false;
            });
        }
        return;
    }
    
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            audioContext = new AudioContext();
            if (audioContext.state === 'suspended') {
                audioContext.resume().then(() => {}).catch(() => {});
            }
            gainNode = audioContext.createGain();
            gainNode.connect(audioContext.destination);
            gainNode.gain.value = 1.0;
            useWebAudio = true;
        }
    } catch(e) {
        useWebAudio = false;
    }
}

// Подключение аудио к Web Audio API
function connectWebAudio() {
    if (!useWebAudio || !audioContext || !gainNode) {
        // Если Web Audio не доступен, используем обычный способ
        return;
    }
    
    try {
        // Отключаем старый источник если есть
        if (sourceNode) {
            try {
                sourceNode.disconnect();
            } catch(e) {
                // Игнорируем ошибки отключения
            }
        }
        
        // Создаем новый источник из audio элемента
        // Важно: можно создать только один раз для одного audio элемента
        if (!sourceNode) {
            sourceNode = audioContext.createMediaElementSource(audio);
            sourceNode.connect(gainNode);
            // Не подключаем audio напрямую к destination - gainNode уже подключен
        }
    } catch(e) {
        // Если не удалось подключить, отключаем Web Audio
        useWebAudio = false;
    }
}

// Инициализируем Web Audio при первом пользовательском действии (для iOS)
function initWebAudioOnUserAction(event) {
    // Предотвращаем множественные вызовы
    if (webAudioInitialized) return;
    
    // Создаем AudioContext только после пользовательского жеста
    if (!audioContext) {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                audioContext = new AudioContext();
                
                // Сразу возобновляем если в suspended состоянии
                // Это должно быть в том же обработчике пользовательского жеста
                if (audioContext.state === 'suspended') {
                    audioContext.resume().then(() => {
                        // Успешно возобновлен
                    }).catch(() => {
                        // Игнорируем ошибки
                    });
                }
                
                gainNode = audioContext.createGain();
                gainNode.connect(audioContext.destination);
                gainNode.gain.value = 1.0;
                useWebAudio = true;
                webAudioInitialized = true;
            }
        } catch(e) {
            useWebAudio = false;
            webAudioInitialized = true; // Помечаем как инициализированный, чтобы не пытаться снова
        }
    } else {
        // Если уже создан, просто возобновляем
        if (audioContext.state === 'suspended') {
            audioContext.resume().catch(() => {});
        }
        webAudioInitialized = true;
    }
}

// Авторизация через Telegram - теперь в app.js
// Используем глобальную переменную window.currentUser из app.js

// === INIT ===
async function fetchTracks() {
    // Если Shared Mode, используем переданный трек
    if (window.SHARED_MODE && typeof INITIAL_TRACK !== 'undefined' && INITIAL_TRACK) {
        tracks = [INITIAL_TRACK];
        currentIndex = 0;
        
        // Скрываем skeleton loader
        const skeletonLoader = document.getElementById('skeleton-loader');
        if (skeletonLoader) {
            skeletonLoader.style.display = 'none';
        }
        
        // Скрываем auth screen и main app
        const authScreen = document.getElementById('auth-screen');
        const mainApp = document.getElementById('main-app');
        if (authScreen) authScreen.style.display = 'none';
        if (mainApp) mainApp.style.display = 'none';
        
        // Инициализируем UI и открываем плеер
        // Не запускаем воспроизведение автоматически, чтобы не нарушать политики автовоспроизведения
        playTrack(0, false);
        return;
    }

    try {
        // Сохраняем текущий трек перед обновлением
        let currentTrackId = null;
        if (currentIndex >= 0 && tracks[currentIndex]) {
            currentTrackId = tracks[currentIndex].id;
        }
        
        // Получаем публичные треки (для библиотеки используются треки из app.js)
        const res = await fetch('/api/tracks');
        tracks = await res.json();
        
        // Обновляем currentIndex если трек все еще существует
        if (currentTrackId !== null) {
            const newIndex = tracks.findIndex(t => t.id === currentTrackId);
            if (newIndex !== -1) {
                currentIndex = newIndex;
            } else {
                // Трек был удален, останавливаем воспроизведение
                if (currentIndex >= 0) {
                    closeTrack();
                }
            }
        }
        
        renderList();
    } catch(e) { }
}

function renderList() {
    const list = document.getElementById('track-list');
    if (!list) return; // Если элемента нет (в новом UI)
    
    if (window.SHARED_MODE) {
        list.innerHTML = ''; // Hide list in shared mode
        return;
    }

    list.innerHTML = '';
    const isPlaying = audio && !audio.paused && currentIndex >= 0;
    tracks.forEach((t, i) => {
        const div = document.createElement('div');
        div.className = `track-item ${i === currentIndex ? 'playing-now' : ''}`;
        const equalizerClass = (i === currentIndex && isPlaying) ? 'equalizer-animation' : 'equalizer-animation paused';
        div.innerHTML = `
            <img src="/uploads/${t.cover_filename || ''}" loading="lazy" onerror="this.style.display='none'">
            <div class="track-info">
                <div class="track-title">${t.title}</div>
                <div class="track-artist">${t.artist}</div>
            </div>
            ${i === currentIndex ? `<div class="${equalizerClass}"><div class="equalizer-bar"></div><div class="equalizer-bar"></div><div class="equalizer-bar"></div><div class="equalizer-bar"></div><div class="equalizer-bar"></div></div>` : ''}
        `;
        div.onclick = () => playTrack(i);
        list.appendChild(div);
    });
}

// === PLAYER LOGIC ===
function playTrack(index, autoPlay = true) {
    // Сначала обновляем треки из window.tracks если они есть
    if (window.tracks && window.tracks.length > 0) {
        tracks = window.tracks;
    }
    
    currentIndex = index;
    window.currentIndex = index;
    
    // Используем глобальный tracks если локальный не определен
    const tracksList = typeof tracks !== 'undefined' && tracks.length > 0 ? tracks : (window.tracks || []);
    const track = tracksList[index];
    
    if (!track) {
        console.error('Track not found at index', index, 'tracks length:', tracksList.length, 'available tracks:', tracksList.map(t => t.id || t.title));
        return;
    }
    
    console.log('Playing track:', track.title, 'index:', index, 'from', tracksList.length, 'tracks');
    
    // Для iOS не используем Web Audio
    if (!isIOS && !webAudioInitialized && !audioContext && autoPlay) {
        initWebAudioOnUserAction();
    }
    
    if (!audio) {
        console.error('Audio element not found');
        return;
    }
    
    // Sources
    audio.src = `/uploads/${track.filename}`;
    
    // Увеличиваем счетчик прослушиваний трека
    if (track.id) {
        fetch(`/api/tracks/${track.id}/play`, { method: 'POST' }).catch(err => console.error('Error counting play:', err));
    }
    
    // Увеличиваем счетчик прослушиваний альбома, если трек из альбома
    if (typeof window.currentAlbumId !== 'undefined' && window.currentAlbumId) {
        fetch(`/api/albums/${window.currentAlbumId}/play`, { method: 'POST' }).catch(err => console.error('Error counting album play:', err));
    }
    
    // Для iOS - устанавливаем правильные атрибуты для фонового воспроизведения
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    audio.setAttribute('preload', 'metadata');
    audio.setAttribute('crossorigin', 'anonymous');
    
    // Для iOS не используем Web Audio API
    if (!isIOS) {
        // Подключаем Web Audio API после установки источника (только для не-iOS)
        audio.addEventListener('loadedmetadata', () => {
            if (useWebAudio && !sourceNode) {
                connectWebAudio();
            }
        }, { once: true });
    }
    
    if (autoPlay) {
        // Воспроизведение - для iOS используем стандартный метод
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                // После успешного запуска, подключаем Web Audio если нужно (не для iOS)
                if (!isIOS && useWebAudio && !sourceNode) {
                    connectWebAudio();
                }
            }).catch((error) => {
                // Игнорируем ошибки воспроизведения
                console.log('Play error:', error);
            });
        }
    }
    
    // Update UI Data
    const coverUrl = `/uploads/${track.cover_filename || ''}`;
    
    // Media Session API - передаем метаданные в систему для фонового воспроизведения
    if ('mediaSession' in navigator) {
        try {
            // Для iOS используем абсолютный URL для artwork
            const artworkUrl = coverUrl.startsWith('http') ? coverUrl : window.location.origin + coverUrl;
            
            navigator.mediaSession.metadata = new MediaMetadata({
                title: track.title,
                artist: track.artist,
                album: '',
                artwork: [
                    { src: artworkUrl, sizes: '512x512', type: 'image/jpeg' },
                    { src: artworkUrl, sizes: '256x256', type: 'image/jpeg' },
                    { src: artworkUrl, sizes: '128x128', type: 'image/jpeg' },
                    { src: artworkUrl, sizes: '96x96', type: 'image/jpeg' }
                ]
            });
            
            // Обработчики действий медиа-сессии
            navigator.mediaSession.setActionHandler('play', () => {
                const playPromise = audio.play();
                if (playPromise !== undefined) {
                    playPromise.then(() => {
                        updatePlayButtons(true);
                        if ('mediaSession' in navigator) {
                            navigator.mediaSession.playbackState = 'playing';
                        }
                    }).catch(() => {});
                }
            });
            
            navigator.mediaSession.setActionHandler('pause', () => {
                audio.pause();
                updatePlayButtons(false);
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'paused';
                }
            });
            
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                prevTrack();
            });
            
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                nextTrack();
            });
            
            // Для iOS добавляем seekto если поддерживается
            try {
                navigator.mediaSession.setActionHandler('seekto', (details) => {
                    if (details.seekTime !== null && details.seekTime !== undefined) {
                        audio.currentTime = details.seekTime;
                    }
                });
            } catch(e) {
                // seekto может не поддерживаться
            }
            
            // Устанавливаем состояние воспроизведения
            navigator.mediaSession.playbackState = autoPlay ? 'playing' : 'paused';
        } catch(e) {
            console.log('Media Session error:', e);
        }
    }
    
    // Mini Player (если есть) - скрываем в shared mode
    const miniPlayer = document.getElementById('mini-player');
    if (miniPlayer) {
        if (window.SHARED_MODE) {
            // В shared mode миниплеер не нужен
            miniPlayer.classList.add('hidden');
        } else {
            miniPlayer.classList.remove('hidden');
        }
    }
    const miniCover = document.getElementById('mini-cover');
    // Извлекаем имя файла из URL для сравнения
    const getFilename = (url) => {
        if (!url) return '';
        const parts = url.split('/');
        return parts[parts.length - 1];
    };
    
    if (miniCover) {
        const currentMiniCover = getFilename(miniCover.src || '');
        const newCoverFilename = getFilename(coverUrl);
        if (currentMiniCover !== newCoverFilename) {
            miniCover.src = coverUrl;
        }
    }
    
    const miniTitle = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    if (miniTitle) miniTitle.innerText = track.title;
    if (miniArtist) miniArtist.innerText = track.artist;
    
    // Full Player - предзагрузка обложки для предотвращения мигания
    const fullCover = document.getElementById('full-cover') || document.getElementById('player-cover');
    const playerBg = document.getElementById('player-bg');
    
    if (fullCover) {
        // Проверяем, нужно ли менять обложку (сравниваем имена файлов)
        const currentCoverFilename = getFilename(fullCover.src || '');
        const newCoverFilename = getFilename(coverUrl);
        const needsUpdate = currentCoverFilename !== newCoverFilename;
        
        if (needsUpdate) {
            // Предзагружаем изображение перед заменой
            const img = new Image();
            img.onload = () => {
                // Только после загрузки меняем src - это предотвращает мигание
                fullCover.src = coverUrl;
                if (playerBg) {
                    playerBg.style.backgroundImage = `url('${coverUrl}')`;
                }
            };
            img.onerror = () => {
                // В случае ошибки все равно устанавливаем (может быть placeholder)
                fullCover.src = coverUrl;
                if (playerBg) {
                    playerBg.style.backgroundImage = `url('${coverUrl}')`;
                }
            };
            img.src = coverUrl;
        }
    }
    
    // Обновляем заголовки в full player (поддержка обоих вариантов ID)
    const playerTitle = document.getElementById('player-title') || document.getElementById('full-title');
    const playerArtist = document.getElementById('player-artist') || document.getElementById('full-artist');
    const fullTitle = document.getElementById('full-title');
    const fullArtist = document.getElementById('full-artist');
    
    if (playerTitle) playerTitle.innerText = track.title;
    if (fullTitle) fullTitle.innerText = track.title;
    
    // Обновляем имя исполнителя - делаем кликабельным если есть nickname
    const updateArtistName = (artistElement, trackData) => {
        if (!artistElement) return;
        
        // Проверяем есть ли nickname
        const nickname = trackData.nickname || (trackData.user_id ? null : null);
        
        if (nickname) {
            // Создаем кликабельную ссылку
            artistElement.innerHTML = `<a href="/user/${nickname}" onclick="if(typeof window.SPANavigation !== 'undefined' && window.SPANavigation.navigateTo) { event.preventDefault(); window.SPANavigation.navigateTo('/user/${nickname}'); }" style="color: rgba(255,255,255,0.6); text-decoration: none; transition: color 0.2s;" onmouseover="this.style.color='#fa2d48'" onmouseout="this.style.color='rgba(255,255,255,0.6)'">${trackData.artist}</a>`;
        } else {
            // Просто текст
            artistElement.innerText = trackData.artist;
        }
    };
    
    updateArtistName(playerArtist, track);
    updateArtistName(fullArtist, track);
    
    // Parse Lyrics
    parseLyrics(track.lyrics);
    
    // Обновляем состояние кнопки лириков и закрываем лирики, если их нет
    updateLyricsButton();
    
    // Если лирики были открыты, но у нового трека их нет - закрываем
    if (isLyricsOpen && lyricsData.length === 0) {
        const cover = document.getElementById('full-cover');
        const lyricsWrap = document.getElementById('lyrics-wrapper');
        const btn = document.getElementById('lyrics-btn');
        
        if (cover && lyricsWrap && btn) {
            isLyricsOpen = false;
            lyricsWrap.style.opacity = '0';
            setTimeout(() => {
                lyricsWrap.style.display = 'none';
            }, 300);
            cover.style.display = 'block';
            requestAnimationFrame(() => {
                cover.style.opacity = '1';
                cover.style.transform = 'scale(1)';
            });
            btn.classList.remove('active');
        }
    }
    
    // Re-render list for active state
    renderList();
    updatePlayButtons(autoPlay);
    
    // Загружаем статус лайка и счетчик из API
    if (track.likes_count !== undefined) {
        currentTrackLikesCount = track.likes_count || 0;
        window.currentTrackLikesCount = currentTrackLikesCount;
    } else {
        currentTrackLikesCount = 0;
        window.currentTrackLikesCount = 0;
    }
    
    // ВСЕГДА загружаем реальный статус лайка из API (не полагаемся на кэш)
    if (track.id) {
        fetch(`/api/tracks/${track.id}/like`, { method: 'GET' })
            .then(res => {
                if (res.ok) {
                    return res.json();
                } else if (res.status === 401) {
                    // Не авторизован - лайк не установлен
                    currentTrackLiked = false;
                    window.currentTrackLiked = false;
                    updateLikeUI();
                    return null;
                } else {
                    throw new Error(`HTTP ${res.status}`);
                }
            })
            .then(data => {
                if (data && data.success) {
                    currentTrackLiked = data.liked || false;
                    window.currentTrackLiked = currentTrackLiked;
                    if (data.likes_count !== undefined) {
                        currentTrackLikesCount = data.likes_count || 0;
                        window.currentTrackLikesCount = currentTrackLikesCount;
                    }
                    // Обновляем трек в массиве
                    if (track) {
                        track.is_liked = currentTrackLiked;
                        track.likes_count = currentTrackLikesCount;
                    }
                    updateLikeUI();
                }
            })
            .catch(err => {
                console.error('Error loading like status:', err);
                // Если ошибка, сбрасываем лайк (не полагаемся на кэш)
                currentTrackLiked = false;
                window.currentTrackLiked = false;
                if (track) {
                    track.is_liked = false;
                }
                updateLikeUI();
            });
    } else {
        // Если нет ID трека, сбрасываем лайк
        currentTrackLiked = false;
        window.currentTrackLiked = false;
        updateLikeUI();
    }
    
    // В Shared Mode всегда открываем плеер
    if (window.SHARED_MODE) {
        if (fullPlayer) {
            fullPlayer.classList.add('open');
            fullPlayer.classList.add('loaded');
        }
        // Скрываем skeleton loader еще раз на всякий случай
        const skeletonLoader = document.getElementById('skeleton-loader');
        if (skeletonLoader) {
            skeletonLoader.style.display = 'none';
        }
    } else {
        // В обычном режиме плеер может быть не нужен сразу
        // console.error('Full Player element not found!'); 
    }  
    
    if (isFirstTrackClick) {
        // При первом клике открываем плеер (не в Shared Mode)
        isFirstTrackClick = false;
        expandPlayer();
        // Автоматически открываем лирики только если они есть
        setTimeout(() => {
            if (!isLyricsOpen && lyricsData.length > 0 && track.lyrics && track.lyrics.trim()) {
                toggleLyricsView();
            }
        }, 200);
    }
}

function closeTrack() {
    if (window.SHARED_MODE) return; // Cant close in shared mode
    audio.pause();
    audio.currentTime = 0;
    document.getElementById('mini-player').classList.add('hidden');
    currentIndex = -1;
    renderList();
}

function togglePlay() {
    // Для iOS не используем Web Audio
    if (!isIOS && !webAudioInitialized && !audioContext) {
        initWebAudioOnUserAction();
    }
    
    if (audio.paused) {
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
        updatePlayButtons(true);
                // Обновляем Media Session
                if ('mediaSession' in navigator) {
                    try {
                        navigator.mediaSession.playbackState = 'playing';
                    } catch(e) {}
                }
            }).catch(error => {
                updatePlayButtons(false);
                console.log('Play error:', error);
            });
        } else {
            updatePlayButtons(true);
        }
    } else {
        audio.pause();
        updatePlayButtons(false);
        // Обновляем Media Session
        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.playbackState = 'paused';
            } catch(e) {}
        }
    }
}

function updatePlayButtons(isPlaying) {
    // Обновляем состояние Media Session
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
    const icon = isPlaying ? '<ion-icon name="pause"></ion-icon>' : '<ion-icon name="play"></ion-icon>';
    const iconLarge = isPlaying ? '<ion-icon name="pause-circle"></ion-icon>' : '<ion-icon name="play-circle"></ion-icon>';
    
    document.getElementById('mini-play-btn').innerHTML = icon;
    document.getElementById('full-play-btn').innerHTML = iconLarge;
    
    // Анимация обложки (уменьшается при паузе) - используем requestAnimationFrame для плавности
    const cover = document.getElementById('full-cover');
    if (cover) {
        requestAnimationFrame(() => {
            if(isPlaying) {
                cover.classList.remove('shrink');
            } else {
                cover.classList.add('shrink');
            }
        });
    }
    
    // Обновляем анимацию эквалайзера в списке треков
    renderList();
}

function nextTrack() {
    if (tracks.length === 0) return;
    if (window.SHARED_MODE) {
        // In shared mode, just restart the track
        audio.currentTime = 0;
        playTrack(0);
        return;
    }
    if (currentIndex < tracks.length - 1) {
        playTrack(currentIndex + 1);
    } else {
        playTrack(0); // Переход к первому треку
    }
}
function prevTrack() {
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    if (tracks.length === 0) return;
    if (window.SHARED_MODE) {
        audio.currentTime = 0;
        playTrack(0);
        return;
    }
    if (currentIndex > 0) {
        playTrack(currentIndex - 1);
    } else {
        playTrack(tracks.length - 1); // Переход к последнему треку
    }
}

// === UI ANIMATIONS ===
function expandPlayer() {
    if (window.SHARED_MODE) return; // Already open and fixed
    if (!fullPlayer) return;
    
    fullPlayer.classList.add('open');
    document.body.style.overflow = 'hidden';
    
    // Скрываем миниплеер когда открыт full player
    const miniPlayer = document.getElementById('mini-player');
    if (miniPlayer) {
        miniPlayer.classList.add('hidden');
    }
    
    // Обновляем кнопку "Назад" в Telegram
    if (window.isTelegram && window.tgWebApp && isVersionAtLeast('6.1') && window.tgWebApp.BackButton) {
        window.tgWebApp.BackButton.show();
    }
    if (typeof updateBackButton === 'function') updateBackButton();
    
    // Плавное появление элементов
    requestAnimationFrame(() => {
        const content = document.querySelector('.player-content');
        if (content) {
            content.style.opacity = '0';
            content.style.transform = 'translateY(10px)';
            setTimeout(() => {
                content.style.transition = 'opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1), transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
                content.style.opacity = '1';
                content.style.transform = 'translateY(0)';
            }, 50);
        }
    });
}
function collapsePlayer() {
    if (window.SHARED_MODE) return; // Cannot collapse
    if (!fullPlayer) return;
    
    // Сразу закрываем плеер без анимации контента
    fullPlayer.classList.remove('open');
    document.body.style.overflow = '';
    
    // Показываем миниплеер когда закрыт full player (если трек играет)
    const miniPlayer = document.getElementById('mini-player');
    if (miniPlayer && currentIndex >= 0) {
        miniPlayer.classList.remove('hidden');
    }
    
    // Обновляем кнопку "Назад" в Telegram
    if (window.isTelegram && window.tgWebApp && isVersionAtLeast('6.1') && window.tgWebApp.BackButton) {
        window.tgWebApp.BackButton.hide();
    }
    if (typeof updateBackButton === 'function') updateBackButton();
    
    // Сбрасываем стили контента после закрытия
    setTimeout(() => {
        const content = document.querySelector('.player-content');
        if (content) {
            content.style.transition = '';
            content.style.opacity = '';
            content.style.transform = '';
        }
    }, 100);
}

// === LYRICS SYSTEM ===
function parseLyrics(text) {
    lyricsData = [];
    const container = document.getElementById('lyrics-container');
    if (!container) {
        console.error('Lyrics container not found');
        return;
    }
    container.innerHTML = '';
    
    if (!text || !text.trim()) {
        container.innerHTML = '<div style="margin-top:50px; color:#666;">No lyrics available</div>';
        return;
    }

    const lines = text.split('\n');
    const regex = /\[(\d{2}):(\d{2}\.?\d*)\](.*)/;

    // Небольшой отступ сверху для первой строки
    const emptyTop = document.createElement('div');
    emptyTop.className = 'lyric-spacer';
    emptyTop.style.height = '50vh'; // Достаточно для центрирования первой строки
    container.appendChild(emptyTop);

    let hasZeroTime = false;
    let firstNonZeroTime = null;

    lines.forEach(line => {
        const match = line.match(regex);
        if (match) {
            const time = parseInt(match[1]) * 60 + parseFloat(match[2]);
            const textContent = match[3].trim();
            
            // Отслеживаем наличие нулевой секунды
            if (time === 0 || time < 0.1) {
                hasZeroTime = true;
            }
            
            // Запоминаем первое ненулевое время
            if (firstNonZeroTime === null && time > 0.1) {
                firstNonZeroTime = time;
            }
            
            // Сохраняем строку с текстом
            if (textContent) {
                lyricsData.push({ time, text: textContent });
            
            const div = document.createElement('div');
            div.className = 'lyric-line';
                div.innerText = textContent;
            div.dataset.time = time;
            div.onclick = () => {
                audio.currentTime = time;
                syncLyrics(); // Сразу обновить UI
            };
            container.appendChild(div);
            } else {
                // Пустая строка - сохраняем отступ
                const emptyDiv = document.createElement('div');
                emptyDiv.style.height = '40px'; // Побольше отступ для пустых строк
                container.appendChild(emptyDiv);
            }
        } else if (line.trim() === '') {
            // Пустая строка без таймкода - сохраняем отступ
            const emptyDiv = document.createElement('div');
            emptyDiv.style.height = '40px';
            container.appendChild(emptyDiv);
        }
    });
    
    // Защита: если первая строка начинается не с нуля, устанавливаем её время на 0
    // чтобы текст был виден с самого начала, а не появлялся позже
    if (!hasZeroTime && lyricsData.length > 0) {
        // Изменяем время первой строки на 0, чтобы она была видна с начала
        lyricsData[0].time = 0;
        
        // Обновляем время в DOM для первой строки
        const firstLineElement = container.querySelector('.lyric-line');
        if (firstLineElement) {
            firstLineElement.dataset.time = 0;
            firstLineElement.onclick = () => {
                audio.currentTime = 0;
                syncLyrics();
            };
        }
    }
    
    // Большой отступ внизу для последней строки
    const emptyBottom = document.createElement('div');
    emptyBottom.className = 'lyric-spacer';
    emptyBottom.style.height = '50vh'; // Достаточно для центрирования последней строки
    container.appendChild(emptyBottom);
    
    // Настраиваем отслеживание скролла после парсинга
    setupLyricsScrollTracking();
    
    // Проверяем, что текст действительно был добавлен
    const finalLines = container.querySelectorAll('.lyric-line');
    if (finalLines.length === 0 && lyricsData.length > 0) {
        console.warn('Lyrics data exists but no lines were rendered');
    }
}

function syncLyrics() {
    if (!isLyricsOpen || lyricsData.length === 0) return;
    
    const time = audio.currentTime;
    if (isNaN(time) || time < 0) return;
    
    let activeIdx = -1;
    
    // Находим активную строку (ближайшую к текущему времени)
    for (let i = lyricsData.length - 1; i >= 0; i--) {
        if (time >= lyricsData[i].time) {
            activeIdx = i;
            break;
        }
    }

    const lines = document.querySelectorAll('.lyric-line');
    if (lines.length === 0) return;
    
    // Обновляем классы только если строка изменилась
    if (lastActiveIdx !== activeIdx) {
    lines.forEach(l => l.classList.remove('active'));

    if (activeIdx !== -1 && activeIdx < lines.length) {
            lines[activeIdx].classList.add('active');
        
            // Если пользователь не скроллил вручную, центрируем активную строку
        if (!userScrolledLyrics) {
                const activeLine = lines[activeIdx];
                // Используем requestAnimationFrame для более плавного скролла
                requestAnimationFrame(() => {
                    activeLine.scrollIntoView({
                        block: 'center',
                        behavior: 'smooth',
                        inline: 'nearest'
                    });
                });
            }
        } else if (activeIdx === -1 && lines.length > 0) {
            // Если нет активной строки (перед началом песни), показываем первую строку
            // но не делаем её активной, просто скроллим к ней
            if (!userScrolledLyrics && lines[0]) {
                requestAnimationFrame(() => {
                    lines[0].scrollIntoView({
                        block: 'center',
                        behavior: 'smooth',
                        inline: 'nearest'
                    });
                });
            }
        }
    }
}

// Функция для настройки отслеживания скролла текста
function setupLyricsScrollTracking() {
    const lyricsContainer = document.getElementById('lyrics-container');
    if (lyricsContainer) {
        // Удаляем старые обработчики если есть
        lyricsContainer.removeEventListener('scroll', handleLyricsScroll); // Legacy
        lyricsContainer.removeEventListener('wheel', handleUserScroll);
        lyricsContainer.removeEventListener('touchstart', handleUserScroll);
        lyricsContainer.removeEventListener('mousedown', handleUserScroll);
        lyricsContainer.removeEventListener('keydown', handleUserScroll);
        
        // Добавляем новые - только на действия пользователя
        lyricsContainer.addEventListener('wheel', handleUserScroll, { passive: true });
        lyricsContainer.addEventListener('touchstart', handleUserScroll, { passive: true });
        lyricsContainer.addEventListener('mousedown', handleUserScroll, { passive: true });
        lyricsContainer.addEventListener('keydown', handleUserScroll, { passive: true });
    }
}

function handleLyricsScroll() {
    // Legacy handler - not used anymore
}

function handleUserScroll() {
    userScrolledLyrics = true;
    
    // Очищаем предыдущий таймер
    if (lyricsScrollTimeout) {
        clearTimeout(lyricsScrollTimeout);
    }
    
    // Через 2 секунды возвращаем автоматическую синхронизацию
    lyricsScrollTimeout = setTimeout(() => {
        userScrolledLyrics = false;
        // Сразу синхронизируем после возврата
        requestAnimationFrame(() => syncLyrics());
    }, 2000);
}

function updateLyricsButton() {
    const btn = document.getElementById('lyrics-btn');
    const hasLyrics = lyricsData.length > 0;
    
    if (btn) {
        if (hasLyrics) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        } else {
            btn.disabled = true;
            btn.style.opacity = '0.3';
            btn.style.cursor = 'not-allowed';
        }
    }
}

function toggleLyricsView() {
    // Не открываем, если лириков нет
    if (lyricsData.length === 0) {
        return;
    }
    
    const cover = document.getElementById('full-cover');
    const lyricsWrap = document.getElementById('lyrics-wrapper');
    const btn = document.getElementById('lyrics-btn');
    const visualContainer = document.querySelector('.visual-container');
    const container = document.getElementById('lyrics-container');
    const lines = document.querySelectorAll('.lyric-line');
    
    // Проверяем, что контейнер не пустой
    if (!container || lines.length === 0) {
        console.warn('Lyrics container is empty, cannot open lyrics view');
        return;
    }
    
    isLyricsOpen = !isLyricsOpen;

    if (isLyricsOpen) {
        // Фиксируем высоту контейнера перед переключением, чтобы избежать "телепортации"
        const currentHeight = visualContainer.offsetHeight || visualContainer.clientHeight;
        if (currentHeight > 0) {
            visualContainer.style.minHeight = currentHeight + 'px';
        }
        
        // Убеждаемся, что контейнер лириков видим и содержит текст
        if (container.children.length === 0) {
            console.warn('Lyrics container is empty, re-parsing lyrics');
            // Попытка перепарсить лирики, если контейнер пустой
            const track = tracks[currentIndex];
            if (track && track.lyrics) {
                parseLyrics(track.lyrics);
                // Обновляем lines после парсинга
                const newLines = document.querySelectorAll('.lyric-line');
                if (newLines.length === 0) {
                    console.error('Failed to parse lyrics');
                    isLyricsOpen = false;
                    return;
                }
            } else {
                console.error('No lyrics data available');
                isLyricsOpen = false;
                return;
            }
        }
        
        // Плавное скрытие обложки
        cover.style.opacity = '0';
        cover.style.transform = 'scale(0.9)';
        setTimeout(() => {
            cover.style.display = 'none';
            
            // Плавное появление текста
            lyricsWrap.style.display = 'flex';
            lyricsWrap.style.visibility = 'visible';
            lyricsWrap.style.pointerEvents = 'auto';
            
            requestAnimationFrame(() => {
                lyricsWrap.style.opacity = '1';
                
                // Сбрасываем флаг пользовательского скролла
                userScrolledLyrics = false;
                
                // Обновляем lines после отображения
                const updatedLines = document.querySelectorAll('.lyric-line');
                
                // Находим активную строку
                const time = audio.currentTime;
                let activeIdx = -1;
                for (let i = lyricsData.length - 1; i >= 0; i--) {
                    if (time >= lyricsData[i].time) {
                        activeIdx = i;
                        break;
                    }
                }
                
                // Скроллим к активной строке или к первой
                const targetLine = activeIdx >= 0 && activeIdx < updatedLines.length 
                    ? updatedLines[activeIdx] 
                    : updatedLines[0];
                
                if (targetLine) {
                    // Небольшая задержка для корректного отображения
                    setTimeout(() => {
                        targetLine.scrollIntoView({
                            block: 'center',
                            behavior: 'auto', // Мгновенно, без анимации
                            inline: 'nearest'
                        });
                        // Затем синхронизируем
                        syncLyrics();
                    }, 150);
                } else {
                    // Если нет строк, скроллим в начало
                    container.scrollTop = 0;
                    setTimeout(syncLyrics, 150);
                }
                
                // Убираем фиксированную высоту после переключения
                setTimeout(() => {
                    visualContainer.style.minHeight = '';
                }, 500);
            });
        }, 300);
        btn.classList.add('active');
    } else {
        // Фиксируем высоту контейнера перед переключением
        const currentHeight = visualContainer.offsetHeight || visualContainer.clientHeight;
        if (currentHeight > 0) {
            visualContainer.style.minHeight = currentHeight + 'px';
        }
        
        // Плавное скрытие текста
        lyricsWrap.style.opacity = '0';
        setTimeout(() => {
            lyricsWrap.style.display = 'none';
            lyricsWrap.style.visibility = 'hidden';
            lyricsWrap.style.pointerEvents = 'none';
            
            // Плавное появление обложки
            cover.style.display = 'block';
            requestAnimationFrame(() => {
                cover.style.opacity = '1';
                cover.style.transform = 'scale(1)';
            });
            
            // Убираем фиксированную высоту после переключения
            setTimeout(() => {
                visualContainer.style.minHeight = '';
            }, 500);
        }, 300);
        btn.classList.remove('active');
    }
}

// === PROGRESS & TIME ===
let lastActiveIdx = -1;
let lastPlayState = null;

function setupAudioListeners() {
    if (!audio) return;

    audio.addEventListener('timeupdate', () => {
        // Проверяем, что время валидно
        if (isNaN(audio.currentTime) || isNaN(audio.duration) || audio.duration === 0) {
            return;
        }
        
        const progressFill = document.getElementById('progress-fill');
        const currTime = document.getElementById('curr-time');
        const durTime = document.getElementById('dur-time');
        
        if (progressFill) {
            const pct = (audio.currentTime / audio.duration) * 100;
            progressFill.style.width = `${pct}%`;
        }
        
        if (currTime) currTime.innerText = fmtTime(audio.currentTime);
        if (durTime) durTime.innerText = fmtTime(audio.duration || 0);
        
        // Синхронизируем кнопки play/pause
        const isPlaying = !audio.paused;
        if (lastPlayState !== isPlaying) {
            updatePlayButtons(isPlaying);
            lastPlayState = isPlaying;
        }
        
        // Синхронизируем текст при каждой смене активной строки
        const time = audio.currentTime;
        if (isNaN(time) || time < 0) return;
        
        let currentActiveIdx = -1;
        for (let i = lyricsData.length - 1; i >= 0; i--) {
            if (time >= lyricsData[i].time) {
                currentActiveIdx = i;
                break;
            }
        }
        
        // Синхронизируем только когда активная строка изменилась
        if (currentActiveIdx !== lastActiveIdx) {
            syncLyrics();
            lastActiveIdx = currentActiveIdx;
        }
    });

    // Также отслеживаем события play/pause для синхронизации кнопок
    audio.addEventListener('play', () => {
        updatePlayButtons(true);
        lastPlayState = true;
        // Обновляем Media Session для фонового воспроизведения
        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.playbackState = 'playing';
            } catch(e) {}
        }
    });

    audio.addEventListener('pause', () => {
        updatePlayButtons(false);
        lastPlayState = false;
        // Обновляем Media Session для фонового воспроизведения
        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.playbackState = 'paused';
            } catch(e) {}
        }
    });

    // Обработка окончания трека
    audio.addEventListener('ended', () => {
        updatePlayButtons(false);
        lastPlayState = false;
        // Переходим к следующему треку
        nextTrack();
    });
}

if (audio) {
    setupAudioListeners();
}

// Обработка видимости страницы для фонового воспроизведения
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && audio) {
        // Если страница снова видна, обновляем Media Session
        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
            } catch(e) {}
        }
    }
});

// Обработка фокуса страницы для iOS
window.addEventListener('focus', () => {
    if (audio && !audio.paused) {
        // Обновляем Media Session при возврате фокуса
        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.playbackState = 'playing';
            } catch(e) {}
        }
    }
});

// Обработка blur для iOS
window.addEventListener('blur', () => {
    // При потере фокуса ничего не делаем - воспроизведение должно продолжаться
});

function fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' + sec : sec}`;
}

// Функция для перемотки трека
function seekToPosition(clientX, element) {
    if (!audio) return;
    
    const rect = element.getBoundingClientRect();
    const width = rect.width;
    const clickX = clientX - rect.left;
    const percent = Math.max(0, Math.min(1, clickX / width));
    
    if (audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
        const newTime = percent * audio.duration;
        const wasPlaying = !audio.paused;
        
        // Для iOS используем более простой и надежный метод
        try {
            // Устанавливаем новое время
            audio.currentTime = newTime;
            
            // Если было воспроизведение, продолжаем
            if (wasPlaying) {
                // Небольшая задержка для iOS
                setTimeout(() => {
                    const playPromise = audio.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(() => {});
                    }
                }, isIOS ? 50 : 0);
            }
        } catch(e) {
            console.log('Seek error:', e);
        }
    }
}

// Клик по прогресс бару (для десктопа)
// Логика перенесена в initPlayer

function setVolume(val) { 
    const volume = parseFloat(val);
    if (isNaN(volume) || volume < 0) return;
    const clampedVolume = Math.max(0, Math.min(1, volume));
    
    // Для iOS используем стандартный способ (Web Audio мешает)
    if (isIOS) {
        audio.volume = clampedVolume;
        return;
    }
    
    // Для других платформ используем Web Audio API если доступно
    if (useWebAudio && gainNode) {
        try {
            gainNode.gain.value = clampedVolume;
            audio.volume = clampedVolume;
        } catch(e) {
            audio.volume = clampedVolume;
        }
    } else {
                audio.volume = clampedVolume;
    }
}

// Настройка ползунка громкости с поддержкой touch событий
document.addEventListener('DOMContentLoaded', () => {
    // Определяем iOS (включая iPad) - улучшенное определение (если еще не определено в initPlayer)
    if (!isIOS) {
        isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
                (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
    }
    
    // Добавляем класс для управления громкостью, если это не iOS
    if (!isIOS) {
        document.body.classList.add('has-volume');
    } else {
        document.documentElement.classList.add('ios-device');
    }
    
    const volumeSlider = document.getElementById('volume-slider');
    // На iOS не настраиваем volume slider, так как он скрыт
    if (!volumeSlider || isIOS) {
        return;
    }
    
    if (volumeSlider) {
        // Основные обработчики для всех устройств
        const updateVolume = (value) => {
            const vol = parseFloat(value);
            if (!isNaN(vol) && vol >= 0 && vol <= 1) {
                volumeSlider.value = vol;
                setVolume(vol);
            }
        };
        
        volumeSlider.addEventListener('input', (e) => {
            updateVolume(e.target.value);
        });
        
        volumeSlider.addEventListener('change', (e) => {
            updateVolume(e.target.value);
        });
        
        // Для iOS/Safari - используем touch события без preventDefault
        // чтобы не блокировать стандартное поведение range input
        let isDragging = false;
        
        volumeSlider.addEventListener('touchstart', (e) => {
            isDragging = true;
        }, { passive: true });
        
        volumeSlider.addEventListener('touchmove', (e) => {
            if (isDragging && e.touches.length > 0) {
                const touch = e.touches[0];
                const rect = volumeSlider.getBoundingClientRect();
                const percent = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
                updateVolume(percent);
            }
        }, { passive: true });
        
        volumeSlider.addEventListener('touchend', (e) => {
            isDragging = false;
            updateVolume(volumeSlider.value);
        }, { passive: true });
        
        volumeSlider.addEventListener('touchcancel', (e) => {
            isDragging = false;
            updateVolume(volumeSlider.value);
        }, { passive: true });
        
        // Для мыши/десктопа
        volumeSlider.addEventListener('mousedown', () => {
            isDragging = true;
        });
        
        volumeSlider.addEventListener('mousemove', (e) => {
            if (isDragging) {
                updateVolume(volumeSlider.value);
            }
        });
        
        volumeSlider.addEventListener('mouseup', () => {
            isDragging = false;
            updateVolume(volumeSlider.value);
        });
    }
});

// Service Worker для фонового воспроизведения
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`/static/sw.js`).then((registration) => {
        // Service Worker зарегистрирован
        console.log('Service Worker registered:', registration.scope);
    }).catch((error) => {
        // Игнорируем ошибки регистрации (может быть из-за HTTPS или других причин)
        console.log('Service Worker registration failed:', error);
    });
}

// Функция для воспроизведения трека по ID
async function playTrackById(trackId) {
    try {
        // Пробуем найти трек в текущем списке
        let track = tracks.find(t => t.id === trackId);
        
        // Если не найден, загружаем его
        if (!track) {
            const res = await fetch(`/api/tracks`);
            const allTracks = await res.json();
            track = allTracks.find(t => t.id === trackId);
        }
        
        if (track) {
            // Добавляем трек в список если его там нет
            const index = tracks.findIndex(t => t.id === trackId);
            if (index === -1) {
                tracks = [track];
                playTrack(0);
            } else {
                playTrack(index);
            }
        }
    } catch(e) {
        console.error('Error playing track:', e);
    }
}

// Функция для обновления UI лайков
function updateLikeUI() {
    // Синхронизируем локальные переменные с глобальными
    const isLiked = window.currentTrackLiked !== undefined ? window.currentTrackLiked : currentTrackLiked;
    const likesCount = window.currentTrackLikesCount !== undefined ? window.currentTrackLikesCount : currentTrackLikesCount;
    
    // Обновляем локальные переменные
    currentTrackLiked = isLiked;
    currentTrackLikesCount = likesCount;
    
    const miniLikeIcon = document.getElementById('mini-like-icon');
    const playerLikeIcon = document.getElementById('player-like-icon');
    const playerLikesCount = document.getElementById('player-likes-count');
    const playerLikeBtn = document.getElementById('player-like-btn');
    
    // Обновляем миниплеер
    if (miniLikeIcon) {
        miniLikeIcon.name = isLiked ? 'heart' : 'heart-outline';
        if (isLiked) {
            miniLikeIcon.setAttribute('fill', 'solid');
            miniLikeIcon.style.color = '#fa2d48';
        } else {
            miniLikeIcon.removeAttribute('fill');
            miniLikeIcon.style.color = '';
        }
    }
    
    // Обновляем фулл плеер
    if (playerLikeIcon) {
        playerLikeIcon.name = isLiked ? 'heart' : 'heart-outline';
        if (isLiked) {
            playerLikeIcon.setAttribute('fill', 'solid');
            playerLikeIcon.style.color = '#fa2d48';
        } else {
            playerLikeIcon.removeAttribute('fill');
            playerLikeIcon.style.color = 'white';
        }
    }
    
    if (playerLikesCount) {
        playerLikesCount.textContent = likesCount || 0;
    }
    
    if (playerLikeBtn) {
        if (isLiked) {
            playerLikeBtn.classList.add('liked');
            playerLikeBtn.style.background = 'rgba(250, 45, 72, 0.2)';
            playerLikeBtn.style.borderColor = '#fa2d48';
        } else {
            playerLikeBtn.classList.remove('liked');
            playerLikeBtn.style.background = 'rgba(255,255,255,0.1)';
            playerLikeBtn.style.borderColor = 'transparent';
        }
    }
}

// Функция для получения текущего трека
function getCurrentTrack() {
    const tracksList = typeof tracks !== 'undefined' ? tracks : (window.tracks || []);
    if (currentIndex >= 0 && currentIndex < tracksList.length) {
        return tracksList[currentIndex];
    }
    return null;
}

// Функции для сохранения и восстановления состояния плеера (для SPA-навигации)
window.getPlayerState = function() {
    const tracksList = typeof tracks !== 'undefined' ? tracks : (window.tracks || []);
    const state = {
        tracks: tracksList,
        currentIndex: currentIndex,
        isPlaying: false,
        currentTime: 0,
        volume: 1
    };
    
    if (audio) {
        state.isPlaying = !audio.paused;
        state.currentTime = audio.currentTime;
        state.volume = audio.volume;
    }
    
    return state;
};

// Функция для обновления UI трека
function updateUI(track) {
    if (!track) return;
    
    const coverUrl = track.cover_filename ? `/uploads/${track.cover_filename}` : '';
    
    // Mini Player
    const miniCover = document.getElementById('mini-cover');
    if (miniCover && coverUrl) {
        miniCover.src = coverUrl;
    }
    
    const miniTitle = document.getElementById('mini-title');
    const miniArtist = document.getElementById('mini-artist');
    if (miniTitle) miniTitle.innerText = track.title || 'Not Playing';
    if (miniArtist) miniArtist.innerText = track.artist || '';
    
    // Full Player
    const fullCover = document.getElementById('full-cover') || document.getElementById('player-cover');
    const playerBg = document.getElementById('player-bg');
    
    if (fullCover && coverUrl) {
        fullCover.src = coverUrl;
    }
    if (playerBg && coverUrl) {
        playerBg.style.backgroundImage = `url('${coverUrl}')`;
    }
    
    const playerTitle = document.getElementById('player-title') || document.getElementById('full-title');
    const playerArtist = document.getElementById('player-artist') || document.getElementById('full-artist');
    const fullTitle = document.getElementById('full-title');
    const fullArtist = document.getElementById('full-artist');
    
    if (playerTitle) playerTitle.innerText = track.title || 'Title';
    if (fullTitle) fullTitle.innerText = track.title || 'Title';
    
    // Обновляем имя исполнителя - делаем кликабельным если есть nickname
    const updateArtistName = (artistElement, trackData) => {
        if (!artistElement) return;
        
        const nickname = trackData.nickname;
        
        if (nickname) {
            artistElement.innerHTML = `<a href="/user/${nickname}" onclick="if(typeof window.SPANavigation !== 'undefined' && window.SPANavigation.navigateTo) { event.preventDefault(); window.SPANavigation.navigateTo('/user/${nickname}'); }" style="color: rgba(255,255,255,0.6); text-decoration: none; transition: color 0.2s;" onmouseover="this.style.color='#fa2d48'" onmouseout="this.style.color='rgba(255,255,255,0.6)'">${trackData.artist || 'Artist'}</a>`;
        } else {
            artistElement.innerText = trackData.artist || 'Artist';
        }
    };
    
    updateArtistName(playerArtist, track);
    updateArtistName(fullArtist, track);
}

window.updatePlayerUI = function() {
    const tracksList = typeof tracks !== 'undefined' ? tracks : (window.tracks || []);
    if (currentIndex >= 0 && currentIndex < tracksList.length) {
        const track = tracksList[currentIndex];
        updateUI(track);
        updateLikeUI();
    }
};

// Функция для поделиться треком (модульная, работает везде)
async function shareCurrentTrack() {
    const track = getCurrentTrack();
    if (!track) {
        console.error('No track to share');
        showShareNotification('Трек не найден');
        return;
    }
    
    // Формируем ссылку на трек - используем полный URL для корректной работы
    const baseUrl = window.location.origin;
    let trackUrl = '';
    
    // Используем slug если есть, иначе ID
    if (track.slug) {
        trackUrl = `${baseUrl}/track/${track.slug}`;
    } else {
        trackUrl = `${baseUrl}/track/${track.id}`;
    }
    
    // Формируем текст для поделиться
    const trackText = `${track.artist} - ${track.title}`;
    
    // Проверяем, находимся ли мы в Telegram Web App
    // МАКСИМАЛЬНО СТРОГАЯ проверка - проверяем напрямую наличие platform или initData
    // В обычном браузере эти свойства НЕ будут установлены, даже если скрипт загружен
    let isRealTelegramWebApp = false;
    
    try {
        if (window.Telegram && window.Telegram.WebApp) {
            const tg = window.Telegram.WebApp;
            // Проверяем наличие platform (это есть ТОЛЬКО в реальном Telegram Web App)
            // В обычном браузере platform будет undefined или пустой строкой
            if (tg.platform && typeof tg.platform === 'string' && tg.platform.length > 0) {
                const validPlatforms = ['ios', 'android', 'tdesktop', 'web', 'macos', 'windows', 'linux', 'weba', 'unigram'];
                if (validPlatforms.includes(tg.platform)) {
                    isRealTelegramWebApp = true;
                }
            }
            // Или проверяем наличие initData (это тоже есть ТОЛЬКО в реальном Telegram Web App)
            if (!isRealTelegramWebApp && (tg.initData || tg.initDataUnsafe)) {
                const hasInitData = (tg.initData && tg.initData.length > 0) || 
                                   (tg.initDataUnsafe && typeof tg.initDataUnsafe === 'object' && tg.initDataUnsafe.user);
                if (hasInitData) {
                    isRealTelegramWebApp = true;
                }
            }
        }
    } catch (e) {
        // Если ошибка при проверке - считаем что это браузер
        isRealTelegramWebApp = false;
    }
    
    // В браузере ВСЕГДА копируем ссылку, НЕ открываем Telegram
    // Только если это РЕАЛЬНЫЙ Telegram Web App (с platform или initData) - открываем Telegram
    if (isRealTelegramWebApp) {
        // В Telegram Web App используем t.me/share/url
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(trackUrl)}&text=${encodeURIComponent(trackText)}`;
        
        try {
            if (window.tgWebApp && typeof window.tgWebApp.openLink === 'function') {
                window.tgWebApp.openLink(shareUrl);
            } else {
                window.open(shareUrl, '_blank');
            }
            showShareNotification('Открывается Telegram для поделиться...');
        } catch (err) {
            console.error('Error opening share link:', err);
            await copyToClipboard(trackUrl, trackText);
        }
    } else {
        // В браузере ВСЕГДА только копируем ссылку в буфер обмена
        await copyToClipboard(trackUrl, trackText);
    }
}

// Функция для копирования в буфер обмена
async function copyToClipboard(url, text) {
    try {
        // Пробуем использовать Clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            showShareNotification('Ссылка скопирована в буфер обмена!');
        } else {
            // Fallback для старых браузеров
            const textArea = document.createElement('textarea');
            textArea.value = url;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                showShareNotification('Ссылка скопирована в буфер обмена!');
            } catch (err) {
                showShareNotification('Не удалось скопировать. Откройте ссылку вручную: ' + url);
            }
            document.body.removeChild(textArea);
        }
    } catch (err) {
        console.error('Failed to copy:', err);
        showShareNotification('Не удалось скопировать. Откройте ссылку вручную: ' + url);
    }
}

// Функция для показа уведомления
function showShareNotification(message) {
    // Создаем элемент уведомления
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        font-size: 14px;
        z-index: 10000;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        animation: slideUp 0.3s ease-out;
    `;
    notification.textContent = message;
    
    // Добавляем анимацию
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateX(-50%) translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
        }
    `;
    if (!document.getElementById('share-notification-style')) {
        style.id = 'share-notification-style';
        document.head.appendChild(style);
    }
    
    document.body.appendChild(notification);
    
    // Удаляем через 3 секунды
    setTimeout(() => {
        notification.style.animation = 'slideUp 0.3s ease-out reverse';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// Экспортируем для использования в app.js и других скриптах
window.playTrackById = playTrackById;
window.updateLikeUI = updateLikeUI;
window.getCurrentTrack = getCurrentTrack;
window.playTrack = playTrack;
window.getPlayerState = window.getPlayerState;
window.updatePlayerUI = window.updatePlayerUI;
window.shareCurrentTrack = shareCurrentTrack;

