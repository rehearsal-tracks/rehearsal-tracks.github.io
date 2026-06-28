import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, refreshCatalog } from "../catalog.js";

const manifestA = { id: "brand-new-day", title: "A Brand New Day", artist: "AB", durationSeconds: 612.4, stems: [{}, {}, {}] };
const manifestZ = { id: "zephyr", title: "Zephyr", artist: "AB", durationSeconds: 100, stems: [{}] };

test("buildCatalog maps fields and derives stemCount", () => {
  const c = buildCatalog([manifestA]);
  assert.equal(c.schemaVersion, 1);
  assert.deepEqual(c.songs[0], {
    id: "brand-new-day", title: "A Brand New Day", artist: "AB", durationSeconds: 612.4, stemCount: 3,
  });
});

test("buildCatalog sorts by title case-insensitively", () => {
  const c = buildCatalog([manifestZ, manifestA]);
  assert.deepEqual(c.songs.map((s) => s.id), ["brand-new-day", "zephyr"]);
});

test("buildCatalog handles a manifest with no stems array", () => {
  const c = buildCatalog([{ id: "x", title: "X", artist: "AB", durationSeconds: 0 }]);
  assert.equal(c.songs[0].stemCount, 0);
});

test("refreshCatalog aggregates manifests and writes once", async () => {
  const writes = [];
  const c = await refreshCatalog({
    listSongIds: async () => ["brand-new-day", "zephyr"],
    readManifest: async (id) => (id === "zephyr" ? manifestZ : manifestA),
    writeCatalog: async (cat) => { writes.push(cat); },
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0], c);
  assert.deepEqual(c.songs.map((s) => s.id), ["brand-new-day", "zephyr"]);
});

test("refreshCatalog skips songs whose manifest is unreadable", async () => {
  const c = await refreshCatalog({
    listSongIds: async () => ["good", "bad"],
    readManifest: async (id) => {
      if (id === "bad") throw new Error("404");
      return manifestA;
    },
    writeCatalog: async () => {},
  });
  assert.deepEqual(c.songs.map((s) => s.id), ["brand-new-day"]);
});
