// Informational length report over the stems. Stems no longer need to be
// equal length: shorter stems simply end early (common zero-start). The CLI
// surfaces the spread as a note, never a gate.
export function lengthReport(stems) {
  if (!stems || stems.length === 0) throw new Error("no stems to report");
  const seconds = stems.map((s) => s.seconds);
  const min = Math.min(...seconds);
  const max = Math.max(...seconds);
  const spreadMs = Math.round((max - min) * 1000);
  const table = stems
    .map((s) => `  ${s.name.padEnd(20)} ${s.seconds.toFixed(3)}s`)
    .join("\n");
  return { spreadMs, min, max, table };
}
