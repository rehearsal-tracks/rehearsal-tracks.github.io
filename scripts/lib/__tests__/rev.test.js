import { test } from "node:test";
import assert from "node:assert/strict";
import { revOf, fileRev, REV_LENGTH } from "../rev.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("revOf is deterministic and REV_LENGTH hex chars", () => {
  const a = revOf("the same bytes");
  const b = revOf("the same bytes");
  assert.equal(a, b);
  assert.equal(a.length, REV_LENGTH);
  assert.match(a, /^[0-9a-f]+$/);
});

test("revOf differs for different content (so replaced stems get new urls)", () => {
  assert.notEqual(revOf("stem version one"), revOf("stem version two"));
});

test("fileRev matches revOf of the file's bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rev-test-"));
  try {
    const path = join(dir, "stem.bin");
    const bytes = "pretend this is a wav";
    await writeFile(path, bytes);
    assert.equal(await fileRev(path), revOf(bytes));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
