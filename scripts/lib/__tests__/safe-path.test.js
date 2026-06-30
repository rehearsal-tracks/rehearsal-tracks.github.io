import { test } from "node:test";
import assert from "node:assert/strict";
import { safeId, safeFilename } from "../safe-path.js";

test("safeId accepts lowercase slug-shaped ids", () => {
  assert.equal(safeId("caterpillar"), "caterpillar");
  assert.equal(safeId("toxic-avenger-2"), "toxic-avenger-2");
});

test("safeId rejects traversal, separators, and rclone-significant chars", () => {
  for (const bad of ["..", "../x", "a/b", "a\\b", "a:b", "-lead", "Lead", "a b", "", "a..b"]) {
    assert.throws(() => safeId(bad), /invalid id/i, `should reject ${JSON.stringify(bad)}`);
  }
});

test("safeFilename accepts a base name with a single extension", () => {
  assert.equal(safeFilename("01 Drums.wav"), "01 Drums.wav");
  assert.equal(safeFilename("bass-DI.flac"), "bass-DI.flac");
});

test("safeFilename rejects traversal, slashes, leading dots, missing/extra extension", () => {
  for (const bad of ["..", "../x.wav", "a/b.wav", "a\\b.wav", ".hidden.wav", "noext", "a..b.wav", ""]) {
    assert.throws(() => safeFilename(bad), /invalid filename/i, `should reject ${JSON.stringify(bad)}`);
  }
});
