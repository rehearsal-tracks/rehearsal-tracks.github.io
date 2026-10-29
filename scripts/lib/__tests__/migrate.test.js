import { test } from "node:test";
import assert from "node:assert/strict";
import { planMigration, stampProject, LEGACY_PROJECT } from "../migrate.js";
import { normalizeProject } from "../project.js";

const song = (id, title, project) => ({ schemaVersion: 1, id, ...(project ? { project } : {}), title, artist: "A", durationSeconds: 1, stems: [] });

test("LEGACY_PROJECT is a valid, listed, toxic-themed project carrying today's credit line", () => {
  const p = normalizeProject(LEGACY_PROJECT, "toxic-avenger");
  assert.equal(p.listed, true);
  assert.equal(p.archived, false);
  assert.equal(p.theme.preset, "toxic");
  assert.match(p.credit, /TOXIC AVENGER/);
});

test("first run: create the project (songOrder = current alphabetical order) and stamp every song", () => {
  const plan = planMigration({ existingProject: null, manifests: [song("z", "zulu"), song("a", "Alpha"), song("m", "Mike")] });
  assert.deepEqual(plan.createProject.songOrder, ["a", "m", "z"]);
  assert.equal(plan.createProject.id, "toxic-avenger");
  assert.deepEqual(plan.stamp, ["z", "a", "m"]);
  assert.deepEqual(plan.foreign, []);
});

test("second run plans nothing (idempotent)", () => {
  const plan = planMigration({
    existingProject: { id: "toxic-avenger" },
    manifests: [song("a", "A", "toxic-avenger"), song("b", "B", "toxic-avenger")],
  });
  assert.deepEqual(plan, { createProject: null, stamp: [], foreign: [] });
});

test("partial previous run: only unstamped songs are stamped; existing project untouched", () => {
  const plan = planMigration({ existingProject: { id: "toxic-avenger" }, manifests: [song("a", "A", "toxic-avenger"), song("b", "B")] });
  assert.equal(plan.createProject, null);
  assert.deepEqual(plan.stamp, ["b"]);
});

test("songs of other projects are reported, never stamped or ordered", () => {
  const plan = planMigration({ existingProject: null, manifests: [song("a", "A"), song("x", "X", "other")] });
  assert.deepEqual(plan.stamp, ["a"]);
  assert.deepEqual(plan.foreign, ["x"]);
  assert.deepEqual(plan.createProject.songOrder, ["a"]);
});

test("stampProject inserts project after id and does not mutate", () => {
  const m = song("a", "A");
  const s = stampProject(m, "toxic-avenger");
  assert.deepEqual(Object.keys(s).slice(0, 3), ["schemaVersion", "id", "project"]);
  assert.equal(s.project, "toxic-avenger");
  assert.equal(m.project, undefined);
  assert.deepEqual({ ...s, project: undefined }, { ...m, project: undefined });
});
