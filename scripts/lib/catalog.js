// Builds the song index (catalog.json) consumed by the landing page.
export function buildCatalog(manifests) {
  const songs = manifests.map((m) => ({
    id: m.id,
    title: m.title,
    artist: m.artist,
    durationSeconds: m.durationSeconds,
    stemCount: Array.isArray(m.stems) ? m.stems.length : 0,
  }));
  songs.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  return { schemaVersion: 1, songs };
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
  const catalog = buildCatalog(manifests);
  await writeCatalog(catalog);
  return catalog;
}
