export function buildManifest({ id, title, artist, stems }) {
  return {
    schemaVersion: 1,
    id,
    title,
    artist,
    durationSeconds: Math.max(...stems.map((s) => s.seconds)),
    // src/waveform are versioned by the stem's content rev (<slug>/<rev>/…) so a replaced stem
    // gets a new, cache-safe url. The rev is persisted too for the prune step + offline sync.
    stems: stems.map((s) => {
      if (!s.rev) {
        throw new Error(`stem "${s.slug}" is missing a content rev (needed for versioned media paths)`);
      }
      return {
        name: s.name,
        slug: s.slug,
        seconds: s.seconds,
        rev: s.rev,
        src: `${s.slug}/${s.rev}/audio.m3u8`,
        waveform: `${s.slug}/${s.rev}/waveform.json`,
      };
    }),
  };
}
