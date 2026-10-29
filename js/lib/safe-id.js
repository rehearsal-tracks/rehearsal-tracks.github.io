// js/lib/safe-id.js — front-end twin of scripts/lib/safe-path.js safeId. Song and project ids from
// the URL are interpolated into R2 paths and localStorage keys, so they're checked first. Keep the
// regex identical to the scripts' (safe-id.test.js compares them).
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function isSafeId(s) {
  return typeof s === "string" && ID_RE.test(s);
}
