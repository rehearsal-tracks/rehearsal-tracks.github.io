// js/prefetch.js — anticipatory segment prefetch (data-loading optimization).
//
// The audio engine under stemplayer-js (@firstcoders/hls-web-audio) only fetches ~10s of each
// stem ahead of the playhead, just-in-time, and that window is hardcoded — with ~15 stems, a
// single slow segment stalls the WHOLE mix (the engine suspends the shared AudioContext if any
// stem's current segment isn't ready). We can't widen the engine's window, but its segment URLs
// come verbatim from each stem's m3u8 with no cache-busting, so we warm the browser HTTP cache
// OURSELVES, further ahead, and the engine's later fetch is served from cache transparently.
//
// This is the same component-agnostic philosophy as the lava-lamp audio tap: don't reach into the
// engine, just prepare what it will read. It degrades gracefully — if this does nothing, the
// engine's own 10s window still works — and it never touches the audio graph, so it can't break
// playback (all work is wrapped so a prefetch failure stays silent).
//
// REQUIRES cacheable segments: R2 objects must send `Cache-Control` (see scripts/lib/upload.js +
// scripts/set-cache-headers.js). Without it the browser won't reuse our warmed entries and we'd
// just double-fetch.

const ENGINE_LOOKAHEAD = 10;  // the engine owns ~this many seconds ahead; don't race it there
const MAX_INFLIGHT = 7;       // cap concurrent prefetch fetches so we never starve the engine's own
const TICK_MS = 500;          // how often we re-evaluate what to prefetch

// Parse an HLS media playlist into [{ url, start, end }] with cumulative times.
// Segment names are taken verbatim (matching the engine) and resolved relative to the m3u8 URL,
// so the warmed cache entry shares the engine's request URL. Durations come from #EXTINF (the
// last segment is short and stems can differ in length, so we never assume a fixed 6s).
export function parseM3u8(text, m3u8Url) {
  const segs = [];
  let dur = 6, start = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      const v = parseFloat(line.slice(8).split(",")[0]);
      if (Number.isFinite(v)) dur = v;
      continue;
    }
    if (line.startsWith("#")) continue;
    segs.push({ url: new URL(line, m3u8Url).href, start, end: start + dur });
    start += dur;
  }
  return segs;
}

// How far ahead of the playhead to prefetch. We deliberately pull the WHOLE remaining song
// (Infinity) rather than backing off on slow links: segments are fetched nearest-first, at low
// priority, under a concurrency cap, so the browser loads as fast as the connection allows and the
// cached buffer keeps growing while the user waits for the loading indicator — smoother on a slow
// pipe than a small window. Kept as a function: the single seam where a future tier could cap this
// (e.g. a per-song ceiling, or honoring Data Saver) without touching the scheduler.
function horizon() {
  return Infinity;
}

// Start prefetching for a built player. `player` is the <stemplayer-js> element (we poll its
// public `playerState` for the playhead); `base` + `stems` come straight from stream.js's manifest.
export function initPrefetch({ player, base, stems }) {
  if (!player || !Array.isArray(stems) || stems.length === 0) return { stop() {} };

  let tables = [];          // per-stem [{ url, start, end }]
  let inFlight = 0;
  let timer = null;
  const fetched = new Set(); // URLs we've already requested (or are requesting)

  // Load + parse every stem's playlist once. A stem whose m3u8 fails just contributes no prefetch
  // (its audio still plays via the engine); we don't want one bad playlist to stop the rest.
  Promise.all(stems.map(async (stem) => {
    const m3u8Url = `${base}/${stem.src}`;
    try {
      const res = await fetch(m3u8Url);
      if (!res.ok) return [];
      return parseM3u8(await res.text(), m3u8Url);
    } catch {
      return [];
    }
  })).then((t) => { tables = t; });

  function prefetch(url) {
    fetched.add(url);
    inFlight++;
    // priority:"low" is a hint (ignored where unsupported) so our speculative fetches yield to the
    // engine's imminent-segment fetches. Default cache/mode/credentials so the entry is shared.
    fetch(url, { priority: "low" })
      .then((r) => r.arrayBuffer())                 // drain into cache; we discard the bytes
      .catch(() => { fetched.delete(url); })         // allow a retry next tick on failure
      .finally(() => { inFlight--; });
  }

  function tick() {
    try {
      if (navigator.onLine === false || !tables.length) return;
      const ps = player.playerState;
      if (!ps) return;
      const currentTime = Number(ps.currentTime) || 0;
      const playing = !!ps.isPlaying;
      // While playing, skip the window the engine already owns so we don't race it on the same
      // URLs; while paused/pre-play, warm from the playhead itself (helps first-play readiness).
      const winStart = playing ? currentTime + ENGINE_LOOKAHEAD : currentTime;
      const winEnd = currentTime + horizon();

      // Gather every not-yet-fetched segment overlapping the window, across all stems.
      const candidates = [];
      for (let si = 0; si < tables.length; si++) {
        for (const seg of tables[si]) {
          if (seg.start >= winEnd) break;      // tables are time-ordered — nothing further fits
          if (seg.end <= winStart) continue;   // already behind the window
          if (!fetched.has(seg.url)) candidates.push({ si, seg });
        }
      }
      // Breadth-first by time (then stem): fill the earliest-needed moment across all stems first,
      // so every stem's cached horizon advances together and no single stem starves the mix.
      candidates.sort((a, b) => a.seg.start - b.seg.start || a.si - b.si);
      for (const c of candidates) {
        if (inFlight >= MAX_INFLIGHT) break;
        prefetch(c.seg.url);
      }
    } catch {
      /* a background optimization must never throw into the page */
    }
  }

  timer = setInterval(tick, TICK_MS);
  tick();

  return {
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
