import { test } from "node:test";
import assert from "node:assert/strict";
import { reorderStems, editMeta, addStem, renameStem, removeStem } from "../manifest-ops.js";

const base = () => ({
  schemaVersion: 1, id: "song", title: "Song", artist: "AB", durationSeconds: 200,
  stems: [
    { name: "Drums", slug: "drums", seconds: 200, src: "drums/audio.m3u8", waveform: "drums/waveform.json" },
    { name: "Bass", slug: "bass", seconds: 180, src: "bass/audio.m3u8", waveform: "bass/waveform.json" },
  ],
});

test("reorderStems reorders to match the given slug order", () => {
  const m = reorderStems(base(), ["bass", "drums"]);
  assert.deepEqual(m.stems.map((s) => s.slug), ["bass", "drums"]);
});

test("reorderStems rejects a slug set that does not match exactly", () => {
  assert.throws(() => reorderStems(base(), ["bass"]), /stem set/i);
  assert.throws(() => reorderStems(base(), ["bass", "drums", "ghost"]), /stem set/i);
  assert.throws(() => reorderStems(base(), ["bass", "vocals"]), /stem set/i);
});

test("reorderStems does not mutate the input", () => {
  const m = base();
  reorderStems(m, ["bass", "drums"]);
  assert.deepEqual(m.stems.map((s) => s.slug), ["drums", "bass"]);
});

test("editMeta replaces only the provided keys", () => {
  assert.equal(editMeta(base(), { title: "New" }).title, "New");
  assert.equal(editMeta(base(), { title: "New" }).artist, "AB");
  assert.equal(editMeta(base(), { artist: "Z" }).artist, "Z");
});

test("addStem appends with seconds and bumps durationSeconds", () => {
  const m = addStem(base(), { name: "Synth", slug: "synth", seconds: 250, src: "synth/audio.m3u8", waveform: "synth/waveform.json" });
  assert.equal(m.stems.length, 3);
  assert.deepEqual(m.stems[2], { name: "Synth", slug: "synth", seconds: 250, src: "synth/audio.m3u8", waveform: "synth/waveform.json" });
  assert.equal(m.durationSeconds, 250);
});

test("addStem stores the content rev and versioned paths when provided", () => {
  const m = addStem(base(), {
    name: "Synth", slug: "synth", seconds: 120, rev: "deadbeef01",
    src: "synth/deadbeef01/audio.m3u8", waveform: "synth/deadbeef01/waveform.json",
  });
  assert.deepEqual(m.stems[2], {
    name: "Synth", slug: "synth", seconds: 120, rev: "deadbeef01",
    src: "synth/deadbeef01/audio.m3u8", waveform: "synth/deadbeef01/waveform.json",
  });
});

test("addStem keeps durationSeconds when new stem is shorter", () => {
  assert.equal(addStem(base(), { name: "Tamb", slug: "tamb", seconds: 90, src: "tamb/audio.m3u8", waveform: "tamb/waveform.json" }).durationSeconds, 200);
});

test("addStem rejects duplicate or empty slug", () => {
  assert.throws(() => addStem(base(), { name: "Dup", slug: "drums", seconds: 10 }), /exists/i);
  assert.throws(() => addStem(base(), { name: "X", slug: "", seconds: 10 }), /empty|invalid/i);
});

test("addStem rejects a missing/non-numeric seconds", () => {
  assert.throws(() => addStem(base(), { name: "X", slug: "x" }), /seconds required/i);
  assert.throws(() => addStem(base(), { name: "X", slug: "x", seconds: "10" }), /seconds required/i);
});

test("renameStem changes the label, keeps slug, rejects unknown/empty", () => {
  const m = renameStem(base(), "drums", "Drum Kit");
  assert.equal(m.stems[0].name, "Drum Kit");
  assert.equal(m.stems[0].slug, "drums");
  assert.throws(() => renameStem(base(), "ghost", "X"), /unknown/i);
  assert.throws(() => renameStem(base(), "drums", "  "), /empty/i);
});

test("removeStem drops the stem and recomputes durationSeconds from remaining seconds", () => {
  const m = removeStem(base(), "drums"); // drops the 200s stem; remaining max is 180
  assert.deepEqual(m.stems.map((s) => s.slug), ["bass"]);
  assert.equal(m.durationSeconds, 180);
});

test("removeStem leaves durationSeconds unchanged when a remaining stem lacks seconds (legacy)", () => {
  const legacy = base();
  delete legacy.stems[1].seconds; // bass has no seconds
  const m = removeStem(legacy, "drums");
  assert.equal(m.durationSeconds, 200); // unchanged: cannot safely recompute
});

test("removeStem rejects unknown slug and removing the last stem", () => {
  assert.throws(() => removeStem(base(), "ghost"), /unknown/i);
  const one = base(); one.stems = [one.stems[0]];
  assert.throws(() => removeStem(one, "drums"), /last stem/i);
});
