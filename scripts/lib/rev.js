// scripts/lib/rev.js — content revision hash used to version a stem's media folder.
//
// Media (audio.m3u8 + seg_*.mp3 + waveform.json) is served `immutable, max-age=1yr` from stable
// paths, so re-uploading a replaced stem at the SAME url would leave existing listeners stuck on
// the old bytes for up to a year (HTTP cache never revalidates `immutable`). The fix: version the
// path by a content hash of the SOURCE stem file — `songs/<id>/<slug>/<rev>/…`. A replaced stem
// gets a new rev → a new url → a guaranteed-fresh fetch, while `immutable` stays honest.
//
// Same bytes → same rev, so idempotent re-runs (re-segmenting unchanged audio) don't churn urls.
// See ~/.claude/plans/2026-07-02-stem-player-media-versioning-design.md.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

// 10 hex chars ≈ 40 bits — plenty to avoid collisions across a stem's revisions, matching the
// app-shell stamp (scripts/stamp-sw.js) so the two version schemes read alike.
export const REV_LENGTH = 10;

// Pure helper: rev of an in-memory Buffer/string. Kept separate so it's unit-testable without fs.
export function revOf(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, REV_LENGTH);
}

// Streams a (potentially large) source stem file through sha256 and returns its short rev.
export function fileRev(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex").slice(0, REV_LENGTH)));
  });
}
