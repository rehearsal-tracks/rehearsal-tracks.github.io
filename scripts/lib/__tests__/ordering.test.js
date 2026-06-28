import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStem } from "../ordering.js";

test("parses a hyphen-separated numeric prefix", () => {
  assert.deepEqual(parseStem("01-drums.wav"), { order: 1, name: "drums" });
});

test("parses a space-separated prefix", () => {
  assert.deepEqual(parseStem("2 bass.wav"), { order: 2, name: "bass" });
});

test("parses an underscore-separated multi-digit prefix", () => {
  assert.deepEqual(parseStem("10_vocals.wav"), { order: 10, name: "vocals" });
});

test("parses a dot-separated prefix", () => {
  assert.deepEqual(parseStem("3.piano.wav"), { order: 3, name: "piano" });
});

test("no prefix yields null order and full name", () => {
  assert.deepEqual(parseStem("vocals.wav"), { order: null, name: "vocals" });
});

test("digits without a separator are NOT treated as a prefix", () => {
  assert.deepEqual(parseStem("2nd-guitar.wav"), { order: null, name: "2nd-guitar" });
});

test("a name that is only a prefix falls back to the base (no empty name)", () => {
  // "01.wav" -> base "01"; dot is the extension, so PREFIX_RE doesn't match -> {null,"01"}.
  assert.deepEqual(parseStem("01.wav"), { order: null, name: "01" });
});

test("prefix followed by separator then nothing falls back to base name", () => {
  // "05-.wav" -> base "05-"; would strip to empty, so guard keeps base.
  assert.deepEqual(parseStem("05-.wav"), { order: 5, name: "05-" });
});

test("strips directory components before parsing", () => {
  assert.deepEqual(parseStem("/songs/in/04-synth.wav"), { order: 4, name: "synth" });
});
