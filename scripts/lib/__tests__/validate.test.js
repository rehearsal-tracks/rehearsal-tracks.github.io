import { test } from "node:test";
import assert from "node:assert/strict";
import { lengthReport } from "../validate.js";

test("reports spread in ms and includes a table", () => {
  const r = lengthReport([{ name: "a", seconds: 100.0 }, { name: "b", seconds: 100.2 }]);
  assert.equal(r.spreadMs, 200);
  assert.equal(r.min, 100.0);
  assert.equal(r.max, 100.2);
  assert.match(r.table, /a/);
  assert.match(r.table, /b/);
});

test("does not throw for unequal lengths (no longer a gate)", () => {
  assert.doesNotThrow(() => lengthReport([{ name: "a", seconds: 10 }, { name: "b", seconds: 600 }]));
});

test("single stem reports zero spread", () => {
  const r = lengthReport([{ name: "a", seconds: 42 }]);
  assert.equal(r.spreadMs, 0);
});

test("throws on empty input", () => {
  assert.throws(() => lengthReport([]), /no stems/i);
});
