// js/stretch/core.js — experimental headless pitch-preserving time-stretch playback core.
//
// WHY THIS EXISTS: the shipped player's engine (@firstcoders/hls-web-audio) has no rate knob — its
// transport clock IS ac.currentTime and it schedules AudioBufferSourceNodes at native rate. So
// slowing playback without raising pitch cannot be a downstream node or a parameter; it needs a
// playback core where a time-stretcher is the clock. This is that core, built on the vendored
// signalsmith-stretch worklet (MIT). It owns the audio; the stemplayer-js component is a silent
// view (see js/stretch.js). Design: ~/.claude/plans/2026-07-07-stem-player-time-stretch-design.md
//
// One stretch node per stem → per-stem GainNode → per-stem compressor → master gain → limiter →
// destination. All nodes share one schedule (same rate, same start, same input origin) so they stay
// sample-aligned; the mix is trivial live gain, exactly like the old engine's per-track gain.
// Per-stem compressors are transparent by default; a 50ms monitor watches the master output and
// engages compression on any stem peaking above −3 dBFS while the master approaches 0 dBFS. Once
// flagged, a stem stays compressed for 1 s after it drops below the threshold (hold timer) to
// prevent rapid on/off pumping. The brickwall limiter is the final safety net. Streaming feed: decode segments
// just ahead of the read head and addBuffers() them, dropBuffers() behind to cap RAM. Because we
// never play faster than 1×, we consume source ≤ real-time and can always stay ahead of playback.

import SignalsmithStretch from "../vendor/SignalsmithStretch.mjs";
import { parseM3u8 } from "../prefetch.js";

const LOOKAHEAD_SEC = 20;   // keep each stem decoded this far ahead of the read head (source secs)
const KEEP_BEHIND_SEC = 4;  // free decoded input older than this behind the read head
const PREBUFFER_SEC = 3;    // fill this much before the first play / after a seek
const FEED_INTERVAL_MS = 200;
const MONITOR_MS = 50;          // per-stem compression monitor poll rate
const MASTER_HOT = 0.707;      // −3 dBFS in linear — master must exceed this to activate per-stem compression
const STEM_HOT = 0.707;        // −3 dBFS in linear — per-stem flag threshold
const HOT_HOLD_MS = 1000;      // keep a stem's compressor engaged this long after it drops below STEM_HOT

// Minimal event emitter (time, end, error, buffering).
function emitter() {
  const map = new Map();
  return {
    on(ev, cb) { (map.get(ev) || map.set(ev, []).get(ev)).push(cb); return () => {
      const a = map.get(ev); if (a) a.splice(a.indexOf(cb), 1);
    }; },
    emit(ev, arg) { (map.get(ev) || []).forEach((cb) => { try { cb(arg); } catch { /* listener */ } }); },
  };
}

