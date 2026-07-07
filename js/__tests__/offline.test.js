import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconcile,
  buildSongUrls,
  syncSong,
  songCacheName,
  listDownloadedIds,
  isDownloaded,
  removeSong,
  songSize,
  formatBytes,
} from "../offline.js";

// ── Fakes ──────────────────────────────────────────────────────────────────────────────────────
// A minimal in-memory Cache Storage, matching the slice of the API offline.js uses.
function makeCacheStorage() {
  const store = new Map(); // cacheName -> Map(url -> response)
  const cacheFor = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const map = store.get(name);
    return {
      async keys() { return [...map.keys()].map((url) => ({ url })); },
      async match(req) { return map.get(typeof req === "string" ? req : req.url) || undefined; },
      async put(req, res) { map.set(typeof req === "string" ? req : req.url, res); },
      async delete(req) { return map.delete(typeof req === "string" ? req : req.url); },
    };
  };
  return {
    _store: store,
    async open(name) { return cacheFor(name); },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
  };
}

// A fetch that serves a fixed url->body table and records what it was asked for.
function makeFetch(table) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (!(url in table)) return { ok: false, status: 404, async text() { return ""; }, headers: new Map() };
    const body = table[url];
    return {
      ok: true,
      status: 200,
      async text() { return body; },
      headers: new Map([["content-length", String(body.length)]]),
    };
  };
  fn.calls = calls;
  return fn;
}

const BASE = "https://cdn.example/songs/song-a";
const M3U8 = "#EXTINF:6,\nseg_000.mp3\n#EXTINF:4,\nseg_001.mp3\n";
// One-stem manifest at rev aaa; media urls resolve inside the rev folder (relative seg names).
const manifest = (rev) => ({
  title: "A", artist: "B",
  stems: [{ name: "Vocals", slug: "vocals", rev, src: `vocals/${rev}/audio.m3u8`, waveform: `vocals/${rev}/waveform.json` }],
});
const urlsFor = (rev) => [
  `${BASE}/manifest.json`,
  `${BASE}/vocals/${rev}/audio.m3u8`,
  `${BASE}/vocals/${rev}/waveform.json`,
  `${BASE}/vocals/${rev}/seg_000.mp3`,
  `${BASE}/vocals/${rev}/seg_001.mp3`,
];
const tableFor = (rev) => Object.fromEntries(urlsFor(rev).map((u) => [u, u.endsWith(".m3u8") ? M3U8 : u]));

// ── reconcile (pure) ─────────────────────────────────────────────────────────────────────────
test("reconcile returns urls to fetch (desired, not cached) and delete (cached, not desired)", () => {
  const { toFetch, toDelete } = reconcile(["a", "b", "c"], ["b", "c", "d"]);
  assert.deepEqual(toFetch, ["a"]);
  assert.deepEqual(toDelete, ["d"]);
});

test("reconcile with an empty cache fetches everything and deletes nothing", () => {
  const { toFetch, toDelete } = reconcile(["a", "b"], []);
  assert.deepEqual(toFetch, ["a", "b"]);
  assert.deepEqual(toDelete, []);
});

test("reconcile accepts Sets", () => {
  const { toFetch, toDelete } = reconcile(new Set(["a"]), new Set(["a", "b"]));
  assert.deepEqual(toFetch, []);
  assert.deepEqual(toDelete, ["b"]);
});

// ── buildSongUrls ──────────────────────────────────────────────────────────────────────────────
test("buildSongUrls enumerates manifest + per-stem m3u8/waveform + parsed segments", async () => {
  const rev = "aaaaaaaaaa";
  const fetchImpl = makeFetch(tableFor(rev));
  const urls = await buildSongUrls({ base: BASE, manifest: manifest(rev), fetchImpl });
  assert.deepEqual([...urls].sort(), urlsFor(rev).sort());
});

test("buildSongUrls throws when a stem's playlist can't be fetched", async () => {
  const fetchImpl = makeFetch({}); // 404 for everything
  await assert.rejects(
    () => buildSongUrls({ base: BASE, manifest: manifest("aaaaaaaaaa"), fetchImpl }),
    /playlist 404 for stem "Vocals"/
  );
});

