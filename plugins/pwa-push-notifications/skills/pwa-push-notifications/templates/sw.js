// Service Worker — PWA shell cache + Web Push handler
// ────────────────────────────────────────────────────────────────────────────
// Bump CACHE_VERSION on every release to invalidate stale caches.

const CACHE_VERSION = 'app-v1';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

const APP_SHELL = [
    '/',
    '/dashboard',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/offline.html',
];

// ─── Install: pre-cache the app shell ───────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

// ─── Activate: clean old caches ──────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((k) => !k.endsWith(CACHE_VERSION))
                    .map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ─── Fetch: network-first for HTML, cache-first for static ───────────────
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (!url.protocol.startsWith('http')) return;
    // Skip realtime websockets
    if (url.pathname.startsWith('/rest/v1') || url.hostname.includes('supabase')) return;
    if (url.searchParams.has('_rsc')) return;

    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
                    return res;
                })
                .catch(async () => {
                    const cached = await caches.match(req);
                    return cached || (await caches.match('/dashboard')) || (await caches.match('/offline.html'));
                })
        );
        return;
    }

    // Static assets: cache-first
    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((res) => {
                if (res.ok && (
                    url.pathname.startsWith('/_next/') ||
                    url.pathname.startsWith('/icons/') ||
                    url.pathname.endsWith('.css') ||
                    url.pathname.endsWith('.js')
                )) {
                    const copy = res.clone();
                    caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
                }
                return res;
            });
        })
    );
});

// ─── Push: handle incoming push notifications ─────────────────────────────
self.addEventListener('push', (event) => {
    if (!event.data) return;
    let payload;
    try { payload = event.data.json(); }
    catch { payload = { title: 'Notification', body: event.data.text() }; }

    const title = payload.title || 'Notification';
    const options = {
        body: payload.body || '',
        icon: payload.icon || '/icons/icon-192.png',
        badge: '/icons/favicon-32.png',
        tag: payload.tag || 'app-notification',
        renotify: !!payload.renotify,
        requireInteraction: !!payload.requireInteraction,
        data: payload.data || {},
        actions: payload.actions || [],
        vibrate: [200, 100, 200],
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Notification click: focus the app and navigate to the link ─────────
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
            for (const win of wins) {
                if ('focus' in win) {
                    win.postMessage({ type: 'navigate', url: targetUrl }, '*');
                    return win.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(targetUrl);
        })
    );
});
