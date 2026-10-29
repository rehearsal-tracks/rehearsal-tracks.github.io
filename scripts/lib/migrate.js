// scripts/lib/migrate.js — pure planning for the one-off multi-project migration
// (scripts/migrate-projects.js). Additive only: creates the toxic-avenger project and stamps
// `project` into manifests that lack one. Never touches media or the legacy catalog file.
import { LEGACY_PROJECT_ID } from "./project.js";
import { buildLegacyCatalog } from "./catalog.js";

export const LEGACY_PROJECT = {
  id: LEGACY_PROJECT_ID,
  name: "The Toxic Avenger",
  credit: "Created EXCLUSIVELY for (and beta tested by) the Cast of Anonymous Theatre's TOXIC AVENGER",
  listed: true,
  archived: false,
  theme: { preset: "toxic", overrides: {} },
  songOrder: [],
};

// existingProject: projects/toxic-avenger/project.json if present, else null.
// → { createProject: project|null, stamp: songIds[], foreign: songIds[] }. Idempotent: a re-run
// after a complete apply plans nothing; after a partial one it finishes the job.
export function planMigration({ existingProject, manifests }) {
  const stamp = manifests.filter((m) => !m.project).map((m) => m.id);
  const foreign = manifests.filter((m) => m.project && m.project !== LEGACY_PROJECT_ID).map((m) => m.id);
  // songOrder = today's landing order (the legacy catalog's alphabetical order), so the project page
  // starts out identical to what the cast sees now.
  const createProject = existingProject
    ? null
    : { ...LEGACY_PROJECT, songOrder: buildLegacyCatalog(manifests).songs.map((s) => s.id) };
  return { createProject, stamp, foreign };
}

export function stampProject(manifest, pid) {
  const { schemaVersion, id, ...rest } = manifest;
  return { schemaVersion, id, project: pid, ...rest };
}
