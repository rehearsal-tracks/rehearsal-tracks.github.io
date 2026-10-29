// js/__tests__/sw-assets.test.js — an offline cold start can only import modules the service worker
// precached, so every shipped js/ module must be in sw.js SHELL_ASSETS (and every listed asset must
// exist, or install logs a precache miss).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const sw = await readFile(join(ROOT, "sw.js"), "utf8");
const listBody = sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/)?.[1] ?? "";
const assets = [...listBody.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

async function jsFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "__tests__") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await jsFiles(p)));
    else if (e.name.endsWith(".js")) out.push(relative(ROOT, p).split(sep).join("/"));
  }
  return out;
}

test("SHELL_ASSETS was parsed", () => {
  assert.ok(assets.includes("index.html"), "regex no longer matches sw.js SHELL_ASSETS");
});

test("every shipped js/ module is precached", async () => {
  const missing = (await jsFiles(join(ROOT, "js"))).filter((f) => !assets.includes(f));
  assert.deepEqual(missing, []);
});

test("every precached asset exists", async () => {
  for (const a of assets.filter((a) => a !== "./")) {
    await assert.doesNotReject(access(join(ROOT, a)), `${a} listed in SHELL_ASSETS but missing`);
  }
});
