// js/offline-ui.js — DOM affordances for PWA Phase B offline downloads. Two mounts:
//   • mountOfflineControl — the player page's "Download for offline" button (+ progress / remove),
//     and a quiet reconcile of an already-downloaded song when it's re-opened online.
//   • mountDownloadsSection — the landing page's "Downloaded" list + storage-usage readout.
// Everything is feature-gated on Cache Storage and wrapped so it can never break the page.
// Logic lives in js/offline.js (unit-tested); this file is presentation only.

import { R2_BASE } from "./config.js";
import { downloadProject } from "./lib/project-downloads.js";
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

// ── Landing page: this project's downloads ───────────────────────────────────────────────────────
// "Download all" / "Remove downloads" for the project, the list of its downloaded songs and the
// device-wide storage usage (spec §1 project-level downloads). `songs` = the project's catalog
// songs; other projects' downloads are listed on their own pages.

// Fetch a song's manifest and download it (the player page's path, minus its UI). A failure
// removes the partial copy: syncSong opens the song's cache before fetching, and a half-filled
// cache would count as "downloaded" (so "Retry failed" would skip it). Safe because Download all
// only downloads songs that weren't downloaded. onFraction(0..1) reports progress within the song.
async function downloadSongById({ id }, onFraction) {
  const base = `${R2_BASE}/songs/${id}`;
  try {
    const res = await fetch(`${base}/manifest.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    await syncSong({
      id, base, manifest: await res.json(),
      onProgress: ({ done, total }) => onFraction?.(total ? done / total : 0),
    });
  } catch (e) {
    await removeSong(id).catch(() => {});
    throw e;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export async function mountDownloadsSection(container, songs) {
  if (!supported() || !container || !songs?.length) return;
  const titleById = new Map(songs.map((s) => [s.id, s.title]));
  // current = id of the song downloading right now (its partial copy isn't listed yet)
  const state = { busy: false, progress: "", message: "", failed: [], confirming: false, current: null };
  let generation = 0; // refreshes can overlap; only the newest one renders
  let progressEl = null; // busy status line (screen readers hear it once per song)
  let pctEl = null;      // within-song percentage, visual only (updated many times per song)
  let focusActions = false; // after a click re-renders the buttons, keep keyboard focus in the row
  // The section is rebuilt on every progress tick; only the status line should be announced.
  container.setAttribute("aria-live", "off");
  window.addEventListener("online", () => refresh());
  window.addEventListener("offline", () => refresh());

  function setProgress(text, pct = "") {
    state.progress = text;
    state.pct = pct;
    if (progressEl) progressEl.textContent = text;
    if (pctEl) pctEl.textContent = pct;
  }

  async function refresh() {
    const gen = ++generation;
    const ids = (await listDownloadedIds().catch(() => []))
      .filter((id) => titleById.has(id) && id !== state.current);
    const est = await storageEstimate();
    if (gen === generation) render(ids, est);
  }

  async function downloadAll(list) {
    if (state.busy) return; // a double tap must not start a second run over the same caches
    focusActions = true;
    Object.assign(state, { busy: true, message: "", failed: [], confirming: false, progress: "Starting…" });
    refresh();
    await requestPersistence();
    // "done" counts songs finished (failed ones included); failures are listed when it ends.
    let tick = { done: 0, total: 0, current: null };
    const label = (pct) => (tick.current
      ? `${tick.done} / ${tick.total} songs · ${tick.current.title}${pct == null ? "" : ` ${pct}%`}`
      : `${tick.done} / ${tick.total} songs`);
    const { total, failed } = await downloadProject(list, {
      isDownloaded: (s) => isDownloaded(s.id),
      downloadSong: (s) => downloadSongById(s, (f) => setProgress(label(null), `${Math.round(f * 100)}%`)),
      shouldStop: isQuotaError,
      onProgress: (p) => { tick = p; state.current = p.current?.id ?? null; setProgress(label(null)); refresh(); },
    });
    state.busy = false;
    state.current = null;
    state.failed = failed.map((f) => f.song);
    state.message = failed.length
      ? (failed.some((f) => isQuotaError(f.error)) ? "Not enough space on this device. " : "") +
        `${failed.length} of ${total} didn't download: ${state.failed.map((s) => s.title).join(", ")}`
      : total ? "All songs downloaded" : "";
    refresh();
  }

  async function removeAll(ids) {
    if (state.busy) return;
    focusActions = true;
    Object.assign(state, { busy: true, confirming: false, message: "", progress: "Removing…" });
    refresh();
    let freed = 0;
    for (const id of ids) {
      freed += await songSize(id).catch(() => 0);
      await removeSong(id).catch(() => {});
    }
    Object.assign(state, { busy: false, failed: [], message: `Removed ${ids.length} song(s) · freed ${formatBytes(freed)}` });
    refresh();
  }

  function render(ids, est) {
    container.hidden = false;
    container.replaceChildren();
    progressEl = null;
    pctEl = null;
    const missing = songs.filter((s) => !ids.includes(s.id));
    const offline = navigator.onLine === false;

    const actions = el("div", "downloads__actions");
    if (state.busy) {
      const btn = el("button", "offline__btn", "Working…");
      btn.disabled = true;
      progressEl = el("span", "offline__status", state.progress);
      progressEl.setAttribute("role", "status");
      pctEl = el("span", "offline__status", state.pct || "");
      pctEl.setAttribute("aria-hidden", "true");
      actions.append(btn, progressEl, pctEl);
    } else if (state.confirming) {
      actions.append(el("span", "downloads__confirm", `Remove ${ids.length} downloaded song(s) from this device?`));
      const yes = el("button", "offline__btn", "Remove");
      yes.addEventListener("click", () => removeAll(ids));
      const no = el("button", "offline__btn offline__btn--ghost", "Cancel");
      no.addEventListener("click", () => { state.confirming = false; focusActions = true; refresh(); });
      actions.append(yes, no);
    } else {
      if (missing.length) {
        const all = el("button", "offline__btn", ids.length ? `⤓ Download the other ${missing.length}` : "⤓ Download all songs");
        all.disabled = offline;
        all.addEventListener("click", () => downloadAll(songs));
        actions.append(all);
      }
      if (state.failed.length && !offline) {
        const retry = el("button", "offline__btn offline__btn--ghost", `Retry failed (${state.failed.length})`);
        retry.addEventListener("click", () => downloadAll(state.failed));
        actions.append(retry);
      }
      if (ids.length) {
        const rm = el("button", "offline__btn offline__btn--ghost", "Remove downloads");
        rm.addEventListener("click", () => { state.confirming = true; state.message = ""; focusActions = true; refresh(); });
        actions.append(rm);
      }
      const note = offline && missing.length ? "Connect to the internet to download" : state.message;
      if (note) actions.append(el("span", "offline__status", note));
    }
    container.append(actions);
    if (focusActions) {
      const btn = actions.querySelector("button:not(:disabled)");
      if (btn) {
        focusActions = false;
        // Only reclaim focus that the re-render dropped; never yank it or scroll the page.
        const active = document.activeElement;
        if (!active || active === document.body) btn.focus({ preventScroll: true });
      }
    }

    if (ids.length) {
      container.append(el("h2", "downloads__heading", "Downloaded for offline"));
      const list = el("div", "downloads__list");
      for (const id of ids) {
        const row = el("div", "downloads__row");
        const name = el("span", "downloads__name", titleById.get(id));
        const size = el("span", "downloads__size");
        // Sizes read every cached entry: skip them while a bulk action re-renders on each tick.
        if (!state.busy) songSize(id).then((b) => { size.textContent = b ? formatBytes(b) : ""; }).catch(() => {});
        const rm = el("button", "downloads__remove", "Remove");
        rm.setAttribute("aria-label", `Remove ${name.textContent} download`);
        rm.disabled = state.busy;
        rm.addEventListener("click", async () => {
          rm.disabled = true;
          await removeSong(id).catch(() => {});
          refresh();
        });
        row.append(name, size, rm);
        list.appendChild(row);
      }
      container.append(list);
    }

    if (est && est.quota) {
      container.append(el("p", "downloads__usage", `Using ${formatBytes(est.usage)} of ${formatBytes(est.quota)} available`));
    }
  }

  await refresh();
}
