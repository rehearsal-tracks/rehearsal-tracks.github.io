// Pure builders for the derived catalog files on R2 (spec §3):
//   projects/<pid>/catalog.json  — one project's songs in running order (schemaVersion 2)
//   projects.json                — public index of listed, non-archived projects
//   catalog.json                 — LEGACY root index read by old installed shells (schemaVersion 1)
import { LEGACY_PROJECT_ID, normalizeProject } from "./project.js";

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

// Regenerates every derived catalog file from R2's sources (project.json + song manifests).
// I/O is injected so this is unit-testable without rclone/network:
//   listProjectIds() / readProject(pid)         projects/<pid>/project.json (null if absent)
//   listSongIds() / readManifest(id)            songs/<id>/manifest.json
//   writeProjectCatalog(pid, c)                 projects/<pid>/catalog.json
//   writeProjectsIndex(index)                   projects.json
//   writeLegacyCatalog(c)                       catalog.json (frozen in phase 5)
// An unreadable manifest is warned and skipped: one bad song mustn't break every catalog. A project
// that fails to read or is invalid ABORTS before any write, because the index written without it
// would silently unlist a live project. readProject returning null (no project.json in that
// folder) is warned and skipped.
// Concurrent refreshes (CLI + admin) are last-writer-wins on derived files; every refresh rebuilds
// from sources, so re-running converges.
export async function refreshCatalog({
  listProjectIds, readProject, listSongIds, readManifest,
  writeProjectCatalog, writeProjectsIndex, writeLegacyCatalog, warn = console.warn,
}) {
  const projects = [];
  for (const pid of await listProjectIds()) {
    const raw = await readProject(pid); // throws → abort (see above); null → folder without project.json
    if (raw === null) { warn(`• catalog: skipping projects/${pid}/: no project.json`); continue; }
    projects.push(normalizeProject(raw, pid));
  }

  const manifests = [];
  for (const id of await listSongIds()) {
    try {
      manifests.push(await readManifest(id));
    } catch (e) {
      warn(`• catalog: skipping ${id}: ${e.message}`);
    }
  }

  const songsByProject = new Map(projects.map((p) => [p.id, []]));
  for (const m of manifests) {
    const list = songsByProject.get(m.project);
    if (list) list.push(m);
    else warn(`• catalog: song ${m.id} has ${m.project ? `unknown project "${m.project}"` : "no project"}; it's in no project catalog`);
  }

  const catalogs = {};
  for (const p of projects) {
    catalogs[p.id] = buildProjectCatalog(p, songsByProject.get(p.id));
    await writeProjectCatalog(p.id, catalogs[p.id]);
  }
  const index = buildProjectsIndex(projects);
  await writeProjectsIndex(index);
  const legacy = buildLegacyCatalog(manifests);
  await writeLegacyCatalog(legacy);
  return { projects: catalogs, index, legacy, songCount: manifests.length };
}
