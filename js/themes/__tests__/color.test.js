import { test } from "node:test";
import assert from "node:assert/strict";
import { hexToRgb, isHex } from "../color.js";

test("isHex accepts #rrggbb in either case, rejects everything else", () => {
  assert.equal(isHex("#8bff1f"), true);
  assert.equal(isHex("#8BFF1F"), true);
  for (const bad of ["8bff1f", "#8bf", "#8bff1g", "#8bff1f00", "", null, undefined, 42, "red"]) {
    assert.equal(isHex(bad), false, String(bad));
  }
});

test("hexToRgb returns an [r, g, b] triplet", () => {
  assert.deepEqual(hexToRgb("#8bff1f"), [139, 255, 31]);
  assert.deepEqual(hexToRgb("#000000"), [0, 0, 0]);
  assert.deepEqual(hexToRgb("#FFFFFF"), [255, 255, 255]);
});

test("hexToRgb throws on invalid input", () => {
  assert.throws(() => hexToRgb("#xyz"), /invalid hex/);
});
