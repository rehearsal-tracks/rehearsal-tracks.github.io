// js/stream.js — load a song manifest from R2 and render stemplayer-js stems.
import { R2_BASE } from "./config.js";
import { initNav } from "./nav.js";
import { initPrefetch } from "./prefetch.js";
import { mountOfflineControl } from "./offline-ui.js";
import {
  WAVE_COLOR, WAVE_PROGRESS_COLOR, buildMobileStemRow, themeWaveform, observeLayout,
} from "./player-ui.js";
import { createStretchEngine } from "./stretch/core.js";

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

  // ── Stretch engine state ──────────────────────────────────────────────────────────────────────
  let ac = null;             // real AudioContext for the stretch core (lazy — iOS needs gesture first)
  let engine = null;         // stretch core instance; set once after the swap
  let coreLoading = null;    // Promise while building the core; reset on failure for retry
  let pendingRate = 1;       // rate chosen before the core exists; applied on load
  let stretchActive = false; // true once swapped to the stretch core; never goes back to false

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

  const stemEls = [...player.querySelectorAll("stemplayer-js-stem")];

  const pushGains = () => {
    if (!engine) return;
    const soloActive = stemEls.some((el) => el.solo === "on");
    stemEls.forEach((el, i) => engine.setGain(i, effectiveGain(el, soloActive)));
  };

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

  // iOS/WebKit audio unlock — called synchronously inside a genuine user gesture.
  // `audioContext.audioWorklet` is undefined until the context is actually "running",
  // which on iOS requires resume() inside a real gesture (not a synthetic event).
  const unlockAudio = () => {
    if (!ac) ac = new AudioContext({ latencyHint: "playback" });
    ac.resume().catch(() => {});
  };

  // Warm the audio context on the first genuine gesture anywhere on the page.
  // We do NOT pre-load the stretch core here — only unlock the context so it's
  // ready when the user drags the slider below 1.0×.
  let warmed = false;
  const warmAudio = () => {
    if (warmed) return; warmed = true;
    unlockAudio();
  };
  ["touchend", "mousedown", "keydown"].forEach((type) =>
    window.addEventListener(type, warmAudio, { capture: true }));

  // Build + load the stretch core. Runs at most once (guarded by coreLoading).
  const ensureCore = () => {
    if (!coreLoading) {
      coreLoading = (async () => {
        if (!ac) ac = new AudioContext({ latencyHint: "playback" });
        // Poll until the context reaches "running". On iOS the context won't be running
        // until resume() is called inside a gesture; we re-nudge on every tick just in case
        // the warm handler was missed (e.g. programmatic test paths).
        for (let i = 0; i < 150 && ac.state !== "running"; i++) {
          ac.resume().catch(() => {});
          await new Promise((r) => setTimeout(r, 20));
        }
        // AudioWorklet requires a secure context (HTTPS or localhost). Over plain HTTP on a
        // LAN IP (e.g. http://192.168.x.x:8000 from a phone), `audioWorklet` is undefined
        // even when the context is "running". The deployed site is HTTPS, so this only bites
        // bare-IP dev testing.
        if (!ac.audioWorklet) {
          showError(!window.isSecureContext
            ? "The slow-down engine needs a secure (HTTPS) connection — it doesn't work over plain HTTP on a LAN address. Use the deployed site or a cloudflared tunnel."
            : "This browser can't run the slow-down engine (AudioWorklet unavailable).");
          throw Object.assign(new Error("AudioWorklet unavailable"), { handled: true });
        }
        engine = createStretchEngine({ ac, base, stems: manifest.stems });
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
  playerEl.addEventListener("input", () => { captureAudibleVolumes(); persist(); pushGains(); });
  playerEl.addEventListener("click", () => { persist(); pushGains(); });

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

  // ── Playhead state + transport interception for stretch mode ─────────────────────────────────
  let scrubbing = false;    // pointer held on the transport (a seek drag may be in progress)
  let seekSettling = false; // a seek was requested and not yet reflected in the core
  const applyPlayhead = (t, pct) => {
    stemEls.forEach((el) => { el.currentPct = pct; });
    controls.currentTime = t;
    controls.currentPct = pct;
  };
  const setPlayhead = (t, pct) => { if (scrubbing || seekSettling) return; applyPlayhead(t, pct); };

  // Transport interceptors for stretch mode. Capture-phase fires BEFORE the component's own
  // handler; stopPropagation prevents the HLS engine from ever playing again after the swap.
  // While stretchActive=false these return early, letting the component handle events normally.
  player.addEventListener("controls:play", (e) => {
    if (!stretchActive) return;
    e.stopPropagation();
    engine.play().catch(() => {});
  }, true);
  player.addEventListener("controls:pause", (e) => {
    if (!stretchActive) return;
    e.stopPropagation();
    if (engine) engine.pause();
  }, true);

  // Scrub guard: a pointer held anywhere on the transport may mean the user is dragging the
  // seek bar — freeze the periodic playhead writes until they let go.
  controls.addEventListener("pointerdown", () => { scrubbing = true; }, true);
  const endScrub = () => { scrubbing = false; };
  window.addEventListener("pointerup", endScrub);
  window.addEventListener("pointercancel", endScrub);

  // Seek interception. In shipped mode the component handles seek natively; we step aside.
  // In stretch mode we debounce the core's expensive dropBuffers/refeed to once per scrub,
  // then force the final position onto the playhead.
  let seekTimer;
  player.addEventListener("seek", (e) => {
    if (!stretchActive) return;
    if (!e.detail || typeof e.detail.t !== "number") return;
    seekSettling = true;
    const target = e.detail.t;
    clearTimeout(seekTimer);
    seekTimer = setTimeout(async () => {
      await engine.seek(target);
      seekSettling = false;
      applyPlayhead(engine.currentTime, engine.duration ? engine.currentTime / engine.duration : 0);
    }, 120);
  });

  let swapping = false; // prevents concurrent swap attempts (e.g. two rapid slider events)
  const triggerSwap = async () => {
    if (stretchActive || swapping) return;
    swapping = true;

    // Capture shipped-engine state before we change anything.
    const pos = controls.currentTime ?? 0;
    const wasPlaying = !!controls.isPlaying;

    // Pause the HLS engine. We dispatch controls:pause as a normal (non-capture) event from
    // the controls element so the component's own controller handles it. (stretchActive is
    // still false, so our capture interceptor won't swallow it.)
    if (wasPlaying) {
      controls.dispatchEvent(new CustomEvent("controls:pause", { bubbles: true, composed: true }));
    }
    prefetchCtl.pause();

    try {
      await ensureCore();
    } catch {
      // Core failed — roll back and let the user retry.
      prefetchCtl.resume();
      swapping = false;
      return;
    }

    // Wire core events → UI feedback.
    engine.on("time", ({ time, pct }) => setPlayhead(time, pct));
    engine.on("state", ({ playing }) => { controls.isPlaying = playing; });
    engine.on("end", () => { controls.isPlaying = false; });
    engine.on("error", (err) => console.warn("[stretch] segment feed error", err));

    // Seek to the captured position, then play if the user was already playing.
    await engine.seek(pos);
    stretchActive = true;  // set before play so the interceptors are live
    swapping = false;
    pushGains();           // re-apply fader/mute/solo state to the stretch core
    if (wasPlaying) engine.play().catch(() => {});
  };

  // ── Speed slider ─────────────────────────────────────────────────────────────────────────────
  const bar = document.createElement("div");
  bar.className = "stretch-bar";
  const rateWrap = document.createElement("label");
  rateWrap.className = "stretch-bar__rate";
  const rateVal = document.createElement("span");
  rateVal.className = "stretch-bar__rateval";
  const rateInput = document.createElement("input");
  rateInput.type = "range";
  rateInput.min = "0.7"; rateInput.max = "1"; rateInput.step = "0.05"; rateInput.value = "1";
  const paintRate = () => { rateVal.textContent = `${Number(rateInput.value).toFixed(2)}×`; };
  paintRate();
  rateInput.addEventListener("input", () => {
    pendingRate = Number(rateInput.value);
    paintRate();
    if (stretchActive) {
      engine.setRate(pendingRate);   // already on core: cheap reschedule, no swap
    } else if (pendingRate < 1) {
      triggerSwap();                 // first sub-1.0× drag: fire-and-forget
    }
  });
  rateWrap.append(document.createTextNode("Speed "), rateInput, rateVal);
  bar.append(rateWrap);
  playerEl.before(bar);

  // Keep the layout (mobile faders vs. native waveform rows) in sync with the player width, and
  // nudge the resize stemplayer-js needs to (re)compute its waveform pixel-width. See player-ui.js.
  observeLayout(player, playerEl);
}

// Compute effective per-stem gain from the component's live props (volume/muted/solo).
function effectiveGain(el, soloActive) {
  if (soloActive && el.solo !== "on") return 0;
  if (el.muted) return 0;
  return typeof el.volume === "number" ? el.volume : 1;
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
