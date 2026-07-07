import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pexec = promisify(execFile);

// Cache-Control policy for R2 objects (see the segment-prefetch design):
// - Audio assets (segments, waveform, playlist) NEVER change once written for a given encode, so
//   they're immutable + long-lived. This lets the player's prefetcher warm the browser HTTP cache
//   and have the audio engine reuse it (verified: without an explicit header, R2 falls back to
//   heuristic caching and segments get re-fetched).
// - JSON indices (manifest.json, catalog.json) are edited by the admin tool, so they stay no-cache.
//
// NOTE: Timing-Allow-Origin can't be set here. rclone's S3 backend only stores a fixed set of
// object headers (Cache-Control, Content-Type, Content-{Disposition,Encoding,Language}, Expires,
// x-amz-meta-*); any other --header-upload key logs `Don't know how to set key "X" on upload` and
// is dropped. R2 also can't return an arbitrary custom header from object metadata, so if we ever
// want Timing-Allow-Origin (for bandwidth-adaptive prefetch depth) it must be added at the
// Cloudflare edge (a "Modify Response Header" Transform Rule / Worker), not on the PUT.
export const CACHE_IMMUTABLE = "Cache-Control: public, max-age=31536000, immutable";
export const CACHE_MUTABLE = "Cache-Control: no-cache";

// Uploads localDir -> r2:<bucket>/<remotePrefix> using a preconfigured rclone remote "r2".
// Uses spawn (not promisify(execFile)) so rclone's --progress streams live to the terminal.
// The bulk copy stamps the immutable audio-asset headers and EXCLUDES manifest.json; if the dir
// carried a manifest (a full-song upload), it's re-pushed afterwards with the mutable policy.
export function uploadDir(localDir, bucket, remotePrefix) {
  const dest = `r2:${bucket}/${remotePrefix}`;
  return new Promise((resolve, reject) => {
    // --s3-no-check-bucket: bucket-scoped R2 tokens can't CreateBucket, and rclone
    // otherwise attempts a bucket check/create that returns 403 AccessDenied.
    const proc = spawn("rclone", [
      "copy", localDir, dest,
      "--s3-no-check-bucket",
      "--exclude", "manifest.json",
      "--header-upload", CACHE_IMMUTABLE,
      "--progress",
    ], { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("close", async (code) => {
      if (code !== 0) return reject(new Error(`rclone exited with code ${code}`));
      try {
        const manifestPath = join(localDir, "manifest.json");
        if (existsSync(manifestPath)) {
          await pexec("rclone", ["copyto", manifestPath, `${dest}/manifest.json`,
            "--s3-no-check-bucket", "--header-upload", CACHE_MUTABLE]);
        }
        resolve(dest);
      } catch (e) { reject(e); }
    });
  });
}

// Lists song ids under songs/ (directory names, trailing slash stripped).
export async function listSongIds(bucket) {
  const { stdout } = await pexec("rclone", ["lsf", "--dirs-only", `r2:${bucket}/songs/`]);
  return stdout.split("\n").map((l) => l.replace(/\/$/, "").trim()).filter(Boolean);
}

// Lists every file under a remote prefix (recursive, files only; paths relative to the prefix).
export async function listRemoteFiles(bucket, prefix) {
  const { stdout } = await pexec("rclone", ["lsf", "-R", "--files-only", `r2:${bucket}/${prefix}`, "--s3-no-check-bucket"]);
  return stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

// Rewrites one existing remote object's headers. A same-key server-side copy is a no-op on R2
// (rclone skips it when only metadata would change), so we round-trip through a local temp file:
// downloading then re-uploading is a fresh PUT, which reliably stamps --header-upload headers.
// Used by the cache-header backfill for assets uploaded before the upload path set headers.
export async function setRemoteHeaders(bucket, path, headers) {
  const tmp = await mkdtemp(join(tmpdir(), "r2-hdr-"));
  const local = join(tmp, "object");
  try {
    await pexec("rclone", ["copyto", `r2:${bucket}/${path}`, local, "--s3-no-check-bucket"]);
    // --no-check-dest forces the PUT: rclone would otherwise skip re-uploading an object whose
    // size+modtime match (the download preserves the original modtime), and the header would never
    // be written. Forcing the upload is what actually applies --header-upload.
    const args = ["copyto", local, `r2:${bucket}/${path}`, "--s3-no-check-bucket", "--no-check-dest"];
    for (const h of headers) args.push("--header-upload", h);
    await pexec("rclone", args);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// Reads and parses a remote manifest.json for one song.
export async function readRemoteManifest(bucket, id) {
  const { stdout } = await pexec("rclone", ["cat", `r2:${bucket}/songs/${id}/manifest.json`]);
  return JSON.parse(stdout);
}

// Uploads an in-memory object as pretty JSON to a remote path (e.g. catalog.json at root).
export async function uploadJson(obj, bucket, remotePath) {
  const tmp = await mkdtemp(join(tmpdir(), "r2-json-"));
  const local = join(tmp, "file.json");
  try {
    await writeFile(local, JSON.stringify(obj, null, 2));
    // --s3-no-check-bucket: see uploadDir — avoids a 403 CreateBucket attempt on
    // bucket-scoped R2 tokens (this copyto targets the bucket root).
    // no-cache: catalog.json / manifest.json are mutable indices, so never cache them.
    await pexec("rclone", ["copyto", local, `r2:${bucket}/${remotePath}`,
      "--s3-no-check-bucket", "--header-upload", CACHE_MUTABLE]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// Delete a single remote object by full path (used by the media-prune step to drop orphaned
// stem revisions). Tolerates an already-absent file so prune is idempotent.
export async function deleteRemoteFile(bucket, path) {
  try {
    await pexec("rclone", ["deletefile", `r2:${bucket}/${path}`, "--s3-no-check-bucket"]);
  } catch (e) {
    const msg = `${e.stderr || ""}${e.message || ""}`.toLowerCase();
    if (msg.includes("not found") || msg.includes("doesn't exist") || msg.includes("object not found")) return;
    throw e;
  }
}

// Purge a whole song's R2 tree. Tolerates an already-absent path (idempotent delete).
export async function deleteRemoteSong(bucket, id) {
  await purgeTolerant(`r2:${bucket}/songs/${id}`);
}

// Purge a single stem's R2 dir. Tolerates an already-absent path.
export async function deleteRemoteStem(bucket, id, slug) {
  await purgeTolerant(`r2:${bucket}/songs/${id}/${slug}`);
}

// Re-upload a manifest object to songs/<id>/manifest.json (used by edit/reorder/rename/delete-stem).
export async function updateRemoteManifest(bucket, id, manifest) {
  await uploadJson(manifest, bucket, `songs/${id}/manifest.json`);
}

async function purgeTolerant(remote) {
  try {
    await pexec("rclone", ["purge", remote, "--s3-no-check-bucket"]);
  } catch (e) {
    // rclone exits non-zero when the directory doesn't exist; treat "not found" as success.
    const msg = `${e.stderr || ""}${e.message || ""}`.toLowerCase();
    if (msg.includes("not found") || msg.includes("doesn't exist") || msg.includes("directory not found")) return;
    throw e;
  }
}
