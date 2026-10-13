// js/media-session.js — background playback + lock-screen / media-key controls.
//
// Three mechanisms work together:
//
// 1. Audio Session API (iOS/iPadOS 17+ Safari): navigator.audioSession.type = "playback" puts the
//    page's Web Audio in the media-playback category, so it keeps playing when the app is
//    backgrounded or the screen locks, and plays through the silent switch. Must be set before any
//    AudioContext is created. Absent in Chrome/Firefox, so it's a no-op on desktop and Android.
//
// 2. Silent <audio> keep-alive: our music is pure Web Audio, which the OS doesn't treat as "media".
//    A looping silent MP3 played alongside it makes the page a real media session: Android Chrome
//    only shows its media notification (which keeps the tab alive in the background) for a media
//    element at least 5 s long — hence the 10 s file — and older iOS needs it to keep Web Audio
//    running. Because the OS pauses media elements on interruptions (phone call, another app's
//    audio, headphones unplugged) but NOT Web Audio, a pause we didn't request is our signal to
//    pause the player too.
//
// 3. Media Session API: lock-screen / notification metadata and transport handlers. On desktop
//    these also route hardware media keys and the browser/OS "now playing" controls to the player.

const KEEP_ALIVE_SRC = "silence.mp3";

// Call before any AudioContext exists (i.e. before the player is created).
export function enableBackgroundAudioSession() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch { /* unsupported value / implementation — fall back to the keep-alive alone */ }
}

export function initMediaSession({
  title, artist, onPlay, onPause, onSeek, getDuration, getCurrentTime, getPlaybackRate,
}) {
  const audio = document.createElement("audio");
  audio.src = KEEP_ALIVE_SRC;
  audio.loop = true;
  audio.preload = "auto";
  audio.setAttribute("playsinline", "");
  audio.disableRemotePlayback = true;

  // Whether the PLAYER is playing — the keep-alive should mirror it.
  let wantPlaying = false;

  // System-initiated pause (interruption, audio focus loss, headphones unplugged) → pause the
  // player, whose Web Audio would otherwise keep going. `audio.paused` filters out stale events
  // from our own pause() when a play() was issued right after it (e.g. pause+start during a seek).
  audio.addEventListener("pause", () => {
    if (wantPlaying && audio.paused) onPause();
  });

  const ms = "mediaSession" in navigator ? navigator.mediaSession : null;

  let lastPositionUpdate = 0;
  const updatePosition = (currentTime = getCurrentTime(), force = false) => {
    if (!ms?.setPositionState) return;
    const now = performance.now();
    if (!force && now - lastPositionUpdate < 1000) return;
    lastPositionUpdate = now;
    const duration = getDuration() || 0;
    const playbackRate = getPlaybackRate() || 1;
    if (!(duration > 0) || !(currentTime >= 0)) return;
    try {
      ms.setPositionState({ duration, position: Math.min(currentTime, duration), playbackRate });
    } catch { /* some browsers reject out-of-range values */ }
  };

  // Idempotent: called from both the user's play gesture (so iOS allows <audio>.play()) and the
  // engines' real state events (which also cover the spacebar, which bypasses controls:play).
  const notifyPlay = () => {
    wantPlaying = true;
    if (audio.paused) audio.play().catch(() => {});
    if (ms) ms.playbackState = "playing";
    updatePosition(undefined, true);
  };

  const notifyPause = () => {
    wantPlaying = false;
    if (!audio.paused) audio.pause();
    if (ms) ms.playbackState = "paused";
    // Keep (not clear) the position so the lock-screen scrubber stays put while paused.
    updatePosition(undefined, true);
  };

  if (ms) {
    ms.metadata = new MediaMetadata({
      title,
      artist,
      artwork: [
        { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
    const setHandler = (action, fn) => {
      try { ms.setActionHandler(action, fn); } catch { /* action unsupported in this browser */ }
    };
    setHandler("play", () => onPlay());
    setHandler("pause", () => onPause());
    setHandler("stop", () => onPause());
    setHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") onSeek(details.seekTime);
    });
  }

  return { notifyPlay, notifyPause, updatePosition };
}
