// js/themes/apply.js — apply a resolved theme (js/themes/resolve.js) to the page: CSS vars on
// <html>, data-theme for theme-specific CSS, the browser's theme-color, waveform colours for the
// player, and the preset's optional background effect. Call once per page load, before the player
// builds (the background effect mounts each time it's called).
import { setWavePalette } from "../player-ui.js";
import { resolveTheme, previewPresetFromQuery } from "./resolve.js";

export function applyTheme(theme, root = document.documentElement) {
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
  root.dataset.theme = theme.id;
  root.ownerDocument?.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.tokens.bg);
  setWavePalette({ wave: theme.tokens.wave, progress: theme.tokens.waveProgress });
  if (theme.background) {
    // A visual must never break the page — swallow load/mount failures.
    theme.background()
      .then((mod) => mod.mount(theme))
      .catch((e) => console.warn("[theme] background failed:", e));
  }
}

// A project's theme setting ({ preset, overrides }, from its catalog) → applied. No setting →
// neutral. `?preset=<id>` in the URL previews that preset instead (dev aid, see resolve.js).
export function applyProjectTheme(setting, search = location.search) {
  const preview = previewPresetFromQuery(search);
  applyTheme(resolveTheme(preview ? { preset: preview } : setting || { preset: "neutral" }));
}
