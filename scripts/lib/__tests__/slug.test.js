import { test } from "node:test";
import assert from "node:assert/strict";
import { stemNameFromFilename, toSlug } from "../slug.js";

test("toSlug lowercases, trims, and hyphenates", () => {
  assert.equal(toSlug("Lead Vocal"), "lead-vocal");
  assert.equal(toSlug("  Bass (DI) "), "bass-di");
  assert.equal(toSlug("Drums_01"), "drums-01");
});

test("stemNameFromFilename strips extension and path", () => {
  assert.equal(stemNameFromFilename("/x/Lead Vocal.wav"), "Lead Vocal");
  assert.equal(stemNameFromFilename("bass.mp3"), "bass");
});

test("toSlug collapses repeats and strips edge hyphens", () => {
  assert.equal(toSlug("--A  &  B--"), "a-b");
});
