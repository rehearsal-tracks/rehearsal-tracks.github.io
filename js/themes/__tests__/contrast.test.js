// js/themes/__tests__/contrast.test.js — WCAG contrast floors for every preset's key pairs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "../resolve.js";
import { hexToRgb } from "../color.js";

const lum = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("every preset keeps body text, dim text, accents and on-accent text legible", () => {
  for (const [id, { tokens: t }] of Object.entries(PRESETS)) {
    assert.ok(contrast(t.text, t.bg) >= 7, `${id}: text on bg`);
    assert.ok(contrast(t.textDim, t.bg) >= 4.5, `${id}: textDim on bg`);
    assert.ok(contrast(t.accent, t.bg) >= 4.5, `${id}: accent on bg`);
    assert.ok(contrast(t.onAccent, t.accent) >= 4.5, `${id}: onAccent on accent`);
  }
});
