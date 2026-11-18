#!/usr/bin/env node
// CLI only. The import library lives in server/import/brasfoot/importer.mjs (audit Q-03).
import { z } from "zod";
import { redactText, stringifyRedacted } from "../server/infrastructure/redaction.mjs";
import { helpText, parseArguments, runImport } from "../server/import/brasfoot/importer.mjs";

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) console.log(helpText());
  else console.log(stringifyRedacted(await runImport(options), 2));
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error("Dataset inválido:", redactText(error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")));
  } else {
    console.error(redactText(error.message));
  }
  process.exitCode = 1;
}
