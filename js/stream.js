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

  // On phones/narrow widths we render our OWN per-stem rows (a clearly-labelled volume fader +
  // mute/solo) instead of stemplayer-js's compact layout, whose only volume affordance is a thin
  // edge-fill that reads like a progress bar. The native <stemplayer-js-stem>s stay in the DOM
  // (they own the audio) but are hidden via CSS on narrow widths; our rows drive their public
  // volume / muted / solo props — the exact props the component's own buttons set, so the audio
  // path is identical. Wide widths hide our list and show the native waveform rows instead.
  const mobileStems = document.createElement("div");
  mobileStems.className = "stems stems--mobile";

  for (const stem of manifest.stems) {
    const el = document.createElement("stemplayer-js-stem");
    el.setAttribute("label", stem.name);
    el.setAttribute("src", `${base}/${stem.src}`);
    el.setAttribute("waveform", `${base}/${stem.waveform}`);
    // Waveform color isn't a CSS custom property — it's set per stem. Dim unplayed bars, accent
    // for the played portion, to match the site palette (--text-dim / --accent) and read as progress.
    el.setAttribute("wave-color", "#5b6291");
    el.setAttribute("wave-progress-color", "#6c8cff");
    player.appendChild(el);
    el.addEventListener("error", () => showError(`Stem "${stem.name}" failed to load (others continue).`));
    mobileStems.appendChild(buildMobileStemRow(el, stem.name));
  }
  playerEl.appendChild(player);
  playerEl.appendChild(mobileStems);

  // stemplayer-js computes its waveform pixel-width only on a resize/layout event.
  // When the player is built programmatically, the initial recalc can run before the
  // workspace has measured its width, leaving waveforms at zero width forever. Nudging
  // a resize after the element is laid out (and again once audio finishes loading)
  // forces the recalculation. See StemPlayer #recalculatePixelsPerSecond / Workspace.waveformWidth.
  // stemplayer-js renders each row from a `displayMode` width class — "lg" = waveforms + a native
  // range volume slider; "xs"/"sm" = compact layout with a custom tap slider — but it computes that
  // field ONCE (first render) and never recomputes it on resize. So on a window resize or phone
  // rotate the layout sticks (e.g. keeps the wide waveform view after shrinking to portrait) until a
  // reload. `displayMode` is a reactive setter, though, so we recompute it ourselves from the player
  // width and assign it (which re-renders), then dispatch a resize so the waveform width recomputes.
  // Thresholds match the component's own (only "lg" shows waveforms; "xs"/"sm" both render compact).
  // Only "lg" shows the native per-stem waveform rows; below that we swap to our own mobile
  // fader list (see buildMobileStemRow) and hide the native stem rows via the .is-mobile class.
  // The threshold is the PLAYER element's width, which is ~130px narrower than the window (body +
  // card padding + border). 670 here means the switch lands at roughly an 800px-wide window, so a
  // landscape phone (~844–926px) gets the waveform layout while portrait stays on the fader list.
  const widthToMode = (w) => (w >= 670 ? "lg" : w >= 600 ? "sm" : "xs");
  const syncLayout = () => {
    const mode = widthToMode(player.clientWidth);
    const mobile = mode !== "lg";
    playerEl.classList.toggle("is-mobile", mobile);
    // The controls row stays visible in both layouts (it's the transport); the native stem rows
    // are only meaningful in "lg" (they carry the waveforms) — on narrow widths CSS hides them and
    // our mobile list takes over. Assigning displayMode is harmless when they're hidden.
    for (const el of player.querySelectorAll("stemplayer-js-controls, stemplayer-js-stem")) {
      if (el.displayMode !== mode) el.displayMode = mode;
    }
    player.dispatchEvent(new Event("resize"));
  };
  requestAnimationFrame(syncLayout);
  player.addEventListener("loading-end", syncLayout);

  // Debounce so a live drag-resize doesn't thrash, and so the component's width-class field has
  // settled before we re-render. Only react to WIDTH changes — re-rendering can change the
  // player's height (waveforms appear/disappear), and reacting to that would re-trigger the loop.
  let lastWidth = Math.round(player.clientWidth), settleTimer;
  const ro = new ResizeObserver(() => {
    const w = Math.round(player.clientWidth);
    if (w === lastWidth) return;
    lastWidth = w;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(syncLayout, 150);
  });
  ro.observe(player);
}

// The mute/solo glyphs are the exact SVGs stemplayer-js renders in its wide (lg) layout
// (extracted from the fc-player-button shadow roots), so the mobile controls read identically to
// landscape: a microphone for solo, a speaker for mute that swaps to a struck-through speaker when
// muted. viewBox 0 0 24 24; filled via CSS (currentColor / --accent), matching the component.
const svg = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const ICON = {
  solo: svg("M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"),
  mute: svg("M7 9v6h4l5 5V4l-5 5H7z"),
  muted: svg("M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"),
};

// Build one row of the mobile stem list: a volume fader + mute/solo, all driving the native
// <stemplayer-js-stem>'s public props. Using a real <input type=range> means volume drags (and is
// keyboard-accessible) for free — no shadow-DOM pointer math. The controls mirror the landscape
// layout: same mute/solo icons, and a slider styled like the component's (thin track, pill thumb).
// muted/solo are the same props the component's own buttons set (solo takes the strings
// "on"/"off"), so audio behaviour is identical.
function buildMobileStemRow(stem, name) {
  const row = document.createElement("div");
  row.className = "stem";

  const top = document.createElement("div");
  top.className = "stem__top";
  const nameEl = document.createElement("span");
  nameEl.className = "stem__name";
  nameEl.innerHTML = '<span class="stem__dot"></span>';
  nameEl.append(name);
  const btns = document.createElement("span");
  btns.className = "stem__buttons";
  const soloBtn = document.createElement("button");
  soloBtn.className = "stem__btn";
  soloBtn.dataset.role = "solo";
  soloBtn.innerHTML = ICON.solo;
  soloBtn.title = "Solo";
  soloBtn.setAttribute("aria-label", `Solo ${name}`);
  const muteBtn = document.createElement("button");
  muteBtn.className = "stem__btn";
  muteBtn.dataset.role = "mute";
  muteBtn.innerHTML = ICON.mute;
  muteBtn.title = "Mute";
  muteBtn.setAttribute("aria-label", `Mute ${name}`);
  btns.append(soloBtn, muteBtn);
  top.append(nameEl, btns);

  const bottom = document.createElement("div");
  bottom.className = "stem__bottom";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "slider";
  slider.min = "0";
  slider.max = "1";
  slider.step = "0.01";
  slider.value = String(stem.volume ?? 1);
  slider.setAttribute("aria-label", `${name} volume`);
  const val = document.createElement("span");
  val.className = "stem__vol";
  const paint = () => { val.textContent = `${Math.round(Number(slider.value) * 100)}`; };
  paint();
  slider.addEventListener("input", () => {
    stem.volume = Number(slider.value);
    paint();
  });
  bottom.append(slider, val);

  muteBtn.addEventListener("click", () => {
    const muted = !stem.muted;
    stem.muted = muted;
    muteBtn.innerHTML = muted ? ICON.muted : ICON.mute;
    muteBtn.classList.toggle("is-active", muted);
    row.classList.toggle("is-muted", muted);
  });
  soloBtn.addEventListener("click", () => {
    const on = stem.solo !== "on";
    stem.solo = on ? "on" : "off";
    soloBtn.classList.toggle("is-active", on);
  });

  row.append(top, bottom);
  return row;
}

main();
