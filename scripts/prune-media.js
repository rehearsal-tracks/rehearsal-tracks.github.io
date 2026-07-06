#!/usr/bin/env node
// Usage: npm run prune-media [-- <songId> ...] [--bucket=stem-player] [--apply]
//
// Deletes orphaned stem-revision files from R2 — media folders no longer referenced by a song's
// manifest, left behind when a stem is replaced with a new content rev. Operates on all songs by
// default, or just the song ids passed as positional args. DRY-RUN by default: it only lists what
// it would delete; pass --apply to actually delete. Safe to run repeatedly.
// See ~/.claude/plans/2026-07-02-stem-player-media-versioning-design.md.
import { listSongIds, readRemoteManifest, listRemoteFiles, deleteRemoteFile } from "./lib/upload.js";
import { findOrphans } from "./lib/prune.js";

function parseArgs(argv) {
  const args = { _: [], bucket: "stem-player", apply: false };
  for (const a of argv) {
    if (a === "--apply") args.apply = true;
    else if (a.startsWith("--")) { const [k, v] = a.slice(2).split("="); args[k] = v ?? true; }
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ids = args._.length ? args._ : await listSongIds(args.bucket);
  let total = 0;
  for (const id of ids) {
    const manifest = await readRemoteManifest(args.bucket, id);
    const files = await listRemoteFiles(args.bucket, `songs/${id}`);
    const { skip, reason, orphans } = findOrphans(manifest, files);
    if (skip) { console.log(`• ${id}: skipped — ${reason}`); continue; }
    if (!orphans.length) { console.log(`✓ ${id}: no orphans`); continue; }
    console.log(`${args.apply ? "🗑" : "•"} ${id}: ${orphans.length} orphaned file(s)`);
    for (const f of orphans) {
      console.log(`    songs/${id}/${f}`);
      if (args.apply) await deleteRemoteFile(args.bucket, `songs/${id}/${f}`);
    }
    total += orphans.length;
  }
  console.log(
    `\n${args.apply ? `Deleted ${total} file(s).` : `${total} file(s) would be deleted. Re-run with --apply to delete.`}`
  );
}

main().catch((e) => { console.error(`\n✖ ${e.message}\n`); process.exit(1); });
