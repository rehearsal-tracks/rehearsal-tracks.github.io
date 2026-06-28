export function checkEqualLength(stems, toleranceMs) {
  if (!stems || stems.length === 0) throw new Error("no stems to validate");
  const seconds = stems.map((s) => s.seconds);
  const min = Math.min(...seconds);
  const max = Math.max(...seconds);
  const spreadMs = Math.round((max - min) * 1000);
  const table = stems
    .map((s) => `  ${s.name.padEnd(20)} ${s.seconds.toFixed(3)}s`)
    .join("\n");
  return { ok: spreadMs <= toleranceMs, spreadMs, min, max, table };
}
