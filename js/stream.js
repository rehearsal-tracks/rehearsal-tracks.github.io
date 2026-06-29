// js/stream.js — load a song manifest from R2 and render stemplayer-js stems.
import { R2_BASE } from "./config.js";
import { initNav } from "./nav.js";

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

  for (const stem of manifest.stems) {
    const el = document.createElement("stemplayer-js-stem");
    el.setAttribute("label", stem.name);
    el.setAttribute("src", `${base}/${stem.src}`);
    el.setAttribute("waveform", `${base}/${stem.waveform}`);
    player.appendChild(el);
    el.addEventListener("error", () => showError(`Stem "${stem.name}" failed to load (others continue).`));
  }
  playerEl.appendChild(player);

  // stemplayer-js computes its waveform pixel-width only on a resize/layout event.
  // When the player is built programmatically, the initial recalc can run before the
  // workspace has measured its width, leaving waveforms at zero width forever. Nudging
  // a resize after the element is laid out (and again once audio finishes loading)
  // forces the recalculation. See StemPlayer #recalculatePixelsPerSecond / Workspace.waveformWidth.
  const kickResize = () => player.dispatchEvent(new Event("resize"));
  requestAnimationFrame(kickResize);
  player.addEventListener("loading-end", kickResize);
}

main();
