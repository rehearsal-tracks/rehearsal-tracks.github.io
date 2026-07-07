// js/stretch.js — EXPERIMENTAL time-stretch player page (branch: experimental-time-stretch).
//
// Same UI as the standard player (stream.js) — the component's native controls row is the transport
// (play/pause + seek + time), waveforms and per-stem faders render in the wide layout, and custom
// mobile fader rows take over on narrow widths — but the stemplayer-js component is used purely as a
// VIEW: a headless pitch-preserving stretch core (js/stretch/core.js) owns the audio and plays it
// back at 0.7–1× without changing pitch. A single extra "Speed" slider drives the rate.
//
// The component never makes a sound and never decodes segments: we give it its OWN silent audio
// context + a disconnected destination, set no-keyboard-events, and never let its controller play.
// It still sizes waveforms because HLS.load parses the m3u8 durations without decoding audio. We
// intercept its controls:play / controls:pause / seek events and route them to the core, mirror the
// core's playing state back onto controls.isPlaying (so the native play button shows the right icon),
// and drive its visual playhead each tick from the core's source-time.
// Design: ~/.claude/plans/2026-07-07-stem-player-time-stretch-design.md

import { R2_BASE } from "./config.js";
import { initNav } from "./nav.js";
import {
  WAVE_COLOR, WAVE_PROGRESS_COLOR, buildMobileStemRow, themeWaveform, observeLayout,
} from "./player-ui.js";
import { createStretchEngine } from "./stretch/core.js";

const params = new URLSearchParams(location.search);
const songId = params.get("song");
const statusEl = document.getElementById("status");
const playerEl = document.getElementById("player");

function showError(msg) { statusEl.textContent = msg; statusEl.hidden = false; }

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

  // Mobile fader list (narrow widths), mirroring the standard player: CSS hides the native stem rows
  // under .is-mobile and shows this list instead. Its rows drive the stems' public volume/muted/solo
  // props — the same props the wide-layout faders set — which our gains listener re-reads into the
  // core, so the audio path is identical in both layouts.
  const mobileStems = document.createElement("div");
  mobileStems.className = "stems stems--mobile";

  for (const stem of manifest.stems) {
    const el = document.createElement("stemplayer-js-stem");
    el.setAttribute("label", stem.name);
    el.setAttribute("src", `${base}/${stem.src}`);       // loads the m3u8 (durations) → sizes waveform
    el.setAttribute("waveform", `${base}/${stem.waveform}`);
    el.setAttribute("wavecolor", WAVE_COLOR);
    el.setAttribute("waveprogresscolor", WAVE_PROGRESS_COLOR);
    themeWaveform(el);
    player.appendChild(el);
    mobileStems.appendChild(buildMobileStemRow(el, stem.name, { volume: 1, muted: false, solo: false }));
  }
  playerEl.appendChild(player);
  playerEl.appendChild(mobileStems);

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
  // component's own uiTick), keep the mix gains in step, and reflect play/pause state onto the
  // native controls button (controls.isPlaying flips its icon — see the transport interception).
  const setPlayhead = (t, pct) => {
    stemEls.forEach((el) => { el.currentPct = pct; });
    controls.currentTime = t;
    controls.currentPct = pct;
  };
  engine.on("time", ({ time, pct }) => setPlayhead(time, pct));
  engine.on("state", ({ playing }) => { controls.isPlaying = playing; });
  engine.on("end", () => { controls.isPlaying = false; });
  engine.on("error", (err) => console.warn("[stretch] segment feed error", err));

  // The component's own volume/mute/solo controls (wide-layout faders + buttons) and our mobile
  // rows both mutate the stem props; recompute our gains whenever they change. (input = fader drag,
  // click = mute/solo.)
  playerEl.addEventListener("input", pushGains);
  playerEl.addEventListener("click", pushGains);

  // ── Transport interception ───────────────────────────────────────────────────────────────────
  // The native controls dispatch controls:play / controls:pause (bubbling, composed) which the
  // component's own host handler would turn into controller.play/pause. A capture-phase listener on
  // the host fires FIRST (on the way down to the controls target); stopPropagation there prevents the
  // component's silent controller from playing. We route to our core instead, and the core's `state`
  // event (above) sets controls.isPlaying so the button still shows the correct play/pause icon.
  player.addEventListener("controls:play", (e) => { e.stopPropagation(); engine.play(); }, true);
  player.addEventListener("controls:pause", (e) => { e.stopPropagation(); engine.pause(); }, true);
  // Seek: the component sets its own (harmless) controller.pct and re-dispatches `seek` with {t,pct}.
  player.addEventListener("seek", (e) => { if (e.detail && typeof e.detail.t === "number") engine.seek(e.detail.t); });

  // ── Speed (rate) control — the only UI beyond the standard player ────────────────────────────
  const bar = document.createElement("div");
  bar.className = "stretch-bar";
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
  bar.append(rateWrap);
  playerEl.before(bar);

  // Keep the layout (mobile faders vs. native waveform rows) in sync with the player width, and
  // nudge the resize stemplayer-js needs to (re)compute its waveform pixel-width. See player-ui.js.
  observeLayout(player, playerEl);
}

main();
