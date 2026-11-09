// Provider errors may include URLs/credentials. Only counters cross the subprocess boundary.
export default async function* report(source) {
  for await (const event of source) {
    if (event.type !== "test:summary" || event.data.file) continue;
    const counts = event.data.counts;
    const summary = {};
    for (const name of ["tests", "passed", "failed", "cancelled", "skipped"]) summary[name] = Number(counts?.[name] ?? 0);
    yield `${JSON.stringify(summary)}\n`;
  }
}
