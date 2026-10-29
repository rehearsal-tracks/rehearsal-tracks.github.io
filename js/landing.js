// js/landing.js — index.html: the project picker or one project's song list (spec §1).
//   ?project=<pid> → that project · ?projects → picker · no query → last project, else picker
import { fetchProjectsIndex, fetchProjectCatalog } from "./data.js";
import { songCardModel } from "./lib/catalog-view.js";
import { decideLanding, pickerEntries } from "./lib/landing-route.js";
import {
  getLastProject, setLastProject, knownProjects, rememberProject, forgetProject,
  setSongProject, cacheTheme, getCachedTheme, PICKER_THEME_KEY,
} from "./lib/project-state.js";
import { initNav } from "./nav.js";
import { mountDownloadsSection } from "./offline-ui.js";
import { applyProjectTheme } from "./themes/apply.js";

const listEl = document.getElementById("song-list");
const downloadsEl = document.getElementById("downloads");
const eyebrowEl = document.getElementById("eyebrow");
const titleEl = document.getElementById("page-title");
const noteEl = document.getElementById("page-note");
const creditEl = document.getElementById("credit");

const NOTICES = {
  invalid: "That project link isn't valid.",
  missing: "That project isn't available any more.",
};

function setState(html) { listEl.innerHTML = html; }
function setNote(text) { noteEl.textContent = text || ""; noteEl.hidden = !text; }

// Cards link to a song or a project. Text goes in via the DOM so data can't inject markup.
const CARD = `<a class="song-card"><span class="song-card__main"><span class="song-card__title"></span><span class="song-card__meta"></span></span><span class="song-card__chevron" aria-hidden="true">▸</span></a>`;
function renderCards(items) {
  setState(items.map(() => CARD).join(""));
  listEl.querySelectorAll(".song-card").forEach((card, i) => {
    card.href = items[i].href;
    card.querySelector(".song-card__title").textContent = items[i].title;
    card.querySelector(".song-card__meta").textContent = items[i].meta || "";
  });
}

async function showPicker(notice) {
  applyProjectTheme({ preset: "neutral" });
  cacheTheme(PICKER_THEME_KEY, { preset: "neutral" });
  document.title = "Rehearsal Tracks";
  eyebrowEl.textContent = "Interactive Stem Player";
  titleEl.textContent = "Rehearsal Tracks";
  setNote(NOTICES[notice] || "Choose a project");
  setState(`<p class="list-note">Loading projects…</p>`);
  let listed = [];
  try {
    listed = (await fetchProjectsIndex()).projects || [];
  } catch { /* offline/unavailable: still show the projects this device has opened */ }
  const entries = pickerEntries({ listed, known: knownProjects() });
  if (!entries.length) {
    return setState(`<p class="list-note">No projects to show yet. Open a project's link to add it here.</p>`);
  }
  renderCards(entries.map((p) => ({ href: `?project=${encodeURIComponent(p.id)}`, title: p.name })));
}

async function showProject(nav, pid) {
  setState(`<p class="list-note">Loading songs…</p>`);
  let catalog;
  try {
    catalog = await fetchProjectCatalog(pid);
  } catch (e) {
    if (e.status === 404) {
      forgetProject(pid);
      history.replaceState(null, "", "?projects");
      return showPicker("missing");
    }
    // Offline without a cached catalog, or R2 trouble: keep the project's look, offer the way out.
    applyProjectTheme(getCachedTheme(pid)?.setting);
    nav.setProject({ id: pid, songs: null });
    return setState(`<p class="error-card">Couldn't load the song list — ${e.message}</p>`);
  }

  const { project, songs } = catalog;
  applyProjectTheme(project.theme);
  cacheTheme(pid, project.theme);
  rememberProject(project);
  setLastProject(pid);
  // So each song's player page paints this project's theme before its manifest arrives.
  for (const s of songs) setSongProject(s.id, pid);
  nav.setProject({ id: pid, songs });

  document.title = `${project.name} — Rehearsal Tracks`;
  eyebrowEl.textContent = "Rehearsal Tracks";
  titleEl.textContent = project.name;
  setNote(project.archived ? "This project is archived. Its songs stay available here." : "");
  creditEl.textContent = project.credit || "";
  creditEl.hidden = !project.credit;

  if (!songs.length) setState(`<p class="list-note">No songs yet.</p>`);
  else renderCards(songs.map(songCardModel));
  // Downloads for this project (PWA Phase B). Additive and feature-gated; a failure must never
  // take down the song list, so it's wrapped separately.
  try { await mountDownloadsSection(downloadsEl, songs); }
  catch { /* offline UI is additive */ }
}

function main() {
  const nav = initNav();
  const route = decideLanding({ search: location.search, lastProject: getLastProject(), known: knownProjects() });
  if (route.view === "picker") return showPicker(route.notice);
  // Returning visitor: show the last project in place (no reload) and make the URL shareable.
  if (route.redirected) history.replaceState(null, "", `?project=${encodeURIComponent(route.pid)}`);
  return showProject(nav, route.pid);
}

main();
