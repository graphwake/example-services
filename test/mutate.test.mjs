import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mutate, render, tooSoon, MIN_GAP_MINUTES } from "../scripts/mutate.mjs";
import { SERVICES } from "../scripts/specs.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "scripts", "mutate.mjs");

function fixture(state) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "example-services-"));
  for (const s of SERVICES) {
    fs.mkdirSync(path.join(root, "services", s), { recursive: true });
    fs.writeFileSync(path.join(root, "services", s, "openapi.json"), render(s, 4));
  }
  if (state !== undefined) fs.writeFileSync(path.join(root, "state.json"), state);
  return root;
}

const read = (root, ...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const specFile = (root, s) => read(root, "services", s, "openapi.json");

test("first run from initial state goes to step 1", () => {
  const root = fixture('{ "step": 4 }\n');
  const { step, message } = mutate(root);
  assert.equal(step, 1);
  assert.deepEqual(JSON.parse(read(root, "state.json")), { step: 1 });
  for (const s of SERVICES) assert.equal(specFile(root, s), render(s, 1));
  const lines = message.split("\n");
  assert.equal(lines[0], "chore(specs): step 1 of 4: add optional fields");
  assert.equal(lines[1], "");
  assert.equal(lines[2], "catalog: add optional field ProductDetail.warrantyMonths (non-breaking)");
  assert.equal(lines[3], "orders: add optional field OrderDetail.giftNote (non-breaking)");
});

test("commit message first lines for every step", () => {
  const root = fixture('{ "step": 4 }\n');
  const firsts = [1, 2, 3, 4].map(() => mutate(root).message.split("\n")[0]);
  assert.deepEqual(firsts, [
    "chore(specs): step 1 of 4: add optional fields",
    "chore(specs): step 2 of 4: remove optional fields",
    "chore(specs): step 3 of 4: remove watched endpoints",
    "chore(specs): step 4 of 4: restore watched endpoints",
  ]);
});

test("four runs return to the start", () => {
  const root = fixture('{ "step": 4 }\n');
  for (let i = 0; i < 4; i++) mutate(root);
  assert.deepEqual(JSON.parse(read(root, "state.json")), { step: 4 });
  for (const s of SERVICES) assert.equal(specFile(root, s), render(s, 4));
});

for (const [name, state] of [
  ["missing state", undefined],
  ["step 0", '{ "step": 0 }'],
  ["step as string", '{ "step": "2" }'],
  ["not json", "not json"],
]) {
  test(`bad state fails and writes nothing: ${name}`, () => {
    const root = fixture(state);
    const before = SERVICES.map((s) => specFile(root, s));
    assert.throws(() => mutate(root));
    assert.deepEqual(SERVICES.map((s) => specFile(root, s)), before);
    const cli = spawnSync(process.execPath, [CLI, root], { encoding: "utf8" });
    assert.equal(cli.status, 1);
    assert.equal(cli.stdout, "");
    assert.deepEqual(SERVICES.map((s) => specFile(root, s)), before);
  });
}

test("CLI prints the commit message", () => {
  const root = fixture('{ "step": 2 }\n');
  const cli = spawnSync(process.execPath, [CLI, root], { encoding: "utf8" });
  assert.equal(cli.status, 0);
  assert.match(cli.stdout, /^chore\(specs\): step 3 of 4: remove watched endpoints\n/);
});

test("committed files match the committed state", () => {
  const { step } = JSON.parse(read(REPO, "state.json"));
  for (const s of SERVICES) assert.equal(specFile(REPO, s), render(s, step), `${s} is out of sync with state.json`);
});

test("tooSoon blocks a change within the minimum gap", () => {
  const now = Date.parse("2026-11-07T06:30:00Z");
  assert.equal(MIN_GAP_MINUTES, 35);
  assert.equal(tooSoon(now - 10 * 60_000, now), true);
  assert.equal(tooSoon(now - 34 * 60_000, now), true);
  assert.equal(tooSoon(now - 35 * 60_000, now), false);
  assert.equal(tooSoon(now - 6 * 3600_000, now), false);
  assert.equal(tooSoon(null, now), false);
});

test("CLI --guard skips with empty stdout when the last change is too recent", () => {
  const root = fixture('{ "step": 4 }\n');
  const git = (...a) => spawnSync("git", a, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  const before = SERVICES.map((s) => specFile(root, s));
  const cli = spawnSync(process.execPath, [CLI, "--guard", root], { encoding: "utf8" });
  assert.equal(cli.status, 0);
  assert.equal(cli.stdout, "");
  assert.match(cli.stderr, /skipped/);
  assert.deepEqual(SERVICES.map((s) => specFile(root, s)), before);
  assert.deepEqual(JSON.parse(read(root, "state.json")), { step: 4 });
});

test("CLI --guard applies the step when the last change is old", () => {
  const root = fixture('{ "step": 4 }\n');
  const old = "2026-01-01T00:00:00Z";
  const env = { ...process.env, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old };
  const git = (...a) => spawnSync("git", a, { cwd: root, encoding: "utf8", env });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  const cli = spawnSync(process.execPath, [CLI, "--guard", root], { encoding: "utf8" });
  assert.equal(cli.status, 0);
  assert.match(cli.stdout, /^chore\(specs\): step 1 of 4/);
});
