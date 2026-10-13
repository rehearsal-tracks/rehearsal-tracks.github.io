// js/themes/apply.js — apply a resolved theme (js/themes/resolve.js) to the page: CSS vars on
// <html>, data-theme for theme-specific CSS, waveform colours for the player, and the preset's
// optional background effect. Called once per page load, before the player builds.
import { setWavePalette } from "../player-ui.js";

export function applyTheme(theme, root = document.documentElement) {
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);
  root.dataset.theme = theme.id;
  setWavePalette({ wave: theme.tokens.wave, progress: theme.tokens.waveProgress });
  if (theme.background) {
    // A visual must never break the page — swallow load/mount failures.
    theme.background()
      .then((mod) => mod.mount(theme))
      .catch((e) => console.warn("[theme] background failed:", e));
  }
}
