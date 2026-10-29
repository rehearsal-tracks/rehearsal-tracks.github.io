import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLegacyCatalog, buildProjectCatalog, buildProjectsIndex, refreshCatalog } from "../catalog.js";

const manifestA = { id: "brand-new-day", title: "A Brand New Day", artist: "AB", durationSeconds: 612.4, stems: [{}, {}, {}] };
const manifestZ = { id: "zephyr", title: "Zephyr", artist: "AB", durationSeconds: 100, stems: [{}] };

test("buildLegacyCatalog maps fields and derives stemCount", () => {
  const c = buildLegacyCatalog([manifestA]);
  assert.equal(c.schemaVersion, 1);
  assert.deepEqual(c.songs[0], {
    id: "brand-new-day", title: "A Brand New Day", artist: "AB", durationSeconds: 612.4, stemCount: 3,
  });
});

test("buildLegacyCatalog sorts by title case-insensitively", () => {
  const c = buildLegacyCatalog([manifestZ, manifestA]);
  assert.deepEqual(c.songs.map((s) => s.id), ["brand-new-day", "zephyr"]);
});

test("buildLegacyCatalog handles a manifest with no stems array", () => {
  const c = buildLegacyCatalog([{ id: "x", title: "X", artist: "AB", durationSeconds: 0 }]);
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

const song = (id, title, project) => ({ id, title, artist: "AB", durationSeconds: 1, stems: [{}], ...(project ? { project } : {}) });
const project = (over = {}) => ({
  id: "show", name: "Show", credit: "c", listed: true, archived: false,
  theme: { preset: "toxic", overrides: {} }, songOrder: [], ...over,
});

test("buildLegacyCatalog keeps toxic-avenger and unassigned songs only", () => {
  const c = buildLegacyCatalog([song("a", "A", "toxic-avenger"), song("b", "B"), song("c", "C", "other")]);
  assert.equal(c.schemaVersion, 1);
  assert.deepEqual(c.songs.map((s) => s.id), ["a", "b"]);
});

test("buildProjectCatalog follows songOrder, appends the rest alphabetically, drops unknown ids", () => {
  const c = buildProjectCatalog(
    project({ songOrder: ["c", "ghost", "a", "c"] }),
    [song("a", "Alpha"), song("b", "bravo"), song("c", "Charlie"), song("d", "Able")],
  );
  assert.deepEqual(c.songs.map((s) => s.id), ["c", "a", "d", "b"]);
});

test("buildProjectCatalog emits schema v2 with the public project block", () => {
  const c = buildProjectCatalog(project({ archived: true }), [song("a", "A")]);
  assert.equal(c.schemaVersion, 2);
  assert.deepEqual(c.project, {
    id: "show", name: "Show", credit: "c", archived: true, theme: { preset: "toxic", overrides: {} },
  });
  assert.deepEqual(c.songs[0], { id: "a", title: "A", artist: "AB", durationSeconds: 1, stemCount: 1 });
  assert.equal("songOrder" in c.project, false);
  assert.equal("listed" in c.project, false);
});

test("buildProjectCatalog with no songs yields an empty list", () => {
  assert.deepEqual(buildProjectCatalog(project(), []).songs, []);
});

test("buildProjectsIndex lists only listed, non-archived projects, by name", () => {
  const idx = buildProjectsIndex([
    project({ id: "z", name: "zebra" }),
    project({ id: "u", name: "Unlisted", listed: false }),
    project({ id: "x", name: "Archived", archived: true }),
    project({ id: "a", name: "Aardvark" }),
  ]);
  assert.deepEqual(idx, { schemaVersion: 1, projects: [{ id: "a", name: "Aardvark" }, { id: "z", name: "zebra" }] });
});
