// public/sw.js
//
// Service Worker de Dramaturge — cache-first.
// Estrategia:
//   - En install: precachea el shell de la app (html, js, css).
//   - En fetch: sirve desde caché si existe; si no, descarga, cachea y devuelve.
//   - Assets del juego (sprites, audio, cg, scripts .dan) se cachean en el
//     primer acceso y se sirven offline desde entonces.
//
// VERSIÓN: incrementar CACHE_NAME al hacer cambios que requieran invalidar caché.
// El SW viejo se elimina automáticamente al activarse el nuevo.

const CACHE_NAME = 'dramaturge-v1';

// Shell mínimo — se precachea en install para garantizar arranque offline.
// Rutas relativas al scope del SW (raíz del sitio en producción).
const PRECACHE_URLS = [
    './',
    './index.html',
];

// ── Install — precachear shell ────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Precacheando shell...');
            return cache.addAll(PRECACHE_URLS);
        })
    );
    // Activar inmediatamente sin esperar a que se cierren pestañas abiertas.
    self.skipWaiting();
});

// ── Activate — limpiar cachés antiguas ───────────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => {
                        console.log(`[SW] Eliminando caché antigua: ${key}`);
                        return caches.delete(key);
                    })
            )
        )
    );
    // Tomar control de todas las pestañas abiertas inmediatamente.
    self.clients.claim();
});

// ── Fetch — cache-first ───────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    // Solo interceptar GET. POST/PUT/DELETE van directo a la red.
    if (event.request.method !== 'GET') return;

    // No interceptar peticiones a otros orígenes (CDNs, APIs externas).
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;

            // No está en caché — fetch a la red, cachear y devolver.
            return fetch(event.request).then((response) => {
                // Solo cachear respuestas válidas (no errores, no opacas de CORS).
                if (!response || response.status !== 200 || response.type === 'opaque') {
                    return response;
                }

                // Clonar antes de consumir — response solo puede leerse una vez.
                const toCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, toCache);
                });

                return response;
            }).catch(() => {
                // Sin red y sin caché — para navegación devolver index.html como fallback.
                if (event.request.destination === 'document') {
                    return caches.match('./index.html');
                }
                // Para otros recursos (audio, imagen) simplemente fallar silenciosamente.
            });
        })
    );
});