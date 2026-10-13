// js/themes/color.js — tiny colour helpers for the theme pipeline. Pure; no DOM.
const HEX = /^#[0-9a-f]{6}$/i;

export function isHex(s) {
  return typeof s === "string" && HEX.test(s);
}

// "#8bff1f" → [139, 255, 31]
export function hexToRgb(hex) {
  if (!isHex(hex)) throw new Error(`invalid hex colour: ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
