/**
 * Bounce PWA Service Worker
 * Caches files individually with progress tracking
 */

importScripts('/version.js');                         // single source of truth
const CACHE_NAME = 'bouncengine-' + self.APP_VERSION;

// All files to precache during install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/version.js',
  '/storage.js',
  '/progress.js',
  '/site.webmanifest',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/apple-touch-icon.png',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/favicon.ico',
  '/background.png',
  '/ground.png',
  '/root.png',
  '/rootgif.gif',
  '/skyline.png',
  '/title.png',
  '/menucredits.png',
  '/nokialogo.png',
  '/songcredits.png',
  '/loading.gif',
  '/raylib.ttf',
  '/intro.wav',
  '/loop.wav',
  '/silence.wav',
  '/engine/index.html',
  '/engine/assets.js',
  '/engine/chunkManager.js',
  '/engine/levels.js',
  '/engine/bouncesplash.png',
  '/engine/igorsplash.png',
  '/engine/pickup.aac',
  '/engine/pop.aac',
  '/engine/up.aac',
  '/editor/index.html',
  '/editor/import_classic_levels.js'
];

// Broadcast caching progress to all clients (includeUncontrolled ensures
// messages reach pages before claim() takes effect on fresh installs)
async function broadcastProgress(cached, total, failed) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(client => {
    client.postMessage({
      type: 'CACHE_PROGRESS',
      cached,
      total,
      failed,
      ready: cached + failed >= total
    });
  });
}

// Guard against concurrent caching from multiple startCaching messages
let isCaching = false;
let cachingProgress = { cached: 0, total: PRECACHE_URLS.length, failed: 0 };

// Cache files one by one so partial caching works
async function cacheFilesIndividually(cache) {
  const total = PRECACHE_URLS.length;
  let cached = 0;
  let failed = 0;

  for (const url of PRECACHE_URLS) {
    let timeoutId;
    try {
      // Skip if already cached (version changes wipe all caches, so
      // existing entries are always from the current version)
      const existing = await cache.match(url);
      if (existing) {
        cached++;
        cachingProgress = { cached, total, failed };
        await broadcastProgress(cached, total, failed);
        continue;
      }

      const ac = new AbortController();
      timeoutId = setTimeout(() => ac.abort(), 15000);
      const response = await fetch(url, { cache: 'no-cache', signal: ac.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        await cache.put(url, response);
        cached++;
      } else {
        failed++;
        console.warn('[SW] Failed to cache:', url, response.status);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      failed++;
      console.error('[SW] Error caching:', url, err);
    }
    cachingProgress = { cached, total, failed };
    await broadcastProgress(cached, total, failed);
  }

  console.log('[SW] Caching complete: ' + cached + '/' + total + ' cached, ' + failed + ' failed');
  return { cached, failed, total };
}

// Install: do nothing here - menu page will explicitly request caching via message
// This ensures caching ONLY happens when triggered from the menu, never from engine
self.addEventListener('install', (event) => {
  console.log('[SW] Installed, waiting for menu to trigger caching...');
  // Don't cache anything here - just complete installation
});

// Activate: delete old caches and claim clients
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Claiming clients');
        return self.clients.claim();
      })
  );
});

// Fetch: CACHE FIRST, network fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  // Never intercept sw.js - let version checks always hit the network
  if (event.request.url.includes('sw.js')) return;

  // Network-first for frequently updated files — changes appear immediately
  // { cache: 'no-cache' } bypasses the browser HTTP cache.
  if (event.request.url.includes('/version.js') || event.request.url.includes('/engine/levels.js') || event.request.url.includes('/editor/') || event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    // Don't ignore search params - this allows cache busting strategies to work!
    caches.match(event.request)
      .then((cached) => {
        if (cached) return cached;

        return fetch(event.request)
          .then((response) => {
            if (!response || response.status !== 200) return response;

            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
            return response;
          })
          .catch((error) => {
            if (event.request.mode === 'navigate') {
              if (event.request.url.includes('/engine')) {
                return caches.match('/engine/index.html');
              }
              return caches.match('/index.html');
            }
            throw error;
          });
      })
  );
});

// Handle messages from page
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }

  // Menu page requests caching to start - this is the ONLY way caching happens
  if (event.data === 'startCaching') {
    if (isCaching) {
      console.log('[SW] Already caching, broadcasting current progress');
      // Broadcast current progress so new clients aren't left hanging
      broadcastProgress(cachingProgress.cached, cachingProgress.total, cachingProgress.failed);
      return;
    }
    isCaching = true;
    // Reset progress so a second startCaching message doesn't broadcast stale "ready"
    cachingProgress = { cached: 0, total: PRECACHE_URLS.length, failed: 0 };
    console.log('[SW] Menu requested caching, starting...');
    caches.open(CACHE_NAME)
      .then((cache) => cacheFilesIndividually(cache))
      .then(() => {
        isCaching = false;
        console.log('[SW] Caching complete');
      });
  }
});
