// scripts/lib/prune.js — pure core for `npm run prune-media`.
//
// When a stem is replaced, its new content rev lands at a new <slug>/<rev>/ folder and the old
// rev's files become orphaned (unreferenced by the manifest, but still taking R2 space). This
// decides which remote files under songs/<id>/ are safe to delete: a file is orphaned when its
// <slug>/<rev> group isn't referenced by any current stem.
//
// Safety: refuses to prune a manifest that isn't versioned yet — there, legacy loose files
// (<slug>/audio.m3u8, <slug>/seg_000.mp3) would each look orphaned and get wrongly deleted. Such a
// song must be re-segmented (which versions it) before pruning is meaningful.

// The first two path segments of a relative media path — "<slug>/<rev>" for versioned files.
function groupOf(relPath) {
  if (!relPath) return null;
  const parts = relPath.split("/");
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
}

// The set of "<slug>/<rev>" groups the current manifest still points at.
export function referencedGroups(manifest) {
  return new Set(
    manifest.stems.flatMap((s) => [s.src, s.waveform].map(groupOf).filter(Boolean))
  );
}

// A manifest is versioned when every stem's src looks like "<slug>/<rev>/audio.m3u8" (>=3 segs).
export function isVersioned(manifest) {
  return manifest.stems.length > 0 && manifest.stems.every((s) => (s.src || "").split("/").length >= 3);
}

// Given a manifest and the files under songs/<id>/ (paths relative to that prefix), return the
// orphaned files. Top-level files (manifest.json — no "/") are always kept.
export function findOrphans(manifest, files) {
  if (!isVersioned(manifest)) {
    return { skip: true, reason: "manifest not versioned (re-segment before pruning)", orphans: [] };
  }
  const keep = referencedGroups(manifest);
  const orphans = files.filter((f) => {
    const group = groupOf(f);
    return group !== null && !keep.has(group);
  });
  return { skip: false, orphans };
}
