// scripts/lib/project.js — projects/<pid>/project.json: the admin-edited source of truth for one
// project (show), plus the rules around it. Pure; no I/O.
import { safeId } from "./safe-path.js";

// The one project that existed before multi-project. The legacy root catalog.json carries only its
// songs (old installed shells know nothing else) and the migration assigns every existing song to it.
export const LEGACY_PROJECT_ID = "toxic-avenger";

// Fill defaults and validate a project.json read from projects/<pid>/. Throws on a bad id or one
// that disagrees with its folder, so a hand-edited typo fails loudly instead of forking a project.
// Flags default to the safe side: unlisted, not archived.
export function normalizeProject(raw, pid) {
  if (!raw || typeof raw !== "object") throw new Error(`project ${pid}: not an object`);
  const id = safeId(raw.id);
  if (id !== pid) throw new Error(`project ${pid}: id "${id}" doesn't match its folder`);
  if (typeof raw.name !== "string" || !raw.name.trim()) throw new Error(`project ${id}: name is required`);
  return {
    id,
    name: raw.name,
    credit: typeof raw.credit === "string" ? raw.credit : "",
    listed: raw.listed === true,
    archived: raw.archived === true,
    theme: { preset: raw.theme?.preset ?? "neutral", overrides: { ...(raw.theme?.overrides || {}) } },
    songOrder: Array.isArray(raw.songOrder) ? raw.songOrder.filter((s) => typeof s === "string") : [],
  };
}

// Song ids are globally unique and each song belongs to exactly one project. Re-uploading into its
// own project, or claiming a pre-migration song that has no project yet, is fine; taking another
// project's song is not. `existingManifest` is null when the id is new.
export function assertSongOwnership(existingManifest, pid) {
  const owner = existingManifest?.project;
  if (owner && owner !== pid) {
    throw new Error(`song "${existingManifest.id}" already belongs to project "${owner}". Pick a different id`);
  }
}
