#!/usr/bin/env node
// `npm run deploy`: stamp sw.js with the current shell content hash, then commit & push so GitHub
// Pages serves the update and clients auto-refresh (next cold launch / "Reload" pill). Safe to run
// with a clean tree (it just reports "nothing to deploy").
//
// The stamp runs FIRST so the hash reflects the content being deployed, and the stamped sw.js is
// included in the same commit. Push uses whatever remote/branch is configured — this repo pushes
// over HTTPS (the SSH key resolves to the wrong account).
import { execFileSync } from "node:child_process";
import { stampSw } from "./stamp-sw.js";

const git = (...args) => execFileSync("git", args, { stdio: "inherit" });
const gitOut = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const version = await stampSw();

git("add", "-A");
if (!gitOut("diff", "--cached", "--name-only")) {
  console.log("Nothing to deploy — working tree clean.");
  process.exit(0);
}
git("commit", "-m", `deploy: shell ${version}`);
git("push");
console.log(`✔ Deployed shell ${version}.`);
