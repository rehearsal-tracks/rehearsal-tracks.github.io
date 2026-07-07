// sw.js — Rehearsal Tracks service worker (Phase A: installable app shell).
//
// Scope: served from the site root, so it controls both index.html and stream.html.
// Responsibilities in Phase A:
//   • Precache the app shell (HTML/CSS/JS/icons/manifest) so the app boots instantly and offline.
//   • Cache the stemplayer-js component (esm.sh) + fonts at runtime so an installed app isn't
//     broken by a CDN hiccup and can cold-start offline.
//   • Serve the mutable JSON indices (catalog.json / manifest.json) network-first with an offline
//     fallback to the last-seen copy.
//   • Media (R2 seg_*.mp3 / waveform.json / audio.m3u8) is served from Cache Storage IF present,
//     otherwise passed through to the network WITHOUT caching. Phase A never auto-fills whole songs
//     into Cache Storage — that's Phase B (per-song "make available offline"). Media therefore still
//     benefits from the HTTP cache + the in-page prefetcher exactly as it does today.
//
// SHELL_VERSION is stamped with a content hash of the shell files at deploy time
// (`npm run deploy` → scripts/stamp-sw.js), so every content change produces a byte-different sw.js
// and the browser detects the update + re-precaches. Old caches are pruned on activate.
// See the PWA design doc: ~/.claude/plans/2026-07-02-stem-player-pwa-design.md.

const SHELL_VERSION = "82f815fe3e"; // stamped at deploy — do not rely on this literal
const SHELL_CACHE = `rt-shell-${SHELL_VERSION}`;
const RUNTIME_CACHE = `rt-runtime-${SHELL_VERSION}`;
const CACHE_ALLOWLIST = new Set([SHELL_CACHE, RUNTIME_CACHE]);

// Per-song offline downloads (Phase B, written by js/offline.js) live in `rt-song-<id>` caches.
// These are deliberately NOT version-scoped: a deploy rolls the shell/runtime caches but must NOT
// wipe a user's downloaded songs, so activate spares anything with this prefix.
const SONG_CACHE_PREFIX = "rt-song-";

// R2 origin that serves song media + the catalog/manifest JSON. Kept in sync with js/config.js
// (R2_BASE). A classic worker can't import the ES module, so this one string is duplicated.
// Cloudflare custom domain (HTTP/2), NOT the HTTP/1.1 pub-*.r2.dev dev URL — see js/config.js.
const R2_ORIGIN = "https://media.andrewbray.us";

// Same-origin shell assets. Relative to the SW scope (site root). "./" caches the root navigation.
const SHELL_ASSETS = [
  "./",
  "index.html",
  "stream.html",
  "manifest.webmanifest",
  "favicon.svg",
  "css/styles.css",
  "js/config.js",
  "js/data.js",
  "js/landing.js",
  "js/lava-lamp.js",
  "js/nav.js",
  "js/offline.js",
  "js/offline-ui.js",
  "js/prefetch.js",
  "js/stream.js",
  "js/sw-register.js",
  "js/lib/catalog-view.js",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
];

// ── Install: precache the shell ──────────────────────────────────────────────────────────────
// Use `cache: "reload"` so the precache fetch bypasses the HTTP cache (avoids baking a stale copy
// into Cache Storage — Jake Archibald's max-age race). Add each file independently (allSettled) so
// one missing/failed asset can't abort the whole install and brick the worker.
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const results = await Promise.allSettled(
      SHELL_ASSETS.map((url) => cache.add(new Request(url, { cache: "reload" })))
    );
    const failed = results
      .map((r, i) => (r.status === "rejected" ? SHELL_ASSETS[i] : null))
      .filter(Boolean);
    if (failed.length) console.warn("[sw] precache misses:", failed);
    // NOTE: no skipWaiting() here. A new worker installs (downloads the new shell) in the
    // background but stays in "waiting" until either all tabs close (auto-activates on next cold
    // launch) or the page sends SKIP_WAITING (the "Reload" pill) — so we never swap assets out from
    // under an active session / mid-playback.
  })());
});

// The page's "Reload" pill posts this once the user opts in; only then do we activate immediately.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// ── Activate: prune old caches, claim clients ────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => !CACHE_ALLOWLIST.has(n) && !n.startsWith(SONG_CACHE_PREFIX))
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// ── Fetch strategies ─────────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never intercept POST/PUT/etc.

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // 1. Navigations (loading index.html / stream.html): network-first so a new deploy is picked up,
  //    with an offline fallback to the cached page (or the root shell).
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, "./"));
    return;
  }

  // 2. Same-origin shell assets (CSS/JS/icons/svg/manifest): stale-while-revalidate — instant from
  //    cache, refreshed in the background so the next load has the latest.
  if (isSameOrigin) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  // 3. The player component (esm.sh) + web fonts: cache-first into the runtime cache. These URLs are
  //    version-stable, so a cached copy is safe and makes the installed app cold-start offline.
  if (url.hostname === "esm.sh" || url.hostname.endsWith("gstatic.com") ||
      url.hostname === "fonts.googleapis.com") {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // 4. R2 assets.
  if (url.origin === R2_ORIGIN) {
    // Mutable indices → network-first, fall back to the last-seen copy offline. searchAllCaches so
    // a downloaded song's manifest.json (stored in its rt-song-<id> cache) still resolves offline
    // even after a deploy has rolled the runtime cache.
    if (url.pathname.endsWith("catalog.json") || url.pathname.endsWith("manifest.json")) {
      event.respondWith(networkFirst(request, RUNTIME_CACHE, null, true));
      return;
    }
    // Media (seg_*.mp3 / waveform.json / audio.m3u8): serve from Cache Storage if Phase B has
    // downloaded it; otherwise straight to the network with NO caching (Phase A doesn't auto-fill).
    event.respondWith(cacheOnlyElseNetwork(request));
    return;
  }

  // Everything else: default network passthrough.
});

// ── Strategy helpers ─────────────────────────────────────────────────────────────────────────

async function networkFirst(request, cacheName, fallbackKey, searchAllCaches = false) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached =
      (await cache.match(request)) ||
      (searchAllCaches && (await caches.match(request))) ||
      (fallbackKey && (await cache.match(fallbackKey)));
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || fetch(request);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  // esm.sh/fonts can return opaque (no-cors) responses; still cacheable, just not introspectable.
  if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
  return res;
}

async function cacheOnlyElseNetwork(request) {
  const cached = await caches.match(request);
  return cached || fetch(request);
}
