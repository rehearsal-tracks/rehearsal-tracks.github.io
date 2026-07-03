// js/sw-register.js — register the service worker, surface updates, and offer an "install"
// affordance. Imported by both index.html and stream.html. Everything here is defensive and
// additive: a failure (unsupported browser, blocked registration) must never affect the page.
// See the PWA design doc: ~/.claude/plans/2026-07-02-stem-player-pwa-design.md.

// ── Register + update lifecycle ────────────────────────────────────────────────────────────────
// Update model (chosen with Andrew): a new deploy ships a byte-different sw.js (content-hashed
// SHELL_VERSION), so the browser installs the new worker + precaches the new shell in the
// background. We DON'T skipWaiting — the new version activates automatically the next time the app
// is fully closed & reopened. If a tab stays open, we show a "Reload" pill so the user applies it
// when convenient (never mid-playback).
let reloadOnControllerChange = false;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js", { scope: "./" });
      watchForUpdates(reg);
      // Long-open sessions: re-check for a new deploy whenever the tab regains focus.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    } catch (err) {
      console.warn("[sw] registration failed:", err);
    }
  });

  // When a newly-activated worker takes control, reload — but ONLY if the user asked for it via the
  // pill. This avoids a spurious reload on the very first install (initial clients.claim) and when a
  // waiting worker auto-activates on a fresh cold launch (the page is already the new version).
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadOnControllerChange) window.location.reload();
  });
}

function watchForUpdates(reg) {
  // A worker may already be waiting (installed while this tab was away).
  if (reg.waiting && navigator.serviceWorker.controller) showUpdatePill(reg);
  reg.addEventListener("updatefound", () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      // "installed" WITH an existing controller means this is an update, not the first install.
      if (installing.state === "installed" && navigator.serviceWorker.controller) showUpdatePill(reg);
    });
  });
}

function showUpdatePill(reg) {
  if (document.querySelector(".install-banner--update")) return; // already showing
  const msg = document.createElement("span");
  msg.className = "install-banner__hint";
  msg.textContent = "A new version is ready";
  const reload = document.createElement("button");
  reload.className = "install-banner__action";
  reload.textContent = "↻ Reload";
  reload.addEventListener("click", () => {
    reload.disabled = true;
    reloadOnControllerChange = true;
    // Tell the waiting worker to activate; controllerchange then reloads the page.
    (reg.waiting || reg.installing)?.postMessage({ type: "SKIP_WAITING" });
  });
  buildBanner([msg, reload], { variant: "update" });
}

// ── Install affordance ───────────────────────────────────────────────────────────────────────
// Already installed / launched from the home screen → never nag.
const isStandalone =
  window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
// One dismissal quiets the install prompt for the rest of the browser session.
const DISMISS_KEY = "rehearsal-tracks:install-dismissed";
const installDismissed = (() => {
  try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
})();

// Build the little bottom-centered pill. `nodes` is the content (a button on Android, a text hint
// on iOS, or the update message + reload). `onClose` runs when the × is tapped (defaults to just
// removing the pill). `variant` adds a modifier class for de-duping.
function buildBanner(nodes, { onClose, variant } = {}) {
  const bar = document.createElement("div");
  bar.className = "install-banner" + (variant ? ` install-banner--${variant}` : "");
  bar.append(...(Array.isArray(nodes) ? nodes : [nodes]));
  const close = document.createElement("button");
  close.className = "install-banner__close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "✕";
  close.addEventListener("click", () => { bar.remove(); onClose?.(); });
  bar.append(close);
  document.body.appendChild(bar);
  return bar;
}

if (!isStandalone && !installDismissed) {
  const persistDismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode — fine */ }
  };

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
      bar?.remove();
      persistDismiss();
    });
    buildBanner(btn, { variant: "install", onClose: persistDismiss });
  });

  // iOS Safari has no install event — show a one-line manual hint (Share → Add to Home Screen).
  const isIOS = /iph|ipa|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS reports as Mac
  const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);
  if (isIOS && isSafari) {
    const hint = document.createElement("span");
    hint.className = "install-banner__hint";
    hint.innerHTML = "Install: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>";
    buildBanner(hint, { variant: "install", onClose: persistDismiss });
  }
}
