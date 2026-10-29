// js/nav.js — shared site header (hamburger + brand) and a slide-in drawer, used by the landing
// page and the player. The drawer is project-scoped: "All songs" (the project page), that
// project's songs, and "Switch project" (the picker). It never fetches: a page hands it the project
// with setProject() once known. Until then only "Switch project" shows.
import { songCardModel } from "./lib/catalog-view.js";

export function initNav({ currentSongId = null } = {}) {
  const root = document.getElementById("nav-root");
  if (!root) return { setProject() {} };

  root.innerHTML = `
    <header class="site-nav">
      <button class="hamburger" id="nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="nav-drawer">
        <span></span><span></span><span></span>
      </button>
      <a class="site-nav__brand" href="index.html">Rehearsal&nbsp;Tracks</a>
    </header>
    <div class="nav-scrim" id="nav-scrim" hidden></div>
    <aside class="nav-drawer" id="nav-drawer" aria-hidden="true">
      <a class="nav-drawer__home" id="nav-home" href="index.html" hidden>All songs</a>
      <nav class="nav-drawer__list" id="nav-drawer-list" aria-label="Songs"></nav>
      <a class="nav-drawer__home nav-drawer__switch" href="index.html?projects">Switch project</a>
    </aside>`;

  const toggle = root.querySelector("#nav-toggle");
  const drawer = root.querySelector("#nav-drawer");
  const scrim = root.querySelector("#nav-scrim");
  const home = root.querySelector("#nav-home");
  const list = root.querySelector("#nav-drawer-list");

  function setOpen(open) {
    drawer.classList.toggle("is-open", open);
    scrim.hidden = !open;
    drawer.setAttribute("aria-hidden", String(!open));
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }

  toggle.addEventListener("click", () => setOpen(!drawer.classList.contains("is-open")));
  scrim.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });

  return {
    // id: the project's pid · songs: its catalog songs, or null when the catalog is unavailable
    // (then the drawer offers just "All songs" + "Switch project").
    setProject({ id, songs }) {
      home.href = `index.html?project=${encodeURIComponent(id)}`;
      home.hidden = false;
      list.replaceChildren();
      for (const song of songs || []) {
        const m = songCardModel(song);
        const a = document.createElement("a");
        a.className = "nav-drawer__song";
        a.href = m.href;
        a.textContent = m.title;
        if (song.id === currentSongId) {
          a.setAttribute("aria-current", "page");
          a.classList.add("is-current");
        }
        list.appendChild(a);
      }
    },
  };
}
