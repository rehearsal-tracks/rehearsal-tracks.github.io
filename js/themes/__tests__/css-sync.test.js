// styles.css :root carries the toxic preset as its defaults so the site renders correctly before
// (or without) JS. This keeps the two from drifting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveTheme } from "../resolve.js";

const css = await readFile(new URL("../../../css/styles.css", import.meta.url), "utf8");
const root = css.match(/:root\s*{([^}]*)}/)?.[1] ?? "";
const declared = Object.fromEntries(
  [...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim().toLowerCase()]),
);

test("styles.css :root declares every toxic theme var with the preset's value", () => {
  const { vars } = resolveTheme({ preset: "toxic" }, { warn: () => {} });
  for (const [k, v] of Object.entries(vars)) {
    assert.equal(declared[k], v, `${k} in styles.css :root`);
  }
});
