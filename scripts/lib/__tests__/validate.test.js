import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEqualLength } from "../validate.js";

test("passes when spread within tolerance", () => {
  const r = checkEqualLength([{ name: "a", seconds: 100.00 }, { name: "b", seconds: 100.03 }], 50);
  assert.equal(r.ok, true);
  assert.equal(r.spreadMs, 30);
});

test("fails when spread exceeds tolerance", () => {
  const r = checkEqualLength([{ name: "a", seconds: 100.0 }, { name: "b", seconds: 100.2 }], 50);
  assert.equal(r.ok, false);
  assert.equal(r.spreadMs, 200);
  assert.match(r.table, /a/);
  assert.match(r.table, /b/);
});

test("single stem always passes with zero spread", () => {
  assert.deepEqual(checkEqualLength([{ name: "a", seconds: 42 }], 50).ok, true);
});

test("throws on empty input", () => {
  assert.throws(() => checkEqualLength([], 50), /no stems/i);
});
