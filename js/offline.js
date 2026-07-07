// js/offline.js — PWA Phase B: make a song available offline (Cache Storage).
//
// A song's media is streamed as ~6s MP3 HLS segments plus a per-stem waveform and playlist, all
// served immutable+content-versioned from R2 (songs/<id>/<slug>/<rev>/…, see the media-versioning
// design). "Download for offline" enumerates every URL that constitutes the whole song and writes
// it into a dedicated per-song Cache Storage bucket; the service worker's cache-first media rule
// (sw.js cacheOnlyElseNetwork) then serves it with zero network, so the existing player + prefetch
// work unchanged offline.
//
// Two design points that make this durable and precise:
//   • Per-song cache keyed `rt-song-<id>`, NOT version-scoped — sw.js spares `rt-song-*` from the
//     activate-time eviction, so a downloaded song survives app-shell deploys (which roll the
//     versioned shell/runtime caches).
//   • Because media URLs carry a content hash, keeping a download current is an exact set-difference
//     against a freshly-fetched manifest — the client mirror of `npm run prune-media`. reconcile()
//     computes it; syncSong() applies it (delete orphaned revs, fetch new ones, refresh manifest).
//
// This module is the page-driven downloader (runs in the window, not the SW) so progress reporting
// and cancellation are direct and the logic is unit-testable. It touches nothing in the audio path.
// See ~/.claude/plans/2026-07-02-stem-player-pwa-design.md (Phase B).

import { parseM3u8 } from "./prefetch.js";

export const SONG_CACHE_PREFIX = "rt-song-";
// Concurrency for the download pool — mirrors the prefetcher's MAX_INFLIGHT so we don't hammer R2
// (risking 429/5xx) while still saturating a fast pipe.
const POOL = 8;

export function songCacheName(id) {
  return `${SONG_CACHE_PREFIX}${id}`;
}

// The one mutable, stable-URL asset in a song: its manifest. Everything else is content-versioned,
// so only the manifest needs force-refreshing on every sync (its URL never changes but its bytes do).
function isManifestUrl(url) {
  return url.endsWith("/manifest.json");
}

// Enumerate every URL that makes up a full offline copy of one song: the manifest, and per stem the
// playlist (audio.m3u8), the waveform, and every segment the playlist references. Segment URLs come
// from parsing each stem's m3u8 (reusing the prefetcher's parser) so they exactly match the URLs the
// audio engine will later request. `fetchImpl` is injectable for tests.
export async function buildSongUrls({ base, manifest, fetchImpl = fetch }) {
  const urls = new Set([`${base}/manifest.json`]);
  for (const stem of manifest.stems) {
    const m3u8Url = `${base}/${stem.src}`;
    urls.add(m3u8Url);
    urls.add(`${base}/${stem.waveform}`);
    // no-store: the playlist is tiny and we only want it to enumerate segments here; the copy that
    // lands in the offline cache is written by the download pool below (as a normal cache entry).
    const res = await fetchImpl(m3u8Url, { cache: "no-store" });
    if (!res.ok) throw new Error(`playlist ${res.status} for stem "${stem.name}"`);
    for (const seg of parseM3u8(await res.text(), m3u8Url)) urls.add(seg.url);
  }
  return urls;
}

// Pure set-difference: what to fetch (desired but not cached) and what to delete (cached but no
// longer desired). Content-versioned URLs make this exact — a replaced stem's old rev shows up in
// toDelete, its new rev in toFetch. Exported for unit testing. (The manifest, a stable URL, is
// force-refreshed separately by syncSong, so its presence in both sets is a no-op here.)
export function reconcile(desiredUrls, cachedUrls) {
  const desired = desiredUrls instanceof Set ? desiredUrls : new Set(desiredUrls);
  const cached = cachedUrls instanceof Set ? cachedUrls : new Set(cachedUrls);
  return {
    toFetch: [...desired].filter((u) => !cached.has(u)),
    toDelete: [...cached].filter((u) => !desired.has(u)),
  };
}

// Run `worker` over `items` with at most `limit` in flight. Stops pulling new work once any worker
// throws (e.g. QuotaExceededError mid-download) and rethrows the first error after in-flight settle.
async function pooledForEach(items, limit, worker) {
  let next = 0;
  let failure = null;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !failure) {
      const idx = next++;
      try {
        await worker(items[idx], idx);
      } catch (err) {
        failure = failure || err;
        throw err;
      }
    }
  });
  await Promise.allSettled(runners);
  if (failure) throw failure;
}

