import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { probeDuration, segmentToHls, generateWaveform } from "../media.js";

let dir, wav, m4a;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "media-test-"));
  wav = join(dir, "tone.wav");
  // 3-second 440Hz tone via ffmpeg's sine source
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", wav]);
  // an AAC/m4a copy — audiowaveform cannot read this directly, so it exercises the
  // ffmpeg-decode-to-wav path in generateWaveform.
  m4a = join(dir, "tone.m4a");
  execFileSync("ffmpeg", ["-y", "-i", wav, "-c:a", "aac", m4a]);
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

test("probeDuration returns ~3s", async () => {
  const s = await probeDuration(wav);
  assert.ok(Math.abs(s - 3) < 0.1, `expected ~3s, got ${s}`);
});

test("segmentToHls writes a playlist and at least one segment", async () => {
  const out = join(dir, "hls");
  await segmentToHls(wav, out, "128k");
  const playlist = await readFile(join(out, "audio.m3u8"), "utf8");
  assert.match(playlist, /#EXTM3U/);
  assert.match(playlist, /seg_000\.mp3/); // playlist references MP3 segments
  await access(join(out, "seg_000.mp3")); // throws if missing
});

test("generateWaveform writes parseable JSON", async () => {
  const wf = join(dir, "waveform.json");
  await generateWaveform(wav, wf);
  const parsed = JSON.parse(await readFile(wf, "utf8"));
  assert.ok(parsed); // shape validated against stemplayer-js in Task 9
});

test("generateWaveform handles m4a/AAC (which audiowaveform can't read directly)", async () => {
  const wf = join(dir, "waveform-m4a.json");
  await generateWaveform(m4a, wf);
  const parsed = JSON.parse(await readFile(wf, "utf8"));
  assert.ok(Array.isArray(parsed.data) && parsed.data.length > 0);
});
