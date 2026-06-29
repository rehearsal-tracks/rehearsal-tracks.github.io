// Interactive Stem Player — vanilla Web Audio API, no dependencies.
// All mixing state lives in this browser tab, so every listener gets a
// private, independent mix. Stems are plain MP3/WAV files played in sync.

const $ = (sel) => document.querySelector(sel);

const els = {
  loading: $("#loading"),
  title: $("#track-title"),
  artist: $("#track-artist"),
  selectWrap: $("#track-select-wrap"),
  select: $("#track-select"),
  play: $("#play-btn"),
  loop: $("#loop-btn"),
  seek: $("#seek"),
  timeCurrent: $("#time-current"),
  timeTotal: $("#time-total"),
  stems: $("#stems"),
  masterVol: $("#master-vol"),
  masterVolValue: $("#master-vol-value"),
  player: document.querySelector(".player"),
  hint: $("#hint"),
};

/** @type {AudioContext} */
let ctx;
let masterGain;

const state = {
  tracks: [],
  current: null, // { id, title, artist, stems: [{name, src, buffer, gain, slider, value, muted, solo, sourceNode}] }
  duration: 0,
  loop: true,
  isPlaying: false,
  startTime: 0, // ctx.currentTime when the current play segment began
  offset: 0, // playback position (s) captured at last pause/seek
  raf: 0,
};

// ---------- Loading & manifest ----------

async function init() {
  try {
    const res = await fetch("tracks.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`tracks.json -> ${res.status}`);
    const data = await res.json();
    state.tracks = data.tracks || [];
    if (state.tracks.length === 0) throw new Error("No tracks defined in tracks.json");

    buildTrackSelector();

    // Allow ?track=<id> deep links.
    const params = new URLSearchParams(location.search);
    const requested = params.get("track");
    const start = state.tracks.find((t) => t.id === requested) || state.tracks[0];
    els.select.value = start.id;
    await loadTrack(start);
  } catch (err) {
    showError(err);
  }
}

function buildTrackSelector() {
  if (state.tracks.length <= 1) return;
  els.selectWrap.hidden = false;
  els.select.innerHTML = "";
  for (const t of state.tracks) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.title;
    els.select.appendChild(opt);
  }
  els.select.addEventListener("change", async () => {
    const t = state.tracks.find((x) => x.id === els.select.value);
    if (t) {
      stop();
      await loadTrack(t);
    }
  });
}

// Create the AudioContext. decodeAudioData works on a suspended context, so we
// do NOT resume here — resuming requires a user gesture and would otherwise hang.
function ensureContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = Number(els.masterVol.value) / 100;
    masterGain.connect(ctx.destination);
  }
}

async function loadTrack(track) {
  showLoading(true);
  ensureContext();

  const stems = track.stems.map((s) => ({
    name: s.name,
    src: s.src,
    value: typeof s.volume === "number" ? s.volume : 0.9,
    muted: false,
    solo: false,
    buffer: null,
    gain: null,
    sourceNode: null,
  }));

  // Fetch + decode every stem in parallel.
  await Promise.all(
    stems.map(async (stem) => {
      const res = await fetch(stem.src, { cache: "force-cache" });
      if (!res.ok) throw new Error(`${stem.src} -> ${res.status}`);
      const arr = await res.arrayBuffer();
      stem.buffer = await ctx.decodeAudioData(arr);
    })
  );

  state.current = { ...track, stems };
  state.duration = Math.max(...stems.map((s) => s.buffer.duration));
  state.offset = 0;

  els.title.textContent = track.title;
  els.artist.textContent = track.artist || "";
  els.timeTotal.textContent = formatTime(state.duration);
  els.timeCurrent.textContent = "0:00";
  els.seek.value = 0;
  setSliderFill(els.seek, 0);

  renderStems(stems);
  els.play.disabled = false;
  els.seek.disabled = false;
  showLoading(false);
}

