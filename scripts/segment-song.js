#!/usr/bin/env node
// Usage: node scripts/segment-song.js <input-dir> --id=<id> --project=<pid> --title="…" --artist="…" [--bitrate=128k] [--no-upload] [--bucket=stem-player]
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { segmentSong } from "./lib/segment.js";
import { uploadDir, readRemoteJsonIfExists } from "./lib/upload.js";
import { safeId } from "./lib/safe-path.js";
import { assertSongOwnership } from "./lib/project.js";
import { refreshRemoteCatalog, describeRefresh } from "./lib/remote-catalog.js";

function parseArgs(argv) {
  const args = { _: [], bitrate: "128k", bucket: "stem-player", upload: true };
  for (const a of argv) {
    if (a === "--no-upload") args.upload = false;
    else if (a.startsWith("--")) { const [k, v] = a.slice(2).split("="); args[k] = v ?? true; }
    else args._.push(a);
  }
  return args;
}

function fail(msg) { console.error(`\n✖ ${msg}\n`); process.exit(1); }

// Detect missing external tools up front and print install instructions.
function assertTools(names) {
  const missing = names.filter((n) => {
    try { execFileSync("which", [n], { stdio: "ignore" }); return false; }
    catch { return true; }
  });
  if (missing.length) fail(`Missing required tool(s): ${missing.join(", ")}\n  Install with: brew install ${missing.join(" ")}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = args._[0];
  if (!inputDir) fail("Usage: segment-song.js <input-dir> --id=<id> --project=<pid> --title=… --artist=…");
  for (const req of ["id", "project", "title", "artist"]) if (!args[req]) fail(`Missing required --${req}`);
  assertTools(["ffmpeg", "ffprobe", "audiowaveform", ...(args.upload ? ["rclone"] : [])]);

  const id = safeId(args.id), project = safeId(args.project);
  if (args.upload) {
    // The project must already exist (admin tool, or the migration for toxic-avenger), and a song id
    // can't move between projects. Skipped for --no-upload, which never touches R2.
    if (!(await readRemoteJsonIfExists(args.bucket, `projects/${project}/project.json`))) {
      fail(`Project "${project}" doesn't exist on R2 (projects/${project}/project.json). Create it first.`);
    }
    assertSongOwnership(await readRemoteJsonIfExists(args.bucket, `songs/${id}/manifest.json`), project);
  }

  const outRoot = join("dist", "songs", id);
  await segmentSong({ inputDir, id, project, title: args.title, artist: args.artist, bitrate: args.bitrate, outRoot, onLog: (m) => console.log(m) });
  console.log(`✔ wrote ${join(outRoot, "manifest.json")}`);

  if (args.upload) {
    console.log("→ uploading to R2…");
    const dest = await uploadDir(outRoot, args.bucket, `songs/${id}`);
    console.log(`✔ uploaded to ${dest}`);
    console.log("→ refreshing catalogs…");
    console.log(`✔ ${describeRefresh(await refreshRemoteCatalog(args.bucket))}`);
  } else {
    console.log("• skipped upload (--no-upload)");
  }
}

main().catch((e) => fail(e.message));
