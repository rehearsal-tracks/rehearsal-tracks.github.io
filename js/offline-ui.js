// js/offline-ui.js — DOM affordances for PWA Phase B offline downloads. Two mounts:
//   • mountOfflineControl — the player page's "Download for offline" button (+ progress / remove),
//     and a quiet reconcile of an already-downloaded song when it's re-opened online.
//   • mountDownloadsSection — the landing page's "Downloaded" list + storage-usage readout.
// Everything is feature-gated on Cache Storage and wrapped so it can never break the page.
// Logic lives in js/offline.js (unit-tested); this file is presentation only.

import {
  syncSong, removeSong, isDownloaded, listDownloadedIds,
  songSize, storageEstimate, requestPersistence, formatBytes,
} from "./offline.js";

const supported = () => typeof caches !== "undefined";
const isQuotaError = (err) =>
  err?.name === "QuotaExceededError" || /quota|exceeded|space/i.test(err?.message || "");

// ── Player page: per-song download control ─────────────────────────────────────────────────────
// `prefetchCtl` (optional) is the player's prefetcher handle ({ pause, resume }). We pause it while
// downloading and whenever a song is already downloaded — otherwise the prefetcher and the
// downloader both pull the whole song at once, doubling requests and saturating the connection
// budget (the "super slow download" symptom). It's resumed only when there's no offline copy.
export async function mountOfflineControl(container, { songId, base, manifest, prefetchCtl }) {
  if (!supported() || !container) return;

  const wrap = document.createElement("div");
  wrap.className = "offline";
  container.appendChild(wrap);

  let downloaded = await isDownloaded(songId).catch(() => false);
  // A downloaded song plays from Cache Storage via the SW, so prefetching into the HTTP cache is
  // pure duplicate work — keep it paused.
  if (downloaded) prefetchCtl?.pause();

  async function download() {
    render("downloading", "Starting…", 0);
    prefetchCtl?.pause(); // give the whole connection budget to the download
    try {
      await requestPersistence(); // exempt this song from best-effort eviction where supported
      await syncSong({
        id: songId, base, manifest,
        onProgress: ({ done, total }) => {
          const frac = total ? done / total : 0;
          render("downloading", `${Math.round(frac * 100)}%`, frac);
        },
      });
      downloaded = true;
      render("downloaded"); // stays paused — the SW now serves this song from Cache Storage
    } catch (err) {
      // Leave a downloaded song marked downloaded (a failed top-up still has the old copy).
      if (!downloaded) prefetchCtl?.resume(); // download aborted — let streaming prefetch continue
      render(downloaded ? "downloaded" : "available",
        isQuotaError(err) ? "Not enough space on device" : "Download failed — try again");
    }
  }

  async function remove() {
    await removeSong(songId).catch(() => {});
    downloaded = false;
    prefetchCtl?.resume(); // no offline copy anymore — resume streaming prefetch
    render("available", "Removed from this device");
  }

  function render(state, detail = "", fraction = null) {
    wrap.innerHTML = "";
    wrap.dataset.state = state;
    const status = document.createElement("span");
    status.className = "offline__status";
    status.textContent = detail;

    if (state === "downloading") {
      const btn = document.createElement("button");
      btn.className = "offline__btn";
      btn.textContent = "Downloading…";
      btn.disabled = true;
      const bar = document.createElement("div");
      bar.className = "offline__bar";
      const fill = document.createElement("div");
      fill.className = "offline__fill";
      fill.style.width = `${Math.round((fraction || 0) * 100)}%`;
      bar.appendChild(fill);
      wrap.append(btn, bar, status);
      return;
    }

    if (state === "downloaded") {
      const label = document.createElement("span");
      label.className = "offline__done";
      label.textContent = "✓ Available offline";
      songSize(songId).then((b) => { if (b) label.textContent = `✓ Available offline · ${formatBytes(b)}`; }).catch(() => {});
      const rm = document.createElement("button");
      rm.className = "offline__btn offline__btn--ghost";
      rm.textContent = "Remove download";
      rm.addEventListener("click", remove);
      wrap.append(label, rm, status);
      return;
    }

    // "available": online → offer download; offline → explain why it's unavailable.
    const btn = document.createElement("button");
    btn.className = "offline__btn";
    btn.textContent = "⤓ Download for offline";
    if (navigator.onLine === false) {
      btn.disabled = true;
      if (!detail) status.textContent = "Connect to the internet to download";
    } else {
      btn.addEventListener("click", download);
    }
    wrap.append(btn, status);
  }

  render(downloaded ? "downloaded" : "available");

  // Quietly keep an already-downloaded song current: re-fetch the manifest and apply the exact
  // set-difference (new/removed/replaced stems) so the offline copy matches the server. Deltas only,
  // so this is usually tiny; failures are swallowed (the existing copy still plays).
  if (downloaded && navigator.onLine !== false) {
    try {
      await syncSong({ id: songId, base, manifest });
      render("downloaded");
    } catch { /* reconcile is best-effort */ }
  }
}

// ── Landing page: downloaded-songs list + storage usage ──────────────────────────────────────────
export async function mountDownloadsSection(container, songs) {
  if (!supported() || !container) return;
  const titleById = new Map((songs || []).map((s) => [s.id, s.title]));

  async function refresh() {
    const ids = await listDownloadedIds().catch(() => []);
    if (!ids.length) { container.innerHTML = ""; container.hidden = true; return; }
    container.hidden = false;
    container.innerHTML = "";

    const heading = document.createElement("h2");
    heading.className = "downloads__heading";
    heading.textContent = "Downloaded for offline";
    container.appendChild(heading);

    const list = document.createElement("div");
    list.className = "downloads__list";
    for (const id of ids) {
      const row = document.createElement("div");
      row.className = "downloads__row";
      const name = document.createElement("span");
      name.className = "downloads__name";
      name.textContent = titleById.get(id) || id;
      const size = document.createElement("span");
      size.className = "downloads__size";
      songSize(id).then((b) => { size.textContent = b ? formatBytes(b) : ""; }).catch(() => {});
      const rm = document.createElement("button");
      rm.className = "downloads__remove";
      rm.textContent = "Remove";
      rm.setAttribute("aria-label", `Remove ${name.textContent} download`);
      rm.addEventListener("click", async () => {
        rm.disabled = true;
        await removeSong(id).catch(() => {});
        refresh();
      });
      row.append(name, size, rm);
      list.appendChild(row);
    }
    container.appendChild(list);

    const est = await storageEstimate();
    if (est && est.quota) {
      const usage = document.createElement("p");
      usage.className = "downloads__usage";
      usage.textContent = `Using ${formatBytes(est.usage)} of ${formatBytes(est.quota)} available`;
      container.appendChild(usage);
    }
  }

  await refresh();
}
