import { stemNameFromFilename } from "./slug.js";

// An order prefix is leading digits followed by at least one separator char.
// Requiring the separator means "2nd-guitar.wav" is NOT parsed as order 2.
const PREFIX_RE = /^(\d+)[\s._-]+/;

// parseStem("01-drums.wav")   -> { order: 1,    name: "drums" }
// parseStem("2 bass.wav")     -> { order: 2,    name: "bass" }
// parseStem("vocals.wav")     -> { order: null, name: "vocals" }
// parseStem("2nd-guitar.wav") -> { order: null, name: "2nd-guitar" }
export function parseStem(file) {
  const base = stemNameFromFilename(file); // strips directory + extension
  const m = PREFIX_RE.exec(base);
  if (!m) return { order: null, name: base };
  const name = base.slice(m[0].length);
  // Guard: never produce an empty display name (would slug to "").
  if (!name) return { order: parseInt(m[1], 10), name: base };
  return { order: parseInt(m[1], 10), name };
}
