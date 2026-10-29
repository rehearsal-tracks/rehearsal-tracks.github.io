// js/lib/project-state.js — what this device remembers about projects (localStorage, all JSON):
//   last-project     pid the landing page reopens for a returning visitor (spec §1)
//   projects:v1      { pid: { name, archived } } for every project this device has opened. Unlisted
//                    projects reach the picker only through this.
//   song-project:v1  { songId: pid } so the player knows a song's project before its manifest
//                    arrives (anti-flash) and when an old offline manifest has no `project`
//   theme:v1:<key>   { setting, id, vars, bg } last-seen theme, painted before first paint by
//                    js/theme-boot.js. That classic script can't import this module, so it
//                    duplicates these key names (theme-boot.test.js keeps them in sync).
// Storage can throw (Safari private mode, quota) or be missing: every access is best-effort.
import { resolveTheme } from "../themes/resolve.js";

const P = "rehearsal-tracks:";
export const KEYS = {
  last: `${P}last-project`,
  known: `${P}projects:v1`,
  songs: `${P}song-project:v1`,
  theme: (key) => `${P}theme:v1:${key}`,
};
// Theme-cache key for the picker page. "@" can't appear in a project id, so it never collides.
export const PICKER_THEME_KEY = "@picker";

const local = () => globalThis.localStorage;

function read(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}
function readMap(storage, key) {
  const v = read(storage, key);
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function write(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* best-effort */ }
}
function remove(storage, key) {
  try { storage.removeItem(key); } catch { /* best-effort */ }
}

export function getLastProject(storage = local()) {
  const v = read(storage, KEYS.last);
  return typeof v === "string" ? v : null;
}
export function setLastProject(pid, storage = local()) {
  write(storage, KEYS.last, pid);
}

export function knownProjects(storage = local()) {
  return readMap(storage, KEYS.known);
}
// `project` is a catalog's public project block ({ id, name, archived, … }).
export function rememberProject({ id, name, archived }, storage = local()) {
  write(storage, KEYS.known, { ...knownProjects(storage), [id]: { name, archived: archived === true } });
}
// A project whose catalog 404s is gone: stop listing it, redirecting to it and painting its theme.
export function forgetProject(pid, storage = local()) {
  const known = knownProjects(storage);
  delete known[pid];
  write(storage, KEYS.known, known);
  if (getLastProject(storage) === pid) remove(storage, KEYS.last);
  remove(storage, KEYS.theme(pid));
}

export function getSongProject(songId, storage = local()) {
  const v = readMap(storage, KEYS.songs)[songId];
  return typeof v === "string" ? v : null;
}
export function setSongProject(songId, pid, storage = local()) {
  write(storage, KEYS.songs, { ...readMap(storage, KEYS.songs), [songId]: pid });
}

// `setting` is a catalog's { preset, overrides }. The resolved vars/id/bg are what theme-boot paints.
export function cacheTheme(key, setting, storage = local()) {
  const s = setting || {};
  const t = resolveTheme(s, { warn: () => {} });
  write(storage, KEYS.theme(key), { setting: s, id: t.id, vars: t.vars, bg: t.tokens.bg });
}
export function getCachedTheme(key, storage = local()) {
  const v = read(storage, KEYS.theme(key));
  return v && typeof v === "object" && v.vars ? v : null;
}
