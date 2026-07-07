// js/stretch.js — EXPERIMENTAL time-stretch player page (branch: experimental-time-stretch).
//
// Same stemplayer-js UI as the shipped player, but used purely as a VIEW: waveforms, per-stem
// faders and the seek timeline render normally, while a headless pitch-preserving stretch core
// (js/stretch/core.js) owns the audio and plays it back at 0.7–1× without changing pitch. A rate
// slider drives it. Design: ~/.claude/plans/2026-07-07-stem-player-time-stretch-design.md
//
// The component never makes a sound and never decodes segments: we give it its OWN silent audio
// context + a disconnected destination, set no-keyboard-events, and never call its play() (we
// intercept its transport). It still sizes waveforms because HLS.load parses the m3u8 durations
// without decoding audio. We drive its visual playhead each tick from the core's source-time.

import { R2_BASE } from "./config.js";
import { initNav } from "./nav.js";
import { createStretchEngine } from "./stretch/core.js";

const params = new URLSearchParams(location.search);
const songId = params.get("song");
const statusEl = document.getElementById("status");
const playerEl = document.getElementById("player");

function showError(msg) { statusEl.textContent = msg; statusEl.hidden = false; }

const WAVE_COLOR = "#4f6b2e";
const WAVE_PROGRESS_COLOR = "#8bff1f";

function deepQuery(root, selector) {
  if (!root) return null;
  const direct = root.querySelector(selector);
  if (direct) return direct;
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) { const f = deepQuery(el.shadowRoot, selector); if (f) return f; }
  }
  return null;
}

// See stream.js: stemplayer-js 4.1.0-beta.4 doesn't forward the stem's wavecolor to the <fc-waveform>
// that paints, so set that element's attributes directly, polling briefly to land before first paint.
function themeWaveform(stem) {
  let tries = 0;
  const iv = setInterval(() => {
    const fcw = stem.shadowRoot && deepQuery(stem.shadowRoot, "fc-waveform");
    if (fcw) { fcw.setAttribute("wavecolor", WAVE_COLOR); fcw.setAttribute("progresscolor", WAVE_PROGRESS_COLOR); }
    if (fcw || ++tries > 60) clearInterval(iv);
  }, 50);
}

