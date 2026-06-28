import { spawn } from "node:child_process";

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
