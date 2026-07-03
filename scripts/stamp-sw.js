#!/usr/bin/env node
// Stamp SHELL_VERSION in sw.js with a short content hash of the app-shell files. Every deploy that
// changes shell content then produces a byte-different sw.js → the browser detects the new worker,
// re-precaches the shell, and (via the "Reload" pill / next cold launch) clients pick it up.
// Run standalone (`npm run stamp-sw`) or as the first step of `npm run deploy`.
//
// Hashes the SAME files listed in sw.js's SHELL_ASSETS (minus sw.js itself, to avoid a
// self-referential hash). Idempotent: re-running with unchanged content is a no-op.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// All shipped .js under js/ (excluding tests), so any script change rolls the version.
async function jsFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "__tests__") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await jsFiles(p)));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

export async function stampSw() {
  const files = [
    join(ROOT, "index.html"),
    join(ROOT, "stream.html"),
    join(ROOT, "css/styles.css"),
    join(ROOT, "manifest.webmanifest"),
    ...(await jsFiles(join(ROOT, "js"))),
    join(ROOT, "icons/apple-touch-icon.png"),
    join(ROOT, "icons/icon-192.png"),
    join(ROOT, "icons/icon-512.png"),
    join(ROOT, "icons/icon-maskable-512.png"),
  ].sort();

  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(relative(ROOT, f)); // include path so renames/moves also change the hash
    hash.update(await readFile(f));
  }
  const version = hash.digest("hex").slice(0, 10);

  const swPath = join(ROOT, "sw.js");
  const src = await readFile(swPath, "utf8");
  const re = /(const SHELL_VERSION = ")[^"]*(";)/;
  if (!re.test(src)) throw new Error("SHELL_VERSION line not found in sw.js");

  const next = `const SHELL_VERSION = "${version}";`;
  if (src.match(re)[0] === next) {
    console.log(`sw.js already stamped with ${version} — no change.`);
    return version;
  }
  await writeFile(swPath, src.replace(re, `$1${version}$2`));
  console.log(`Stamped sw.js SHELL_VERSION → ${version}`);
  return version;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  stampSw().catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
}
