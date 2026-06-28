import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
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
  const input = resolve(file);
  // stemplayer-js (@firstcoders/hls-web-audio) decodes each segment with the Web Audio
  // decodeAudioData() API, which cannot read MPEG-TS containers. So emit standalone MP3
  // segments via ffmpeg's segment muxer (matching the stemplayer-js demo) rather than
  // mpegts via the hls muxer. -reset_timestamps makes each segment start at t=0 so it
  // decodes independently. Run with cwd=outDir so the playlist records relative names.
  await run("ffmpeg", [
    "-y", "-i", input, "-vn", "-ac", "2",
    "-c:a", "libmp3lame", "-b:a", bitrate,
    "-f", "segment", "-segment_time", "6",
    "-segment_format", "mp3", "-reset_timestamps", "1",
    "-segment_list", "audio.m3u8", "-segment_list_type", "m3u8",
    "seg_%03d.mp3",
  ], { cwd: outDir });
}

export async function generateWaveform(file, outPath) {
  await run("audiowaveform", [
    "-i", file, "-o", outPath,
    "--output-format", "json", "--pixels-per-second", "20", "--bits", "8",
  ]);
}
