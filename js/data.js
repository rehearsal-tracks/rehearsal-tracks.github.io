// js/data.js — shared R2 data fetches for the landing page and nav drawer.
import { R2_BASE } from "./config.js";

export async function fetchCatalog() {
  const res = await fetch(`${R2_BASE}/catalog.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  return res.json();
}
