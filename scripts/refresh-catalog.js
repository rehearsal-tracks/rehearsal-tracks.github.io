#!/usr/bin/env node
// Rebuild catalog.json from the songs currently on R2 — without re-uploading them.
// Usage: node scripts/refresh-catalog.js [--bucket=stem-player]
import { refreshCatalog } from "./lib/catalog.js";
import { listSongIds, readRemoteManifest, uploadJson } from "./lib/upload.js";

const bucketArg = process.argv.slice(2).find((a) => a.startsWith("--bucket="));
const bucket = bucketArg ? bucketArg.split("=")[1] : "stem-player";

refreshCatalog({
  listSongIds: () => listSongIds(bucket),
  readManifest: (id) => readRemoteManifest(bucket, id),
  writeCatalog: (c) => uploadJson(c, bucket, "catalog.json"),
})
  .then((c) => console.log(`✔ catalog.json updated (${c.songs.length} songs)`))
  .catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
