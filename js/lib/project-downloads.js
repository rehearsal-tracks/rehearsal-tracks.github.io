// js/lib/project-downloads.js — "Download all" for one project (spec §1 project-level downloads).
// Songs go one at a time: each song's own download already runs an 8-way pool, so parallel songs
// would only fight over bandwidth. A failed song doesn't stop the rest, except when shouldStop(err)
// says every later song would fail too (out of storage): then the remaining songs are reported
// failed with that error. Already-downloaded songs are skipped, so "Retry failed" is just another
// call with the failed songs. I/O is injected (unit-tested); js/offline-ui.js wires the real one.
//   isDownloaded(song) → Promise<boolean>   downloadSong(song) → Promise
//   onProgress({ done, total, current })    current = the song now downloading, or null
export async function downloadProject(songs, { isDownloaded, downloadSong, shouldStop = () => false, onProgress = () => {} }) {
  const todo = [];
  for (const song of songs) {
    if (!(await isDownloaded(song).catch(() => false))) todo.push(song);
  }
  const total = todo.length;
  const failed = [];
  onProgress({ done: 0, total, current: null });
  for (let i = 0; i < todo.length; i++) {
    onProgress({ done: i, total, current: todo[i] });
    try {
      await downloadSong(todo[i]);
    } catch (error) {
      if (shouldStop(error)) {
        for (const song of todo.slice(i)) failed.push({ song, error });
        onProgress({ done: total, total, current: null });
        return { total, failed };
      }
      failed.push({ song: todo[i], error });
    }
    onProgress({ done: i + 1, total, current: null });
  }
  return { total, failed };
}
