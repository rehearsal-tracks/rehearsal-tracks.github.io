// scripts/lib/remote-catalog.js — the one wiring of refreshCatalog (pure, I/O injected) to the live
// R2 bucket via rclone. Shared by refresh-catalog.js, segment-song.js, the admin server and the
// migration so the file layout can't drift between them.
import { refreshCatalog } from "./catalog.js";
import { listProjectIds, readRemoteProject, listSongIds, readRemoteManifest, uploadJson } from "./upload.js";

export function refreshRemoteCatalog(bucket) {
  return refreshCatalog({
    listProjectIds: () => listProjectIds(bucket),
    readProject: (pid) => readRemoteProject(bucket, pid),
    listSongIds: () => listSongIds(bucket),
    readManifest: (id) => readRemoteManifest(bucket, id),
    writeProjectCatalog: (pid, c) => uploadJson(c, bucket, `projects/${pid}/catalog.json`),
    writeProjectsIndex: (index) => uploadJson(index, bucket, "projects.json"),
    writeLegacyCatalog: (c) => uploadJson(c, bucket, "catalog.json"),
  });
}

export function describeRefresh({ projects, index, legacy, songCount }) {
  return `catalogs refreshed: ${songCount} song(s), ${Object.keys(projects).length} project(s) ` +
    `(${index.projects.length} listed), ${legacy.songs.length} in legacy catalog.json`;
}
