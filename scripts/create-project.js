#!/usr/bin/env node
// Create a new project (show): writes projects/<pid>/project.json and refreshes the catalogs. Until
// the admin tool's project form (Phase 4) this is how a new show starts; then upload its songs with
// `segment-song.js --project=<pid>`. Refuses to overwrite an existing project. Dry-run by default.
//
//   node scripts/create-project.js --id=<pid> --name="Show Name" [--credit="…"] [--listed]
//        [--preset=neutral|toxic] [--overrides='{"accent":"#ff3366"}'] [--bucket=stem-player] [--apply]
//
// --listed puts it in the public picker (projects.json); without it the project is reachable only
// by its link (index.html?project=<pid>).
import { buildNewProject } from "./lib/project.js";
import { readRemoteProject, writeRemoteProject } from "./lib/upload.js";
import { refreshRemoteCatalog, describeRefresh } from "./lib/remote-catalog.js";

// Strict on purpose (this writes to the live bucket): unknown flags, `--apply=…`/`--listed=…`
// values and missing values are errors rather than silently ignored.
const VALUE_FLAGS = ["id", "name", "credit", "preset", "overrides", "bucket"];
const BOOL_FLAGS = ["listed", "apply"];
function parseArgs(argv) {
  const args = { bucket: "stem-player", listed: false, apply: false };
  for (const a of argv) {
    const m = /^--([a-z]+)(?:=([\s\S]*))?$/.exec(a);
    if (!m) throw new Error(`unexpected argument: ${a}`);
    const [, k, v] = m;
    if (BOOL_FLAGS.includes(k) && v === undefined) args[k] = true;
    else if (VALUE_FLAGS.includes(k) && v !== undefined) args[k] = v;
    else throw new Error(`bad flag: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.id || !args.name) throw new Error('Usage: create-project.js --id=<pid> --name="…" [--credit="…"] [--listed] [--preset=…] [--overrides=JSON] [--apply]');
  const project = buildNewProject({
    id: args.id,
    name: args.name,
    credit: args.credit ?? "",
    listed: args.listed,
    preset: args.preset ?? "neutral",
    overrides: args.overrides ? JSON.parse(args.overrides) : {},
  });
  if (await readRemoteProject(args.bucket, project.id)) {
    throw new Error(`projects/${project.id}/project.json already exists; edit projects in the admin tool (Phase 4)`);
  }
  console.log(`${args.apply ? "" : "[dry-run] "}projects/${project.id}/project.json:\n${JSON.stringify(project, null, 2)}`);
  if (!args.apply) return console.log("\nDry run only. Re-run with --apply to write.");
  await writeRemoteProject(args.bucket, project.id, project);
  console.log(`✔ created ${project.id}`);
  try {
    console.log(`✔ ${describeRefresh(await refreshRemoteCatalog(args.bucket))}`);
  } catch (e) {
    // The project exists now, so re-running create-project would refuse; just rebuild the catalogs.
    throw new Error(`project created, but the catalog refresh failed (${e.message}). Run: node scripts/refresh-catalog.js`);
  }
  console.log(`  Page: index.html?project=${project.id}   Add songs: segment-song.js … --project=${project.id}`);
}

main().catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
