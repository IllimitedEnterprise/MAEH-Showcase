import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGit } from "../scripts/lib/git.mjs";
import { NOREPLY, applySettings, describePlan, makeHooksExecutable, planSettings, wantedSettings } from "../scripts/lib/setup.mjs";
import { gitAvailable } from "./helpers/repo.mjs";
import { REPO } from "./helpers/site-data.mjs";

const info = gitAvailable();

function scratchRepo() {
  const base = mkdtempSync(join(tmpdir(), "maeh-setup-"));
  const root = join(base, "repo");
  mkdirSync(join(root, ".githooks"), { recursive: true });
  writeFileSync(join(root, ".githooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
  const globalConfig = join(base, "global-gitconfig");
  writeFileSync(globalConfig, "[user]\n\tname = Someone Else\n\temail = private@example.com\n");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1" };
  const git = createGit({ gitPath: info.path, cwd: root, env });
  git.exec(["init", "-q", "-b", "main"]);
  return { base, root, git, env, globalConfig, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test("the plan names what would change and why, and applying it is idempotent", { skip: !info }, () => {
  const repo = scratchRepo();
  try {
    const wanted = wantedSettings({ ghPath: "C:\\Program Files\\GitHub CLI\\gh.exe", name: "Frequency", email: "1+me@users.noreply.github.com" });
    const plan = planSettings(repo.git, wanted);
    assert.ok(plan.every((entry) => entry.change), "a fresh repository needs every setting");
    assert.match(describePlan(plan).join("\n"), /core\.hooksPath[\s\S]*\(not set\)\s+->\s+\.githooks/);

    const done = applySettings(repo.git, plan);
    assert.deepEqual(done.sort(), plan.map((entry) => entry.key).sort());
    assert.equal(repo.git.exec(["config", "--local", "--get", "core.hooksPath"]).stdout.trim(), ".githooks");
    assert.equal(repo.git.exec(["config", "--local", "--get", "core.autocrlf"]).stdout.trim(), "false");
    assert.equal(repo.git.exec(["config", "--local", "--get", "user.name"]).stdout.trim(), "Frequency");
    const helpers = repo.git.exec(["config", "--local", "--get-all", "credential.https://github.com.helper"]).stdout.split("\n").filter((line, index, all) => index < all.length - 1 || line !== "");
    assert.deepEqual(helpers, ["", "!'C:/Program Files/GitHub CLI/gh.exe' auth git-credential"], "an empty entry resets wider helpers, then ours");

    const again = planSettings(repo.git, wanted);
    assert.ok(again.every((entry) => !entry.change), "nothing left to change");
    assert.deepEqual(applySettings(repo.git, again), []);
  } finally {
    repo.cleanup();
  }
});

test("only the repository's own config is written; the global one is left alone", { skip: !info }, () => {
  const repo = scratchRepo();
  try {
    const before = repo.git.exec(["config", "--global", "--list"]).stdout;
    applySettings(repo.git, planSettings(repo.git, wantedSettings({ ghPath: "/usr/bin/gh", name: "Frequency" })));
    assert.equal(repo.git.exec(["config", "--global", "--list"]).stdout, before);
    assert.equal(repo.git.exec(["config", "--global", "--get", "user.name"]).stdout.trim(), "Someone Else");
    assert.equal(repo.git.exec(["config", "--local", "--get", "user.name"]).stdout.trim(), "Frequency");
  } finally {
    repo.cleanup();
  }
});

test("identity and credentials are only touched when asked for", () => {
  const keys = wantedSettings().map((entry) => entry.key);
  assert.deepEqual(keys, ["core.hooksPath", "core.autocrlf"]);
  assert.ok(wantedSettings({ ghPath: "/x/gh" }).some((entry) => entry.key === "credential.https://github.com.helper"));
});

test("only a GitHub noreply address is accepted as a commit address", () => {
  for (const good of ["269201905+IllimitedEnterprise@users.noreply.github.com", "someone@users.noreply.github.com"]) assert.match(good, NOREPLY);
  for (const bad of ["me@gmail.com", "x@noreply.github.com", "1+me@users.noreply.github.com.evil.example", "private@example.com"]) assert.doesNotMatch(bad, NOREPLY);
});

test("hooks become executable on Linux and macOS, and nothing happens on Windows", () => {
  const base = mkdtempSync(join(tmpdir(), "maeh-hooks-"));
  try {
    mkdirSync(join(base, ".githooks"), { recursive: true });
    writeFileSync(join(base, ".githooks", "pre-push"), "#!/bin/sh\n");
    chmodSync(join(base, ".githooks", "pre-push"), 0o644);
    assert.deepEqual(makeHooksExecutable(base, "win32"), []);
    assert.deepEqual(makeHooksExecutable(base, "linux"), ["pre-push"]);
    if (process.platform !== "win32") assert.equal(statSync(join(base, ".githooks", "pre-push")).mode & 0o111, 0o111);
    assert.deepEqual(makeHooksExecutable(join(base, "nowhere"), "linux"), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the command shows the plan without --yes and changes nothing", { skip: !info }, () => {
  const repo = scratchRepo();
  try {
    /* The script always works on the checkout it lives in, so this is a read-only look at this one:
     * without --yes it must print the plan and change nothing. */
    const result = spawnSync(process.execPath, [join(REPO, "scripts", "setup.mjs"), "--no-credentials"], { encoding: "utf8", cwd: repo.root, env: repo.env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Run again with --yes|Nothing to change/);
    assert.match(result.stdout, /nothing global is changed/);
    const bad = spawnSync(process.execPath, [join(REPO, "scripts", "setup.mjs"), "--email", "me@gmail.com"], { encoding: "utf8", env: repo.env });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /noreply/);
  } finally {
    repo.cleanup();
  }
});
