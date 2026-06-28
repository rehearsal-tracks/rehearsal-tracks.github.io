import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
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
  const input = resolve(file);
  // audiowaveform cannot read AAC/m4a (and several other) containers — it only handles
  // WAV/MP3/FLAC/Ogg/Opus. Decode to a temp WAV via ffmpeg first so any ffmpeg-readable
  // input works uniformly.
  const tmp = await mkdtemp(join(tmpdir(), "waveform-"));
  const wav = join(tmp, "audio.wav");
  try {
    await run("ffmpeg", ["-y", "-v", "error", "-i", input, wav]);
    await run("audiowaveform", [
      "-i", wav, "-o", outPath,
      "--output-format", "json", "--pixels-per-second", "20", "--bits", "8",
    ]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
