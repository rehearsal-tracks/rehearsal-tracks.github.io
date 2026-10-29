// js/theme-boot.js — CLASSIC script, loaded synchronously in <head> so it runs before first paint.
// Paints the cached theme of the project this page is about to show, so a project with its own
// colours doesn't flash the CSS defaults (toxic) while modules load. The page module then applies
// the real theme. Reads the keys written by js/lib/project-state.js; a classic script can't import
// that module, so the names are duplicated here (theme-boot.test.js keeps them in sync).
(function () {
  try {
    var P = "rehearsal-tracks:";
    var get = function (k) { return JSON.parse(localStorage.getItem(P + k) || "null"); };
    var q = new URLSearchParams(location.search);
    var key;
    if (q.has("song")) key = (get("song-project:v1") || {})[q.get("song")];
    else if (q.has("projects")) key = "@picker";
    else if (q.has("project")) key = q.get("project") || "@picker"; // empty → landing shows the picker
    else {
      // Returning visitor: the landing page reopens the last project unless it's archived.
      var last = get("last-project");
      key = last && !((get("projects:v1") || {})[last] || {}).archived ? last : "@picker";
    }
    var t = key && get("theme:v1:" + key);
    if (!t || !t.vars) return;
    var root = document.documentElement;
    for (var name in t.vars) root.style.setProperty(name, t.vars[name]);
    root.dataset.theme = t.id;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && t.bg) meta.setAttribute("content", t.bg);
  } catch (e) { /* first paint falls back to the styles.css defaults */ }
})();
