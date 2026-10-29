// js/lib/landing-route.js — what index.html shows (spec §1). Pure, so it's unit-tested.
import { isSafeId } from "./safe-id.js";

// search: location.search · lastProject: saved pid or null · known: knownProjects()
// → { view: "project", pid, redirected } | { view: "picker", notice? }
//   ?projects        → picker (the drawer's "Switch project"; beats everything)
//   ?project=<pid>   → that project; an invalid pid → picker with notice "invalid"
//   no query         → the last project unless it's archived (redirected: true), else the picker
export function decideLanding({ search, lastProject, known = {} }) {
  const q = new URLSearchParams(search);
  if (q.has("projects")) return { view: "picker" };
  if (q.has("project")) {
    const pid = q.get("project");
    return isSafeId(pid) ? { view: "project", pid, redirected: false } : { view: "picker", notice: "invalid" };
  }
  if (isSafeId(lastProject) && !known[lastProject]?.archived) {
    return { view: "project", pid: lastProject, redirected: true };
  }
  return { view: "picker" };
}

// Picker list: listed projects (projects.json) plus projects this device has opened (unlisted ones
// included), minus archived ones, de-duplicated by id (the listed name wins), sorted by name.
export function pickerEntries({ listed = [], known = {} }) {
  const byId = new Map();
  for (const p of listed) {
    if (isSafeId(p?.id)) byId.set(p.id, { id: p.id, name: String(p.name || p.id) });
  }
  for (const [id, p] of Object.entries(known)) {
    if (!byId.has(id) && isSafeId(id) && !p?.archived) byId.set(id, { id, name: String(p?.name || id) });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
