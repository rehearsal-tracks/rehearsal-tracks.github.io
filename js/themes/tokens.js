// js/themes/tokens.js — the complete, overridable set of theme colour tokens.
// key (used in presets + project overrides) → CSS custom property. resolveTheme emits each as
// `--x: #hex` AND `--x-rgb: r, g, b` so CSS can do rgba(var(--x-rgb), 0.5).
// Adding a token = add it here, give every preset a value, use it in styles.css, and add the
// default to styles.css :root (css-sync.test.js enforces the last part).
export const TOKENS = {
  bg: "--bg",
  bgElev: "--bg-elev",
  bgElev2: "--bg-elev-2",
  line: "--line",
  text: "--text",
  textDim: "--text-dim",
  accent: "--accent",          // primary interactive colour (volume, titles, active states)
  accent2: "--accent-2",       // secondary (seek / progress / warm glow)
  accent3: "--accent-3",       // tertiary glow colour
  onAccent: "--on-accent",     // text drawn on an --accent fill
  thumb: "--thumb",            // mobile fader thumb
  panelTop: "--panel-top",     // player card gradient
  panelBottom: "--panel-bottom",
  navBg: "--nav-bg",           // fixed site header
  cardTop: "--card-top",       // landing song-card gradient
  cardBottom: "--card-bottom",
  wave: "--wave",              // waveform, unplayed
  waveProgress: "--wave-progress", // waveform, played
};
