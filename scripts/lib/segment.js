// scripts/lib/segment.js — reusable segmentation core shared by the CLI and the admin server.
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { toSlug } from "./slug.js";
import { parseStem } from "./ordering.js";
import { lengthReport } from "./validate.js";
import { buildManifest } from "./manifest.js";
import { probeDuration, segmentToHls, generateWaveform } from "./media.js";
import { fileRev } from "./rev.js";

export const AUDIO_EXT = new Set([".wav", ".mp3", ".flac", ".aiff", ".aif", ".m4a"]);

// Segment one audio file into <outRoot>/<slug>/<rev>/ (audio.m3u8 + segments + waveform.json),
// where <rev> is a content hash of the source file so replaced stems land at a fresh, cache-safe
// url (see rev.js). Pass a precomputed `rev` to reuse a hash already taken; otherwise it's derived
// from the file. Returns { stemDir, rev } — callers need the rev to build the manifest paths.
export async function segmentStem({ file, slug, outRoot, bitrate = "128k", rev }) {
  const stemRev = rev ?? (await fileRev(file));
  const stemDir = join(outRoot, slug, stemRev);
  await segmentToHls(file, stemDir, bitrate);
  await generateWaveform(file, join(stemDir, "waveform.json"));
  return { stemDir, rev: stemRev };
}

// Discover, probe, sort, segment all stems in inputDir and write manifest.json.
// Returns { manifest, outRoot, stems, report }. onLog is an optional progress sink
// (defaults to a no-op) so the CLI keeps its output and the server can stay quiet.
export async function segmentSong({ inputDir, id, title, artist, bitrate = "128k", outRoot, onLog = () => {} }) {
  const audioFiles = [];
  for (const f of await readdir(inputDir)) {
    if (AUDIO_EXT.has(extname(f).toLowerCase())) audioFiles.push(join(inputDir, f));
    else onLog(`• skipping non-audio file: ${f}`);
  }
  if (audioFiles.length === 0) throw new Error(`No audio files found in ${inputDir}`);

  const stems = [];
  for (const file of audioFiles) {
    const { order, name } = parseStem(file);
    try {
      stems.push({ file, order, name, slug: toSlug(name), seconds: await probeDuration(file) });
    } catch (e) {
      onLog(`• skipping unreadable file ${file}: ${e.message}`);
    }
  }
  if (stems.length === 0) throw new Error("No readable audio stems remain after probing.");

  stems.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.file.localeCompare(b.file));

  const seen = new Map();
  for (const s of stems) {
    if (!s.slug) throw new Error(`Stem "${s.name}" has an empty slug. Rename it.`);
    if (seen.has(s.slug)) throw new Error(`Stem name collision: "${s.name}" and "${seen.get(s.slug)}" both slug to "${s.slug}". Rename one.`);
    seen.set(s.slug, s.name);
  }

  const report = lengthReport(stems);
  onLog(`Stems (${stems.length}):\n${report.table}`);
  if (report.spreadMs > 0) onLog(`• stems differ by ${report.spreadMs}ms; shorter stems will end early (common zero-start).`);

  await mkdir(outRoot, { recursive: true });
  for (const s of stems) {
    onLog(`→ segmenting ${s.name}`);
    const { rev } = await segmentStem({ file: s.file, slug: s.slug, outRoot, bitrate });
    s.rev = rev; // buildManifest reads this to form the versioned src/waveform paths
  }

  const manifest = buildManifest({ id, title, artist, stems });
  await writeFile(join(outRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { manifest, outRoot, stems, report };
}
