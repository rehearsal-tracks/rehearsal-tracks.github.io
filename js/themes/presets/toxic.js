// js/themes/presets/toxic.js — THE TOXIC AVENGER: radioactive lime + molten-orange fire horizon +
// purple lightning on a near-black green-tinted sky. Values are the pre-theming hardcoded colours.
export default {
  id: "toxic",
  tokens: {
    bg: "#0a0e07",
    bgElev: "#12180d",
    bgElev2: "#1b2411",
    line: "#384720",
    text: "#edf4e2",
    textDim: "#a0b389",
    accent: "#8bff1f",
    accent2: "#ff6a1a",
    accent3: "#a855f7",
    onAccent: "#07130a",
    thumb: "#d8ffb0",
    panelTop: "#1c2812",
    panelBottom: "#10160c",
    navBg: "#0d0f1a",
    cardTop: "#1e2440",
    cardBottom: "#161a2c",
    wave: "#4f6b2e",
    waveProgress: "#8bff1f",
  },
  // Audio-reactive lava lamp; colours derive from accent2 (hot, bottom) → accent (cool, top).
  background: () => import("../../lava-lamp.js"),
};
