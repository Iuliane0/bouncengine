/**
 * Bounce PWA Service Worker
 * Caches files individually with progress tracking
 */

// ---------------------------------------------------------------------------
// VERSION — read from this worker's OWN URL ('/sw.js?v=vX.Y.Z').
//
// It used to come from importScripts('/version.js'). That is wrong behind a CDN:
// Cloudflare edge-caches every .js on this origin — /version.js AND /sw.js itself
// both measured cf-cache-status:HIT, age ~37min — and it ignores a request's
// Cache-Control: no-cache. importScripts() cannot bypass that, and neither can
// registration's updateViaCache:'none', which only controls the *browser's* HTTP
// cache. So the worker imported a stale version and named its cache after an old
// release (observed: cache "bouncengine-v1.2.1" while the app ran v1.2.4).
//
// That silently disabled the whole version-scoping scheme: activate() saw its own
// cache name unchanged and deleted nothing, and cacheFilesIndividually()'s
// "skip what's already cached" shortcut — whose correctness depends on a version
// bump wiping the cache — then kept the previous release's files alive forever.
//
// Putting the version in the URL fixes it at the only layer a CDN respects. A new
// release is a URL the edge has never seen, so it MISSes through to the origin and
// the browser sees genuinely new worker bytes.
// ---------------------------------------------------------------------------
let APP_VERSION = new URL(self.location.href).searchParams.get('v');
if (!APP_VERSION) {
  // Fallback for a worker still registered at the bare '/sw.js' — i.e. the one
  // load that happens while this change is shipping. The page re-registers with
  // ?v= immediately after, and this branch stops being reachable.
  try { importScripts('/version.js'); APP_VERSION = self.APP_VERSION; } catch (e) { }
}
const CACHE_NAME = 'bouncengine-' + (APP_VERSION || 'unversioned');

// Ask the ORIGIN for a file, not the edge. Cloudflare answers .js from its cache
// regardless of request headers, so the only reliable buster is a URL it has never
// seen. The response is stored under the CLEAN url — the key pages actually request.
function originFetch(url, init) {
  const bust = url + (url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(APP_VERSION || '0');
  return fetch(bust, init);
}

// The engine document is byte-identical for every level: '?level=N' / '?online=ID'
// is read at runtime by the page itself. Map them all onto ONE canonical key.
//
// Without this, each level was cached under its own '/engine/?level=N' entry, so
// every level a player had opened kept a private frozen copy of the engine and went
// on running that release's physics — while newly-opened levels got current code.
// Deliberately NOT gated on request.mode === 'navigate'. The document is the same
// document however it is asked for, and gating on navigate left the '?level=N' form
// falling through to the asset branch below, where a leftover per-level entry could
// still be resolved — handing back the exact stale copy this is here to kill.
function canonicalDoc(request) {
  const u = new URL(request.url);
  if (u.origin !== self.location.origin) return null;
  const p = u.pathname;
  if (p === '/engine/' || p === '/engine/index.html') return '/engine/index.html';
  if (p === '/editor/' || p === '/editor/index.html') return '/editor/index.html';
  return null;
}

// Read ONLY from this version's cache.
//
// The bare caches.match() searches every cache in the origin, in creation order. That
// is a live staleness channel: when a release lands, the outgoing worker stays alive
// until its last client goes away and can still service a 'startCaching' message —
// creating 'bouncengine-<previous>' AFTER this worker's activate sweep has already
// run, so the sweep never sees it (observed: v1.2.9 active, v1.2.8 recreated behind
// it). Scoping every read means a leftover cache is simply invisible.
function matchOwn(key) {
  return caches.match(key, { cacheName: CACHE_NAME });
}

// Serve a canonical document, preferring the version-scoped cache (instant launch)
// and falling back to the network only when it has not been precached yet.
function serveDoc(request, docKey) {
  return matchOwn(docKey).then((cached) => {
    if (cached) return cached;
    return fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(docKey, clone));
        }
        return response;
      })
      .catch(() => matchOwn(docKey).then((c) => c || matchOwn('/index.html')));
  });
}

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
  // Compressed audio (Opus + AAC fallback). Both encode sample-exact so the
  // gapless menu loop stays seamless; ~16.4MB of WAV became ~2.6MB.
  '/intro.ogg',
  '/loop.ogg',
  '/silence.ogg',
  '/intro.m4a',
  '/loop.m4a',
  '/silence.m4a',
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
      // Skip if already cached. This is only safe because CACHE_NAME carries the
      // release version, so a bump lands in a brand-new empty cache and everything
      // is genuinely re-fetched. That invariant was broken while the version came
      // from a CDN-cached importScripts: the name never changed, so this shortcut
      // kept re-confirming the previous release's files as "already cached".
      const existing = await cache.match(url);
      if (existing) {
        cached++;
        cachingProgress = { cached, total, failed };
        await broadcastProgress(cached, total, failed);
        continue;
      }

      const ac = new AbortController();
      timeoutId = setTimeout(() => ac.abort(), 15000);
      const response = await originFetch(url, { cache: 'no-cache', signal: ac.signal });
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
  await sweepForeignCaches();   // the outgoing worker may have re-created its own
  return { cached, failed, total };
}