// ---------- Stem UI ----------

function renderStems(stems) {
  els.stems.innerHTML = "";
  const hues = [220, 270, 190, 320, 150, 30];
  stems.forEach((stem, i) => {
    const hue = hues[i % hues.length];
    const row = document.createElement("div");
    row.className = "stem";
    row.innerHTML = `
      <div class="stem__top">
        <span class="stem__name"><span class="stem__dot" style="background:hsl(${hue} 80% 65%)"></span>${escapeHtml(stem.name)}</span>
        <div class="stem__buttons">
          <button class="stem__btn" data-role="mute" aria-pressed="false" title="Mute">M</button>
          <button class="stem__btn" data-role="solo" aria-pressed="false" title="Solo">S</button>
        </div>
      </div>
      <div class="stem__bottom">
        <input type="range" class="slider" min="0" max="100" value="${Math.round(stem.value * 100)}" aria-label="${escapeHtml(stem.name)} volume" />
        <span class="stem__vol">${Math.round(stem.value * 100)}</span>
      </div>`;

    const slider = row.querySelector(".slider");
    const volLabel = row.querySelector(".stem__vol");
    const muteBtn = row.querySelector('[data-role="mute"]');
    const soloBtn = row.querySelector('[data-role="solo"]');

    setSliderFill(slider, stem.value * 100);

    slider.addEventListener("input", () => {
      stem.value = Number(slider.value) / 100;
      volLabel.textContent = slider.value;
      setSliderFill(slider, slider.value);
      applyGains();
    });
    muteBtn.addEventListener("click", () => {
      stem.muted = !stem.muted;
      muteBtn.classList.toggle("is-active", stem.muted);
      muteBtn.setAttribute("aria-pressed", String(stem.muted));
      row.classList.toggle("is-muted", stem.muted);
      applyGains();
    });
    soloBtn.addEventListener("click", () => {
      stem.solo = !stem.solo;
      soloBtn.classList.toggle("is-active", stem.solo);
      soloBtn.setAttribute("aria-pressed", String(stem.solo));
      applyGains();
    });

    stem._row = row;
    els.stems.appendChild(row);
  });
}

// Recompute the effective gain of every stem (handles mute + solo logic).
function applyGains() {
  if (!state.current) return;
  const anySolo = state.current.stems.some((s) => s.solo);
  for (const stem of state.current.stems) {
    if (!stem.gain) continue;
    const audible = anySolo ? stem.solo : !stem.muted;
    const target = audible ? stem.value : 0;
    stem.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.015);
  }
}

// ---------- Transport ----------

function buildGraph(offset) {
  // Web Audio source nodes are single-use, so we recreate them on every
  // play/seek and start all stems at the exact same context time -> sync.
  const startAt = ctx.currentTime + 0.06;
  for (const stem of state.current.stems) {
    const src = ctx.createBufferSource();
    src.buffer = stem.buffer;
    src.loop = state.loop;

    const gain = ctx.createGain();
    src.connect(gain).connect(masterGain);

    src.start(startAt, offset % stem.buffer.duration);
    stem.sourceNode = src;
    stem.gain = gain;

    // When a non-looping track ends, reset the transport.
    src.onended = () => {
      if (!state.loop && state.isPlaying && stem === state.current.stems[0]) {
        stop();
      }
    };
  }
  applyGains();
  state.startTime = startAt;
  state.offset = offset;
}

function teardownGraph() {
  if (!state.current) return;
  for (const stem of state.current.stems) {
    if (stem.sourceNode) {
      stem.sourceNode.onended = null;
      try { stem.sourceNode.stop(); } catch (_) {}
      stem.sourceNode.disconnect();
      stem.sourceNode = null;
    }
    if (stem.gain) { stem.gain.disconnect(); stem.gain = null; }
  }
}

