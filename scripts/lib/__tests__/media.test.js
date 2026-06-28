import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { probeDuration, segmentToHls, generateWaveform } from "../media.js";

let dir, wav;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "media-test-"));
  wav = join(dir, "tone.wav");
  // 3-second 440Hz tone via ffmpeg's sine source
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", wav]);
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
  await access(join(out, "seg_000.ts")); // throws if missing
});

test("generateWaveform writes parseable JSON", async () => {
  const wf = join(dir, "waveform.json");
  await generateWaveform(wav, wf);
  const parsed = JSON.parse(await readFile(wf, "utf8"));
  assert.ok(parsed); // shape validated against stemplayer-js in Task 9
});
