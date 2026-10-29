#!/usr/bin/env node
// Rebuild every derived catalog (projects/<pid>/catalog.json, projects.json, legacy catalog.json) from R2 — without re-uploading songs.
// Usage: node scripts/refresh-catalog.js [--bucket=stem-player]
import { refreshRemoteCatalog, describeRefresh } from "./lib/remote-catalog.js";

const bucketArg = process.argv.slice(2).find((a) => a.startsWith("--bucket="));
const bucket = bucketArg ? bucketArg.split("=")[1] : "stem-player";

refreshRemoteCatalog(bucket)
  .then((r) => console.log(`✔ ${describeRefresh(r)}`))
  .catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
