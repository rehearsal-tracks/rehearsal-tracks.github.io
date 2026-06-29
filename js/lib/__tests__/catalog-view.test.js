import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, songCardModel } from "../catalog-view.js";

test("formatDuration formats minutes:seconds", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(63), "1:03");
  assert.equal(formatDuration(612.4), "10:12");
  assert.equal(formatDuration(59.6), "1:00"); // rounds up to a full minute
});

test("formatDuration tolerates missing input", () => {
  assert.equal(formatDuration(undefined), "0:00");
});

test("songCardModel builds an encoded href", () => {
  const m = songCardModel({ id: "a b", title: "T", artist: "AB", durationSeconds: 60, stemCount: 3 });
  assert.equal(m.href, "stream.html?song=a%20b");
  assert.equal(m.id, "a b");
  assert.equal(m.title, "T");
});

test("songCardModel pluralises stems", () => {
  assert.match(songCardModel({ id: "x", title: "X", artist: "AB", durationSeconds: 60, stemCount: 1 }).meta, /1 stem(?!s)/);
  assert.match(songCardModel({ id: "x", title: "X", artist: "AB", durationSeconds: 60, stemCount: 2 }).meta, /2 stems/);
});

test("songCardModel joins meta with separators and includes duration", () => {
  const m = songCardModel({ id: "x", title: "X", artist: "Andrew Bray", durationSeconds: 612.4, stemCount: 11 });
  assert.equal(m.meta, "Andrew Bray · 10:12 · 11 stems");
});

test("songCardModel drops a missing artist", () => {
  const m = songCardModel({ id: "x", title: "X", artist: "", durationSeconds: 60, stemCount: 2 });
  assert.equal(m.meta, "1:00 · 2 stems");
});
