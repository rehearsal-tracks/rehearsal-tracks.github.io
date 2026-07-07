#!/usr/bin/env node
// One-off backfill: stamp Cache-Control onto R2 objects that were
// uploaded BEFORE the upload path started setting these headers. New uploads get the headers
// automatically (see scripts/lib/upload.js); this fixes the existing catalog.
//
// Policy (matches upload.js):
//   - songs/**  audio assets (seg_*.mp3, waveform.json, audio.m3u8) → immutable, long-lived
//   - manifest.json / catalog.json (mutable indices)                 → no-cache
//
// Mechanism: each object is downloaded and re-uploaded (a fresh PUT stamps the headers reliably —
// a same-key server-side copy is a no-op on R2). This is slower (bytes round-trip through your
// machine) but correct. START SMALL and verify against the live site before the whole catalog:
//
//   npm run set-cache-headers -- --song=01-who-will-save-new-jersey --dry-run   # preview one song
//   npm run set-cache-headers -- --song=01-who-will-save-new-jersey             # apply to one song
//   npm run set-cache-headers -- --all                                          # apply to everything
//
// Note the `--` after the npm script name and keep it all on ONE line, or the flags won't reach
// the script. Running with neither --song nor --all only previews (dry-run), as a safety guard.
// After the first real run, re-check a segment in the browser: cache-control present + a repeat
// fetch is a cache hit.
import {
  listSongIds, listRemoteFiles, setRemoteHeaders,
  CACHE_IMMUTABLE, CACHE_MUTABLE,
} from "./lib/upload.js";

const argv = process.argv.slice(2);
const getArg = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.split("=").slice(1).join("=") : true;
};
const bucket = getArg("bucket") && getArg("bucket") !== true ? getArg("bucket") : "stem-player";
const onlySong = getArg("song") && getArg("song") !== true ? getArg("song") : null;
// Safety guard: modifying EVERY song live requires an explicit --all. Without --song or --all we
// only preview, so an accidental arg-less run can't rewrite the whole catalog (as one just did).
const runAll = !!getArg("all");
const dryRun = !!getArg("dry-run") || (!onlySong && !runAll);

// manifest.json is the only mutable file living under songs/**; everything else is an audio asset.
const headersFor = (relPath) =>
  relPath.endsWith("manifest.json") ? [CACHE_MUTABLE] : [CACHE_IMMUTABLE];

async function main() {
  if (dryRun && !getArg("dry-run")) {
    console.log("• No --song or --all given → preview only (dry-run). Re-run with --all to apply to every song.");
  }
  const songs = onlySong ? [onlySong] : await listSongIds(bucket);
  console.log(`${dryRun ? "[dry-run] " : ""}Backfilling cache headers on bucket "${bucket}" for ${songs.length} song(s).`);

  let count = 0;
  for (const id of songs) {
    const files = await listRemoteFiles(bucket, `songs/${id}`);
    for (const rel of files) {
      const path = `songs/${id}/${rel}`;
      const headers = headersFor(rel);
      console.log(`${dryRun ? "[dry-run] " : ""}${path}  ←  ${headers.join(" | ")}`);
      if (!dryRun) await setRemoteHeaders(bucket, path, headers);
      count++;
    }
  }

  // catalog.json lives at the bucket root (mutable index).
  console.log(`${dryRun ? "[dry-run] " : ""}catalog.json  ←  ${CACHE_MUTABLE}`);
  if (!dryRun && !onlySong) await setRemoteHeaders(bucket, "catalog.json", [CACHE_MUTABLE]);

  console.log(`${dryRun ? "[dry-run] " : "✔ "}${dryRun ? "would update" : "updated"} ${count} object(s)${onlySong ? "" : " + catalog.json"}.`);
}

main().catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
