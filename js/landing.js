// js/landing.js — render the song list from catalog.json.
import { fetchCatalog } from "./data.js";
import { songCardModel } from "./lib/catalog-view.js";
import { initNav } from "./nav.js";
import { mountDownloadsSection } from "./offline-ui.js";

const listEl = document.getElementById("song-list");
const downloadsEl = document.getElementById("downloads");

function setState(html) { listEl.innerHTML = html; }

function renderSongs(songs) {
  if (!songs || songs.length === 0) {
    setState(`<p class="list-note">No songs yet.</p>`);
    return;
  }
  setState(
    songs.map((song) => {
      const m = songCardModel(song);
      return `<a class="song-card" href="${m.href}">
        <span class="song-card__main">
          <span class="song-card__title"></span>
          <span class="song-card__meta"></span>
        </span>
        <span class="song-card__chevron" aria-hidden="true">▸</span>
      </a>`;
    }).join("")
  );
  // Set text via DOM (not template interpolation) so titles/artists can't inject markup.
  const cards = listEl.querySelectorAll(".song-card");
  songs.forEach((song, i) => {
    const m = songCardModel(song);
    cards[i].querySelector(".song-card__title").textContent = m.title;
    cards[i].querySelector(".song-card__meta").textContent = m.meta;
  });
}

async function main() {
  initNav();
  setState(`<p class="list-note">Loading songs…</p>`);
  try {
    const catalog = await fetchCatalog();
    renderSongs(catalog.songs);
    // Downloaded-songs list + storage usage (PWA Phase B). Additive and feature-gated; a failure
    // must never take down the catalog, so it's wrapped separately.
    try { await mountDownloadsSection(downloadsEl, catalog.songs); }
    catch { /* offline UI is additive */ }
  } catch (e) {
    setState(`<p class="error-card">Couldn't load the song list — ${e.message}</p>`);
  }
}

main();
