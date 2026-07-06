import { test } from "node:test";
import assert from "node:assert/strict";
import { findOrphans, isVersioned, referencedGroups } from "../prune.js";

const versioned = () => ({
  schemaVersion: 1, id: "song", title: "S", artist: "A", durationSeconds: 200,
  stems: [
    { name: "Drums", slug: "drums", seconds: 200, rev: "aaaa111111", src: "drums/aaaa111111/audio.m3u8", waveform: "drums/aaaa111111/waveform.json" },
    { name: "Bass", slug: "bass", seconds: 180, rev: "bbbb222222", src: "bass/bbbb222222/audio.m3u8", waveform: "bass/bbbb222222/waveform.json" },
  ],
});

const legacy = () => ({
  schemaVersion: 1, id: "song", title: "S", artist: "A", durationSeconds: 200,
  stems: [{ name: "Drums", slug: "drums", seconds: 200, src: "drums/audio.m3u8", waveform: "drums/waveform.json" }],
});

test("isVersioned true only when every stem src has a rev segment", () => {
  assert.equal(isVersioned(versioned()), true);
  assert.equal(isVersioned(legacy()), false);
});

test("referencedGroups collects each stem's <slug>/<rev> group", () => {
  assert.deepEqual([...referencedGroups(versioned())].sort(), ["bass/bbbb222222", "drums/aaaa111111"]);
});

test("findOrphans flags files from unreferenced (old) revs, keeps current + manifest.json", () => {
  const files = [
    "manifest.json",
    "drums/aaaa111111/audio.m3u8",   // current — keep
    "drums/aaaa111111/seg_000.mp3",  // current — keep
    "drums/0000oldrev0/audio.m3u8",  // stale rev — orphan
    "drums/0000oldrev0/seg_000.mp3", // stale rev — orphan
    "bass/bbbb222222/audio.m3u8",    // current — keep
  ];
  const { skip, orphans } = findOrphans(versioned(), files);
  assert.equal(skip, false);
  assert.deepEqual(orphans.sort(), ["drums/0000oldrev0/audio.m3u8", "drums/0000oldrev0/seg_000.mp3"]);
});

test("findOrphans refuses to prune a not-yet-versioned manifest", () => {
  const { skip, orphans, reason } = findOrphans(legacy(), ["drums/audio.m3u8", "drums/seg_000.mp3"]);
  assert.equal(skip, true);
  assert.deepEqual(orphans, []);
  assert.match(reason, /not versioned/i);
});