// Delete every cache that is not ours. Run at activate AND after precaching: the
// previous release's worker outlives activation (until its last client is gone) and
// can still answer a 'startCaching' message, re-creating its cache behind us.
async function sweepForeignCaches() {
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => {
    console.log('[SW] Deleting foreign cache:', n);
    return caches.delete(n);
  }));
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
  event.waitUntil((async () => {
    await sweepForeignCaches();

    // Evict every query-carrying engine/editor entry left by older workers:
    //   '/engine/?level=N'      — a private frozen engine per level played
    //   '/engine/levels.js?v=2' — the asset under its hand-written buster
    // They live INSIDE the current cache, so the name check above never touches them.
    // Both forms are now served from the clean key, and with ignoreSearch a leftover
    // could otherwise win the match by insertion order — stale, and nondeterministic.
    try {
      const cache = await caches.open(CACHE_NAME);
      for (const req of await cache.keys()) {
        const u = new URL(req.url);
        if (u.search && (u.pathname.startsWith('/engine/') || u.pathname.startsWith('/editor/'))) {
          console.log('[SW] Evicting stale per-level entry:', u.pathname + u.search);
          await cache.delete(req);
        }
      }
    } catch (e) { console.warn('[SW] Legacy eviction skipped:', e); }

    console.log('[SW] Claiming clients');
    await self.clients.claim();
  })());
});

// Fetch: CACHE FIRST, network fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  // Never intercept sw.js - let version checks always hit the network
  if (event.request.url.includes('sw.js')) return;

  // Always live: account/API traffic, and the update probe itself.
  //
  // Note what is NOT here any more: '/engine/' and '/editor/'. Network-first is
  // actively HARMFUL for this origin's static .js, because "the network" is
  // Cloudflare's edge — /engine/levels.js measured cf-cache-status:HIT, so a
  // network-first fetch returned the edge's stale copy in preference to a cache
  // that the release had just refreshed. Freshness is now guaranteed by the
  // version-scoped cache name plus originFetch()'s ?v= buster, so these are served
  // cache-first below: fast, and current by construction.
  if (event.request.url.includes('/api/') || event.request.url.includes('/version.js')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => matchOwn(event.request))
    );
    return;
  }

  // Engine / editor documents collapse onto one canonical, version-scoped entry,
  // so a release refreshes the engine for EVERY level at once instead of leaving
  // each previously-played level holding its own copy of the old logic.
  const docKey = canonicalDoc(event.request);
  if (docKey) {
    event.respondWith(serveDoc(event.request, docKey));
    return;
  }

  // The engine asks for '<script src="levels.js?v=2">' — a hand-written buster from
  // before the version was single-sourced — while the precache stores it clean, so an
  // exact match misses and the fall-through lands on Cloudflare's edge copy.
  //
  // Resolve it to the clean key explicitly rather than with { ignoreSearch: true }:
  // ignoreSearch returns whichever entry was inserted first, so a leftover '?v=2' copy
  // from an older worker could win the match and keep serving stale code. Naming the
  // key outright is deterministic. Freshness comes from the version-scoped cache name.
  const url = new URL(event.request.url);
  const isVersionedAsset = url.origin === self.location.origin && url.search &&
    (url.pathname.startsWith('/engine/') || url.pathname.startsWith('/editor/'));
  const lookup = isVersionedAsset ? (url.origin + url.pathname) : event.request;

  event.respondWith(
    matchOwn(lookup)
      .then((cached) => {
        if (cached) return cached;

        return fetch(event.request)
          .then((response) => {
            if (!response || response.status !== 200) return response;

            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(lookup, responseToCache);        // clean key for engine assets
            });
            return response;
          })
          .catch((error) => {
            if (event.request.mode === 'navigate') {
              if (event.request.url.includes('/engine')) {
                return matchOwn('/engine/index.html');
              }
              return matchOwn('/index.html');
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
