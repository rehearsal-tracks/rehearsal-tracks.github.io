// js/lava-lamp.js — audio-reactive "gooey toxic waste" lava-lamp background.
//
// Tier 1 (vanilla, no dependencies): coloured blobs are drawn on a full-viewport <canvas> and rise
// like wax in a lamp; the whole canvas is run through an SVG "goo" filter (a big Gaussian blur then
// a steep alpha threshold) so blobs that touch MERGE with a liquid meniscus and pinch apart again.
// A molten-orange → toxic-lime colour ramp (hot at the bottom, cooling as it rises) + an emissive
// drop-shadow glow read as radioactive ooze.
//
// When audio is playing the goo reacts: blobs SWELL and rise faster to the bass, the glow BRIGHTENS
// with the overall level, and the sway SHIMMERS on the treble. With no audio (the landing page, or
// before play) it falls back to a gentle idle drift so the page still looks alive. Honours
// prefers-reduced-motion by drawing a single static frame.

// ── Audio tap ─────────────────────────────────────────────────────────────────────────────────
// We don't reach into stemplayer-js's audio graph — instead we patch AudioNode.connect once so that
// whenever ANY node connects to a context's final destination (the speakers), we ALSO feed it into a
// shared AnalyserNode. An analyser is a passive sink: it reads the signal without altering the path
// to the output, so this captures the full mix no matter how the component wires itself, and the
// tap is wrapped in try/catch so a visual can never break playback. The patch is installed on module
// load — well before the first user-gesture play that lazily creates the AudioContext.
let analyser = null;
let freqData = null;

function installAudioTap() {
  if (typeof AudioNode === "undefined" || AudioNode.prototype.__lavaTapped) return;
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    const result = origConnect.call(this, target, ...rest);
    try {
      if (typeof AudioDestinationNode !== "undefined" && target instanceof AudioDestinationNode) {
        const ctx = this.context;
        if (!analyser || analyser.context !== ctx) {
          analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.8;
          freqData = new Uint8Array(analyser.frequencyBinCount);
        }
        origConnect.call(this, analyser); // passive tap, alongside the real output
      }
    } catch { /* a background visual must never interfere with playback */ }
    return result;
  };
  AudioNode.prototype.__lavaTapped = true;
}

// ── Blob field ──────────────────────────────────────────────────────────────────────────────────
const HOT = [255, 106, 26];   // molten orange — the heat source at the bottom
const COOL = [139, 255, 31];  // toxic lime — cooled ooze up top

let layer, canvas, ctx;
let W = 0, H = 0, DPR = 1;
const blobs = [];
let t = 0, last = 0;
// Smoothed audio signals (0..1): bass, treble, overall level. Smoothing keeps the goo from
// twitching frame-to-frame — it eases toward each new reading instead of snapping.
let sBass = 0, sTreble = 0, sLevel = 0;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

function makeBlobs() {
  blobs.length = 0;
  const unit = Math.min(W, H);
  // Scale the count to viewport area so phones aren't overcrowded and big screens aren't sparse.
  const count = clamp(Math.round((W * H) / 150000), 6, 14);
  for (let i = 0; i < count; i++) {
    const baseR = unit * rand(0.06, 0.13);
    blobs.push({
      baseX: rand(0, W),
      x: rand(0, W),
      y: rand(0, H),
      baseR,
      r: baseR,
      rise: unit * rand(0.0135, 0.034),  // px/sec upward drift (~75% of the original pace — slower, calmer)
      swayAmp: W * rand(0.03, 0.08),
      swayFreq: rand(0.08, 0.28),
      swayPhase: rand(0, Math.PI * 2),
      breathe: rand(0.3, 0.8),
      breathePhase: rand(0, Math.PI * 2),
    });
  }
}

function colorAt(y) {
  // p: 0 at the top (cool lime) → 1 at the bottom (hot orange).
  const p = clamp(y / H, 0, 1);
  const r = Math.round(COOL[0] + (HOT[0] - COOL[0]) * p);
  const g = Math.round(COOL[1] + (HOT[1] - COOL[1]) * p);
  const b = Math.round(COOL[2] + (HOT[2] - COOL[2]) * p);
  return `${r}, ${g}, ${b}`;
}

