// js/stream.js — load a song manifest from R2 and render stemplayer-js stems.
import { R2_BASE } from "./config.js";
import { initNav } from "./nav.js";
import { initPrefetch } from "./prefetch.js";
import { mountOfflineControl } from "./offline-ui.js";
import {
  WAVE_COLOR, WAVE_PROGRESS_COLOR, buildMobileStemRow, themeWaveform, observeLayout,
} from "./player-ui.js";

const params = new URLSearchParams(location.search);
const songId = params.get("song");
const statusEl = document.getElementById("status");
const playerEl = document.getElementById("player");

function showError(msg) { statusEl.textContent = msg; statusEl.hidden = false; }

async function main() {
  initNav({ currentSongId: songId });
  if (!songId) return showError("No ?song=<id> specified.");
  const base = `${R2_BASE}/songs/${songId}`;
  let manifest;
  try {
    const res = await fetch(`${base}/manifest.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    manifest = await res.json();
  } catch (e) {
    return showError(`Couldn't load manifest at ${base}/manifest.json — ${e.message}`);
  }

  document.getElementById("title").textContent = manifest.title;
  document.getElementById("artist").textContent = manifest.artist;

  const player = document.createElement("stemplayer-js");

  // The controls row (play/pause + timeline) is required: it establishes the measured
  // waveform area that the player uses to size each stem's waveform. Without it,
  // waveformWidth is 0 and the waveforms render at zero width (invisible).
  const controls = document.createElement("stemplayer-js-controls");
  controls.setAttribute("label", manifest.title);
  player.appendChild(controls);

  // On phones/narrow widths we render our OWN per-stem rows (a clearly-labelled volume fader +
  // mute/solo) instead of stemplayer-js's compact layout, whose only volume affordance is a thin
  // edge-fill that reads like a progress bar. The native <stemplayer-js-stem>s stay in the DOM
  // (they own the audio) but are hidden via CSS on narrow widths; our rows drive their public
  // volume / muted / solo props — the exact props the component's own buttons set, so the audio
  // path is identical. Wide widths hide our list and show the native waveform rows instead.
  const mobileStems = document.createElement("div");
  mobileStems.className = "stems stems--mobile";

  // Per-visit mix (volume + mute/solo per stem) is remembered in localStorage, keyed per song and
  // per stem's stable storage slug (stem.src), so it survives reloads and stem reordering. Restore
  // the saved values onto the stem props here (before building the mobile rows, so their initial UI
  // reflects the restored state); changes are written back by the delegated listeners below.
  const savedMix = readSavedMix(songId);
  // Stem `volume` reads 0 WHILE muted (it reports effective gain, not the set level), so we can't
  // recover a muted stem's real level from the prop. Track the last audible level per stem and
  // persist that instead, so unmuting later restores the right volume.
  const lastVolume = {};

  for (const stem of manifest.stems) {
    const el = document.createElement("stemplayer-js-stem");
    el.setAttribute("label", stem.name);
    el.setAttribute("src", `${base}/${stem.src}`);
    el.setAttribute("waveform", `${base}/${stem.waveform}`);
    el.dataset.stemKey = stem.src;
    // Waveform bars are drawn to a <canvas>, so their colour can't come from CSS. We set it in two
    // ways for robustness: (1) the stem's own `wavecolor` / `waveprogresscolor` attributes (lowercase,
    // NO hyphens — those are its observedAttributes), and (2) directly on the inner <fc-waveform> via
    // themeWaveform() below, because stemplayer-js 4.1.0-beta.4 reflects these to stem properties but
    // does NOT forward them to the child that actually paints — so without (2) the waveforms fall back
    // to the component defaults (grey bars + cyan progress, which clashes with the theme).
    el.setAttribute("wavecolor", WAVE_COLOR);
    el.setAttribute("waveprogresscolor", WAVE_PROGRESS_COLOR);
    themeWaveform(el);
    const s = savedMix[stem.src] || {};
    const vol = typeof s.volume === "number" ? s.volume : 1;
    lastVolume[stem.src] = vol;
    el.volume = vol;                 // set the level first, then mute (mute would zero the getter)
    if (s.muted) el.muted = true;
    if (s.solo) el.solo = "on";
    player.appendChild(el);
    el.addEventListener("error", () => showError(`Stem "${stem.name}" failed to load (others continue).`));
    // Pass explicit init state (not el.volume, which is 0 when muted) so the row shows the true level.
    mobileStems.appendChild(buildMobileStemRow(el, stem.name, { volume: vol, muted: !!s.muted, solo: !!s.solo }));
  }
  playerEl.appendChild(player);
  playerEl.appendChild(mobileStems);

  // Anticipatory prefetch: warm the browser cache with segments further ahead than the engine's
  // own ~10s window, so a slow segment on any one stem doesn't stall the whole mix. Component-
  // agnostic (warms the cache the engine reads from) and wrapped so it can never break playback.
  // Held behind a small controller so the offline downloader can PAUSE it: the two both pull the
  // whole song, so running them together doubles every request and saturates the ~6-connection
  // budget (each segment would be fetched once for the HTTP cache AND once for Cache Storage). While
  // downloading — or once a song is fully downloaded (the SW then serves it from Cache Storage) —
  // prefetch is redundant, so we stop it and let the downloader/SW be the single fetch path.
  let prefetch = null;
  const prefetchCtl = {
    resume() {
      if (prefetch) return;
      try { prefetch = initPrefetch({ player, base, stems: manifest.stems }); }
      catch { /* prefetch is a pure optimization — never let it interfere with playback */ }
    },
    pause() { prefetch?.stop(); prefetch = null; },
  };
  prefetchCtl.resume();

  // "Download for offline" control (PWA Phase B). Sits below the player; feature-gated on Cache
  // Storage and fully self-contained, so it never affects playback. Also quietly reconciles an
  // already-downloaded copy against the fresh manifest we just fetched.
  try {
    const offlineHost = document.createElement("div");
    playerEl.after(offlineHost);
    mountOfflineControl(offlineHost, { songId, base, manifest, prefetchCtl });
  } catch { /* offline UI is additive — never let it break the page */ }

  // Persist the mix on any change. Delegated on the #player container so it captures BOTH our mobile
  // fader rows (native <input>/<button> in light DOM) and the component's own wide-layout controls
  // (its native range 'input' and button 'click' are composed events that bubble out of the shadow
  // DOM). Capture each audible stem's level synchronously on every volume 'input' (the stem isn't
  // muted yet at that instant) so a later mute keeps the real level; the localStorage write itself
  // is debounced so a volume drag coalesces into one write.
  const captureAudibleVolumes = () => {
    for (const el of player.querySelectorAll("stemplayer-js-stem")) {
      if (el.dataset.stemKey && !el.muted) lastVolume[el.dataset.stemKey] = el.volume;
    }
  };
  const persist = debounce(() => saveMix(songId, player, lastVolume), 300);
  playerEl.addEventListener("input", () => { captureAudibleVolumes(); persist(); });
  playerEl.addEventListener("click", persist);

  // Restoring solo needs to happen AFTER the component's first render: unlike volume/muted (which
  // stick when set at creation), the stem resets `solo` to "off" during init. Re-apply the saved
  // solo once the stem's first update settles, and again on loading-end as a belt-and-braces guard
  // (both run before any user interaction, so they can't clobber a live change).
  const restoreSolo = () => {
    for (const el of player.querySelectorAll("stemplayer-js-stem")) {
      if (savedMix[el.dataset.stemKey]?.solo && el.solo !== "on") el.solo = "on";
    }
  };
  for (const el of player.querySelectorAll("stemplayer-js-stem")) {
    if (el.updateComplete) el.updateComplete.then(restoreSolo);
  }
  player.addEventListener("loading-end", restoreSolo);

  // Keep the layout (mobile faders vs. native waveform rows) in sync with the player width, and
  // nudge the resize stemplayer-js needs to (re)compute its waveform pixel-width. See player-ui.js.
  observeLayout(player, playerEl);
}

// ── Saved mix persistence (localStorage) ─────────────────────────────────────────────────────
// One entry per song; within it, one record per stem keyed by its stable storage slug (stem.src).
const mixKey = (songId) => `rehearsal-tracks:mix:v1:${songId}`;

function readSavedMix(songId) {
  try {
    return JSON.parse(localStorage.getItem(mixKey(songId)) || "{}") || {};
  } catch {
    return {}; // corrupt/unavailable storage (e.g. private mode) → start fresh
  }
}

function saveMix(songId, player, lastVolume) {
  const mix = {};
  for (const el of player.querySelectorAll("stemplayer-js-stem")) {
    const key = el.dataset.stemKey;
    if (!key) continue;
    // el.volume reports 0 while muted, so only refresh the remembered level when audible; a muted
    // stem keeps its last audible level so unmuting later restores it.
    if (!el.muted) lastVolume[key] = el.volume;
    mix[key] = {
      volume: key in lastVolume ? lastVolume[key] : el.volume,
      muted: !!el.muted,
      solo: el.solo === "on",
    };
  }
  try {
    localStorage.setItem(mixKey(songId), JSON.stringify(mix));
  } catch { /* storage full or disabled — a non-persisted mix still works for this visit */ }
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

main();
