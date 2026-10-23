import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  assertNodeVersion, compareVersionStrings, findOnPath, gitCandidates, ghCandidates, resolveTool, stateDir,
  versionAtLeast,
} from "../scripts/lib/runtime.mjs";

test("version-stamped folders sort naturally, newest first", () => {
  const names = ["app-3.6.7", "app-3.10.0", "app-3.9.1"];
  assert.deepEqual(names.sort((a, b) => compareVersionStrings(b, a)), ["app-3.10.0", "app-3.9.1", "app-3.6.7"]);
  assert.equal(compareVersionStrings("git-2.53.0+3", "git-2.53.0+3"), 0);
});

test("node version floor", () => {
  assert.ok(versionAtLeast("v24.19.0", 22));
  assert.ok(!versionAtLeast("20.11.1", 22));
  assert.throws(() => assertNodeVersion(22, "20.11.1"));
  assert.doesNotThrow(() => assertNodeVersion(22, "24.19.0"));
});

test("state lives outside the repository, per platform, with an override", () => {
  assert.equal(stateDir({ MAEH_SHOWCASE_STATE: "X:\\state" }, "win32"), "X:\\state");
  assert.equal(stateDir({ LOCALAPPDATA: "C:\\Users\\t\\AppData\\Local" }, "win32"),
    join("C:\\Users\\t\\AppData\\Local", "MAEH-Showcase"));
  assert.match(stateDir({ XDG_STATE_HOME: "/var/state" }, "linux"), /maeh-showcase$/);
});

test("PATH search honours the platform's executable suffix", () => {
  const present = new Set([join("C:\\tools", "git.exe")]);
  const exists = (path) => present.has(path);
  assert.equal(findOnPath("git", { env: { PATH: "C:\\bin;C:\\tools" }, platform: "win32", exists }), join("C:\\tools", "git.exe"));
  assert.equal(findOnPath("git", { env: { PATH: "C:\\bin" }, platform: "win32", exists }), null);
});

test("git is looked for in a fixed order: env, PATH, Hermes, MinGit, GitHub Desktop, Program Files", () => {
  const local = "C:\\Users\\t\\AppData\\Local";
  const present = new Set([join("C:\\onpath", "git.exe")]);
  const listDir = (dir) => {
    if (dir.endsWith("tools")) return ["git-2.53.0+3-win32-x64", "node-26.7.0-win32-x64", "git-2.40.0-win32-x64"];
    if (dir.endsWith("GitHubDesktop")) return ["app-3.6.7", "app-3.10.0", "other"];
    return [];
  };
  const found = gitCandidates({
    env: { MAEH_GIT: "E:\\mine\\git.exe", PATH: "C:\\onpath", LOCALAPPDATA: local, ProgramFiles: "C:\\Program Files" },
    platform: "win32", exists: (path) => present.has(path), listDir,
  });
  assert.deepEqual(found.map((candidate) => candidate.source), [
    "env MAEH_GIT", "PATH", "Hermes tools", "Hermes tools", "MinGit", "GitHub Desktop", "GitHub Desktop", "Program Files",
  ]);
  assert.ok(found[2].path.includes("git-2.53.0+3"), "newest Hermes git first");
  assert.ok(found[5].path.includes("app-3.10.0"), "newest GitHub Desktop first");
});

test("gh candidates", () => {
  const found = ghCandidates({ env: { ProgramFiles: "C:\\Program Files", PATH: "" }, platform: "win32", exists: () => false });
  assert.deepEqual(found.map((candidate) => candidate.source), ["Program Files"]);
});

test("the first candidate that runs wins; missing files are skipped without being run", () => {
  const ran = [];
  const probe = (path) => { ran.push(path); return path.includes("good") ? "git version 2.56.0" : null; };
  const exists = (path) => !path.includes("missing");
  const result = resolveTool("git", [
    { path: "C:\\missing\\git.exe", source: "Hermes tools" },
    { path: "C:\\broken\\git.exe", source: "MinGit" },
    { path: "C:\\good\\git.exe", source: "GitHub Desktop" },
    { path: "C:\\later\\git.exe", source: "Program Files" },
  ], { probe, exists });
  assert.equal(result.path, "C:\\good\\git.exe");
  assert.equal(result.version, "git version 2.56.0");
  assert.deepEqual(ran, ["C:\\broken\\git.exe", "C:\\good\\git.exe"]);
});

test("when nothing runs the error says what was tried", () => {
  assert.throws(() => resolveTool("git", [{ path: "C:\\x\\git.exe", source: "MinGit" }], { probe: () => null, exists: () => true }),
    /git not found \(MinGit: did not run\)/);
});
