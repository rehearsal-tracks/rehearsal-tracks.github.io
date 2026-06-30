// Pure transforms over a song manifest (schema v1). All return a new manifest
// (shallow clone + new stems array); none mutate their input. durationSeconds
// is always max(stem seconds); see design decision #6 (seconds persisted per stem).

const clone = (m) => ({ ...m, stems: m.stems.map((s) => ({ ...s })) });
const maxSeconds = (stems) => Math.max(...stems.map((s) => s.seconds));
const allHaveSeconds = (stems) => stems.every((s) => typeof s.seconds === "number");

export function reorderStems(manifest, orderedSlugs) {
  const have = manifest.stems.map((s) => s.slug);
  const sameSet =
    orderedSlugs.length === have.length &&
    new Set(orderedSlugs).size === orderedSlugs.length &&
    orderedSlugs.every((slug) => have.includes(slug));
  if (!sameSet) {
    throw new Error(`stem set mismatch: client view is stale, re-fetch and retry`);
  }
  const bySlug = new Map(manifest.stems.map((s) => [s.slug, { ...s }]));
  return { ...manifest, stems: orderedSlugs.map((slug) => bySlug.get(slug)) };
}

export function editMeta(manifest, { title, artist } = {}) {
  const m = clone(manifest);
  if (title !== undefined) m.title = title;
  if (artist !== undefined) m.artist = artist;
  return m;
}

export function addStem(manifest, { name, slug, seconds, src, waveform }) {
  if (!slug) throw new Error(`stem slug is empty/invalid`);
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    throw new Error(`stem seconds required (got ${JSON.stringify(seconds)})`);
  }
  if (manifest.stems.some((s) => s.slug === slug)) {
    throw new Error(`stem slug "${slug}" already exists`);
  }
  const m = clone(manifest);
  m.stems.push({ name, slug, seconds, src, waveform });
  m.durationSeconds = Math.max(manifest.durationSeconds, seconds);
  return m;
}

export function renameStem(manifest, slug, newName) {
  if (!newName || !newName.trim()) throw new Error(`new name is empty`);
  const m = clone(manifest);
  const stem = m.stems.find((s) => s.slug === slug);
  if (!stem) throw new Error(`unknown stem slug "${slug}"`);
  stem.name = newName;
  return m;
}

export function removeStem(manifest, slug) {
  if (!manifest.stems.some((s) => s.slug === slug)) {
    throw new Error(`unknown stem slug "${slug}"`);
  }
  if (manifest.stems.length <= 1) throw new Error(`cannot remove the last stem`);
  const m = clone(manifest);
  m.stems = m.stems.filter((s) => s.slug !== slug);
  // Recompute only when every remaining stem carries seconds; otherwise a legacy
  // manifest can't be recomputed safely — leave the (harmless over-estimate) as-is.
  if (allHaveSeconds(m.stems)) {
    m.durationSeconds = maxSeconds(m.stems);
  } else {
    console.warn(`• removeStem: a remaining stem lacks "seconds"; leaving durationSeconds=${m.durationSeconds}`);
  }
  return m;
}
