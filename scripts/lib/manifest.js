export function buildManifest({ id, title, artist, stems }) {
  return {
    schemaVersion: 1,
    id,
    title,
    artist,
    durationSeconds: Math.max(...stems.map((s) => s.seconds)),
    stems: stems.map((s) => ({
      name: s.name,
      slug: s.slug,
      seconds: s.seconds,
      src: `${s.slug}/audio.m3u8`,
      waveform: `${s.slug}/waveform.json`,
    })),
  };
}
