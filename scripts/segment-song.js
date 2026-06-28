#!/usr/bin/env node
// Usage: node scripts/segment-song.js <input-dir> --id=<id> --title="…" --artist="…" [--bitrate=128k] [--no-upload] [--bucket=stem-player]
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, extname } from "node:path";
import { stemNameFromFilename, toSlug } from "./lib/slug.js";
import { checkEqualLength } from "./lib/validate.js";
import { buildManifest } from "./lib/manifest.js";
import { probeDuration, segmentToHls, generateWaveform } from "./lib/media.js";
import { uploadDir } from "./lib/upload.js";

const TOLERANCE_MS = 50;
const AUDIO_EXT = new Set([".wav", ".mp3", ".flac", ".aiff", ".aif", ".m4a"]);

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

// Spec §8: detect missing external tools up front and print install instructions.
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
  if (!inputDir) fail("Usage: segment-song.js <input-dir> --id=<id> --title=… --artist=…");
  for (const req of ["id", "title", "artist"]) if (!args[req]) fail(`Missing required --${req}`);

  assertTools(["ffmpeg", "ffprobe", "audiowaveform", ...(args.upload ? ["rclone"] : [])]);

  // Discover stems; warn about (and skip) non-audio files. Spec §8.
  const audioFiles = [];
  for (const f of await readdir(inputDir)) {
    if (AUDIO_EXT.has(extname(f).toLowerCase())) audioFiles.push(join(inputDir, f));
    else console.warn(`• skipping non-audio file: ${f}`);
  }
  if (audioFiles.length === 0) fail(`No audio files found in ${inputDir}`);

  // Probe durations; skip unreadable files with a warning, abort if none remain. Spec §8.
  const stems = [];
  for (const file of audioFiles) {
    const name = stemNameFromFilename(file);
    try {
      stems.push({ file, name, slug: toSlug(name), seconds: await probeDuration(file) });
    } catch (e) {
      console.warn(`• skipping unreadable file ${file}: ${e.message}`);
    }
  }
  if (stems.length === 0) fail("No readable audio stems remain after probing.");

  // Guard against slug collisions (would clobber output dirs and manifest entries).
  const seenSlugs = new Map();
  for (const s of stems) {
    if (seenSlugs.has(s.slug)) fail(`Stem name collision: "${s.name}" and "${seenSlugs.get(s.slug)}" both slug to "${s.slug}". Rename one.`);
    seenSlugs.set(s.slug, s.name);
  }

  const v = checkEqualLength(stems, TOLERANCE_MS);
  console.log(`Stems (${stems.length}):\n${v.table}`);
  if (!v.ok) fail(`Stem lengths differ by ${v.spreadMs}ms (tolerance ${TOLERANCE_MS}ms). Re-export equal-length stems.`);

  // Build output tree
  const outRoot = join("dist", "songs", args.id);
  await mkdir(outRoot, { recursive: true });
  for (const s of stems) {
    const stemDir = join(outRoot, s.slug);
    console.log(`→ segmenting ${s.name}`);
    await segmentToHls(s.file, stemDir, args.bitrate);
    await generateWaveform(s.file, join(stemDir, "waveform.json"));
  }
  const manifest = buildManifest({ id: args.id, title: args.title, artist: args.artist, stems });
  await writeFile(join(outRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`✔ wrote ${join(outRoot, "manifest.json")}`);

  if (args.upload) {
    console.log("→ uploading to R2…");
    const dest = await uploadDir(outRoot, args.bucket, `songs/${args.id}`);
    console.log(`✔ uploaded to ${dest}`);
  } else {
    console.log("• skipped upload (--no-upload)");
  }
}

main().catch((e) => fail(e.message));