// Download or update a song's offline copy. Handles both first download (empty cache → fetch all)
// and reconciliation (existing cache → diff and apply) via the same path, so a re-open just tops up.
// Reports { done, total } after each unit so callers can drive a progress bar. `onProgress` also
// receives a `phase` ("delete" | "fetch") for optional messaging.
//   - fetchImpl / cacheStorage are injectable for tests.
//   - The manifest is always re-fetched and re-put (mutable content at a stable URL).
//   - QuotaExceededError propagates so the caller can surface "not enough space".
export async function syncSong({ id, base, manifest, onProgress, fetchImpl = fetch, cacheStorage = caches }) {
  const cache = await cacheStorage.open(songCacheName(id));
  const desired = await buildSongUrls({ base, manifest, fetchImpl });
  const cachedUrls = new Set((await cache.keys()).map((req) => req.url));
  const { toFetch, toDelete } = reconcile(desired, cachedUrls);

  // The manifest URL is "already cached" after the first download (stable URL) so the diff won't
  // re-fetch it, but its bytes may have changed — always refresh it as part of the fetch work.
  const manifestUrl = `${base}/manifest.json`;
  const fetchList = toFetch.includes(manifestUrl) ? toFetch : [manifestUrl, ...toFetch];

  const total = fetchList.length;
  let done = 0;
  onProgress?.({ done, total, phase: "fetch" });

  // Drop orphaned revisions first so a replace-in-place frees space before the new rev lands.
  for (const url of toDelete) {
    if (!isManifestUrl(url)) await cache.delete(url);
  }
  if (toDelete.length) onProgress?.({ done, total, phase: "delete" });

  await pooledForEach(fetchList, POOL, async (url) => {
    // Media is immutable + content-versioned, so reuse the HTTP cache ("default") — this lets a
    // segment the prefetcher already warmed be copied into Cache Storage without a second network
    // round-trip. Only the manifest (mutable bytes at a stable URL) is force-reloaded to dodge the
    // Jake Archibald max-age race and capture the latest catalog state.
    const res = await fetchImpl(url, { cache: isManifestUrl(url) ? "reload" : "default" });
    if (!res.ok) throw new Error(`download ${res.status}: ${url}`);
    await cache.put(url, res);
    done++;
    onProgress?.({ done, total, phase: "fetch" });
  });

  return { total, fetched: fetchList.length, deleted: toDelete.length };
}

// Remove a song's entire offline copy in one call. Returns true if a cache existed.
export function removeSong(id, cacheStorage = caches) {
  return cacheStorage.delete(songCacheName(id));
}

// Ids of every downloaded song (from the `rt-song-*` cache names).
export async function listDownloadedIds(cacheStorage = caches) {
  const names = await cacheStorage.keys();
  return names
    .filter((n) => n.startsWith(SONG_CACHE_PREFIX))
    .map((n) => n.slice(SONG_CACHE_PREFIX.length));
}

export async function isDownloaded(id, cacheStorage = caches) {
  return (await cacheStorage.keys()).includes(songCacheName(id));
}

// Approximate on-disk size of a downloaded song, summed from cached responses' Content-Length.
// R2 sends CORS-readable headers so this is accurate for our media (opaque responses, which have no
// readable length, don't occur here). Returns 0 for a song that isn't downloaded.
export async function songSize(id, cacheStorage = caches) {
  const names = await cacheStorage.keys();
  if (!names.includes(songCacheName(id))) return 0;
  const cache = await cacheStorage.open(songCacheName(id));
  let bytes = 0;
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    const len = Number(res?.headers.get("content-length"));
    if (Number.isFinite(len)) bytes += len;
  }
  return bytes;
}

// Origin-wide storage usage vs quota (Cache Storage + IndexedDB etc.). null if unsupported.
export async function storageEstimate() {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

// Ask the platform to persist storage (exempt from best-effort eviction). No-op/false when
// unsupported; on iOS home-screen PWAs and engaged Chromium this is granted without a prompt.
export async function requestPersistence() {
  try {
    return navigator.storage?.persist ? await navigator.storage.persist() : false;
  } catch {
    return false;
  }
}

// 0 -> "0 B"; 105_000_000 -> "105 MB". Pure; used by the storage UI.
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = n / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}
