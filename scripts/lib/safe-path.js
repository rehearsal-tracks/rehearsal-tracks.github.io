// Positive-allowlist guards for single path components reaching the filesystem
// or rclone. Allowlists (not denylists) so unanticipated tricks fail closed.

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;            // matches toSlug() output; no ".", "/", ":", spaces
const FILENAME_RE = /^[A-Za-z0-9 _-]+\.[A-Za-z0-9]+$/; // base + exactly one extension; blocks "..", leading "."

export function safeId(s) {
  if (typeof s !== "string" || !ID_RE.test(s)) {
    throw new Error(`invalid id: ${JSON.stringify(s)}`);
  }
  return s;
}

export function safeFilename(s) {
  if (typeof s !== "string" || !FILENAME_RE.test(s) || s.includes("..")) {
    throw new Error(`invalid filename: ${JSON.stringify(s)}`);
  }
  return s;
}
