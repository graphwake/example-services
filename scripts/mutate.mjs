#!/usr/bin/env node
// Applies the next step of the change cycle to both services.
// Usage: node scripts/mutate.mjs [rootDir]
// Prints the commit message on stdout. Exits 1 (and writes nothing) when state.json is missing or invalid.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICES, specFor, describeStep } from "./specs.mjs";

const SHORT = {
  1: "add optional fields",
  2: "remove optional fields",
  3: "remove watched endpoints",
  4: "restore watched endpoints",
};

export function render(service, step) {
  return JSON.stringify(specFor(service, step), null, 2) + "\n";
}

function readState(root) {
  const file = path.join(root, "state.json");
  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`cannot read ${file}: ${err.message}`);
  }
  const step = state?.step;
  if (!Number.isInteger(step) || step < 1 || step > 4) {
    throw new Error(`${file}: "step" must be an integer from 1 to 4, got ${JSON.stringify(step)}`);
  }
  return step;
}

export function mutate(root) {
  const step = (readState(root) % 4) + 1;
  // Render everything before writing anything.
  const files = SERVICES.map((s) => [path.join(root, "services", s, "openapi.json"), render(s, step)]);
  for (const [file, body] of files) fs.writeFileSync(file, body);
  fs.writeFileSync(path.join(root, "state.json"), JSON.stringify({ step }) + "\n");
  const message = [`chore(specs): step ${step} of 4: ${SHORT[step]}`, "", ...SERVICES.map((s) => describeStep(s, step))].join("\n");
  return { step, message };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    process.stdout.write(mutate(root).message + "\n");
  } catch (err) {
    process.stderr.write(`mutate: ${err.message}\n`);
    process.exit(1);
  }
}
