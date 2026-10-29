// js/lib/__tests__/project-downloads.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadProject } from "../project-downloads.js";

const songs = ["a", "b", "c", "d"].map((id) => ({ id, title: id.toUpperCase() }));

function harness({ have = [], fail = {}, quota } = {}) {
  const calls = [];
  const progress = [];
  return {
    calls, progress,
    opts: {
      isDownloaded: async (s) => have.includes(s.id),
      downloadSong: async (s) => {
        calls.push(s.id);
        if (s.id === quota) { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }
        if (fail[s.id]) throw new Error(fail[s.id]);
      },
      shouldStop: (e) => e.name === "QuotaExceededError",
      onProgress: (p) => progress.push({ done: p.done, total: p.total, current: p.current?.id ?? null }),
    },
  };
}

test("downloads only missing songs, one at a time, in order", async () => {
  const h = harness({ have: ["b"] });
  const r = await downloadProject(songs, h.opts);
  assert.deepEqual(h.calls, ["a", "c", "d"]);
  assert.deepEqual(r, { total: 3, failed: [] });
  assert.deepEqual(h.progress[0], { done: 0, total: 3, current: null });
  assert.deepEqual(h.progress.at(-1), { done: 3, total: 3, current: null });
  assert.ok(h.progress.some((p) => p.current === "c" && p.done === 1));
});

test("a failed song doesn't stop the rest; failures are reported", async () => {
  const h = harness({ fail: { b: "404" } });
  const r = await downloadProject(songs, h.opts);
  assert.deepEqual(h.calls, ["a", "b", "c", "d"]);
  assert.deepEqual(r.failed.map((f) => [f.song.id, f.error.message]), [["b", "404"]]);
});

test("a quota error stops early and marks the rest failed", async () => {
  const h = harness({ quota: "b" });
  const r = await downloadProject(songs, h.opts);
  assert.deepEqual(h.calls, ["a", "b"]);
  assert.deepEqual(r.failed.map((f) => f.song.id), ["b", "c", "d"]);
  assert.ok(r.failed.every((f) => f.error.name === "QuotaExceededError"));
});

test("nothing to do → total 0", async () => {
  const h = harness({ have: ["a", "b", "c", "d"] });
  assert.deepEqual(await downloadProject(songs, h.opts), { total: 0, failed: [] });
  assert.deepEqual(h.calls, []);
});

test("an isDownloaded error counts as not downloaded; onProgress/shouldStop are optional", async () => {
  const calls = [];
  const r = await downloadProject(songs.slice(0, 1), {
    isDownloaded: async () => { throw new Error("no caches"); },
    downloadSong: async (s) => { calls.push(s.id); },
  });
  assert.deepEqual(calls, ["a"]);
  assert.deepEqual(r, { total: 1, failed: [] });
});
