// js/player-ui.js — UI building blocks shared by the standard player (stream.js) and the
// experimental slow-down player (stretch.js). These are the pieces that render the stemplayer-js
// component into our theme and add the custom mobile fader rows; they are audio-agnostic (they only
// read/write the component's public props), so both the native controller and the headless stretch
// core can sit behind them.

// Toxic Avenger waveform palette: murky-moss unplayed bars, toxic-green played portion (reads as
// progress). Kept in sync with --accent in css/styles.css.
export const WAVE_COLOR = "#4f6b2e";
export const WAVE_PROGRESS_COLOR = "#8bff1f";

// Find the first matching element anywhere in a shadow-DOM subtree, crossing shadow boundaries.
export function deepQuery(root, selector) {
  if (!root) return null;
  const direct = root.querySelector(selector);
  if (direct) return direct;
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) {
      const found = deepQuery(el.shadowRoot, selector);
      if (found) return found;
    }
  }
  return null;
}

// Colour a stem's waveform. stemplayer-js 4.1.0-beta.4 doesn't pass the stem's wavecolor down to the
// <fc-waveform> that actually paints the canvas, so we set that element's own observed attributes
// (`wavecolor` / `progresscolor`) directly. We poll briefly for it: setting the colour BEFORE the
// first paint (its peaks are fetched over the network, so there's a window) means the initial draw
// uses our colour with no forced redraw. Bails out once applied, or after ~3s if the element never
// appears (defensive — a missing waveform just keeps the component defaults).
export function themeWaveform(stem) {
  let tries = 0;
  const iv = setInterval(() => {
    const fcw = stem.shadowRoot && deepQuery(stem.shadowRoot, "fc-waveform");
    if (fcw) {
      fcw.setAttribute("wavecolor", WAVE_COLOR);
      fcw.setAttribute("progresscolor", WAVE_PROGRESS_COLOR);
    }
    if (fcw || ++tries > 60) clearInterval(iv);
  }, 50);
}

// The mute/solo glyphs are the exact SVGs stemplayer-js renders in its wide (lg) layout
// (extracted from the fc-player-button shadow roots), so the mobile controls read identically to
// landscape: a microphone for solo, a speaker for mute that swaps to a struck-through speaker when
// muted. viewBox 0 0 24 24; filled via CSS (currentColor / --accent), matching the component.
const svg = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
export const ICON = {
  solo: svg("M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"),
  mute: svg("M7 9v6h4l5 5V4l-5 5H7z"),
  muted: svg("M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"),
};

// Build one row of the mobile stem list: a volume fader + mute/solo, all driving the native
// <stemplayer-js-stem>'s public props. Using a real <input type=range> means volume drags (and is
// keyboard-accessible) for free — no shadow-DOM pointer math. The controls mirror the landscape
// layout: same mute/solo icons, and a slider styled like the component's (thin track, pill thumb).
// muted/solo are the same props the component's own buttons set (solo takes the strings
// "on"/"off"), so audio behaviour is identical whether the native controller or the stretch core
// reads them.
export function buildMobileStemRow(stem, name, init) {
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
  slider.addEventListener("input", () => {
    stem.volume = Number(slider.value);
    paint();
  });
  bottom.append(slider, val);

  // Reflect a mute/solo state in the row UI. Called both when toggled and on init (to show state
  // restored from localStorage), so the row always matches the stem's actual props.
  const showMute = (muted) => {
    muteBtn.innerHTML = muted ? ICON.muted : ICON.mute;
    muteBtn.classList.toggle("is-active", muted);
    row.classList.toggle("is-muted", muted);
  };
  const showSolo = (on) => soloBtn.classList.toggle("is-active", on);

  muteBtn.addEventListener("click", () => {
    const muted = !stem.muted;
    stem.muted = muted;
    showMute(muted);
  });
  soloBtn.addEventListener("click", () => {
    const on = stem.solo !== "on";
    stem.solo = on ? "on" : "off";
    showSolo(on);
  });

  // Initialise from the explicit init state (a saved mix may have set the stem muted, in which case
  // stem.volume reads 0 — so we take the true level from init, not the prop).
  slider.value = String(init.volume);
  paint();
  showMute(init.muted);
  showSolo(init.solo);

  row.append(top, bottom);
  return row;
}

// stemplayer-js renders each row from a `displayMode` width class — "lg" = waveforms + a native
// range volume slider; "xs"/"sm" = compact layout with a custom tap slider — but it computes that
// field ONCE (first render) and never recomputes it on resize. So on a window resize or phone
// rotate the layout sticks (e.g. keeps the wide waveform view after shrinking to portrait) until a
// reload. `displayMode` is a reactive setter, though, so we recompute it ourselves from the player
// width and assign it (which re-renders), then dispatch a resize so the waveform width recomputes.
// Only "lg" shows the native per-stem waveform rows; below that we swap to our own mobile fader
// list (see buildMobileStemRow) and hide the native stem rows via the .is-mobile class. The
// threshold is the PLAYER element's width, ~130px narrower than the window; 670 lands the switch at
// roughly an 800px window, so a landscape phone gets waveforms while portrait stays on the faders.
export const widthToMode = (w) => (w >= 670 ? "lg" : w >= 600 ? "sm" : "xs");

// Recompute the layout (mobile-vs-waveform) from the player's current width and push it to the
// component, then nudge a resize so the waveform pixel-width recalculates. The controls row stays
// visible in both layouts (it's the transport); the native stem rows are only meaningful in "lg"
// (they carry the waveforms) — on narrow widths CSS hides them and our mobile list takes over.
export function syncLayout(player, playerEl) {
  const mode = widthToMode(player.clientWidth);
  playerEl.classList.toggle("is-mobile", mode !== "lg");
  for (const el of player.querySelectorAll("stemplayer-js-controls, stemplayer-js-stem")) {
    if (el.displayMode !== mode) el.displayMode = mode;
  }
  player.dispatchEvent(new Event("resize"));
}

// Wire the layout to run once the element is laid out (rAF), again when audio finishes loading, and
// on every settled WIDTH change (debounced). Only WIDTH changes matter — re-rendering can change the
// player's height (waveforms appear/disappear), and reacting to that would re-trigger the loop.
export function observeLayout(player, playerEl) {
  const run = () => syncLayout(player, playerEl);
  requestAnimationFrame(run);
  player.addEventListener("loading-end", run);
  let lastWidth = Math.round(player.clientWidth), settleTimer;
  const ro = new ResizeObserver(() => {
    const w = Math.round(player.clientWidth);
    if (w === lastWidth) return;
    lastWidth = w;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(run, 150);
  });
  ro.observe(player);
}
