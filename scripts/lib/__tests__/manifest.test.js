import { test } from "node:test";
import assert from "node:assert/strict";
import { buildManifest } from "../manifest.js";

test("builds manifest matching schema v1 with content-versioned media paths", () => {
  const m = buildManifest({
    id: "midnight",
    title: "Midnight",
    artist: "Andrew Bray",
    stems: [
      { name: "Lead Vocal", slug: "lead-vocal", seconds: 612.4, rev: "a1b2c3d4e5" },
      { name: "Bass", slug: "bass", seconds: 612.39, rev: "f6e5d4c3b2" },
    ],
  });
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.id, "midnight");
  assert.equal(m.durationSeconds, 612.4); // max of stem durations
  assert.deepEqual(m.stems[0], {
    name: "Lead Vocal",
    slug: "lead-vocal",
    seconds: 612.4,
    rev: "a1b2c3d4e5",
    src: "lead-vocal/a1b2c3d4e5/audio.m3u8",
    waveform: "lead-vocal/a1b2c3d4e5/waveform.json",
  });
});

test("throws when a stem is missing its content rev", () => {
  assert.throws(
    () => buildManifest({ id: "x", title: "X", artist: "Y", stems: [{ name: "Bass", slug: "bass", seconds: 180.5 }] }),
    /missing a content rev/i
  );
});

test("persists seconds on every stem (needed for later edits)", () => {
  const m = buildManifest({
    id: "x", title: "X", artist: "Y",
    stems: [{ name: "Bass", slug: "bass", seconds: 180.5, rev: "0011223344" }],
  });
  assert.equal(m.stems[0].seconds, 180.5);
});

test("durationSeconds is the max even when the longest stem is not first", () => {
  const m = buildManifest({
    id: "x", title: "X", artist: "Y",
    stems: [
      { name: "Short", slug: "short", seconds: 100.0, rev: "aaaaaaaaaa" },
      { name: "Long", slug: "long", seconds: 100.04, rev: "bbbbbbbbbb" },
    ],
  });
  assert.equal(m.durationSeconds, 100.04);
});
