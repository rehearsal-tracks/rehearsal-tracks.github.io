// Pure view helpers for the catalog (no DOM, no fetch) — unit-testable.

// 612.4 -> "10:12"; 63 -> "1:03"; 0 -> "0:00"
export function formatDuration(seconds) {
  const total = Math.round(seconds || 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Maps a catalog song to the strings the card / drawer render.
export function songCardModel(song) {
  const stemLabel = `${song.stemCount} ${song.stemCount === 1 ? "stem" : "stems"}`;
  return {
    id: song.id,
    href: `stream.html?song=${encodeURIComponent(song.id)}`,
    title: song.title,
    meta: [song.artist, formatDuration(song.durationSeconds), stemLabel]
      .filter(Boolean)
      .join(" · "),
  };
}
