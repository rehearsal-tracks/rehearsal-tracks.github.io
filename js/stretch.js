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

  // The stemplayer-js component gets its OWN silent context (viewAc) — a disconnected destination so
  // it never makes sound and its suspend/resume can't touch our audio. Our playback context `ac` is
  // NOT created here: on iOS/WebKit audioWorklet is only exposed once the context is "running", which
  // requires resuming inside a user gesture — so `ac` is created and unlocked lazily on the first
  // gesture (see unlockAudio / ensureCore below).
  const viewAc = new AudioContext();
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

  // ── Headless stretch core owns the audio (context + core created on the first gesture) ────────
  let ac = null;            // playback AudioContext — created inside ensureCore (see below)
  let engine = null;        // stretch core — created once `ac` exists
  let pendingRate = 1;      // rate chosen before the core exists; applied on load

  const pushGains = () => {
    if (!engine) return;
    const soloActive = stemEls.some((el) => el.solo === "on");
    stemEls.forEach((el, i) => engine.setGain(i, effectiveGain(el, soloActive)));
  };

  // Drive the component's visual playhead from the core's source-time. `applyPlayhead` writes
  // unconditionally; `setPlayhead` (the core's periodic ticks) is SUPPRESSED while the user is
  // scrubbing the seek bar or a seek is still settling — otherwise a tick overwrites the thumb the
  // user is dragging and it visibly jerks back.
  let scrubbing = false;    // pointer held on the transport (a seek drag may be in progress)
  let seekSettling = false; // a seek was requested and not yet applied to the core
  const applyPlayhead = (t, pct) => {
    stemEls.forEach((el) => { el.currentPct = pct; });
    controls.currentTime = t;
    controls.currentPct = pct;
  };
  const setPlayhead = (t, pct) => { if (scrubbing || seekSettling) return; applyPlayhead(t, pct); };

  // iOS/WebKit audio unlock. The hard WebKit fact that drives this: `audioContext.audioWorklet` is
  // UNDEFINED until the context is actually "running" — merely creating it inside a gesture is not
  // enough. On iOS a context reaches "running" only after resume() is called inside a genuine user
  // gesture, so unlockAudio() creates `ac` and resumes it SYNCHRONOUSLY inside the gesture handler.
  // Once unlocked this way, later resume() calls work even outside a gesture. (Older iOS also needed a
  // silent-buffer "kick" started in the same gesture; a bare resume() has been reliable since iOS 16.)
  const unlockAudio = () => {
    if (!ac) ac = new AudioContext({ latencyHint: "playback" });
    ac.resume().catch(() => {});
  };

  // Build the stretch core LAZILY on the first gesture (play/seek), NOT at page load. We wait for the
  // context to reach "running" — because audioWorklet doesn't exist until then on iOS — re-nudging
  // resume() each tick (harmless once it's been unlocked in a gesture), then build the core and load
  // it. If audioWorklet is still absent once running, this WebKit build genuinely lacks AudioWorklet
  // and we surface that rather than crash opaquely inside addModule.
  let coreLoading = null;
  const ensureCore = () => {
    if (!coreLoading) {
      coreLoading = (async () => {
        if (!ac) ac = new AudioContext({ latencyHint: "playback" });
        for (let i = 0; i < 150 && ac.state !== "running"; i++) {
          ac.resume().catch(() => {});
          await new Promise((r) => setTimeout(r, 20));
        }
        // AudioWorklet (which the whole stretch core is built on) is only exposed in a SECURE CONTEXT
        // — HTTPS, or localhost which the spec treats as secure. It is missing over plain HTTP on a
        // LAN IP (e.g. a phone hitting the dev server at http://192.168.x.x:8000), even though the
        // context is "running". The deployed site is HTTPS, so this only bites bare-IP dev testing.
        // Fail cleanly with an accurate message (flagged so the generic catch doesn't clobber it).
        if (!ac.audioWorklet) {
          showError(!window.isSecureContext
            ? "The slow-down engine needs a secure (HTTPS) connection — the browser disables its audio engine over plain HTTP on a LAN address. It works on the deployed HTTPS site and on http://localhost."
            : "This browser can't run the slow-down engine (AudioWorklet unavailable).");
          throw Object.assign(new Error("AudioWorklet unavailable"), { handled: true });
        }
        engine = createStretchEngine({ ac, base, stems: manifest.stems });
        engine.on("time", ({ time, pct }) => setPlayhead(time, pct));
        engine.on("state", ({ playing }) => { controls.isPlaying = playing; });
        engine.on("end", () => { controls.isPlaying = false; });
        engine.on("error", (err) => console.warn("[stretch] segment feed error", err));
        await engine.load();
        engine.setRate(pendingRate);
        pushGains();
      })().catch((e) => {
        coreLoading = null; // let the next gesture retry
        if (!e?.handled) showError(`Couldn't initialise stretch core — ${e.message}`);
        throw e;
      });
    }
    return coreLoading;
  };

  // The component's volume/mute/solo controls (wide faders + buttons) and our mobile rows mutate the
  // stem props; recompute our gains whenever they change (input = fader drag, click = mute/solo).
  playerEl.addEventListener("input", pushGains);
  playerEl.addEventListener("click", pushGains);

  // ── Transport interception ───────────────────────────────────────────────────────────────────
  // The native controls dispatch controls:play / controls:pause (bubbling, composed) which the
  // component's own host handler would turn into controller.play/pause. A capture-phase listener on
  // the host fires FIRST (on the way down to the controls target); stopPropagation there prevents the
  // component's silent controller from playing. We route to our core instead, and the core's `state`
  // event (above) sets controls.isPlaying so the button still shows the correct play/pause icon.
  player.addEventListener("controls:play", (e) => {
    e.stopPropagation();
    ensureCore().then(() => engine.play()).catch(() => {});
  }, true);
  player.addEventListener("controls:pause", (e) => { e.stopPropagation(); if (engine) engine.pause(); }, true);

  // Unlock + warm the core on the FIRST genuine gesture anywhere on the page (synthetic events don't
  // count on iOS). We bind to touchend/mousedown/keydown — the events iOS accepts as audio-activation
  // triggers; pointer events do NOT reliably count. unlockAudio() runs synchronously in the handler
  // (so the gesture applies to the silent-buffer kick + resume), then we kick the async core load so
  // the worklet is usually ready by the play tap. load() only parses m3u8s + builds nodes; the heavy
  // segment decoding still waits for actual playback, so warming early is cheap.
  let warmed = false;
  const warm = () => {
    if (warmed) return;
    warmed = true;
    unlockAudio();
    ensureCore().catch(() => {});
  };
  ["touchend", "mousedown", "keydown"].forEach((type) =>
    window.addEventListener(type, warm, { capture: true }));

  // Scrub guard: a pointer held anywhere on the transport (the native seek bar lives there) means the
  // user may be dragging the playhead — freeze the periodic playhead writes until they let go.
  controls.addEventListener("pointerdown", () => { scrubbing = true; }, true);
  const endScrub = () => { scrubbing = false; };
  window.addEventListener("pointerup", endScrub);
  window.addEventListener("pointercancel", endScrub);

  // Seek: the component re-dispatches `seek` with {t, pct} (continuously through a drag, and on
  // release). Debounce so the core's expensive dropBuffers()/refeed runs once the scrub settles
  // rather than on every intermediate value, then force the final position onto the playhead — the
  // periodic ticks are suppressed while seeking, and when paused there are none at all.
  let seekTimer;
  player.addEventListener("seek", (e) => {
    if (!e.detail || typeof e.detail.t !== "number") return;
    seekSettling = true;
    const target = e.detail.t;
    clearTimeout(seekTimer);
    seekTimer = setTimeout(async () => {
      try { await ensureCore(); } catch { seekSettling = false; return; }
      await engine.seek(target);
      seekSettling = false;
      applyPlayhead(engine.currentTime, engine.duration ? engine.currentTime / engine.duration : 0);
    }, 120);
  });

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
  rate.addEventListener("input", () => { pendingRate = Number(rate.value); if (engine) engine.setRate(pendingRate); paintRate(); });
  rateWrap.append(document.createTextNode("Speed "), rate, rateVal);
  bar.append(rateWrap);
  playerEl.before(bar);

  // Keep the layout (mobile faders vs. native waveform rows) in sync with the player width, and
  // nudge the resize stemplayer-js needs to (re)compute its waveform pixel-width. See player-ui.js.
  observeLayout(player, playerEl);
}

main();
