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

// In-memory R2 for refreshCatalog: records every write.
function fakeIO({ projects = {}, songs = {}, failProject, failSong } = {}) {
  const writes = { projectCatalogs: {}, index: [], legacy: [] };
  const warnings = [];
  return {
    writes, warnings,
    io: {
      listProjectIds: async () => Object.keys(projects),
      readProject: async (pid) => { if (pid === failProject) throw new Error("boom"); return projects[pid] ?? null; },
      listSongIds: async () => Object.keys(songs),
      readManifest: async (id) => { if (id === failSong) throw new Error("404"); return songs[id]; },
      writeProjectCatalog: async (pid, c) => { writes.projectCatalogs[pid] = c; },
      writeProjectsIndex: async (i) => { writes.index.push(i); },
      writeLegacyCatalog: async (c) => { writes.legacy.push(c); },
      warn: (m) => warnings.push(m),
    },
  };
}

test("refreshCatalog writes one catalog per project, the index and the legacy catalog", async () => {
  const { io, writes } = fakeIO({
    projects: {
      "toxic-avenger": { id: "toxic-avenger", name: "Toxic", listed: true, songOrder: ["b"] },
      secret: { id: "secret", name: "Secret" },
    },
    songs: { a: song("a", "A", "toxic-avenger"), b: song("b", "B", "toxic-avenger"), s: song("s", "S", "secret") },
  });
  const r = await refreshCatalog(io);
  assert.deepEqual(writes.projectCatalogs["toxic-avenger"].songs.map((s) => s.id), ["b", "a"]);
  assert.deepEqual(writes.projectCatalogs.secret.songs.map((s) => s.id), ["s"]);
  assert.deepEqual(writes.index, [{ schemaVersion: 1, projects: [{ id: "toxic-avenger", name: "Toxic" }] }]);
  assert.deepEqual(writes.legacy[0].songs.map((s) => s.id), ["a", "b"]); // never the unlisted project's song
  assert.equal(r.projects.secret, writes.projectCatalogs.secret);
  assert.equal(r.index, writes.index[0]);
  assert.equal(r.legacy, writes.legacy[0]);
  assert.equal(r.songCount, 3);
});

test("refreshCatalog writes an empty catalog for a project with no songs", async () => {
  const { io, writes } = fakeIO({ projects: { show: { id: "show", name: "Show" } } });
  await refreshCatalog(io);
  assert.deepEqual(writes.projectCatalogs.show.songs, []);
});

test("refreshCatalog warns about songs with no or unknown project and keeps them out of project catalogs", async () => {
  const { io, writes, warnings } = fakeIO({
    projects: { show: { id: "show", name: "Show" } },
    songs: { lone: song("lone", "Lone"), stray: song("stray", "Stray", "gone") },
  });
  await refreshCatalog(io);
  assert.deepEqual(writes.projectCatalogs.show.songs, []);
  assert.equal(warnings.length, 2);
  assert.match(warnings.join("\n"), /lone.*no project/);
  assert.match(warnings.join("\n"), /stray.*unknown project "gone"/);
  assert.deepEqual(writes.legacy[0].songs.map((s) => s.id), ["lone"]); // pre-migration safety
});

test("refreshCatalog works before the migration (no projects at all)", async () => {
  const { io, writes } = fakeIO({ songs: { a: song("a", "A"), b: song("b", "B") } });
  await refreshCatalog(io);
  assert.deepEqual(writes.projectCatalogs, {});
  assert.deepEqual(writes.index, [{ schemaVersion: 1, projects: [] }]);
  assert.deepEqual(writes.legacy[0].songs.map((s) => s.id), ["a", "b"]);
});

test("refreshCatalog skips unreadable manifests with a warning", async () => {
  const { io, writes, warnings } = fakeIO({ songs: { good: song("good", "Good"), bad: song("bad", "Bad") }, failSong: "bad" });
  await refreshCatalog(io);
  assert.deepEqual(writes.legacy[0].songs.map((s) => s.id), ["good"]);
  assert.match(warnings[0], /skipping bad/);
});

test("refreshCatalog warns and skips a project folder with no project.json", async () => {
  const { io, writes, warnings } = fakeIO({ projects: { show: { id: "show", name: "Show" }, leftover: null } });
  await refreshCatalog(io);
  assert.deepEqual(Object.keys(writes.projectCatalogs), ["show"]);
  assert.match(warnings[0], /leftover.*no project\.json/);
});

test("refreshCatalog aborts without writing anything when a project can't be read or is invalid", async () => {
  for (const projects of [
    { show: { id: "show", name: "Show" }, broken: {} },               // invalid
    { show: { id: "show", name: "Show" }, other: { id: "x", name: "X" } }, // id/folder mismatch
  ]) {
    const { io, writes } = fakeIO({ projects });
    await assert.rejects(refreshCatalog(io));
    assert.deepEqual(writes, { projectCatalogs: {}, index: [], legacy: [] });
  }
  const { io, writes } = fakeIO({ projects: { show: { id: "show", name: "Show" } }, failProject: "show" });
  await assert.rejects(refreshCatalog(io), /boom/);
  assert.deepEqual(writes.index, []);
});