function readAudio() {
  if (analyser) {
    analyser.getByteFrequencyData(freqData);
    const n = freqData.length;
    const avg = (from, to) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += freqData[i];
      return sum / ((to - from) * 255);
    };
    return {
      bass: avg(0, Math.floor(n * 0.15)),
      treble: avg(Math.floor(n * 0.55), n),
      level: avg(0, n),
    };
  }
  // Idle: no audio hooked up — breathe gently so the lamp still feels alive.
  return { bass: 0, treble: 0, level: 0.12 + 0.06 * Math.sin(t * 0.6) };
}

function update(dt) {
  const a = readAudio();
  sBass += (a.bass - sBass) * 0.18;
  sTreble += (a.treble - sTreble) * 0.18;
  sLevel += (a.level - sLevel) * 0.10;

  for (const b of blobs) {
    b.y -= b.rise * dt * (1 + sBass * 3.4);        // bass makes the ooze rise faster
    b.x = b.baseX + Math.sin(t * b.swayFreq + b.swayPhase) * b.swayAmp * (1 + sTreble * 1.2);
    const breathe = Math.sin(t * b.breathe + b.breathePhase) * 0.10;
    const shimmer = sTreble * Math.sin(t * 9 + b.breathePhase) * 0.08;  // treble surface ripple
    b.r = b.baseR * (1 + sBass * 0.75 + breathe + shimmer);             // bass swell
    if (b.y < -b.r) {                               // risen off the top → re-enter from below
      b.y = H + b.r;
      b.baseX = rand(0, W);
    }
  }

  // Overall level drives the emissive glow blur (CSS var consumed by the canvas drop-shadow).
  layer.style.setProperty("--lava-glow", (14 + sLevel * 68).toFixed(1) + "px");
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  for (const b of blobs) {
    const c = colorAt(b.y);
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    // Solid core so the goo filter's alpha threshold keeps the blob; soft edge for it to bite into.
    g.addColorStop(0, `rgba(${c}, 0.95)`);
    g.addColorStop(0.55, `rgba(${c}, 0.95)`);
    g.addColorStop(1, `rgba(${c}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function loop(ts) {
  const now = ts / 1000;
  let dt = last ? now - last : 0.016;
  last = now;
  if (dt > 0.05) dt = 0.05;   // clamp big gaps (e.g. returning to a backgrounded tab) so nothing jumps
  t += dt;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const rx = W ? w / W : 1;
  const ry = H ? h / H : 1;
  W = w;
  H = h;
  DPR = Math.min(window.devicePixelRatio || 1, 1.5);   // cap DPR — the goo is blurry, so pixels are cheap to lose
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!blobs.length) makeBlobs();
  else for (const b of blobs) { b.x *= rx; b.baseX *= rx; b.y *= ry; }  // keep the field proportional, no reset flash
}

function debounce(fn, ms) {
  let id;
  return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}

function start() {
  layer = document.createElement("div");
  layer.id = "lava";
  layer.setAttribute("aria-hidden", "true");
  // The goo filter: blur bleeds neighbouring blobs together, then the steep alpha ramp
  // (0 0 0 24 -9 → alpha_out = 24·alpha − 9) snaps that bleed into a crisp liquid edge and merges
  // any blobs that overlap. Generous filter region so edge blobs' blur isn't clipped.
  layer.innerHTML =
    '<svg class="lava-defs" aria-hidden="true">' +
    '<filter id="lava-goo" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">' +
    '<feGaussianBlur in="SourceGraphic" stdDeviation="18" result="blur"/>' +
    '<feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -9"/>' +
    "</filter></svg>";
  canvas = document.createElement("canvas");
  canvas.id = "lava-canvas";
  layer.appendChild(canvas);
  document.body.appendChild(layer);
  ctx = canvas.getContext("2d");

  resize();
  window.addEventListener("resize", debounce(resize, 150));

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update(0);   // one settle of the CSS glow var
    draw();      // a single static frame — no animation loop
    return;
  }
  requestAnimationFrame(loop);
}

export function initLavaLamp() {
  installAudioTap();  // patch ASAP so it's in place before the first play creates the AudioContext
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

initLavaLamp();
