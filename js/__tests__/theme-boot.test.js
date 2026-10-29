// js/__tests__/theme-boot.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { cacheTheme, setSongProject, setLastProject, rememberProject, PICKER_THEME_KEY } from "../lib/project-state.js";
import { resolveTheme } from "../themes/resolve.js";

const src = await readFile(new URL("../theme-boot.js", import.meta.url), "utf8");

function storage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function run(search, store) {
  const props = {};
  const meta = { content: "#0a0e07", setAttribute(k, v) { this[k] = v; } };
  const documentElement = { style: { setProperty: (k, v) => { props[k] = v; } }, dataset: {} };
  vm.runInNewContext(src, {
    URLSearchParams, JSON,
    location: { search },
    localStorage: store,
    document: { documentElement, querySelector: () => meta },
  });
  return { props, theme: documentElement.dataset.theme ?? null, meta: meta.content };
}

const neutral = resolveTheme({ preset: "neutral" });

test("?project=<pid> paints that project's cached theme (vars, data-theme, theme-color)", () => {
  const s = storage();
  cacheTheme("show", { preset: "neutral" }, s);
  const r = run("?project=show", s);
  assert.deepEqual(r.props, neutral.vars);
  assert.equal(r.theme, "neutral");
  assert.equal(r.meta, neutral.tokens.bg);
});

test("?song=<id> uses the song → project map", () => {
  const s = storage();
  cacheTheme("show", { preset: "neutral" }, s);
  setSongProject("tune", "show", s);
  assert.equal(run("?song=tune", s).theme, "neutral");
  assert.equal(run("?song=unknown", s).theme, null);
});

test("no query → the last project; else the picker's theme", () => {
  const s = storage();
  cacheTheme("show", { preset: "neutral" }, s);
  setLastProject("show", s);
  assert.equal(run("", s).theme, "neutral");
  const p = storage();
  cacheTheme(PICKER_THEME_KEY, { preset: "neutral" }, p);
  assert.equal(run("", p).theme, "neutral");
  assert.equal(run("?projects", p).theme, "neutral");
});

test("an empty ?project= paints the picker's theme, not the last project's", () => {
  const s = storage();
  cacheTheme("show", { preset: "toxic" }, s);
  cacheTheme(PICKER_THEME_KEY, { preset: "neutral" }, s);
  setLastProject("show", s);
  assert.equal(run("?project=", s).theme, "neutral");
});

test("an archived last project paints the picker's theme (the landing page shows the picker)", () => {
  const s = storage();
  cacheTheme("old", { preset: "toxic" }, s);
  cacheTheme(PICKER_THEME_KEY, { preset: "neutral" }, s);
  rememberProject({ id: "old", name: "Old", archived: true }, s);
  setLastProject("old", s);
  assert.equal(run("", s).theme, "neutral");
  assert.equal(run("?project=old", s).theme, "toxic"); // a direct link still shows it
});

test("nothing cached, junk or a throwing storage → no change, no throw", () => {
  assert.deepEqual(run("?project=show", storage()).props, {});
  const junk = storage();
  junk.setItem("rehearsal-tracks:theme:v1:show", "{oops");
  assert.deepEqual(run("?project=show", junk).props, {});
  const boom = { getItem() { throw new Error("denied"); } };
  assert.doesNotThrow(() => run("?project=show", boom));
});
