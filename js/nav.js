// js/nav.js — shared site header (hamburger + brand) and a slide-in song drawer.
// Used by both the landing page and the player page. The drawer's song list is
// fetched from catalog.json; if that fails it degrades to just the "All songs" link.
import { fetchCatalog } from "./data.js";
import { songCardModel } from "./lib/catalog-view.js";

export function initNav({ currentSongId = null } = {}) {
  const root = document.getElementById("nav-root");
  if (!root) return;

  root.innerHTML = `
    <header class="site-nav">
      <button class="hamburger" id="nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="nav-drawer">
        <span></span><span></span><span></span>
      </button>
      <a class="site-nav__brand" href="index.html">Rehearsal&nbsp;Tracks</a>
    </header>
    <div class="nav-scrim" id="nav-scrim" hidden></div>
    <aside class="nav-drawer" id="nav-drawer" aria-hidden="true">
      <a class="nav-drawer__home" href="index.html">All songs</a>
      <nav class="nav-drawer__list" id="nav-drawer-list" aria-label="Songs"></nav>
    </aside>`;

  const toggle = root.querySelector("#nav-toggle");
  const drawer = root.querySelector("#nav-drawer");
  const scrim = root.querySelector("#nav-scrim");
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

  // Populate the song list lazily; failure is non-fatal (home link still works).
  fetchCatalog()
    .then((catalog) => {
      for (const song of catalog.songs || []) {
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
    })
    .catch(() => { /* drawer still offers the All songs link */ });
}
