// js/lib/__tests__/safe-id.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeId } from "../safe-id.js";
import { safeId } from "../../../scripts/lib/safe-path.js";

const SAMPLES = ["toxic-avenger", "a", "0x", "song-1", "-a", "A", "a/b", "..", "a.b", "", "a b", "a_b", null, undefined, 7, "@picker"];

test("isSafeId accepts exactly what the scripts' safeId accepts", () => {
  for (const s of SAMPLES) {
    let scripts = true;
    try { safeId(s); } catch { scripts = false; }
    assert.equal(isSafeId(s), scripts, JSON.stringify(s));
  }
});

test("isSafeId basics", () => {
  assert.equal(isSafeId("toxic-avenger"), true);
  assert.equal(isSafeId("../x"), false);
  assert.equal(isSafeId("@picker"), false);
});
