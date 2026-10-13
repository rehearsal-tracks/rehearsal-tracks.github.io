// js/themes/resolve.js — turn a project's theme setting ({ preset, overrides }) into concrete CSS
// custom properties. Pure (no DOM) so it's unit-testable; js/themes/apply.js does the DOM side.
import { TOKENS } from "./tokens.js";
import { hexToRgb, isHex } from "./color.js";
import toxic from "./presets/toxic.js";
import neutral from "./presets/neutral.js";

// Registry. A bespoke theme for a future project = a new module in presets/ registered here.
export const PRESETS = { toxic, neutral };
export const FALLBACK_PRESET = "neutral";

export function resolveTheme({ preset, overrides } = {}, { warn = console.warn } = {}) {
  let base = Object.hasOwn(PRESETS, preset ?? "") ? PRESETS[preset] : null;
  if (!base) {
    if (preset) warn(`[theme] unknown preset "${preset}" — using ${FALLBACK_PRESET}`);
    base = PRESETS[FALLBACK_PRESET];
  }

  const tokens = { ...base.tokens };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (!Object.hasOwn(TOKENS, key)) { warn(`[theme] ignoring unknown token "${key}"`); continue; }
    if (!isHex(value)) { warn(`[theme] ignoring invalid colour for "${key}": ${value}`); continue; }
    tokens[key] = value.toLowerCase();
  }

  const vars = {};
  for (const [key, cssVar] of Object.entries(TOKENS)) {
    vars[cssVar] = tokens[key].toLowerCase();
    vars[`${cssVar}-rgb`] = hexToRgb(tokens[key]).join(", ");
  }

  return { id: base.id, tokens, vars, background: base.background || null };
}

// Dev/preview aid: `?preset=neutral` on any page previews a preset over the configured theme.
// Deliberately public and harmless (purely cosmetic, only registered presets); Phase 4's admin
// theme editing can use it to preview.
export function previewPresetFromQuery(search) {
  const id = new URLSearchParams(search).get("preset");
  return id && Object.hasOwn(PRESETS, id) ? id : null;
}
