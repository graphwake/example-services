#!/usr/bin/env node
// Applies the next step of the change cycle to both services.
// Usage: node scripts/mutate.mjs [--guard] [rootDir]
// Prints the commit message on stdout. Exits 1 (and writes nothing) when state.json is missing or invalid.
// --guard: when state.json was last committed less than MIN_GAP_MINUTES ago, change nothing, print nothing on
// stdout and exit 0. Steps come in pairs that undo each other (add/remove a field, remove/restore an endpoint), so
// two changes inside one URL check (30 min) or before an upload finishes would reach Graphwake as no change at all.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { SERVICES, specFor, describeStep } from "./specs.mjs";

const SHORT = {
  1: "add optional fields",
  2: "remove optional fields",
  3: "remove watched endpoints",
  4: "restore watched endpoints",
};

export const MIN_GAP_MINUTES = 35;

export function tooSoon(lastChangeMs, nowMs) {
  return lastChangeMs != null && nowMs - lastChangeMs < MIN_GAP_MINUTES * 60_000;
}

// Commit time of the last commit that touched state.json, or null when git can't tell.
function lastChangeAt(root) {
  const r = spawnSync("git", ["log", "-1", "--format=%ct", "--", "state.json"], { cwd: root, encoding: "utf8" });
  const secs = Number.parseInt(r.stdout, 10);
  return r.status === 0 && Number.isFinite(secs) ? secs * 1000 : null;
}

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
  const args = process.argv.slice(2);
  const guard = args.includes("--guard");
  const root = args.find((a) => a !== "--guard") ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (guard && tooSoon(lastChangeAt(root), Date.now())) {
    process.stderr.write(`mutate: skipped, the specs changed less than ${MIN_GAP_MINUTES} minutes ago\n`);
    process.exit(0);
  }
  try {
    process.stdout.write(mutate(root).message + "\n");
  } catch (err) {
    process.stderr.write(`mutate: ${err.message}\n`);
    process.exit(1);
  }
}
