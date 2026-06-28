# Milestone 1 — Validation Report

**Goal:** Prove that one real song streams from R2 and plays sample-accurate across
15 stems / ~10 minutes, on desktop and both mobile platforms.

**Engine:** `@stemplayer-js/stemplayer-js` (Web Audio + per-segment `decodeAudioData`).

---

## Deviations discovered during validation

These differ from the original spec/plan and were required to make playback work:

1. **Segment format: MP3, not MPEG-TS.** `stemplayer-js` decodes each segment with the
   Web Audio `decodeAudioData()` API, which cannot read MPEG-TS (`.ts`) containers. The
   pipeline now emits standalone MP3 segments via ffmpeg's `segment` muxer
   (`-f segment -segment_format mp3 -reset_timestamps 1`), matching the stemplayer-js demo.
   Symptom before fix: "The player is buffering" forever; segments fetched (200) but never decoded.

2. **`<stemplayer-js-controls>` is required.** The player needs the controls row to
   establish the measured waveform area and the transport UI. `stream.js` now creates it.

3. **Resize nudge after load.** `stemplayer-js` only computes waveform pixel-width on a
   resize/layout event; when built programmatically the initial recalc runs before the
   workspace measures its width (`Workspace.waveformWidth` returns 0). `stream.js`
   dispatches a `resize` after layout + on `loading-end` to force the recalculation.

4. **Waveform format: no shim needed.** `audiowaveform`'s native JSON (integer min/max
   pairs) works directly — the renderer's `Peaks` class normalizes internally. The spec's
   pre-planned shim branch was NOT required.

---

## Validation matrix (spec §9)

Run against a real 15-stem, ~10-minute song.

| Check | Result | Notes |
|---|---|---|
| **Sample-accuracy** — transient-heavy stem stays aligned at t≈0 and t≈10min (by ear + waveform) | ⬜ | |
| **Streaming proof** — with DevTools throttling, playback starts before full download; `.mp3` segments fetched progressively | ⬜ | |
| **Memory bounded** — heap during playback does not approach the full-decode figure (~3.2 GB) | ⬜ | |
| **Concurrency** — 15 simultaneous HLS streams succeed over HTTP/2; note steady-state request volume | ⬜ | |
| **Device: iOS Safari** — manual pass on a real device | ⬜ | |
| **Device: Android Chrome** — manual pass on a real device | ⬜ | |
| **iOS autoplay** — playback requires a tap; AudioContext resumes on that gesture; no autoplay attempted before it | ⬜ | |

## Results so far

- ✅ 2-stem real song ("A Brand New Day") streams and plays in sync on desktop Chrome.
- ✅ Waveforms render; per-stem volume / mute / solo functional.
- ✅ **Large content confirmed working: 10+ WAV stems, ~10-min songs** stream and stay in sync on desktop.
- ✅ **Mobile device: functionality confirmed great** on a real device (full formal matrix below not yet exhaustively filled — sample-accuracy/memory/concurrency confirmed functionally, not yet formally measured).
- Overall verdict (Andrew, 2026-06-28): working great; moving forward to post-M1 roadmap.

The formal per-row matrix above remains to be filled in with measurements when time allows; functional behavior is confirmed good.

---

## Milestone 1 decision

- ⬜ **PASS** — all criteria met; `stemplayer-js` confirmed as the engine.
- ⬜ **FALLBACK** — sample-accuracy or 15-stem concurrency failed; trigger spec §11
  fallback (swap to a `hls.js`-based engine — no re-encoding needed) as a follow-up plan.
