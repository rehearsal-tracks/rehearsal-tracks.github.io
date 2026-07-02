import { test } from "node:test";
import assert from "node:assert/strict";
import { parseM3u8 } from "../prefetch.js";

const BASE = "https://cdn.example/songs/x/vocals/audio.m3u8";

test("parseM3u8 builds cumulative segment times and absolute URLs", () => {
  const m3u8 = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:6",
    "#EXTINF:6.000000,",
    "seg_000.mp3",
    "#EXTINF:6.000000,",
    "seg_001.mp3",
    "#EXTINF:2.500000,", // last segment is short
    "seg_002.mp3",
    "#EXT-X-ENDLIST",
    "",
  ].join("\n");

  const segs = parseM3u8(m3u8, BASE);
  assert.equal(segs.length, 3);
  assert.deepEqual(segs[0], { url: "https://cdn.example/songs/x/vocals/seg_000.mp3", start: 0, end: 6 });
  assert.deepEqual(segs[1], { url: "https://cdn.example/songs/x/vocals/seg_001.mp3", start: 6, end: 12 });
  assert.deepEqual(segs[2], { url: "https://cdn.example/songs/x/vocals/seg_002.mp3", start: 12, end: 14.5 });
});

test("parseM3u8 ignores blank lines and unknown tags, resolving names relative to the playlist", () => {
  const segs = parseM3u8("#EXTINF:6,\nseg_000.mp3\n", BASE);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].url, "https://cdn.example/songs/x/vocals/seg_000.mp3");
});

test("parseM3u8 returns an empty list for a playlist with no segments", () => {
  assert.deepEqual(parseM3u8("#EXTM3U\n#EXT-X-ENDLIST\n", BASE), []);
});
