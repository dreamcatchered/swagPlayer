// Service Worker для фонового воспроизведения
const CACHE_NAME = 'music-player-v1';
const BASE_PATH = '';

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Кэшируем только необходимые файлы, пропускаем ошибки
            return Promise.allSettled([
                cache.add(`${BASE_PATH}/`).catch(() => {}),
                cache.add(`${BASE_PATH}/static/sw.js`).catch(() => {})
            ]);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', (event) => {
    // Пропускаем запросы к аудио файлам и API - они должны загружаться напрямую
    if (event.request.url.includes('/uploads/') || 
        event.request.url.includes('/api/') ||
        event.request.url.includes('/static/')) {
        return;
    }
    
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request).catch(() => {
                // Если запрос не удался, возвращаем пустой ответ
                return new Response('', { status: 404 });
            });
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