// ── syncSong: first download ─────────────────────────────────────────────────────────────────
test("syncSong downloads every url into the per-song cache and reports progress to total", async () => {
  const rev = "aaaaaaaaaa";
  const cacheStorage = makeCacheStorage();
  const fetchImpl = makeFetch(tableFor(rev));
  const progress = [];
  const res = await syncSong({
    id: "song-a", base: BASE, manifest: manifest(rev), fetchImpl, cacheStorage,
    onProgress: (p) => progress.push(p),
  });
  assert.equal(res.total, 5);
  assert.equal(res.deleted, 0);
  // Cache holds all 5 urls.
  const cache = await cacheStorage.open(songCacheName("song-a"));
  const stored = (await cache.keys()).map((r) => r.url).sort();
  assert.deepEqual(stored, urlsFor(rev).sort());
  // Progress ends at done === total.
  const last = progress[progress.length - 1];
  assert.deepEqual([last.done, last.total], [5, 5]);
});

// ── syncSong: reconcile after a stem is replaced (new rev) ─────────────────────────────────────
test("syncSong reconciles a replaced stem: deletes old-rev files, fetches new-rev files", async () => {
  const cacheStorage = makeCacheStorage();
  // First download at rev aaa.
  await syncSong({ id: "song-a", base: BASE, manifest: manifest("aaaaaaaaaa"), fetchImpl: makeFetch(tableFor("aaaaaaaaaa")), cacheStorage });
  // Stem replaced -> rev bbb. Re-sync.
  const rev2 = "bbbbbbbbbb";
  const fetch2 = makeFetch(tableFor(rev2));
  const res = await syncSong({ id: "song-a", base: BASE, manifest: manifest(rev2), fetchImpl: fetch2, cacheStorage });

  const cache = await cacheStorage.open(songCacheName("song-a"));
  const stored = (await cache.keys()).map((r) => r.url).sort();
  // Only the new rev's files (+ manifest) remain; old-rev media is gone.
  assert.deepEqual(stored, urlsFor(rev2).sort());
  // Old-rev media (3 files: m3u8 + waveform + 2 segs = 4, but manifest url is shared) deleted.
  assert.equal(res.deleted, 4);
  // Manifest is always refreshed even though its url was unchanged.
  assert.ok(fetch2.calls.some((c) => c.url === `${BASE}/manifest.json` && c.opts?.cache === "reload"));
});

test("syncSong re-run with unchanged content refetches only the manifest (idempotent media)", async () => {
  const rev = "aaaaaaaaaa";
  const cacheStorage = makeCacheStorage();
  await syncSong({ id: "song-a", base: BASE, manifest: manifest(rev), fetchImpl: makeFetch(tableFor(rev)), cacheStorage });
  const res = await syncSong({ id: "song-a", base: BASE, manifest: manifest(rev), fetchImpl: makeFetch(tableFor(rev)), cacheStorage });
  assert.equal(res.deleted, 0);
  assert.equal(res.fetched, 1); // just the manifest
});

// ── listing / removing / sizing ────────────────────────────────────────────────────────────────
test("listDownloadedIds / isDownloaded / removeSong track per-song caches", async () => {
  const cacheStorage = makeCacheStorage();
  await syncSong({ id: "song-a", base: BASE, manifest: manifest("aaaaaaaaaa"), fetchImpl: makeFetch(tableFor("aaaaaaaaaa")), cacheStorage });
  assert.deepEqual(await listDownloadedIds(cacheStorage), ["song-a"]);
  assert.equal(await isDownloaded("song-a", cacheStorage), true);
  assert.equal(await isDownloaded("song-x", cacheStorage), false);
  await removeSong("song-a", cacheStorage);
  assert.equal(await isDownloaded("song-a", cacheStorage), false);
  assert.deepEqual(await listDownloadedIds(cacheStorage), []);
});

test("songSize sums cached responses' content-length; 0 when not downloaded", async () => {
  const rev = "aaaaaaaaaa";
  const cacheStorage = makeCacheStorage();
  await syncSong({ id: "song-a", base: BASE, manifest: manifest(rev), fetchImpl: makeFetch(tableFor(rev)), cacheStorage });
  const expected = urlsFor(rev).reduce((sum, u) => sum + (u.endsWith(".m3u8") ? M3U8.length : u.length), 0);
  assert.equal(await songSize("song-a", cacheStorage), expected);
  assert.equal(await songSize("song-x", cacheStorage), 0);
});

// ── formatBytes (pure) ─────────────────────────────────────────────────────────────────────────
test("formatBytes renders human sizes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(105_000_000), "100 MB");
  assert.equal(formatBytes(1.5 * 1024 ** 3), "1.5 GB");
});