// Resolve each stem's effective gain from the component's live props (volume/muted/solo), applying
// solo priority: if any stem is soloed, only soloed stems are audible. el.volume reads 0 while muted
// (component quirk), which is fine here — a muted stem contributes 0 anyway.
function effectiveGain(el, soloActive) {
  if (soloActive && el.solo !== "on") return 0;
  if (el.muted) return 0;
  return typeof el.volume === "number" ? el.volume : 1;
}

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

  await customElements.whenDefined("stemplayer-js");

  // Two contexts on purpose: `ac` plays our stretched audio; `viewAc` is the component's own context,
  // kept silent (disconnected destination) so even an accidental component play makes no sound — and
  // so the component's own suspend()/resume() (it suspends on construction and on seek) can never
  // freeze OUR audio.
  const ac = new AudioContext({ sampleRate: 44100, latencyHint: "playback" });
  const viewAc = new AudioContext({ sampleRate: 44100 });
  const silent = viewAc.createGain();
  silent.gain.value = 0; // never connected to viewAc.destination → truly silent

  const player = document.createElement("stemplayer-js");
  player.audioContext = viewAc;   // inject BEFORE append/upgrade so the Controller uses them
  player.destination = silent;
  player.setAttribute("no-keyboard-events", ""); // its spacebar must not trigger a silent play

  const controls = document.createElement("stemplayer-js-controls");
  controls.setAttribute("label", manifest.title);
  player.appendChild(controls);

  for (const stem of manifest.stems) {
    const el = document.createElement("stemplayer-js-stem");
    el.setAttribute("label", stem.name);
    el.setAttribute("src", `${base}/${stem.src}`);       // loads the m3u8 (durations) → sizes waveform
    el.setAttribute("waveform", `${base}/${stem.waveform}`);
    el.setAttribute("wavecolor", WAVE_COLOR);
    el.setAttribute("waveprogresscolor", WAVE_PROGRESS_COLOR);
    themeWaveform(el);
    player.appendChild(el);
  }
  playerEl.appendChild(player);

  const stemEls = [...player.querySelectorAll("stemplayer-js-stem")];

  // ── Headless stretch core owns the audio ────────────────────────────────────────────────────
  const engine = createStretchEngine({ ac, base, stems: manifest.stems });
  try {
    await engine.load();
  } catch (e) {
    return showError(`Couldn't initialise stretch core — ${e.message}`);
  }

  const pushGains = () => {
    const soloActive = stemEls.some((el) => el.solo === "on");
    stemEls.forEach((el, i) => engine.setGain(i, effectiveGain(el, soloActive)));
  };
  pushGains();

  // Drive the component's visual playhead from the core's source-time each tick (mirrors the
  // component's own uiTick), and keep the mix gains in step.
  const setPlayhead = (t, pct) => {
    stemEls.forEach((el) => { el.currentPct = pct; });
    controls.currentTime = t;
    controls.currentPct = pct;
  };
  engine.on("time", ({ time, pct }) => setPlayhead(time, pct));
  engine.on("end", () => { setPlayButton(false); });
  engine.on("error", (err) => console.warn("[stretch] segment feed error", err));

  // The component's own volume/mute/solo controls (wide-layout faders + buttons) mutate the stem
  // props; recompute our gains whenever they change. (input = fader drag, click = mute/solo.)
  playerEl.addEventListener("input", pushGains);
  playerEl.addEventListener("click", pushGains);

  // ── Transport interception ───────────────────────────────────────────────────────────────────
  // The component's controls dispatch controls:play / controls:pause (bubbling, composed) which its
  // host handler turns into controller.play/pause. A capture-phase listener on the host fires FIRST
  // (on the way down to the controls target); stopPropagation there prevents the component's own
  // bubble-phase handler → the silent controller never plays. We route to our core instead.
  player.addEventListener("controls:play", (e) => { e.stopPropagation(); engine.play(); }, true);
  player.addEventListener("controls:pause", (e) => { e.stopPropagation(); engine.pause(); }, true);
  // Seek: the component sets its own (harmless) controller.pct and re-dispatches `seek` with {t,pct}.
  player.addEventListener("seek", (e) => { if (e.detail && typeof e.detail.t === "number") engine.seek(e.detail.t); });

  // ── Our transport bar (play/pause + rate) — the source of truth for the experiment ──────────
  const bar = document.createElement("div");
  bar.className = "stretch-bar";
  const playBtn = document.createElement("button");
  playBtn.className = "stretch-bar__play";
  playBtn.type = "button";
  const setPlayButton = (isPlaying) => {
    playBtn.textContent = isPlaying ? "⏸ Pause" : "▶ Play";
    playBtn.classList.toggle("is-playing", isPlaying);
  };
  setPlayButton(false);
  playBtn.addEventListener("click", () => { engine.playing ? engine.pause() : engine.play(); });
  engine.on("state", ({ playing }) => setPlayButton(playing));

  const rateWrap = document.createElement("label");
  rateWrap.className = "stretch-bar__rate";
  const rateVal = document.createElement("span");
  rateVal.className = "stretch-bar__rateval";
  const rate = document.createElement("input");
  rate.type = "range";
  rate.min = "0.7";
  rate.max = "1";
  rate.step = "0.05"; // snap to 1.00, 0.95, 0.90 … 0.70
  rate.value = "1";
  const paintRate = () => { rateVal.textContent = `${Number(rate.value).toFixed(2)}×`; };
  paintRate();
  rate.addEventListener("input", () => { engine.setRate(Number(rate.value)); paintRate(); });
  rateWrap.append(document.createTextNode("Speed "), rate, rateVal);

  bar.append(playBtn, rateWrap);
  playerEl.before(bar);

  // ── Waveform sizing (same nudges as stream.js) ───────────────────────────────────────────────
  const widthToMode = (w) => (w >= 670 ? "lg" : w >= 600 ? "sm" : "xs");
  const syncLayout = () => {
    const mode = widthToMode(player.clientWidth);
    playerEl.classList.toggle("is-mobile", mode !== "lg");
    for (const el of player.querySelectorAll("stemplayer-js-controls, stemplayer-js-stem")) {
      if (el.displayMode !== mode) el.displayMode = mode;
    }
    player.dispatchEvent(new Event("resize"));
  };
  requestAnimationFrame(syncLayout);
  player.addEventListener("loading-end", syncLayout);
  let lastWidth = Math.round(player.clientWidth), settle;
  new ResizeObserver(() => {
    const w = Math.round(player.clientWidth);
    if (w === lastWidth) return;
    lastWidth = w;
    clearTimeout(settle);
    settle = setTimeout(syncLayout, 150);
  }).observe(player);
}

main();
