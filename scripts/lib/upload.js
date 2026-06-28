import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pexec = promisify(execFile);

// Uploads localDir -> r2:<bucket>/<remotePrefix> using a preconfigured rclone remote "r2".
// Uses spawn (not promisify(execFile)) so rclone's --progress streams live to the terminal.
export function uploadDir(localDir, bucket, remotePrefix) {
  const dest = `r2:${bucket}/${remotePrefix}`;
  return new Promise((resolve, reject) => {
    const proc = spawn("rclone", ["copy", localDir, dest, "--progress"], { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve(dest) : reject(new Error(`rclone exited with code ${code}`)));
  });
}

// Lists song ids under songs/ (directory names, trailing slash stripped).
export async function listSongIds(bucket) {
  const { stdout } = await pexec("rclone", ["lsf", "--dirs-only", `r2:${bucket}/songs/`]);
  return stdout.split("\n").map((l) => l.replace(/\/$/, "").trim()).filter(Boolean);
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
    await pexec("rclone", ["copyto", local, `r2:${bucket}/${remotePath}`]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
