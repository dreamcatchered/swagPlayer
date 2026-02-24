// SPA Navigation Module - для плавных переходов без перезагрузки страницы
// Плеер продолжает играть при переходах между страницами

(function() {
    'use strict';
    
    // История навигации
    const history = [];
    let isNavigating = false;
    
    // Глобальный обработчик 401 ошибок для редиректа на бота
    function handle401Error(response, url) {
        if (response && response.status === 401) {
            console.log('401 Unauthorized, redirecting to bot');
            const botUrl = 'https://t.me/swagplayerobot?start=auth';
            if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openTelegramLink) {
                window.Telegram.WebApp.openTelegramLink(botUrl);
            } else {
                window.location.href = botUrl;
            }
            return true;
        }
        return false;
    }
    
    // Перехватываем все fetch запросы для обработки 401
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        return originalFetch.apply(this, args).then(response => {
            // Проверяем 401 только для API запросов
            if (response.status === 401 && args[0] && typeof args[0] === 'string' && args[0].includes('/api/')) {
                // Не обрабатываем 401 для /api/user/profile - это нормально
                if (!args[0].includes('/api/user/profile')) {
                    handle401Error(response, args[0]);
                }
            }
            return response;
        });
    };
    
    // Инициализация SPA-навигации
    function initSPANavigation() {
        // Перехватываем клики по ссылкам
        document.addEventListener('click', handleLinkClick, true);
        
        // Перехватываем onclick с window.location.href
        document.addEventListener('click', (e) => {
            const target = e.target;
            // Проверяем onclick атрибуты
            if (target.onclick && target.onclick.toString().includes('location.href')) {
                const onclickStr = target.getAttribute('onclick') || '';
                const match = onclickStr.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
                if (match && match[1]) {
                    const url = match[1];
                    if (url.startsWith('/') && !url.startsWith('/admin')) {
                        e.preventDefault();
                        e.stopPropagation();
                        navigateTo(url);
                    }
                }
            }
        }, true);
        
        // Перехватываем window.location.href через глобальную функцию
        window.navigateToPage = function(url) {
            if (url && url.startsWith('/') && !url.startsWith('/admin')) {
                navigateTo(url);
            } else {
                window.location.href = url;
            }
        };
        
        // Обрабатываем кнопку "назад" в браузере
        window.addEventListener('popstate', handlePopState);
        
        // Сохраняем начальное состояние только если история пуста
        const initialUrl = window.location.pathname + window.location.search;
        
        // Проверяем SHARED_MODE - если true, НЕ восстанавливаем из localStorage
        const isSharedMode = typeof window.SHARED_MODE !== 'undefined' && window.SHARED_MODE === true;
        
        if (history.length === 0) {
            // Пытаемся восстановить состояние из localStorage при загрузке
            // НО НЕ в SHARED_MODE - там должен быть только shared трек!
            if (!isSharedMode) {
                try {
                    const savedState = localStorage.getItem('playerState');
                    if (savedState) {
                        window.playerState = JSON.parse(savedState);
                        console.log('Restored player state from localStorage on init');
                        // НЕ вызываем restorePlayerState автоматически - это вызовет автоплей
                        // Плеер должен быть на паузе до явного действия пользователя
                    }
                } catch (e) {
                    console.log('Failed to restore player state from localStorage:', e);
                }
            } else {
                console.log('SHARED_MODE detected, skipping localStorage restore in navigation');
            }
            
            // Сохраняем состояние плеера перед сохранением в историю
            savePlayerState();
            
            history.push({
                url: initialUrl,
                title: document.title,
                content: getPageContent(),
                styles: getPageStyles(), // Сохраняем встроенные стили
                playerState: window.playerState ? JSON.parse(JSON.stringify(window.playerState)) : null
            });
            
            console.log('SPA Navigation initialized, initial URL:', initialUrl, 'history length:', history.length);
        } else {
            console.log('SPA Navigation already initialized, history length:', history.length);
        }
    }
    
    // Получение контента страницы для сохранения
    function getPageContent() {
        const mainContent = document.querySelector('.container') || 
                           document.querySelector('.main-app') ||
                           document.querySelector('body > .container') ||
                           document.body;
        return mainContent ? mainContent.innerHTML : '';
    }
    
    // Получение встроенных стилей страницы для сохранения
    function getPageStyles() {
        const styles = Array.from(document.querySelectorAll('head > style'));
        return styles.map(style => style.textContent).join('\n');
    }
    
    // Обработка кликов по ссылкам
    function handleLinkClick(e) {
        const link = e.target.closest('a');
        if (!link) return;
        
        // Игнорируем внешние ссылки, якоря, и специальные ссылки
        const href = link.getAttribute('href');
        if (!href || 
            (href.startsWith('http') && !href.includes(window.location.hostname)) ||
            href.startsWith('#') ||
            href.startsWith('javascript:') ||
            href.startsWith('mailto:') ||
            href.startsWith('tel:') ||
            link.hasAttribute('data-no-spa') ||
            link.target === '_blank') {
            return;
        }
        
        // Игнорируем ссылки на админку
        if (href.startsWith('/admin')) {
            return;
        }
        
        // Игнорируем ссылки внутри модальных окон
        if (link.closest('.modal')) {
            return;
        }
        
        // /app (профиль) - НЕ используем SPA, делаем обычный переход
        // Это решает проблемы с инициализацией приложения
        if (href === '/app' || href.startsWith('/app?') || href.startsWith('/app#')) {
            // Обычный переход без SPA
            return;
        }
        
        // Все остальные переходы через SPA
        e.preventDefault();
        e.stopPropagation();
        navigateTo(href);
    }
    
    // Навигация на новую страницу
    async function navigateTo(url) {
        if (isNavigating) {
            console.log('Navigation already in progress, ignoring:', url);
            return;
        }
        
        // Нормализуем URL
        let cleanUrl = url;
        if (cleanUrl.startsWith('http')) {
            // Извлекаем путь из полного URL
            try {
                const urlObj = new URL(cleanUrl);
                cleanUrl = urlObj.pathname + urlObj.search;
            } catch(e) {
                console.error('Invalid URL:', cleanUrl);
                return;
            }
        }
        
        // Убираем query параметры для чистоты URL (но сохраняем для запроса)
        const urlPath = cleanUrl.split('?')[0];
        
        // Если это та же страница - не делаем ничего
        if (urlPath === window.location.pathname) {
            console.log('Same page, ignoring navigation:', urlPath);
            return;
        }
        
        console.log('Navigating to:', cleanUrl, 'from:', window.location.pathname);
        isNavigating = true;
        
        try {
            // Показываем индикатор загрузки (опционально)
            showLoadingIndicator();
            
            // Загружаем контент через AJAX (используем оригинальный URL с query параметрами если есть)
            const fetchUrl = cleanUrl.includes('?') ? cleanUrl : cleanUrl;
            console.log('Fetching URL:', fetchUrl);
            
            const response = await fetch(fetchUrl, {
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'text/html',
                    'Cache-Control': 'no-cache'
                },
                cache: 'no-cache'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Извлекаем стили из head (для страниц с встроенными стилями)
            const styles = doc.querySelectorAll('head style');
            if (styles.length > 0) {
                // Удаляем ВСЕ старые встроенные стили перед добавлением новых
                // (чтобы избежать конфликтов при переходе между страницами)
                const existingInlineStyles = Array.from(document.querySelectorAll('head > style'));
                existingInlineStyles.forEach(oldStyle => {
                    // Удаляем только встроенные стили (не из файлов)
                    // Проверяем что это не критичные стили (например, из app.css)
                    const styleText = oldStyle.textContent || '';
                    if (styleText.includes('.container') || styleText.includes('body {') || styleText.includes(':root')) {
                        oldStyle.remove();
                    }
                });
                
                // Добавляем стили из новой страницы
                styles.forEach(style => {
                    const styleContent = style.textContent;
                    const newStyle = document.createElement('style');
                    newStyle.textContent = styleContent;
                    document.head.appendChild(newStyle);
                });
            }
            
            // Извлекаем контент страницы
            // Для /app ищем .main-app, для остальных - .container
            let newContent = null;
            if (urlPath === '/app' || urlPath.startsWith('/app')) {
                newContent = doc.querySelector('.main-app');
                if (!newContent) {
                    newContent = doc.querySelector('#main-app');
                }
            } else {
                newContent = doc.querySelector('.container');
            }
            
            if (!newContent) {
                newContent = doc.querySelector('.main-app');
            }
            if (!newContent) {
                newContent = doc.querySelector('body > .container');
            }
            if (!newContent) {
                newContent = doc.body;
            }
            
            if (!newContent || !newContent.innerHTML || newContent.innerHTML.trim() === '') {
                console.error('Content not found or empty, full HTML:', html.substring(0, 500));
                throw new Error('Content not found');
            }
            
            console.log('Content extracted, length:', newContent.innerHTML.length);
            
            // Сохраняем текущее состояние в историю ПЕРЕД переходом
            const currentUrl = window.location.pathname + window.location.search;
            const lastHistoryItem = history.length > 0 ? history[history.length - 1] : null;
            
            // Сохраняем только если это не та же страница
            if (!lastHistoryItem || lastHistoryItem.url !== currentUrl) {
                // Сохраняем состояние плеера перед сохранением в историю
                savePlayerState();
                
                history.push({
                    url: currentUrl,
                    title: document.title,
                    content: getPageContent(),
                    styles: getPageStyles(), // Сохраняем встроенные стили
                    playerState: window.playerState ? JSON.parse(JSON.stringify(window.playerState)) : null
                });
                
                console.log('Saved to history:', currentUrl, 'history length:', history.length);
            }
            
            // Обновляем URL без перезагрузки
            // Используем replaceState если это первый переход, иначе pushState
            const isFirstNavigation = history.length === 0;
            if (isFirstNavigation) {
                window.history.replaceState({ url: urlPath, timestamp: Date.now() }, '', cleanUrl);
            } else {
                window.history.pushState({ url: urlPath, timestamp: Date.now() }, '', cleanUrl);
            }
            
                // Обновляем контент страницы
                const currentContent = document.querySelector('.container') || 
                                  document.querySelector('.main-app') ||
                                  document.querySelector('body > .container') ||
                                  document.body;
                
                if (currentContent) {
                    // Сохраняем состояние плеера ПЕРЕД обновлением контента
                    savePlayerState();
                    
                    // Сохраняем текущее состояние аудио для плавного перехода
                    const audio = document.getElementById('audio-element');
                    let wasPlaying = false;
                    let savedTime = 0;
                    let savedVolume = 1;
                    let savedSrc = '';
                    let savedTracks = null;
                    let savedCurrentIndex = -1;
                    
                    if (audio) {
                        wasPlaying = !audio.paused && audio.currentTime > 0;
                        savedTime = audio.currentTime;
                        savedVolume = audio.volume;
                        savedSrc = audio.src;
                        
                        // Сохраняем текущие треки и индекс
                        if (typeof window.getPlayerState === 'function') {
                            const playerState = window.getPlayerState();
                            savedTracks = playerState.tracks;
                            savedCurrentIndex = playerState.currentIndex;
                        } else if (window.tracks && window.currentIndex !== undefined) {
                            savedTracks = window.tracks;
                            savedCurrentIndex = window.currentIndex;
                        }
                    }
                    
                    // Обновляем контент - проверяем что контент действительно изменился
                    let contentToSet = '';
                    
                    if (currentContent === document.body) {
                        // Если это body, заменяем только внутренний контент
                        const bodyContent = newContent.querySelector('.container') || 
                                           newContent.querySelector('.main-app') ||
                                           newContent;
                        contentToSet = bodyContent ? bodyContent.innerHTML : newContent.innerHTML;
                    } else {
                        contentToSet = newContent.innerHTML;
                    }
                    
                    // Проверяем что контент не пустой
                    if (!contentToSet || contentToSet.trim() === '') {
                        console.error('Content is empty, trying full page reload');
                        window.location.href = url;
                        return;
                    }
                    
                    // Устанавливаем контент
                    currentContent.innerHTML = contentToSet;
                    
                    // Если переходим в /app, правильно обрабатываем структуру
                    if (urlPath === '/app' || urlPath.startsWith('/app')) {
                        // Показываем main-app если он был скрыт
                        const mainApp = document.getElementById('main-app');
                        if (mainApp) {
                            if (mainApp.style.display === 'none') {
                                mainApp.style.display = 'flex';
                            }
                        }
                        // Скрываем auth-screen если он виден
                        const authScreen = document.getElementById('auth-screen');
                        if (authScreen && authScreen.style.display !== 'none') {
                            authScreen.style.display = 'none';
                        }
                    } else {
                        // Если переходим НЕ в /app, скрываем элементы /app
                        const mainApp = document.getElementById('main-app');
                        if (mainApp) {
                            mainApp.style.display = 'none';
                        }
                        const authScreen = document.getElementById('auth-screen');
                        if (authScreen) {
                            authScreen.style.display = 'none';
                        }
                    }
                    
                    // Обновляем title
                    document.title = doc.title || document.title;
                    
                    // Обновляем классы и атрибуты body в зависимости от страницы
                    // Убираем data-page="app" если переходим не на /app
                    if (urlPath !== '/app' && document.body.hasAttribute('data-page')) {
                        document.body.removeAttribute('data-page');
                        // Убираем классы связанные с app
                        document.body.classList.remove('app-mode');
                    } else if (urlPath === '/app' && !document.body.hasAttribute('data-page')) {
                        document.body.setAttribute('data-page', 'app');
                        document.body.classList.add('app-mode');
                    }
                    
                    // Принудительно пересчитываем стили после изменения структуры
                    // Это помогает браузеру правильно применить стили
                    requestAnimationFrame(() => {
                        // Принудительный reflow для применения стилей
                        void document.body.offsetHeight;
                    });
                    
                    // ВАЖНО: Восстанавливаем состояние плеера СРАЗУ после обновления контента
                    // но ДО выполнения скриптов страницы, чтобы скрипты не перезаписали состояние
                    // Используем микро-задержку чтобы DOM успел обновиться
                    requestAnimationFrame(() => {
                        const newAudio = document.getElementById('audio-element');
                        
                        // Если трек играл, восстанавливаем БЕЗ паузы
                        if (wasPlaying && newAudio && savedSrc) {
                            // Сохраняем треки и индекс ПЕРЕД восстановлением, чтобы не перезаписать
                            if (savedTracks && savedTracks.length > 0) {
                                window.tracks = savedTracks;
                                window.currentIndex = savedCurrentIndex;
                                
                                // Обновляем треки в плеере если функция доступна
                                if (typeof window.setTracks === 'function') {
                                    window.setTracks(savedTracks);
                                }
                            }
                            
                            // Восстанавливаем аудио БЕЗ паузы - сразу устанавливаем src и продолжаем
                            if (newAudio.src !== savedSrc) {
                                // Сохраняем текущее время перед сменой src
                                const currentTime = newAudio.currentTime;
                                newAudio.src = savedSrc;
                                
                                // После загрузки метаданных восстанавливаем время и продолжаем
                                newAudio.addEventListener('loadedmetadata', function restoreAudioState() {
                                    newAudio.removeEventListener('loadedmetadata', restoreAudioState);
                                    newAudio.currentTime = savedTime;
                                    newAudio.volume = savedVolume;
                                    
                                    // Продолжаем воспроизведение без паузы
                                    const playPromise = newAudio.play();
                                    if (playPromise !== undefined) {
                                        playPromise.catch(e => {
                                            console.log('Auto-play prevented, but audio is ready:', e);
                                        });
                                    }
                                }, { once: true });
                                
                                // Загружаем метаданные
                                newAudio.load();
                            } else {
                                // Если src тот же, просто продолжаем
                                newAudio.currentTime = savedTime;
                                newAudio.volume = savedVolume;
                                const playPromise = newAudio.play();
                                if (playPromise !== undefined) {
                                    playPromise.catch(e => console.log('Auto-play prevented:', e));
                                }
                            }
                        } else {
                            // Если не играл, просто восстанавливаем состояние
                            restorePlayerState();
                        }
                        
                        // Инициализируем скрипты на новой странице ПОСЛЕ восстановления плеера
                        // с небольшой задержкой чтобы дать время на восстановление
                        setTimeout(() => {
                            initPageScripts();
                        }, 100);
                    });
                    
                    // Прокручиваем вверх
                    window.scrollTo(0, 0);
                }
            
            // Обновляем кнопки "назад"
            updateBackButtons();
            
        } catch (error) {
            console.error('Navigation error:', error);
            // При ошибке делаем обычный переход
            window.location.href = url;
        } finally {
            isNavigating = false;
            hideLoadingIndicator();
        }
    }
    
    // Обработка кнопки "назад" браузера
    function handlePopState(e) {
        console.log('PopState event, history length:', history.length, 'state:', e.state);
        
        if (history.length > 1) {
            // Сохраняем текущее состояние аудио ПЕРЕД переходом назад
            const audio = document.getElementById('audio-element');
            let wasPlaying = false;
            let savedTime = 0;
            let savedVolume = 1;
            let savedSrc = '';
            let savedTracks = null;
            let savedCurrentIndex = -1;
            
            if (audio) {
                wasPlaying = !audio.paused && audio.currentTime > 0;
                savedTime = audio.currentTime;
                savedVolume = audio.volume;
                savedSrc = audio.src;
                
                // Сохраняем текущие треки и индекс
                if (typeof window.getPlayerState === 'function') {
                    const playerState = window.getPlayerState();
                    savedTracks = playerState.tracks;
                    savedCurrentIndex = playerState.currentIndex;
                } else if (window.tracks && window.currentIndex !== undefined) {
                    savedTracks = window.tracks;
                    savedCurrentIndex = window.currentIndex;
                }
            }
            
            // Сохраняем состояние плеера перед переходом назад
            savePlayerState();
            
            // Удаляем текущее состояние
            const currentState = history.pop();
            console.log('Removed current state:', currentState.url);
            
            // Получаем предыдущее состояние
            const prevState = history[history.length - 1];
            console.log('Restoring previous state:', prevState ? prevState.url : 'none');
            
            if (prevState) {
                // Обновляем URL в адресной строке
                window.history.replaceState({ url: prevState.url, timestamp: prevState.timestamp || Date.now() }, prevState.title || document.title, prevState.url);
                
                // Восстанавливаем сохраненное состояние плеера из истории
                // НО только если плеер не играет - иначе сохраняем текущее состояние
                if (prevState.playerState) {
                    // Если плеер играет, НЕ перезаписываем текущие треки
                    if (wasPlaying && savedTracks && savedTracks.length > 0) {
                        // Сохраняем текущие треки в playerState
                        window.playerState = {
                            ...prevState.playerState,
                            tracks: savedTracks,
                            currentIndex: savedCurrentIndex,
                            isPlaying: true,
                            currentTime: savedTime,
                            volume: savedVolume
                        };
                    } else {
                        // Если не играет, используем состояние из истории
                        window.playerState = prevState.playerState;
                    }
                }
                
                // Восстанавливаем контент
                const currentContent = document.querySelector('.container') || 
                                      document.querySelector('.main-app') ||
                                      document.querySelector('body > .container') ||
                                      document.body;
                
                if (currentContent) {
                    currentContent.innerHTML = prevState.content;
                    document.title = prevState.title || document.title;
                    
                    // Обновляем классы и атрибуты body в зависимости от страницы
                    const prevUrlPath = prevState.url.split('?')[0];
                    // Убираем data-page="app" если возвращаемся не на /app
                    if (prevUrlPath !== '/app' && document.body.hasAttribute('data-page')) {
                        document.body.removeAttribute('data-page');
                        // Убираем классы связанные с app
                        document.body.classList.remove('app-mode');
                    } else if (prevUrlPath === '/app' && !document.body.hasAttribute('data-page')) {
                        document.body.setAttribute('data-page', 'app');
                        document.body.classList.add('app-mode');
                    }
                    
                    // Восстанавливаем встроенные стили из сохраненного состояния
                    if (prevState.styles) {
                        // Удаляем старые встроенные стили
                        const existingInlineStyles = Array.from(document.querySelectorAll('head > style'));
                        existingInlineStyles.forEach(oldStyle => {
                            const styleText = oldStyle.textContent || '';
                            if (styleText.includes('.container') || styleText.includes('body {') || styleText.includes(':root')) {
                                oldStyle.remove();
                            }
                        });
                        
                        // Добавляем сохраненные стили
                        if (prevState.styles.trim()) {
                            const newStyle = document.createElement('style');
                            newStyle.textContent = prevState.styles;
                            document.head.appendChild(newStyle);
                        }
                    }
                    
                    // Принудительно пересчитываем стили после изменения структуры
                    requestAnimationFrame(() => {
                        void document.body.offsetHeight;
                    });
                    
                    // Восстанавливаем состояние плеера БЕЗ паузы
                    requestAnimationFrame(() => {
                        const newAudio = document.getElementById('audio-element');
                        
                        // Если трек играл, восстанавливаем БЕЗ паузы
                        if (wasPlaying && newAudio && savedSrc) {
                            // Сохраняем треки и индекс ПЕРЕД восстановлением
                            if (savedTracks && savedTracks.length > 0) {
                                window.tracks = savedTracks;
                                window.currentIndex = savedCurrentIndex;
                                
                                if (typeof window.setTracks === 'function') {
                                    window.setTracks(savedTracks);
                                }
                            }
                            
                            // Восстанавливаем аудио БЕЗ паузы
                            if (newAudio.src !== savedSrc) {
                                newAudio.src = savedSrc;
                                newAudio.addEventListener('loadedmetadata', function restoreAudioState() {
                                    newAudio.removeEventListener('loadedmetadata', restoreAudioState);
                                    newAudio.currentTime = savedTime;
                                    newAudio.volume = savedVolume;
                                    
                                    const playPromise = newAudio.play();
                                    if (playPromise !== undefined) {
                                        playPromise.catch(e => console.log('Auto-play prevented:', e));
                                    }
                                }, { once: true });
                                newAudio.load();
                            } else {
                                newAudio.currentTime = savedTime;
                                newAudio.volume = savedVolume;
                                const playPromise = newAudio.play();
                                if (playPromise !== undefined) {
                                    playPromise.catch(e => console.log('Auto-play prevented:', e));
                                }
                            }
                        } else {
                            // Если не играл, просто восстанавливаем состояние
                            restorePlayerState();
                        }
                        
                        // Инициализируем скрипты
                        setTimeout(() => {
                            initPageScripts();
                        }, 100);
                    });
                    
                    // Обновляем кнопки "назад"
                    updateBackButtons();
                }
            }
        } else if (history.length === 1) {
            // Если осталась только одна запись в истории, переходим на главную
            console.log('Only one item in history, navigating to home');
            navigateTo('/');
        } else {
            // Если нет истории, переходим на главную
            console.log('No history, navigating to home');
            navigateTo('/');
        }
    }
    
    // Сохранение состояния плеера
    function savePlayerState() {
        const audio = document.getElementById('audio-element');
        const tracksList = typeof window.tracks !== 'undefined' ? window.tracks : [];
        const currentIdx = typeof window.currentIndex !== 'undefined' ? window.currentIndex : -1;
        
        // Сохраняем состояние - ВСЕГДА сохраняем даже если трек не играет
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
                
                console.log('Player state saved:', {
                    trackId: window.playerState.trackId,
                    isPlaying: window.playerState.isPlaying,
                    currentTime: window.playerState.currentTime,
                    currentIndex: currentIdx,
                    tracksCount: tracksList.length
                });
            } else if (currentIdx >= 0) {
                // Сохраняем индекс даже если трек не найден
                window.playerState.currentIndex = currentIdx;
                console.log('Player state saved (index only):', {
                    currentIndex: currentIdx,
                    tracksCount: tracksList.length
                });
            } else if (tracksList.length > 0) {
                // Сохраняем треки даже если нет текущего индекса
                console.log('Player state saved (tracks only):', {
                    tracksCount: tracksList.length
                });
            }
        }
        
        // Также используем функцию из player.js если доступна
        if (typeof window.getPlayerState === 'function') {
            const playerState = window.getPlayerState();
            window.playerState = { ...window.playerState, ...playerState };
        }
        
        // Сохраняем в localStorage для восстановления после перезагрузки
        try {
            localStorage.setItem('playerState', JSON.stringify(window.playerState));
        } catch (e) {
            console.log('Failed to save player state to localStorage:', e);
        }
    }
    
    // Восстановление состояния плеера
    function restorePlayerState() {
        // Сначала пытаемся восстановить из window.playerState, потом из localStorage
        if (!window.playerState) {
            try {
                const savedState = localStorage.getItem('playerState');
                if (savedState) {
                    window.playerState = JSON.parse(savedState);
                    console.log('Restored player state from localStorage');
                }
            } catch (e) {
                console.log('Failed to restore player state from localStorage:', e);
            }
        }
        
        if (!window.playerState) {
            console.log('No player state to restore');
            return;
        }
        
        // Получаем элемент audio ПЕРВЫМ делом
        const audio = document.getElementById('audio-element');
        if (!audio) {
            console.log('Audio element not found, cannot restore state');
            return;
        }
        
        const state = window.playerState;
        console.log('Restoring player state:', state);
        
        // Восстанавливаем треки ВСЕГДА если они есть в состоянии
        // ВАЖНО: Валидируем треки перед восстановлением
        if (state.tracks && state.tracks.length > 0) {
            // Валидируем треки - проверяем их существование
            const validateTracks = async (tracks) => {
                if (!tracks || tracks.length === 0) return [];
                
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
            
            // Валидируем треки
            validateTracks(state.tracks).then(validTracks => {
                if (validTracks.length > 0) {
                    // Сохраняем текущие треки если они есть (для защиты от перезаписи)
                    const currentTracks = window.tracks || [];
                    const currentIndex = window.currentIndex !== undefined ? window.currentIndex : -1;
                    const isCurrentlyPlaying = audio && !audio.paused && audio.currentTime > 0;
                    const hasCurrentTracks = currentTracks.length > 0 && currentIndex >= 0;
                    
                    // Если плеер играет ИЛИ есть текущие треки - НЕ перезаписываем треки
                    // Это предотвращает перезапись треков при возврате назад
                    if (!isCurrentlyPlaying && !hasCurrentTracks && currentTracks.length === 0) {
                        // Обновляем состояние с валидными треками только если нет текущих треков
                        state.tracks = validTracks;
                        if (state.currentIndex >= validTracks.length) {
                            state.currentIndex = -1;
                        }
                        window.playerState = state;
                        
                        if (typeof window.setTracks === 'function') {
                            window.setTracks(validTracks);
                        } else {
                            window.tracks = validTracks;
                        }
                        console.log('Tracks restored from state (validated):', validTracks.length);
                        
                        // Сохраняем обновленное состояние
                        try {
                            localStorage.setItem('playerState', JSON.stringify(state));
                        } catch (e) {
                            console.log('Failed to update player state:', e);
                        }
                    } else {
                        console.log('Player is playing or has tracks, keeping current tracks:', {
                            isPlaying: isCurrentlyPlaying,
                            hasTracks: hasCurrentTracks,
                            tracksCount: currentTracks.length
                        });
                        // Обновляем playerState но не перезаписываем tracks
                        window.playerState = { ...window.playerState, tracks: currentTracks, currentIndex: currentIndex };
                    }
                } else {
                    console.log('No valid tracks found, clearing state');
                    // Очищаем состояние если нет валидных треков
                    window.tracks = [];
                    window.currentIndex = -1;
                    try {
                        localStorage.removeItem('playerState');
                    } catch (e) {
                        console.log('Failed to clear localStorage:', e);
                    }
                }
            });
        }
        
        // Восстанавливаем индекс ВСЕГДА если он есть
        if (state.currentIndex !== undefined) {
            window.currentIndex = state.currentIndex;
            // Также обновляем в player.js если доступно
            if (typeof window.setCurrentIndex === 'function') {
                window.setCurrentIndex(state.currentIndex);
            }
            console.log('Current index restored:', state.currentIndex);
        }
        
        // Восстанавливаем громкость
        if (state.volume !== undefined) {
            audio.volume = state.volume;
        }
        
        // Если был воспроизведен трек, восстанавливаем его
        if (state.trackId && state.tracks && state.tracks.length > 0) {
            const track = state.tracks.find(t => t.id === state.trackId) || 
                         (state.currentIndex >= 0 && state.currentIndex < state.tracks.length ? state.tracks[state.currentIndex] : null);
            
            if (track) {
                console.log('Restoring track:', track.title, 'isPlaying:', state.isPlaying, 'currentTime:', state.currentTime, 'index:', state.currentIndex);
                
                // Устанавливаем источник
                const audioSrc = `/uploads/${track.filename}`;
                if (audio.src !== audioSrc) {
                    audio.src = audioSrc;
                }
                
                // Обновляем UI плеера сразу
                if (typeof window.updatePlayerUI === 'function') {
                    window.updatePlayerUI();
                } else if (typeof window.updateUI === 'function') {
                    window.updateUI(track);
                } else if (typeof window.updateLikeUI === 'function') {
                    window.updateLikeUI();
                }
                
                // Обновляем миниплеер и фуллплеер если они есть
                updatePlayerElements(track);
                
                // Показываем миниплеер если он скрыт
                const miniPlayer = document.getElementById('mini-player');
                if (miniPlayer) {
                    miniPlayer.classList.remove('hidden');
                }
                
                // Ждем загрузки метаданных перед восстановлением времени
                const restoreTime = () => {
                    // Восстанавливаем время воспроизведения
                    if (state.currentTime !== undefined && state.currentTime > 0) {
                        audio.currentTime = state.currentTime;
                    }
                    
                    // НИКОГДА не запускаем автоматически!
                    // Музыка должна быть на паузе до явного нажатия пользователем
                    console.log('Track loaded but NOT auto-playing (autoplay completely disabled)');
                    
                    // Обновляем UI
                    if (typeof window.updatePlayerUI === 'function') {
                        window.updatePlayerUI();
                    }
                    
                    // Обновляем кнопки play чтобы показать что трек на паузе
                    const miniPlayBtn = document.getElementById('mini-play-btn');
                    const fullPlayBtn = document.getElementById('play-btn');
                    if (miniPlayBtn) {
                        const icon = miniPlayBtn.querySelector('ion-icon');
                        if (icon) icon.name = 'play';
                    }
                    if (fullPlayBtn) {
                        const icon = fullPlayBtn.querySelector('ion-icon');
                        if (icon) icon.name = 'play';
                    }
                };
                
                // Если метаданные уже загружены
                if (audio.readyState >= 1) {
                    restoreTime();
                } else {
                    // Ждем загрузки метаданных
                    const metadataHandler = () => {
                        restoreTime();
                    };
                    audio.addEventListener('loadedmetadata', metadataHandler, { once: true });
                    audio.addEventListener('canplay', metadataHandler, { once: true });
                    // Загружаем метаданные
                    audio.load();
                }
            }
        } else if (state.audioSrc) {
            // Если есть сохраненный источник, восстанавливаем его БЕЗ автозапуска
            console.log('Restoring from audioSrc (no autoplay):', state.audioSrc);
            audio.src = state.audioSrc;
            if (state.currentTime > 0) {
                audio.currentTime = state.currentTime;
            }
            // НЕ запускаем автоматически!
        } else if (state.tracks && state.tracks.length > 0 && state.currentIndex >= 0) {
            // Если есть треки и индекс, но нет trackId - восстанавливаем по индексу БЕЗ автозапуска
            const track = state.tracks[state.currentIndex];
            if (track) {
                console.log('Restoring track by index (no autoplay):', track.title, 'index:', state.currentIndex);
                const audioSrc = `/uploads/${track.filename}`;
                audio.src = audioSrc;
                if (state.currentTime > 0) {
                    audio.currentTime = state.currentTime;
                }
                // НЕ запускаем автоматически! Пользователь должен нажать play
                // Показываем миниплеер чтобы пользователь видел что трек загружен
                const miniPlayer = document.getElementById('mini-player');
                if (miniPlayer) {
                    miniPlayer.classList.remove('hidden');
                }
                updatePlayerElements(track);
            }
        }
        
        // Обновляем элементы плеера после восстановления
        if (state.trackId && state.tracks && state.tracks.length > 0) {
            const track = state.tracks.find(t => t.id === state.trackId) || 
                         (state.currentIndex >= 0 ? state.tracks[state.currentIndex] : null);
            if (track) {
                updatePlayerElements(track);
            }
        }
    }
    
    // Инициализация скриптов на новой странице
    function initPageScripts() {
        // Переинициализируем обработчики событий
        const links = document.querySelectorAll('a');
        links.forEach(link => {
            // Уже обрабатываются через делегирование
        });
        
        // Убеждаемся что audio-element существует (для всех страниц)
        if (!document.getElementById('audio-element')) {
            const audio = document.createElement('audio');
            audio.id = 'audio-element';
            audio.playsinline = true;
            audio.preload = 'metadata';
            audio.crossOrigin = 'anonymous';
            audio.style.display = 'none';
            document.body.appendChild(audio);
            console.log('Audio element created');
        }
        
        // Если перешли в /app - инициализируем приложение
        if (window.location.pathname === '/app' || window.location.pathname.startsWith('/app')) {
            console.log('SPA navigation to /app detected');
            
            // Проверяем, есть ли уже загруженный пользователь и данные
            if (window.currentUser && window.currentUser.id) {
                console.log('User already authenticated, loading app data directly');
                
                // Показываем приложение
                const authScreen = document.getElementById('auth-screen');
                const mainApp = document.getElementById('main-app');
                if (authScreen) authScreen.style.display = 'none';
                if (mainApp) mainApp.style.display = 'flex';
                
                // Загружаем и рендерим данные
                if (typeof window.loadMyTracks === 'function') {
                    window.loadMyTracks().then(() => {
                        console.log('Tracks loaded after SPA navigation');
                    });
                }
                if (typeof window.loadMyAlbums === 'function') {
                    window.loadMyAlbums().then(() => {
                        console.log('Albums loaded after SPA navigation');
                    });
                }
                if (typeof window.renderProfile === 'function') {
                    window.renderProfile();
                }
            } else {
                // Инициализируем приложение если функция доступна
                if (typeof window.initApp === 'function') {
                    console.log('Initializing app after SPA navigation to /app');
                    window.initApp().catch(err => {
                        console.error('Error initializing app:', err);
                    });
                }
            }
        }
        
        // Переинициализируем playTrackFromList для главной страницы
        if (window.location.pathname === '/' || window.location.pathname === '') {
            // Переинициализируем обработчики для треков на главной
            const trackItems = document.querySelectorAll('.track-item[data-track-index]');
            trackItems.forEach(item => {
                const trackIndex = item.dataset.trackIndex;
                const trackId = item.dataset.trackId;
                
                // Обновляем onclick для самого элемента
                item.onclick = function(e) {
                    e.stopPropagation();
                    const idx = parseInt(trackIndex);
                    if (!isNaN(idx) && window.tracks && window.tracks[idx]) {
                        playTrackFromList(idx);
                    }
                };
                
                // Обновляем onclick для кнопки play
                const playBtn = item.querySelector('.btn-play-track');
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
                const idx = typeof index === 'string' ? parseInt(index) : (typeof index === 'number' ? index : -1);
                console.log('playTrackFromList called with index:', idx, 'tracks length:', window.tracks ? window.tracks.length : 0);
                
                // Убеждаемся что tracks загружены
                if (!window.tracks || !Array.isArray(window.tracks) || window.tracks.length === 0) {
                    console.error('Tracks not loaded');
                    return;
                }
                
                if (idx < 0 || idx >= window.tracks.length) {
                    console.error('Invalid track index:', idx, 'tracks length:', window.tracks.length);
                    return;
                }
                
                // Синхронизируем tracks с player.js если нужно
                if (typeof window.setTracks === 'function') {
                    window.setTracks(window.tracks);
                }
                
                // Небольшая задержка для синхронизации
                setTimeout(() => {
                    if (typeof window.playTrack === 'function') {
                        console.log('Calling playTrack with index:', idx, 'track:', window.tracks[idx]?.title);
                        window.playTrack(idx, true);
                    } else {
                        console.error('playTrack function not available');
                        // Fallback - открываем страницу трека
                        const track = window.tracks[idx];
                        if (track) {
                            if (window.navigateToPage) {
                                window.navigateToPage('/track/' + (track.slug || track.id));
                            } else {
                                window.location.href = '/track/' + (track.slug || track.id);
                            }
                        }
                    }
                }, 100);
            };
            console.log('playTrackFromList reinitialized, track items:', trackItems.length);
        }
        
        // Переинициализируем playTrackFromAlbum для страницы альбома
        if (window.location.pathname.startsWith('/album/')) {
            // playTrackFromAlbum уже должна быть определена в album.html
            // Но убеждаемся что она доступна глобально
            if (typeof window.playTrackFromAlbum !== 'function') {
                console.warn('playTrackFromAlbum not found, trying to reinitialize');
            }
        }
        
        // Для /app инициализация происходит выше через initApp()
        
        // Переинициализируем обработчики для кнопок лайков
        const likeButtons = document.querySelectorAll('.track-like-btn, .album-like-btn, #mini-like-btn, #player-like-btn');
        likeButtons.forEach(btn => {
            // Удаляем старые обработчики и добавляем новые
            const trackId = btn.dataset.trackId;
            const albumId = btn.dataset.albumId;
            
            if (trackId) {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    if (typeof window.toggleTrackLike === 'function') {
                        window.toggleTrackLike(parseInt(trackId));
                    }
                };
            } else if (albumId) {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    if (typeof window.toggleAlbumLike === 'function') {
                        window.toggleAlbumLike(parseInt(albumId));
                    }
                };
            } else if (btn.id === 'mini-like-btn' || btn.id === 'player-like-btn') {
                // Кнопки лайка в миниплеере и фуллплеере
                btn.onclick = (e) => {
                    e.stopPropagation();
                    if (typeof window.toggleCurrentTrackLike === 'function') {
                        window.toggleCurrentTrackLike();
                    }
                };
            }
        });
        
        // Если на странице альбома - переинициализируем функцию playTrackFromAlbum
        if (window.location.pathname.startsWith('/album/')) {
            // Переинициализируем обработчики для треков альбома
            const trackItems = document.querySelectorAll('.track-item[data-track-id]');
            trackItems.forEach(item => {
                const trackId = parseInt(item.dataset.trackId);
                const tracksData = item.dataset.tracks;
                
                if (trackId && tracksData) {
                    item.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                            const tracksList = JSON.parse(tracksData);
                            if (typeof window.playTrackFromAlbum === 'function') {
                                window.playTrackFromAlbum(trackId, tracksList);
                            } else {
                                // Fallback - используем playTrack напрямую
                                const index = tracksList.findIndex(t => t.id === trackId);
                                if (index !== -1 && typeof window.playTrack === 'function') {
                                    window.tracks = tracksList;
                                    window.currentIndex = index;
                                    window.playTrack(index, true);
                                }
                            }
                        } catch (err) {
                            console.error('Error parsing tracks data:', err);
                        }
                    };
                }
            });
            
            // Если есть сохраненное состояние плеера - не трогаем его
            if (window.playerState && window.playerState.isPlaying) {
                console.log('Player is playing, keeping current tracks');
                return;
            }
            
            // Иначе загружаем треки альбома
            const albumId = window.location.pathname.split('/album/')[1];
            if (albumId) {
                // Треки уже должны быть загружены из HTML
                // Просто убеждаемся что плеер готов
                setTimeout(() => {
                    if (typeof window.setTracks === 'function' && window.tracks && window.tracks.length > 0) {
                        window.setTracks(window.tracks);
                    }
                }, 200);
            }
        }
        
        // Инициализируем специфичные для страницы скрипты
        if (typeof window.initPage === 'function') {
            window.initPage();
        }
    }
    
    // Обновление кнопок "назад"
    function updateBackButtons() {
        const backButtons = document.querySelectorAll('.back-btn');
        backButtons.forEach(btn => {
            // Всегда показываем кнопку "назад"
            btn.style.display = 'flex';
            
            // Удаляем старые обработчики
            btn.onclick = null;
            
            if (history.length > 1) {
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Back button clicked, history length:', history.length);
                    window.history.back();
                };
            } else {
                // Если нет истории, показываем кнопку "домой"
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Back button clicked, no history, navigating to home');
                    navigateTo('/');
                };
            }
        });
    }
    
    // Обновление элементов плеера
    function updatePlayerElements(track) {
        if (!track) return;
        
        // Обновляем миниплеер
        const miniCover = document.getElementById('mini-cover');
        const miniTitle = document.getElementById('mini-title');
        const miniArtist = document.getElementById('mini-artist');
        const miniPlayer = document.getElementById('mini-player');
        
        if (miniCover && track.cover_filename) {
            miniCover.src = `/uploads/${track.cover_filename}`;
        }
        if (miniTitle) miniTitle.textContent = track.title || 'Not Playing';
        if (miniArtist) miniArtist.textContent = track.artist || '';
        if (miniPlayer && !miniPlayer.classList.contains('hidden')) {
            miniPlayer.classList.remove('hidden');
        }
        
        // Обновляем фуллплеер
        const fullCover = document.getElementById('full-cover');
        const fullTitle = document.getElementById('full-title');
        const fullArtist = document.getElementById('full-artist');
        const playerBg = document.getElementById('player-bg');
        
        if (fullCover && track.cover_filename) {
            fullCover.src = `/uploads/${track.cover_filename}`;
        }
        if (fullTitle) fullTitle.textContent = track.title || 'Title';
        if (fullArtist) fullArtist.textContent = track.artist || 'Artist';
        if (playerBg && track.cover_filename) {
            playerBg.style.backgroundImage = `url(/uploads/${track.cover_filename})`;
        }
    }
    
    // Показ индикатора загрузки
    function showLoadingIndicator() {
        // Можно добавить тонкий индикатор загрузки
        document.body.style.opacity = '0.95';
    }
    
    // Скрытие индикатора загрузки
    function hideLoadingIndicator() {
        document.body.style.opacity = '1';
    }
    
    // Получение длины истории
    function getHistoryLength() {
        return history.length;
    }
    
    // Публичный API
    window.SPANavigation = {
        navigate: navigateTo,
        init: initSPANavigation,
        goBack: () => window.history.back(),
        savePlayerState: savePlayerState,
        restorePlayerState: restorePlayerState,
        getHistoryLength: getHistoryLength
    };
    
    // Автоматическая инициализация при загрузке DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // Небольшая задержка чтобы убедиться что все скрипты загружены
            setTimeout(initSPANavigation, 100);
        });
    } else {
        // Небольшая задержка чтобы убедиться что все скрипты загружены
        setTimeout(initSPANavigation, 100);
    }
    
    // Экспортируем функции для использования в других скриптах
    window.savePlayerStateForSPA = savePlayerState;
    window.restorePlayerStateForSPA = restorePlayerState;
    
})();

