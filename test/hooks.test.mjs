import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGit } from "../scripts/lib/git.mjs";
import { gitAvailable, makeRepo } from "./helpers/repo.mjs";

const skip = gitAvailable() ? {} : { skip: "git is not available here" };
const DAY = join("results", "2026", "10", "2026-10-21");

async function withRepo(run) {
  const repo = makeRepo({});
  try { return await run(repo); } finally { repo.cleanup(); }
}

const tryCommit = (repo, message = "test") => repo.git.exec(["commit", "-q", "-m", message], { allowFail: true });

test("editing a frozen file cannot be committed", skip, () => withRepo((repo) => {
  const file = join(repo.root, DAY, "README.md");
  writeFileSync(file, "# rewritten\n");
  repo.git.add([join(DAY, "README.md")]);
  const result = tryCommit(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /M results\/2026\/10\/2026-10-21\/README\.md - frozen files may only be added/);
}));

test("deleting a frozen file cannot be committed", skip, () => withRepo((repo) => {
  repo.git.exec(["rm", "-q", join(DAY, "desk.json")]);
  const result = tryCommit(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /D results\/2026\/10\/2026-10-21\/desk\.json - frozen files may only be added/);
}));

test("adding a new dated day folder is allowed", skip, () => withRepo((repo) => {
  const dir = join(repo.root, "results", "2026", "10", "2026-10-22");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "day.json"), "{}\n");
  repo.git.add([join("results", "2026", "10", "2026-10-22")]);
  assert.equal(tryCommit(repo).status, 0);
}));

test("the derived catalogue and series may change; so may anything under stars", skip, () => withRepo((repo) => {
  writeFileSync(join(repo.root, "results", "index.json"), '{"changed":true}\n');
  writeFileSync(join(repo.root, "results", "series.json"), '{"changed":true}\n');
  writeFileSync(join(repo.root, "stars", "leaderboard.md"), "# changed\n");
  repo.git.add(["results/index.json", "results/series.json", "stars/leaderboard.md"]);
  assert.equal(tryCommit(repo).status, 0);
}));

test("a file in results that is not inside a dated folder is refused", skip, () => withRepo((repo) => {
  writeFileSync(join(repo.root, "results", "notes.txt"), "stray\n");
  repo.git.add(["results/notes.txt"]);
  const result = tryCommit(repo);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /results\/notes\.txt is not inside a dated results folder/);
}));

test("a push that is not a fast-forward is refused, and so is deleting the branch", skip, () => withRepo((repo) => {
  // Someone else pushes first, from a second clone.
  const other = mkdtempSync(join(tmpdir(), "maeh-clone-"));
  try {
    const clone = createGit({ gitPath: repo.gitInfo.path, cwd: other });
    clone.exec(["clone", "-q", repo.bare, "."]);
    for (const [key, value] of [["user.name", "Other"], ["user.email", "o@example.invalid"], ["core.autocrlf", "false"]]) clone.exec(["config", key, value]);
    writeFileSync(join(other, "other.txt"), "theirs\n");
    clone.exec(["add", "other.txt"]);
    clone.exec(["commit", "-q", "-m", "theirs"]);
    clone.exec(["push", "-q", "origin", "main"]);

    // Now our own, diverged, commit.
    writeFileSync(join(repo.root, "ours.txt"), "ours\n");
    repo.git.add(["ours.txt"]);
    assert.equal(tryCommit(repo, "ours").status, 0);
    const pushed = repo.git.exec(["push", "origin", "main"], { allowFail: true });
    assert.notEqual(pushed.status, 0);
    assert.match(pushed.stderr, /would not be a fast-forward/);

    const deleted = repo.git.exec(["push", "origin", ":main"], { allowFail: true });
    assert.notEqual(deleted.status, 0);
    assert.match(deleted.stderr, /refusing to delete/);
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
}));

test("an ordinary fast-forward push goes through", skip, () => withRepo((repo) => {
  writeFileSync(join(repo.root, "more.txt"), "more\n");
  repo.git.add(["more.txt"]);
  assert.equal(tryCommit(repo).status, 0);
  assert.equal(repo.git.exec(["push", "-q", "origin", "main"], { allowFail: true }).status, 0);
}));