function currentPosition() {
  if (!state.isPlaying) return state.offset;
  let pos = state.offset + (ctx.currentTime - state.startTime);
  if (state.loop && state.duration > 0) pos %= state.duration;
  return Math.min(pos, state.duration);
}

async function play() {
  ensureContext();
  if (ctx.state === "suspended") await ctx.resume();
  const startOffset = state.offset >= state.duration ? 0 : state.offset;
  buildGraph(startOffset);
  state.isPlaying = true;
  els.player.classList.add("is-playing");
  els.play.setAttribute("aria-label", "Pause");
  tick();
}

function pause() {
  const pos = currentPosition();
  teardownGraph();
  state.isPlaying = false;
  state.offset = pos;
  els.player.classList.remove("is-playing");
  els.play.setAttribute("aria-label", "Play");
  cancelAnimationFrame(state.raf);
}

function stop() {
  teardownGraph();
  state.isPlaying = false;
  state.offset = 0;
  els.player.classList.remove("is-playing");
  els.seek.value = 0;
  setSliderFill(els.seek, 0);
  els.timeCurrent.textContent = "0:00";
  cancelAnimationFrame(state.raf);
}

function seekTo(fraction) {
  const pos = fraction * state.duration;
  state.offset = pos;
  if (state.isPlaying) {
    teardownGraph();
    buildGraph(pos);
  }
  els.timeCurrent.textContent = formatTime(pos);
  setSliderFill(els.seek, fraction * 1000);
}

function tick() {
  const pos = currentPosition();
  const frac = state.duration ? pos / state.duration : 0;
  els.seek.value = String(Math.round(frac * 1000));
  setSliderFill(els.seek, frac * 1000);
  els.timeCurrent.textContent = formatTime(pos);
  if (state.isPlaying) state.raf = requestAnimationFrame(tick);
}

// ---------- Wiring ----------

els.play.addEventListener("click", async () => {
  if (state.isPlaying) pause();
  else await play();
});

els.loop.addEventListener("click", () => {
  state.loop = !state.loop;
  els.loop.classList.toggle("is-on", state.loop);
  els.loop.setAttribute("aria-pressed", String(state.loop));
  for (const stem of state.current?.stems || []) {
    if (stem.sourceNode) stem.sourceNode.loop = state.loop;
  }
});

let wasPlayingBeforeSeek = false;
els.seek.addEventListener("pointerdown", () => { wasPlayingBeforeSeek = state.isPlaying; });
els.seek.addEventListener("input", () => {
  const frac = Number(els.seek.value) / 1000;
  els.timeCurrent.textContent = formatTime(frac * state.duration);
  setSliderFill(els.seek, els.seek.value);
});
els.seek.addEventListener("change", () => {
  seekTo(Number(els.seek.value) / 1000);
});

els.masterVol.addEventListener("input", () => {
  els.masterVolValue.textContent = els.masterVol.value;
  setSliderFill(els.masterVol, els.masterVol.value);
  if (masterGain) masterGain.gain.setTargetAtTime(Number(els.masterVol.value) / 100, ctx.currentTime, 0.015);
});

// Spacebar = play/pause.
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target.tagName !== "INPUT" && e.target.tagName !== "SELECT") {
    e.preventDefault();
    els.play.click();
  }
});

// ---------- Helpers ----------

function setSliderFill(el, valueOutOf) {
  const max = Number(el.max) || 100;
  el.style.setProperty("--fill", `${(Number(valueOutOf) / max) * 100}%`);
}

function formatTime(s) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function showLoading(on) {
  els.loading.classList.toggle("is-hidden", !on);
}

function showError(err) {
  console.error(err);
  els.loading.innerHTML = `<p style="max-width:340px;text-align:center;line-height:1.5">
    Couldn't load the stems.<br><span style="opacity:.7">${escapeHtml(err.message || String(err))}</span>
  </p>`;
  els.loading.classList.remove("is-hidden");
}

// Init slider fills on load.
setSliderFill(els.masterVol, els.masterVol.value);
init();
