// scripts/lib/__tests__/project.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeProject, assertSongOwnership, LEGACY_PROJECT_ID } from "../project.js";

test("LEGACY_PROJECT_ID is the pre-multi-project show", () => {
  assert.equal(LEGACY_PROJECT_ID, "toxic-avenger");
});

test("normalizeProject fills defaults (unlisted, not archived, neutral, empty order)", () => {
  assert.deepEqual(normalizeProject({ id: "show", name: "Show" }, "show"), {
    id: "show", name: "Show", credit: "", listed: false, archived: false,
    theme: { preset: "neutral", overrides: {} }, songOrder: [],
  });
});

test("normalizeProject keeps valid fields and only literal true for flags", () => {
  const p = normalizeProject({
    id: "show", name: "Show", credit: "For the cast", listed: true, archived: "yes",
    theme: { preset: "toxic", overrides: { accent: "#ff0000" } }, songOrder: ["a", 7, "b"],
  }, "show");
  assert.equal(p.listed, true);
  assert.equal(p.archived, false);
  assert.equal(p.credit, "For the cast");
  assert.deepEqual(p.theme, { preset: "toxic", overrides: { accent: "#ff0000" } });
  assert.deepEqual(p.songOrder, ["a", "b"]);
});

test("normalizeProject rejects a bad id, a folder mismatch, a missing name", () => {
  assert.throws(() => normalizeProject({ id: "../x", name: "X" }, "x"), /invalid id/);
  assert.throws(() => normalizeProject({ id: "other", name: "X" }, "show"), /doesn't match/);
  assert.throws(() => normalizeProject({ id: "show", name: " " }, "show"), /name is required/);
  assert.throws(() => normalizeProject(null, "show"), /not an object/);
});

test("normalizeProject does not share nested objects with its input", () => {
  const raw = { id: "show", name: "Show", theme: { preset: "toxic", overrides: { accent: "#ff0000" } } };
  normalizeProject(raw, "show").theme.overrides.accent = "#000000";
  assert.equal(raw.theme.overrides.accent, "#ff0000");
});

test("assertSongOwnership allows new ids, own project, and unassigned (pre-migration) songs", () => {
  assert.doesNotThrow(() => assertSongOwnership(null, "show"));
  assert.doesNotThrow(() => assertSongOwnership({ id: "s", project: "show" }, "show"));
  assert.doesNotThrow(() => assertSongOwnership({ id: "s" }, "show"));
});

test("assertSongOwnership rejects a song owned by another project", () => {
  assert.throws(() => assertSongOwnership({ id: "s", project: "other" }, "show"), /already belongs to project "other"/);
});