export function createStretchEngine({ ac, base, stems, fetchImpl = fetch }) {
  const ev = emitter();

  // Per-stem playback state. `node` = stretch worklet; `gain` = live mix gain; `segs` = m3u8 entries;
  // `nextIdx` = next segment to decode; `fedUntil` = source seconds decoded into the node so far
  // (relative to the current feed origin — reset on seek); `busy` = a decode is in flight.
  const tracks = stems.map((s) => ({
    stem: s,
    node: null,
    gain: null,
    compressor: null,
    analyser: null,
    hotUntil: 0,
    compressed: false,
    segs: [],
    nextIdx: 0,
    fedUntil: 0,
    busy: false,
    droppedTo: 0,
  }));

  const master = ac.createGain();

  // Brickwall limiter: catches peaks before they clip the destination.
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.05;

  master.connect(limiter);
  limiter.connect(ac.destination);

  // Master-level meter: taps the signal between master gain and limiter so we see the pre-limited
  // peak. Used by the per-stem compression monitor to decide whether the mix is approaching 0 dBFS.
  const masterAnalyser = ac.createAnalyser();
  masterAnalyser.fftSize = 2048;
  master.connect(masterAnalyser);
  const masterBuf = new Float32Array(2048);
  const stemBuf = new Float32Array(2048);
  let monitorTimer = null;

  let duration = 0;      // total song length (secs), from the m3u8 durations
  let rate = 1;          // current playback rate (0.7..1)
  let playing = false;
  let inputBase = 0;     // source seconds at the current feed origin / buffer position 0 (moves on seek)
  let headRel = 0;       // read position RELATIVE to inputBase (secs into the fed buffers)
  let feedTimer = null;
  let ended = false;

  // Read position relative to the feed origin. WHILE PLAYING the worklet's own inputTime is the live
  // truth; otherwise `headRel` is (it's frozen on pause and set explicitly on seek). We must NOT trust
  // node.inputTime while stopped: dropBuffers()/stop() don't reset it and no process() runs to refresh
  // it, so after a paused seek it still holds the pre-pause position — which would make play() resume
  // tens of seconds past where the user dropped the playhead.
  function liveRel() {
    const n = tracks[0]?.node;
    return playing && n ? (Number(n.inputTime) || 0) : headRel;
  }

  // Master source-time playhead: feed origin + how far the (synchronised) nodes have read.
  function inputTime() {
    return inputBase + liveRel();
  }

  async function load() {
    // 1) Parse each stem's m3u8 for its segment list + durations (cheap; no audio decode).
    await Promise.all(tracks.map(async (t) => {
      const m3u8Url = `${base}/${t.stem.src}`;
      const res = await fetchImpl(m3u8Url, { cache: "force-cache" });
      if (!res.ok) throw new Error(`m3u8 ${res.status} for ${t.stem.name}`);
      t.segs = parseM3u8(await res.text(), m3u8Url);
    }));
    duration = Math.max(0, ...tracks.map((t) => (t.segs.length ? t.segs[t.segs.length - 1].end : 0)));

    // 2) Create one stretch node per stem, wired stem → gain → master. Instantiations run in
    //    parallel; each compiles/loads the (cached) worklet + WASM.
    await Promise.all(tracks.map(async (t) => {
      // numberOfInputs MUST be 1 (the library's default). The worklet's process() unconditionally
      // reads `inputList[0]` — even in its no-live-input branch it does `inputs[c % inputs.length]`
      // (SignalsmithStretch.mjs ~line 269). With numberOfInputs:0, inputList is [] so inputList[0] is
      // undefined → `.length` throws a fatal WASM/worklet processorerror and playback dies silently.
      // We never CONNECT anything to the input, so inputList[0] is an empty channel array []: the
      // live-input branch (`else if (inputs?.length)`) stays false and it correctly reads our
      // addBuffers() data in the buffer-playback branch.
      const node = await SignalsmithStretch(ac, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      // signalsmith only refreshes `.inputTime` when an update interval is set — without this the
      // reported input position stays 0, freezing our playhead AND our feed/dropBuffers decisions.
      node.setUpdateInterval?.(0.1);
      const gain = ac.createGain();
      node.connect(gain);

      // Per-stem compressor: transparent by default (threshold 0 dB = nothing reaches it).
      // The monitor lowers the threshold when this stem is flagged as hot.
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = 0;
      comp.knee.value = 6;
      comp.ratio.value = 1;
      comp.attack.value = 0.005;
      comp.release.value = 0.1;

      // Per-stem analyser: passive tap BEFORE the compressor so we measure uncompressed level.
      const stemAn = ac.createAnalyser();
      stemAn.fftSize = 2048;

      gain.connect(comp);
      gain.connect(stemAn);
      comp.connect(master);

      t.node = node;
      t.gain = gain;
      t.compressor = comp;
      t.analyser = stemAn;
    }));

    return { duration };
  }

  // Decode one segment for a track and append it to the node's input buffer.
  async function feedOne(t) {
    if (t.busy || t.nextIdx >= t.segs.length) return;
    t.busy = true;
    try {
      const seg = t.segs[t.nextIdx];
      const res = await fetchImpl(seg.url, { cache: "force-cache" });
      const buf = await ac.decodeAudioData(await res.arrayBuffer());
      const chans = [];
      for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c).slice());
      if (chans.length === 1) chans.push(chans[0]); // mono → duplicate to stereo
      await t.node.addBuffers(chans);
      t.fedUntil += buf.duration;
      t.nextIdx += 1;
    } catch (e) {
      ev.emit("error", e);
    } finally {
      t.busy = false;
    }
  }

  // Feed loop: keep every stem decoded to `target` source-seconds ahead of the read head, and free
  // input that has fallen behind. Detect end when the read head reaches the song duration.
  function feedTick() {
    const head = inputTime();
    const relHead = head - inputBase;             // read position within the current feed origin
    const target = relHead + LOOKAHEAD_SEC;
    for (const t of tracks) {
      if (t.fedUntil < target) feedOne(t);        // fire-and-forget; `busy` guards re-entry
      const dropTo = relHead - KEEP_BEHIND_SEC;
      if (t.node && dropTo > t.droppedTo + 1) {
        t.droppedTo = dropTo;
        t.node.dropBuffers?.(dropTo);
      }
    }
    if (playing && duration && head >= duration - 0.05) stop(true);
    ev.emit("time", { time: head, pct: duration ? head / duration : 0 });
  }

  function startFeedLoop() {
    if (feedTimer) return;
    feedTimer = setInterval(feedTick, FEED_INTERVAL_MS);
  }
  function stopFeedLoop() {
    if (feedTimer) { clearInterval(feedTimer); feedTimer = null; }
  }

  // ── Per-stem compression monitor ──────────────────────────────────────────────────────────
  // Polled at 50 ms. Two gates: (1) master peak > −3 dBFS activates the system, (2) each stem
  // independently checked — any stem peaking above −3 dBFS gets its compressor engaged with a
  // 1 s hold timer. Compressor params ramp via setTargetAtTime for click-free transitions.
  function peakOf(analyserNode, buf) {
    analyserNode.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i]);
      if (v > peak) peak = v;
    }
    return peak;
  }

  function monitorTick() {
    if (!playing) return;
    const masterPeak = peakOf(masterAnalyser, masterBuf);
    const now = performance.now();

    if (masterPeak > MASTER_HOT) {
      for (const t of tracks) {
        if (!t.analyser) continue;
        if (peakOf(t.analyser, stemBuf) > STEM_HOT) {
          t.hotUntil = now + HOT_HOLD_MS;
        }
      }
    }

    for (const t of tracks) {
      if (!t.compressor) continue;
      const shouldCompress = now < t.hotUntil;
      if (shouldCompress && !t.compressed) {
        const when = ac.currentTime;
        t.compressor.threshold.setTargetAtTime(-15, when, 0.01);
        t.compressor.ratio.setTargetAtTime(6, when, 0.01);
        t.compressed = true;
      } else if (!shouldCompress && t.compressed) {
        const when = ac.currentTime;
        t.compressor.threshold.setTargetAtTime(0, when, 0.1);
        t.compressor.ratio.setTargetAtTime(1, when, 0.1);
        t.compressed = false;
      }
    }
  }

  function startMonitor() {
    if (!monitorTimer) monitorTimer = setInterval(monitorTick, MONITOR_MS);
  }
  function stopMonitor() {
    if (monitorTimer) { clearInterval(monitorTimer); monitorTimer = null; }
  }

  // Schedule all nodes to (re)start reading at `relInput` (relative to feed origin) at the current
  // rate, a hair ahead of now so the worklet can compensate its latency. Shared schedule = sync.
  function scheduleAll(relInput) {
    const when = ac.currentTime + 0.05;
    // Use the library's start() convenience (which builds the schedule internally). Passing the raw
    // schedule() object with the same fields did NOT begin buffer playback; start() reliably does.
    // Signature: start(when, offset, duration, rate, semitones).
    for (const t of tracks) {
      t.node?.start(when, relInput, undefined, rate, 0);
    }
  }

  async function ensurePrebuffer(relFrom) {
    // Decode until each stem has PREBUFFER_SEC past relFrom (or runs out), so play doesn't underrun.
    const goal = relFrom + PREBUFFER_SEC;
    let guard = 0;
    while (guard++ < 200 && tracks.some((t) => t.fedUntil < goal && t.nextIdx < t.segs.length)) {
      await Promise.all(tracks.map((t) => (t.fedUntil < goal ? feedOne(t) : null)));
    }
  }

  async function play() {
    if (playing) return;
    if (ac.state === "suspended") await ac.resume();
    ended = false;
    // Start from the explicit read position, NOT node.inputTime (see liveRel): after a paused seek
    // the worklet's clock is stale, so trusting it here is exactly what jumped playback ahead.
    await ensurePrebuffer(headRel);
    scheduleAll(headRel);
    playing = true;
    startFeedLoop();
    startMonitor();
    ev.emit("state", { playing: true });
  }

  function stop(isEnd = false) {
    if (!playing && !isEnd) return;
    if (playing) headRel = liveRel(); // freeze the live read position so resume continues from here
    playing = false;
    for (const t of tracks) t.node?.stop?.();
    stopFeedLoop();
    stopMonitor();
    if (isEnd) { ended = true; ev.emit("end"); }
    ev.emit("state", { playing: false });
  }

  function pause() { stop(false); }

  async function seek(sec) {
    const clamped = Math.max(0, Math.min(duration, sec));
    const wasPlaying = playing;
    if (playing) { playing = false; for (const t of tracks) t.node?.stop?.(); stopFeedLoop(); }
    // Feed whole segments, so the feed origin (buffer position 0) snaps to the START of the segment
    // containing `clamped`. dropBuffers() with no arg clears each node and resets its input timeline
    // to 0, so inputBase carries the absolute position of that boundary.
    const segs = tracks[0].segs;
    let originIdx = segs.findIndex((s) => s.end > clamped);
    if (originIdx < 0) originIdx = Math.max(0, segs.length - 1); // past the last segment → last one
    inputBase = segs[originIdx] ? segs[originIdx].start : 0;
    // Resume from the EXACT sought position: headRel is the offset of `clamped` into that first
    // segment. (Reading a fraction into the fed buffers is fine — the data from the boundary is there.)
    headRel = Math.max(0, clamped - inputBase);
    for (const t of tracks) {
      await t.node?.dropBuffers?.();
      t.nextIdx = t.segs[originIdx] ? originIdx : 0;
      t.fedUntil = 0;
      t.busy = false;
      t.droppedTo = 0;
    }
    ev.emit("time", { time: inputBase + headRel, pct: duration ? (inputBase + headRel) / duration : 0 });
    if (wasPlaying) await play();
  }

  function setRate(r) {
    rate = Math.max(0.5, Math.min(1, r));
    if (playing) scheduleAll(inputTime() - inputBase); // reschedule from current pos at new rate
    ev.emit("rate", rate);
  }

  // Live per-stem gain (volume already folded with mute/solo by the caller). Instant, like the
  // old engine's per-track gain — no re-feed needed since each stem has its own node + gain.
  function setGain(index, g) {
    const t = tracks[index];
    if (t?.gain) t.gain.gain.value = g;
  }

  function destroy() {
    stop(false);
    for (const t of tracks) {
      try { t.node?.disconnect(); } catch { /* already gone */ }
      try { t.gain?.disconnect(); } catch { /* already gone */ }
      try { t.compressor?.disconnect(); } catch { /* already gone */ }
      try { t.analyser?.disconnect(); } catch { /* already gone */ }
    }
    try { masterAnalyser.disconnect(); } catch { /* already gone */ }
    try { master.disconnect(); } catch { /* already gone */ }
    try { limiter.disconnect(); } catch { /* already gone */ }
  }

  return {
    load, play, pause, seek, setRate, setGain, destroy,
    on: ev.on,
    get duration() { return duration; },
    get rate() { return rate; },
    get playing() { return playing; },
    get currentTime() { return inputTime(); },
    get ended() { return ended; },
  };
}
