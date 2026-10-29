#!/usr/bin/env node
// One-off, additive migration to multi-project data (spec §4): creates
// projects/toxic-avenger/project.json, stamps "project": "toxic-avenger" into every song manifest
// that lacks one, then refreshes all catalogs. Touches no media; legacy catalog.json stays.
// Safe to re-run (a completed migration plans nothing). Don't run it while editing in the admin tool.
//
//   npm run migrate-projects                    # dry-run: print the plan
//   npm run migrate-projects -- --apply         # do it   [--bucket=stem-player]
import { planMigration, stampProject } from "./lib/migrate.js";
import { LEGACY_PROJECT_ID } from "./lib/project.js";
import { listSongIds, readRemoteManifest, readRemoteJsonIfExists, writeRemoteProject, updateRemoteManifest } from "./lib/upload.js";
import { refreshRemoteCatalog, describeRefresh } from "./lib/remote-catalog.js";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const bucketArg = argv.find((a) => a.startsWith("--bucket="));
const bucket = bucketArg ? bucketArg.split("=")[1] : "stem-player";
const tag = apply ? "" : "[dry-run] ";

async function main() {
  const existingProject = await readRemoteJsonIfExists(bucket, `projects/${LEGACY_PROJECT_ID}/project.json`);
  // Every manifest must be readable: a migration that silently skips a song would orphan it.
  const manifests = [];
  for (const id of await listSongIds(bucket)) {
    try { manifests.push(await readRemoteManifest(bucket, id)); }
    catch (e) { throw new Error(`can't read songs/${id}/manifest.json (${e.message}); fix it and re-run`); }
  }
  const plan = planMigration({ existingProject, manifests });

  console.log(`${tag}bucket "${bucket}": ${manifests.length} song(s)`);
  if (plan.createProject) {
    console.log(`${tag}create projects/${LEGACY_PROJECT_ID}/project.json:\n${JSON.stringify(plan.createProject, null, 2)}`);
  } else {
    console.log(`• projects/${LEGACY_PROJECT_ID}/project.json already exists; left as is`);
  }
  console.log(`${tag}stamp project into ${plan.stamp.length} manifest(s)${plan.stamp.length ? `: ${plan.stamp.join(", ")}` : ""}`);
  if (plan.foreign.length) console.log(`• already in other projects (untouched): ${plan.foreign.join(", ")}`);

  if (!apply) return console.log("\nDry run only. Re-run with --apply to write.");

  if (plan.createProject) await writeRemoteProject(bucket, LEGACY_PROJECT_ID, plan.createProject);
  for (const id of plan.stamp) {
    await updateRemoteManifest(bucket, id, stampProject(manifests.find((m) => m.id === id), LEGACY_PROJECT_ID));
    console.log(`✔ stamped ${id}`);
  }
  console.log(`✔ ${describeRefresh(await refreshRemoteCatalog(bucket))}`);
}

main().catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
