// js/lib/__tests__/landing-route.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideLanding, pickerEntries } from "../landing-route.js";

test("?project=<pid> opens that project", () => {
  assert.deepEqual(decideLanding({ search: "?project=show", lastProject: "other" }), { view: "project", pid: "show", redirected: false });
});

test("an invalid ?project goes to the picker with a notice", () => {
  for (const search of ["?project=../x", "?project=", "?project=Show"]) {
    assert.deepEqual(decideLanding({ search, lastProject: "show" }), { view: "picker", notice: "invalid" });
  }
});

test("?projects always shows the picker, even with a last project or ?project", () => {
  assert.deepEqual(decideLanding({ search: "?projects", lastProject: "show" }), { view: "picker" });
  assert.deepEqual(decideLanding({ search: "?projects&project=show", lastProject: null }), { view: "picker" });
});

test("no query: returning visitor reopens the last project", () => {
  assert.deepEqual(decideLanding({ search: "", lastProject: "show", known: { show: { name: "S" } } }), { view: "project", pid: "show", redirected: true });
});

test("no query: nothing saved, an archived last project or a junk one → picker", () => {
  assert.deepEqual(decideLanding({ search: "", lastProject: null }), { view: "picker" });
  assert.deepEqual(decideLanding({ search: "", lastProject: "old", known: { old: { name: "O", archived: true } } }), { view: "picker" });
  assert.deepEqual(decideLanding({ search: "", lastProject: "../x" }), { view: "picker" });
});

test("other params (e.g. ?preset=) don't affect routing", () => {
  assert.deepEqual(decideLanding({ search: "?preset=neutral", lastProject: "show" }), { view: "project", pid: "show", redirected: true });
});

test("pickerEntries: listed ∪ known, de-duplicated, archived known hidden, sorted by name", () => {
  const entries = pickerEntries({
    listed: [{ id: "toxic", name: "The Toxic Avenger" }, { id: "b", name: "bravo" }],
    known: {
      toxic: { name: "Old name", archived: false },  // listed copy wins
      secret: { name: "Alpha (unlisted)", archived: false },
      gone: { name: "Archived", archived: true },
      "../bad": { name: "Bad" },
    },
  });
  assert.deepEqual(entries, [
    { id: "secret", name: "Alpha (unlisted)" },
    { id: "b", name: "bravo" },
    { id: "toxic", name: "The Toxic Avenger" },
  ]);
});

test("pickerEntries tolerates missing inputs and nameless known entries", () => {
  assert.deepEqual(pickerEntries({}), []);
  assert.deepEqual(pickerEntries({ known: { x: {} } }), [{ id: "x", name: "x" }]);
  assert.deepEqual(pickerEntries({ known: { x: { name: 5 } } }), [{ id: "x", name: "5" }]); // junk storage can't break the sort
});
