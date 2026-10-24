import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hermesWakes } from "./helpers/hermes.mjs";

const SHIM = fileURLToPath(new URL("../deploy/hermes/maeh-showcase-nightly.py", import.meta.url));

/* A real interpreter: PYTHON if set, else the first python on PATH that actually runs (on Windows the
 * first one is often the Microsoft Store stub, which does not). */
function findPython() {
  const names = process.platform === "win32" ? ["python.exe", "python3.exe"] : ["python3", "python"];
  const candidates = process.env.PYTHON ? [process.env.PYTHON] : [];
  for (const dir of String(process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) candidates.push(join(dir, name));
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ["-c", "print('ok')"], { encoding: "utf8", timeout: 20_000 });
    if (!probe.error && probe.status === 0 && probe.stdout.trim() === "ok") return candidate;
  }
  return null;
}
const python = findPython();
const skip = python ? {} : { skip: "no python on this machine" };

/* A fake repository whose scripts/nightly.mjs is whatever the test says. */
function fakeRepo(body) {
  const root = mkdtempSync(join(tmpdir(), "maeh-shim-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "nightly.mjs"), body);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function runShim(repo, env = {}) {
  const result = spawnSync(python, [SHIM], {
    encoding: "utf8", cwd: tmpdir(), timeout: 60_000,
    env: { ...process.env, MAEH_SHOWCASE_REPO: repo.root, MAEH_NODE: process.execPath, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const verdict = (stdout) => JSON.parse(stdout.trim().split("\n").at(-1));

test("a clean run passes the silent verdict straight through, and Hermes would skip the agent", skip, () => {
  const repo = fakeRepo('console.log("frozen days: 16"); console.log(JSON.stringify({wakeAgent:false,outcome:"noop",frozen:[],pushed:false,attention:[]}));');
  try {
    const result = runShim(repo);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /frozen days: 16/);
    assert.deepEqual(verdict(result.stdout), { wakeAgent: false, outcome: "noop", frozen: [], pushed: false, attention: [] });
    assert.equal(hermesWakes(result.stdout), false);
  } finally { repo.cleanup(); }
});

test("a run that needs a look passes its attention lines and wake verdict through", skip, () => {
  const repo = fakeRepo('console.log("ATTENTION 1 account(s) are partial"); console.log(JSON.stringify({wakeAgent:true,outcome:"frozen",frozen:["2026-10-22"],pushed:true,attention:["x"]}));');
  try {
    const result = runShim(repo);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /ATTENTION 1 account\(s\) are partial/);
    assert.equal(hermesWakes(result.stdout), true);
  } finally { repo.cleanup(); }
});

test("a non-zero exit WITH a verdict is passed through untouched: the script's own words win", skip, () => {
  const repo = fakeRepo('console.log("ATTENTION verification failed"); console.log(JSON.stringify({wakeAgent:true,outcome:"integrity",frozen:[],pushed:false,attention:["v"]})); process.exitCode = 3;');
  try {
    const result = runShim(repo);
    assert.equal(result.status, 0, "the shim exits 0 so Hermes reads the gate");
    assert.equal(verdict(result.stdout).outcome, "integrity");
  } finally { repo.cleanup(); }
});

test("a script that dies without a verdict still wakes the agent, with what it did print", skip, () => {
  const repo = fakeRepo('console.log("starting"); console.error("boom"); process.exitCode = 3;');
  try {
    const result = runShim(repo);
    assert.equal(result.status, 0);
    assert.equal(verdict(result.stdout).wakeAgent, true);
    assert.match(result.stdout, /exited with code 3 without a verdict/);
    assert.match(result.stdout, /starting/);
    assert.equal(hermesWakes(result.stdout), true);
  } finally { repo.cleanup(); }
});

test("a script that never exits is cut off and wakes the agent", skip, () => {
  const repo = fakeRepo("setInterval(() => {}, 1000);");
  try {
    const result = runShim(repo, { MAEH_SHIM_TIMEOUT_SECONDS: "1" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /did not finish within 1 minute/);
    assert.equal(hermesWakes(result.stdout), true);
  } finally { repo.cleanup(); }
});

test("no repository found: wake with a clear instruction", skip, () => {
  const result = spawnSync(python, [SHIM], {
    encoding: "utf8", cwd: tmpdir(), timeout: 60_000,
    env: { ...process.env, MAEH_SHOWCASE_REPO: join(tmpdir(), "does-not-exist-here"), HOME: tmpdir(), USERPROFILE: tmpdir() },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /repository was not found; set MAEH_SHOWCASE_REPO/);
  assert.equal(hermesWakes(result.stdout), true);
});

test("no usable Node: wake and say what to set", skip, () => {
  const repo = fakeRepo('console.log("never runs");');
  const empty = mkdtempSync(join(tmpdir(), "maeh-nonode-"));
  try {
    const result = spawnSync(python, [SHIM], {
      encoding: "utf8", cwd: tmpdir(), timeout: 60_000,
      env: { MAEH_SHOWCASE_REPO: repo.root, PATH: empty, LOCALAPPDATA: empty, ProgramFiles: empty, SystemRoot: process.env.SystemRoot ?? "" },
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /no Node 22 or newer was found; set MAEH_NODE/);
    assert.equal(hermesWakes(result.stdout), true);
  } finally { repo.cleanup(); rmSync(empty, { recursive: true, force: true }); }
});

test("a MAEH_NODE that points nowhere is skipped, not fatal, so it is not how to drill the failure", skip, () => {
  const repo = fakeRepo('console.log(JSON.stringify({wakeAgent:false,outcome:"noop",frozen:[],pushed:false,attention:[]}));');
  try {
    const result = runShim(repo, { MAEH_NODE: join(tmpdir(), "no-such-node.exe"), PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}` });
    assert.equal(result.status, 0);
    assert.equal(hermesWakes(result.stdout), false, "the shim went on to the next place it looks for Node");
    assert.doesNotMatch(result.stdout, /was found/);
  } finally { repo.cleanup(); }
});

test("whatever the script prints is reduced to printable ASCII", skip, () => {
  const repo = fakeRepo('console.log("caf\\u00e9 \\u2713"); console.log(JSON.stringify({wakeAgent:false,outcome:"noop",frozen:[],pushed:false,attention:[]}));');
  try {
    const result = runShim(repo);
    assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(result.stdout));
    assert.equal(hermesWakes(result.stdout), false);
  } finally { repo.cleanup(); }
});
