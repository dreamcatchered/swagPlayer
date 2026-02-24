// SwagPlayer Unified - Main JavaScript
(function() {
    'use strict';
    
    // ============= STATE =============
    const state = {
        user: window.INIT?.user || null,
        tracks: window.INIT?.tracks || [],
        albums: window.INIT?.albums || [],
        currentTrack: null,
        currentIndex: -1,
        isPlaying: false,
        isLyricsOpen: false,
        isShuffleOn: false,
        volume: parseFloat(localStorage.getItem('swag_volume') || '1'),
        lyricsData: [],
        shuffledIndices: []
    };
    
    // ============= ELEMENTS =============
    const $ = id => document.getElementById(id);
    const audio = $('audio');
    const miniPlayer = $('mini-player');
    const fullPlayer = $('full-player');
    const progressInput = $('progress');
    const volumeSlider = $('volume-slider');
    const miniVolSlider = $('mini-vol-slider');
    
    // ============= INIT =============
    document.addEventListener('DOMContentLoaded', init);
    
    function init() {
        lucide.createIcons();
        initTelegram();
        initAudio();
        initUI();
        loadContent();
        handleSharedContent();
        restoreVolume();
    }
    
    function initTelegram() {
        if (window.tg) {
            window.tg.ready();
            window.tg.expand();
            try {
                window.tg.setHeaderColor('#000000');
                window.tg.setBackgroundColor('#000000');
            } catch(e) {}
        }
    }
    
    function initAudio() {
        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('loadedmetadata', onMetadataLoaded);
        audio.addEventListener('ended', () => nextTrack());
        audio.addEventListener('play', () => updatePlayState(true));
        audio.addEventListener('pause', () => updatePlayState(false));
        
        progressInput.addEventListener('input', e => {
            const pct = e.target.value;
            if (audio.duration) audio.currentTime = (pct / 100) * audio.duration;
            updateProgressBar(pct);
        });
        
        if (volumeSlider) {
            volumeSlider.addEventListener('input', e => setVolume(parseFloat(e.target.value)));
        }
        if (miniVolSlider) {
            miniVolSlider.addEventListener('input', e => setVolume(parseFloat(e.target.value)));
        }
    }
    
    function initUI() {
        // Keyboard
        document.addEventListener('keydown', onKeyDown);
        
        // Close volume popup on outside click
        document.addEventListener('click', e => {
            const popup = $('mini-vol-popup');
            const btn = $('mini-vol-btn');
            if (popup && !popup.contains(e.target) && !btn.contains(e.target)) {
                popup.classList.remove('visible');
            }
        });
        
        // Handle orientation change - close lyrics on mobile landscape
        let lastWidth = window.innerWidth;
        window.addEventListener('resize', () => {
            const isLandscape = window.innerHeight < 500 && window.innerWidth > window.innerHeight;
            const widthChanged = Math.abs(window.innerWidth - lastWidth) > 100;
            lastWidth = window.innerWidth;
            
            // Close lyrics when switching to landscape on mobile or when resizing significantly
            if ((isLandscape || widthChanged) && state.isLyricsOpen) {
                closeLyrics();
            }
        });
        
        // Handle orientation change event for mobile
        window.addEventListener('orientationchange', () => {
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
    
    function handleSharedContent() {
        const init = window.INIT;
        if (init.sharedTrack) {
            document.body.classList.add('shared-mode');
            state.tracks = [init.sharedTrack];
            playTrack(0);
            expandPlayer();
        } else if (init.sharedAlbum && init.albumTracks?.length) {
            // Album page mode - show album view, don't auto-play
            document.body.classList.add('album-mode');
            state.tracks = init.albumTracks;
        }
        
        if (init.q) {
            $('search-input').value = init.q;
            $('search-bar').style.display = 'block';
        }
    }
    
    // Album page functions
    function playAlbumTracks() {
        if (state.tracks.length > 0) {
            playTrack(0);
            showMiniPlayer();
        }
    }
    
    function playAlbumTrack(index) {
        if (index >= 0 && index < state.tracks.length) {
            playTrack(index);
            showMiniPlayer();
        }
    }
    
    // ============= CONTENT =============
    function loadContent() {
        renderTracks(state.tracks);
        renderAlbums(state.albums);
        updateUserUI();
    }
    
    function renderTracks(tracks) {
        const container = $('tracks-list');
        if (!tracks?.length) {
            container.innerHTML = '<div class="empty-state"><p>Нет треков</p></div>';
            return;
        }
        
        container.innerHTML = tracks.map((t, i) => `
            <div class="track-card" onclick="window.SwagPlayer.playTrack(${i})">
                <img src="${t.cover_filename ? '/uploads/' + t.cover_filename : '/static/img/default-cover.svg'}" 
                     onerror="this.src='/static/img/default-cover.svg'">
                <div class="info">
                    <div class="title">${escHtml(t.title)}</div>
                    <div class="artist">${escHtml(t.artist || '')}</div>
                </div>
                <div class="stats">
                    <span><i data-lucide="play" class="w-3 h-3"></i>${t.plays_count || 0}</span>
                    <span><i data-lucide="heart" class="w-3 h-3"></i>${t.likes_count || 0}</span>
                </div>
            </div>
        `).join('');
        
        lucide.createIcons();
    }
    
    function renderAlbums(albums) {
        const container = $('albums-grid');
        if (!albums?.length) {
            container.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><p>Нет альбомов</p></div>';
            return;
        }
        
        container.innerHTML = albums.map(a => `
            <a href="/album/${a.slug || a.id}" class="album-card">
                <div class="cover">
                    ${a.cover_filename 
                        ? `<img src="/uploads/${a.cover_filename}">`
                        : `<div class="placeholder"><i data-lucide="disc-3" class="w-12 h-12"></i></div>`}
                </div>
                <div class="title">${escHtml(a.title)}</div>
                <div class="subtitle">${escHtml(a.description || 'Альбом')}</div>
            </a>
        `).join('');
        
        lucide.createIcons();
    }
    
    // ============= PLAYBACK =============
    function playTrack(index) {
        if (index < 0 || index >= state.tracks.length) return;
        
        state.currentIndex = index;
        state.currentTrack = state.tracks[index];
        const t = state.currentTrack;
        
        audio.src = `/uploads/${t.filename}`;
        audio.play().catch(() => {});
        
        updateTrackUI();
        showMiniPlayer();
        
        // Count play
        fetch(`/api/tracks/${t.id}/play`, { method: 'POST' }).catch(() => {});
        
        // Parse lyrics
        if (t.lyrics) {
            state.lyricsData = parseLRC(t.lyrics);
            renderLyrics();
        } else {
            state.lyricsData = [];
            $('lyrics-scroll').innerHTML = '<p style="text-align:center;color:#666;padding-top:20vh;">Текст недоступен</p>';
        }
    }
    
    function togglePlay() {
        if (!state.currentTrack) {
            if (state.tracks.length) playTrack(0);
            return;
        }
        audio.paused ? audio.play() : audio.pause();
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
        $('shuffle-btn').classList.toggle('active', state.isShuffleOn);
    }
    
    async function loadAlbum(id) {
        try {
            const res = await fetch(`/api/album/${id}`);
            const data = await res.json();
            if (data.album && data.tracks?.length) {
                state.tracks = data.tracks;
                playTrack(0);
                expandPlayer();
            }
        } catch(e) {
            console.error('Failed to load album:', e);
        }
    }
    
    // ============= UI UPDATES =============
    function updatePlayState(isPlaying) {
        state.isPlaying = isPlaying;
        
        const icon = $('play-icon');
        icon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
        
        const miniBtn = $('mini-play-btn');
        miniBtn.innerHTML = `<i data-lucide="${isPlaying ? 'pause' : 'play'}" class="w-6 h-6 fill-white"></i>`;
        
        lucide.createIcons();
        
        const card = $('art-card');
        if (isPlaying) {
            gsap.to(card, { scale: 1, duration: 1.2, ease: "back.out(1.7)" });
            card.classList.add('playing');
        } else {
            gsap.to(card, { scale: 0.9, duration: 1, ease: "power4.out" });
            card.classList.remove('playing');
        }
    }
    
    function updateTrackUI() {
        const t = state.currentTrack;
        if (!t) return;
        
        const cover = t.cover_filename ? `/uploads/${t.cover_filename}` : '/static/img/default-cover.svg';
        
        // Mini
        $('mini-cover').src = cover;
        $('mini-title').textContent = t.title;
        $('mini-artist').textContent = t.artist || '';
        
        // Full
        $('art-card').style.backgroundImage = `url('${cover}')`;
        $('full-title').textContent = t.title;
        $('full-artist').textContent = t.artist || '';
        
        updateLikeUI();
    }
    
    function updateLikeUI() {
        const t = state.currentTrack;
        if (!t) return;
        
        const btn = $('like-btn');
        const icon = $('like-icon');
        const count = $('likes-count');
        
        count.textContent = t.likes_count || 0;
        btn.classList.toggle('liked', !!t.is_liked);
    }
    
    function onTimeUpdate() {
        if (!audio.duration) return;
        
        const pct = (audio.currentTime / audio.duration) * 100;
        progressInput.value = pct;
        updateProgressBar(pct);
        $('cur-time').textContent = formatTime(audio.currentTime);
        
        if (state.lyricsData.length) updateActiveLyric();
    }
    
    function onMetadataLoaded() {
        $('total-time').textContent = formatTime(audio.duration);
    }
    
    function updateProgressBar(pct) {
        progressInput.style.background = `linear-gradient(to right, #fff ${pct}%, rgba(255,255,255,0.1) ${pct}%)`;
    }
    
    function setVolume(vol) {
        state.volume = Math.max(0, Math.min(1, vol));
        audio.volume = state.volume;
        localStorage.setItem('swag_volume', state.volume);
        if (volumeSlider) volumeSlider.value = state.volume;
        if (miniVolSlider) miniVolSlider.value = state.volume;
        updateVolumeIcon();
    }
    
    function updateVolumeIcon() {
        const icon = $('volume-icon');
        if (!icon) return;
        let name = state.volume === 0 ? 'volume-x' : state.volume < 0.5 ? 'volume-1' : 'volume-2';
        icon.setAttribute('data-lucide', name);
        lucide.createIcons();
    }
    
    function updateUserUI() {
        const avatar = $('user-avatar');
        const icon = $('user-icon');
        if (state.user?.avatar_url) {
            avatar.src = state.user.avatar_url;
            avatar.style.display = 'block';
            icon.style.display = 'none';
        } else {
            avatar.style.display = 'none';
            icon.style.display = 'block';
        }
    }
    
    // ============= PLAYER VISIBILITY =============
    function showMiniPlayer() {
        miniPlayer.classList.add('visible');
    }
    
    function expandPlayer() {
        fullPlayer.classList.add('visible');
        document.body.style.overflow = 'hidden';
    }
    
    function collapsePlayer() {
        fullPlayer.classList.remove('visible');
        fullPlayer.classList.remove('lyrics-open');
        document.body.style.overflow = '';
        closeLyrics();
    }
    
    // ============= LYRICS =============
    function parseLRC(lrc) {
        if (!lrc) return [];
        const lines = lrc.split('\n');
        const result = [];
        const regex = /\[(\d+):(\d+\.?\d*)\]/;
        
        lines.forEach(line => {
            const m = regex.exec(line);
            if (m) {
                const time = parseInt(m[1]) * 60 + parseFloat(m[2]);
                const text = line.replace(regex, '').trim();
                if (text) result.push({ t: time, text });
            }
        });
        return result;
    }
    
    function renderLyrics() {
        const container = $('lyrics-scroll');
        container.innerHTML = state.lyricsData.map((l, i) => 
            `<div class="lyric-line" onclick="window.SwagPlayer.seekToLyric(${l.t})">${escHtml(l.text)}</div>`
        ).join('');
    }
    
    function updateActiveLyric() {
        const time = audio.currentTime;
        let activeIdx = -1;
        state.lyricsData.forEach((l, i) => { if (time >= l.t) activeIdx = i; });
        
        const lines = document.querySelectorAll('.lyric-line');
        lines.forEach((el, i) => {
            const isActive = i === activeIdx;
            if (isActive && !el.classList.contains('active')) {
                el.classList.add('active');
                gsap.to($('lyrics-scroll'), {
                    duration: 1,
                    scrollTo: { y: el.offsetTop - $('lyrics-scroll').offsetHeight / 2 + el.offsetHeight / 2 },
                    ease: "power3.out"
                });
            } else if (!isActive) {
                el.classList.remove('active');
            }
        });
    }
    
    function seekToLyric(time) {
        audio.currentTime = time;
        if (audio.paused) audio.play();
    }
    
    function toggleLyrics() {
        state.isLyricsOpen = !state.isLyricsOpen;
        const section = $('lyrics-section');
        const btn = $('lyrics-btn');
        
        if (state.isLyricsOpen) {
            btn.classList.add('active');
            section.classList.add('visible');
            fullPlayer.classList.add('lyrics-open');
        } else {
            btn.classList.remove('active');
            section.classList.remove('visible');
            fullPlayer.classList.remove('lyrics-open');
        }
    }
    
    function closeLyrics() {
        if (state.isLyricsOpen) {
            state.isLyricsOpen = false;
            $('lyrics-section').classList.remove('visible');
            $('lyrics-btn').classList.remove('active');
            fullPlayer.classList.remove('lyrics-open');
        }
    }
    
    // ============= LIKES =============
    async function toggleLike() {
        if (!state.currentTrack) return;
        if (!state.user) {
            requestAuth();
            return;
        }
        
        try {
            const res = await fetch(`/api/tracks/${state.currentTrack.id}/like`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            
            if (data.success) {
                state.currentTrack.is_liked = data.liked;
                state.currentTrack.likes_count = data.likes_count;
                updateLikeUI();
            } else if (res.status === 401) {
                requestAuth();
            }
        } catch(e) {
            console.error('Like error:', e);
        }
    }
    
    // ============= NAVIGATION =============
    function switchTab(tab) {
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        
        $('tracks-section').style.display = (tab === 'all' || tab === 'tracks') ? 'block' : 'none';
        $('albums-section').style.display = (tab === 'all' || tab === 'albums') ? 'block' : 'none';
        $('my-section').style.display = tab === 'my' ? 'block' : 'none';
        
        if (tab === 'my') loadMyContent();
    }
    
    async function loadMyContent() {
        if (!state.user) {
            $('my-auth-prompt').style.display = 'block';
            $('my-content').style.display = 'none';
            return;
        }
        
        $('my-auth-prompt').style.display = 'none';
        $('my-content').style.display = 'block';
        
        try {
            const [tracksRes, albumsRes] = await Promise.all([
                fetch(`/api/tracks?user_id=${state.user.id}&show_hidden=true`),
                fetch(`/api/albums?user_id=${state.user.id}`)
            ]);
            
            const myTracks = await tracksRes.json();
            const myAlbums = await albumsRes.json();
            
            renderMyTracks(myTracks);
            renderMyAlbums(myAlbums);
        } catch(e) {
            console.error('Load my content error:', e);
        }
    }
    
    function renderMyTracks(tracks) {
        const container = $('my-tracks-list');
        if (!tracks?.length) {
            container.innerHTML = '<div class="empty-state"><p>Нет треков</p></div>';
            return;
        }
        
        // Store for playback
        window._myTracks = tracks;
        
        container.innerHTML = tracks.map((t, i) => `
            <div class="track-card" onclick="window.SwagPlayer.playMyTrack(${i})">
                <img src="${t.cover_filename ? '/uploads/' + t.cover_filename : '/static/img/default-cover.svg'}">
                <div class="info">
                    <div class="title">${escHtml(t.title)}</div>
                    <div class="artist">${escHtml(t.artist || '')}</div>
                </div>
                ${t.hidden ? '<span style="color:#666;font-size:12px;">скрыт</span>' : ''}
            </div>
        `).join('');
    }
    
    function renderMyAlbums(albums) {
        const container = $('my-albums-grid');
        if (!albums?.length) {
            container.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><p>Нет альбомов</p></div>';
            return;
        }
        
        container.innerHTML = albums.map(a => `
            <div class="album-card" onclick="window.SwagPlayer.loadAlbum('${a.slug || a.id}')">
                <div class="cover">
                    ${a.cover_filename 
                        ? `<img src="/uploads/${a.cover_filename}">`
                        : `<div class="placeholder"><i data-lucide="disc-3" class="w-12 h-12"></i></div>`}
                </div>
                <div class="title">${escHtml(a.title)}</div>
            </div>
        `).join('');
        
        lucide.createIcons();
    }
    
    function playMyTrack(index) {
        if (window._myTracks) {
            state.tracks = window._myTracks;
            playTrack(index);
        }
    }
    
    // ============= SEARCH =============
    function toggleSearch() {
        const bar = $('search-bar');
        const visible = bar.style.display !== 'none';
        bar.style.display = visible ? 'none' : 'block';
        if (!visible) $('search-input').focus();
    }
    
    function performSearch(e) {
        e.preventDefault();
        const q = $('search-input').value.trim();
        if (q) window.location.href = `/?q=${encodeURIComponent(q)}`;
    }
    
    function goBack() {
        window.history.back();
    }
    
    // ============= PROFILE =============
    function openProfile() {
        if (!state.user) {
            requestAuth();
            return;
        }
        
        const modal = $('profile-modal');
        modal.classList.add('visible');
        
        $('profile-content').innerHTML = `
            <div style="text-align:center;margin-bottom:24px;">
                <div style="width:96px;height:96px;margin:0 auto 16px;border-radius:50%;overflow:hidden;background:#222;">
                    ${state.user.avatar_url 
                        ? `<img src="${state.user.avatar_url}" style="width:100%;height:100%;object-fit:cover;">`
                        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;"><i data-lucide="user" class="w-12 h-12" style="color:#444;"></i></div>`}
                </div>
                <h3 style="font-size:20px;font-weight:700;margin-bottom:4px;">${escHtml(state.user.display_name || state.user.first_name || 'User')}</h3>
                ${state.user.nickname ? `<p style="color:#888;">@${state.user.nickname}</p>` : ''}
            </div>
            
            <div style="display:flex;flex-direction:column;gap:12px;">
                ${state.user.nickname ? `
                    <a href="/user/${state.user.nickname}" class="btn-secondary">
                        <i data-lucide="external-link" class="w-4 h-4"></i>
                        Моя публичная страница
                    </a>
                ` : ''}
                
                <a href="/app" class="btn-secondary">
                    <i data-lucide="settings" class="w-4 h-4"></i>
                    Управление треками
                </a>
                
                <button onclick="window.SwagPlayer.logout()" class="btn-secondary" style="color:#fa2d48;">
                    <i data-lucide="log-out" class="w-4 h-4"></i>
                    Выйти
                </button>
            </div>
        `;
        
        lucide.createIcons();
    }
    
    function closeProfile() {
        $('profile-modal').classList.remove('visible');
    }
    
    async function logout() {
        await fetch('/api/auth/logout', { method: 'POST' });
        state.user = null;
        updateUserUI();
        closeProfile();
        window.location.reload();
    }
    
    // ============= AUTH =============
    async function requestAuth() {
        if (window.tg?.initData) {
            $('auth-overlay').style.display = 'flex';
            
            try {
                const res = await fetch('/api/auth/telegram', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ initData: window.tg.initData })
                });
                
                const data = await res.json();
                
                if (data.success && data.user) {
                    state.user = data.user;
                    updateUserUI();
                    $('auth-overlay').style.display = 'none';
                    
                    // Reload my content if on that tab
                    if ($('my-section').style.display !== 'none') {
                        loadMyContent();
                    }
                } else {
                    throw new Error(data.error || 'Auth failed');
                }
            } catch(e) {
                console.error('Auth error:', e);
                $('auth-overlay').style.display = 'none';
                alert('Не удалось авторизоваться. Попробуйте позже.');
            }
        } else {
            // Redirect to Telegram bot for auth
            window.open('https://t.me/swagplayerobot?start=auth', '_blank');
        }
    }
    
    // ============= SHARE =============
    function shareTrack() {
        const t = state.currentTrack;
        if (!t) return;
        
        const url = `${window.location.origin}/track/${t.slug || t.id}`;
        
        if (window.tg) {
            window.tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(t.title + ' - ' + t.artist)}`);
        } else if (navigator.share) {
            navigator.share({
                title: t.title,
                text: `${t.title} - ${t.artist}`,
                url: url
            }).catch(() => {});
        } else {
            navigator.clipboard.writeText(url).then(() => {
                alert('Ссылка скопирована!');
            });
        }
    }
    
    // ============= VOLUME MINI =============
    function toggleMiniVolume() {
        $('mini-vol-popup').classList.toggle('visible');
    }
    
    // ============= KEYBOARD =============
    function onKeyDown(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        switch(e.code) {
            case 'Space':
                e.preventDefault();
                togglePlay();
                break;
            case 'ArrowLeft':
                audio.currentTime = Math.max(0, audio.currentTime - 5);
                break;
            case 'ArrowRight':
                audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
                break;
            case 'ArrowUp':
                e.preventDefault();
                setVolume(state.volume + 0.1);
                break;
            case 'ArrowDown':
                e.preventDefault();
                setVolume(state.volume - 0.1);
                break;
        }
    }
    
    // ============= UTILS =============
    function formatTime(s) {
        if (!s || isNaN(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec < 10 ? '0' + sec : sec}`;
    }
    
    function escHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    
    // ============= EXPORTS =============
    window.SwagPlayer = {
        playTrack,
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
    
    // Also expose for inline handlers
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
