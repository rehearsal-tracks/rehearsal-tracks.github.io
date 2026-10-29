// Pure builders for the derived catalog files on R2 (spec §3):
//   projects/<pid>/catalog.json  — one project's songs in running order (schemaVersion 2)
//   projects.json                — public index of listed, non-archived projects
//   catalog.json                 — LEGACY root index read by old installed shells (schemaVersion 1)
import { LEGACY_PROJECT_ID } from "./project.js";

const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

function songEntry(m) {
  return {
    id: m.id,
    title: m.title,
    artist: m.artist,
    durationSeconds: m.durationSeconds,
    stemCount: Array.isArray(m.stems) ? m.stems.length : 0,
  };
}

// Legacy catalog: only songs old shells already know. Unassigned songs count as legacy because
// before the migration stamps `project` NO manifest has one, and every one of them is a Toxic
// Avenger song; a strict filter would empty the live site on the first refresh after merge.
export function buildLegacyCatalog(manifests) {
  const songs = manifests
    .filter((m) => !m.project || m.project === LEGACY_PROJECT_ID)
    .map(songEntry)
    .sort(byTitle);
  return { schemaVersion: 1, songs };
}

// `manifests` = this project's songs only (refreshCatalog groups them). Order: songOrder first,
// ids with no matching song (deleted, or another project's) dropped, then the rest alphabetically.
// `project` is a normalizeProject() result; only its public fields are published.
export function buildProjectCatalog(project, manifests) {
  const remaining = new Map(manifests.map((m) => [m.id, m]));
  const ordered = [];
  for (const id of project.songOrder) {
    if (remaining.has(id)) { ordered.push(remaining.get(id)); remaining.delete(id); }
  }
  const rest = [...remaining.values()].sort(byTitle);
  const { id, name, credit, archived, theme } = project;
  return {
    schemaVersion: 2,
    project: { id, name, credit, archived, theme },
    songs: [...ordered, ...rest].map(songEntry),
  };
}

export function buildProjectsIndex(projects) {
  const projectsOut = projects
    .filter((p) => p.listed && !p.archived)
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { schemaVersion: 1, projects: projectsOut };
}

// Regenerates the catalog from R2's current state. I/O is injected so this is
// unit-testable without rclone/network:
//   listSongIds() -> Promise<string[]>
//   readManifest(id) -> Promise<object>
//   writeCatalog(catalog) -> Promise<void>
// A song whose manifest can't be read is warned and skipped — one bad song
// must not break the whole catalog.
export async function refreshCatalog({ listSongIds, readManifest, writeCatalog }) {
  const ids = await listSongIds();
  const manifests = [];
  for (const id of ids) {
    try {
      manifests.push(await readManifest(id));
    } catch (e) {
      console.warn(`• catalog: skipping ${id}: ${e.message}`);
    }
  }
  const catalog = buildLegacyCatalog(manifests);
  await writeCatalog(catalog);
  return catalog;
}
