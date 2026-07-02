// js/sw-register.js — register the service worker and offer an "install" affordance.
// Imported by both index.html and stream.html. Everything here is defensive and additive: a
// failure (unsupported browser, blocked registration) must never affect the page. See the PWA
// design doc: ~/.claude/plans/2026-07-02-stem-player-pwa-design.md.

// ── Register the service worker ────────────────────────────────────────────────────────────────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js", { scope: "./" })
      .catch((err) => console.warn("[sw] registration failed:", err));
  });
}

// ── Install affordance ───────────────────────────────────────────────────────────────────────
// Already installed / launched from the home screen → never nag.
const isStandalone =
  window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
// One dismissal quiets the prompt for the rest of the browser session.
const DISMISS_KEY = "rehearsal-tracks:install-dismissed";
const dismissed = (() => {
  try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
})();

function dismiss(el) {
  el.remove();
  try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode — fine */ }
}

// Build the little bottom-centered pill. `body` is the action content (a button on Android, a
// text hint on iOS). A × dismisses it.
function buildBanner(bodyNode) {
  const bar = document.createElement("div");
  bar.className = "install-banner";
  bar.append(bodyNode);
  const close = document.createElement("button");
  close.className = "install-banner__close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "✕";
  close.addEventListener("click", () => dismiss(bar));
  bar.append(close);
  document.body.appendChild(bar);
  return bar;
}

if (!isStandalone && !dismissed) {
  // Android / desktop Chromium: the browser fires `beforeinstallprompt`; stash it and drive a real
  // install button. (iOS never fires this event.)
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    const btn = document.createElement("button");
    btn.className = "install-banner__action";
    btn.textContent = "⬇ Install app";
    btn.addEventListener("click", async () => {
      const bar = btn.closest(".install-banner");
      e.prompt();
      try { await e.userChoice; } catch { /* ignore */ }
      if (bar) dismiss(bar);
    });
    buildBanner(btn);
  });

  // iOS Safari has no install event — show a one-line manual hint (Share → Add to Home Screen).
  const isIOS = /iph|ipa|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS reports as Mac
  const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);
  if (isIOS && isSafari) {
    const hint = document.createElement("span");
    hint.className = "install-banner__hint";
    hint.innerHTML = "Install: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>";
    buildBanner(hint);
  }
}
