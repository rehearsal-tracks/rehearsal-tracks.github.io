// js/lib/__tests__/project-state.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KEYS, PICKER_THEME_KEY, getLastProject, setLastProject, knownProjects, rememberProject,
  forgetProject, getSongProject, setSongProject, cacheTheme, getCachedTheme,
} from "../project-state.js";
import { resolveTheme } from "../../themes/resolve.js";

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}
const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };

test("keys are namespaced like the existing mix key", () => {
  assert.equal(KEYS.last, "rehearsal-tracks:last-project");
  assert.equal(KEYS.known, "rehearsal-tracks:projects:v1");
  assert.equal(KEYS.songs, "rehearsal-tracks:song-project:v1");
  assert.equal(KEYS.theme("show"), "rehearsal-tracks:theme:v1:show");
  assert.equal(PICKER_THEME_KEY, "@picker");
});

test("last project round-trips; junk reads as null", () => {
  const s = fakeStorage();
  assert.equal(getLastProject(s), null);
  setLastProject("show", s);
  assert.equal(getLastProject(s), "show");
  assert.equal(getLastProject(fakeStorage({ [KEYS.last]: "{not json" })), null);
  assert.equal(getLastProject(fakeStorage({ [KEYS.last]: "42" })), null);
});

test("rememberProject stores name + archived; knownProjects tolerates junk", () => {
  const s = fakeStorage();
  rememberProject({ id: "a", name: "A", archived: false, credit: "ignored" }, s);
  rememberProject({ id: "b", name: "B", archived: true }, s);
  assert.deepEqual(knownProjects(s), { a: { name: "A", archived: false }, b: { name: "B", archived: true } });
  assert.deepEqual(knownProjects(fakeStorage({ [KEYS.known]: "[1,2]" })), {});
});

test("forgetProject drops it from known, lastProject (if it was last) and the theme cache", () => {
  const s = fakeStorage();
  rememberProject({ id: "a", name: "A" }, s);
  rememberProject({ id: "b", name: "B" }, s);
  setLastProject("a", s);
  cacheTheme("a", { preset: "neutral" }, s);
  forgetProject("a", s);
  assert.deepEqual(Object.keys(knownProjects(s)), ["b"]);
  assert.equal(getLastProject(s), null);
  assert.equal(getCachedTheme("a", s), null);
  setLastProject("b", s);
  forgetProject("zzz", s);
  assert.equal(getLastProject(s), "b");
});

test("song → project map", () => {
  const s = fakeStorage();
  assert.equal(getSongProject("x", s), null);
  setSongProject("x", "show", s);
  setSongProject("y", "other", s);
  assert.equal(getSongProject("x", s), "show");
  assert.equal(getSongProject("y", s), "other");
});

test("cacheTheme stores the setting plus resolved vars, id and bg for theme-boot", () => {
  const s = fakeStorage();
  const setting = { preset: "toxic", overrides: { accent: "#ff0000" } };
  cacheTheme("show", setting, s);
  const t = getCachedTheme("show", s);
  const r = resolveTheme(setting);
  assert.deepEqual(t, { setting, id: "toxic", vars: r.vars, bg: r.tokens.bg });
  assert.equal(getCachedTheme("nope", s), null);
  cacheTheme("bare", null, s); // a catalog without a theme block → neutral, no throw
  assert.equal(getCachedTheme("bare", s).id, "neutral");
});

test("every function survives a throwing or missing storage", () => {
  for (const s of [throwing, null]) {
    assert.equal(getLastProject(s), null);
    assert.doesNotThrow(() => setLastProject("a", s));
    assert.deepEqual(knownProjects(s), {});
    assert.doesNotThrow(() => rememberProject({ id: "a", name: "A" }, s));
    assert.doesNotThrow(() => forgetProject("a", s));
    assert.equal(getSongProject("x", s), null);
    assert.doesNotThrow(() => setSongProject("x", "a", s));
    assert.doesNotThrow(() => cacheTheme("a", { preset: "neutral" }, s));
    assert.equal(getCachedTheme("a", s), null);
  }
});
