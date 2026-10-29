// js/data.js — R2 JSON fetches for the landing page, drawer and player. Errors carry `.status`
// (HTTP status, or undefined when the network/SW failed) so callers can tell "gone" (404) apart
// from "offline".
import { R2_BASE } from "./config.js";

async function getJson(path) {
  const res = await fetch(`${R2_BASE}/${path}`, { cache: "no-cache" });
  if (!res.ok) {
    const err = new Error(`${path} ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// projects.json — { schemaVersion: 1, projects: [{ id, name }] }: listed, non-archived projects.
export const fetchProjectsIndex = () => getJson("projects.json");

// projects/<pid>/catalog.json — { schemaVersion: 2, project: { id, name, credit, archived, theme },
// songs }. `pid` must already have passed isSafeId (it's interpolated into the path).
export const fetchProjectCatalog = (pid) => getJson(`projects/${pid}/catalog.json`);

// LEGACY root catalog (Toxic Avenger only). Removed in Task 7 once nothing imports it.
export const fetchCatalog = () => getJson("catalog.json");
