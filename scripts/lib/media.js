import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
const run = promisify(execFile);

export async function probeDuration(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]);
  const seconds = parseFloat(stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe could not read duration of ${file}`);
  return seconds;
}

export async function segmentToHls(file, outDir, bitrate = "128k") {
  await mkdir(outDir, { recursive: true });
  await run("ffmpeg", [
    "-y", "-i", file, "-vn", "-ac", "2", "-c:a", "aac", "-b:a", bitrate,
    "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
    "-hls_segment_type", "mpegts",
    "-hls_segment_filename", `${outDir}/seg_%03d.ts`,
    `${outDir}/audio.m3u8`,
  ]);
}

export async function generateWaveform(file, outPath) {
  await run("audiowaveform", [
    "-i", file, "-o", outPath,
    "--output-format", "json", "--pixels-per-second", "20", "--bits", "8",
  ]);
}
