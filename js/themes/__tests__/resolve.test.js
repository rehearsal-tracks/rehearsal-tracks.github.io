import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTheme, PRESETS, previewPresetFromQuery } from "../resolve.js";
import { TOKENS } from "../tokens.js";

const quiet = { warn: () => {} };

test("every preset defines every token with a valid hex", () => {
  for (const [id, p] of Object.entries(PRESETS)) {
    assert.equal(p.id, id);
    for (const key of Object.keys(TOKENS)) {
      assert.match(p.tokens[key] ?? "", /^#[0-9a-f]{6}$/i, `${id}.${key}`);
    }
    assert.deepEqual(Object.keys(p.tokens).sort(), Object.keys(TOKENS).sort(), `${id} has extra tokens`);
  }
});

test("resolves a preset into hex + rgb CSS vars", () => {
  const t = resolveTheme({ preset: "toxic" }, quiet);
  assert.equal(t.id, "toxic");
  assert.equal(t.vars["--accent"], "#8bff1f");
  assert.equal(t.vars["--accent-rgb"], "139, 255, 31");
  assert.equal(Object.keys(t.vars).length, Object.keys(TOKENS).length * 2);
  assert.equal(typeof t.background, "function");
});

test("applies whitelisted, valid overrides (normalised to lowercase)", () => {
  const t = resolveTheme({ preset: "toxic", overrides: { accent: "#FF3FA4" } }, quiet);
  assert.equal(t.tokens.accent, "#ff3fa4");
  assert.equal(t.vars["--accent-rgb"], "255, 63, 164");
  assert.equal(t.tokens.accent2, PRESETS.toxic.tokens.accent2); // untouched
});

test("ignores unknown keys and invalid colours, with a warning each", () => {
  const warnings = [];
  const t = resolveTheme(
    { preset: "toxic", overrides: { accent: "red", fontSize: "#ffffff", __proto__x: "#000000" } },
    { warn: (m) => warnings.push(m) },
  );
  assert.equal(t.tokens.accent, PRESETS.toxic.tokens.accent);
  assert.equal(t.vars["--fontSize"], undefined);
  assert.equal(warnings.length, 3);
});

test("unknown preset falls back to neutral with a warning; missing preset falls back silently", () => {
  const warnings = [];
  assert.equal(resolveTheme({ preset: "nope" }, { warn: (m) => warnings.push(m) }).id, "neutral");
  assert.equal(warnings.length, 1);
  assert.equal(resolveTheme({}, { warn: (m) => warnings.push(m) }).id, "neutral");
  assert.equal(resolveTheme(undefined, quiet).id, "neutral");
  assert.equal(warnings.length, 1);
});

test("resolving does not mutate the preset", () => {
  const before = JSON.stringify(PRESETS.toxic.tokens);
  resolveTheme({ preset: "toxic", overrides: { accent: "#000000" } }, quiet);
  assert.equal(JSON.stringify(PRESETS.toxic.tokens), before);
});

test("previewPresetFromQuery returns a known preset id or null", () => {
  assert.equal(previewPresetFromQuery("?preset=neutral"), "neutral");
  assert.equal(previewPresetFromQuery("?song=x&preset=toxic"), "toxic");
  assert.equal(previewPresetFromQuery("?preset=nope"), null);
  assert.equal(previewPresetFromQuery(""), null);
});
