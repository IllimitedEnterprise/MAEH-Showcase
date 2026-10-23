import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./helpers/site-data.mjs";

/* The workflows are checked as text: no YAML library is installed, and what matters is simple to
 * state. Every action is pinned to a full commit, the token is read-only except where a deploy
 * needs more, and nothing user-controlled reaches a shell. */

const dir = join(REPO, ".github", "workflows");
const workflows = Object.fromEntries(readdirSync(dir).filter((name) => name.endsWith(".yml")).map((name) => [name, readFileSync(join(dir, name), "utf8")]));

/* Looked up with `gh api` on 2026-10-23; each release is more than two weeks old. */
const PINS = {
  "actions/checkout": { sha: "3d3c42e5aac5ba805825da76410c181273ba90b1", version: "v7.0.1" },
  "actions/setup-node": { sha: "949feb2413d6458794dcd2491c4babbbce0c15c1", version: "v7.1.0" },
  "actions/upload-pages-artifact": { sha: "fc324d3547104276b827a68afc52ff2a11cc49c9", version: "v5.0.0" },
  "actions/deploy-pages": { sha: "368f82528645a54fb793d4d04e342629a3f51346", version: "v5.0.1" },
};

test("there is a CI workflow and a Pages workflow", () => {
  assert.deepEqual(Object.keys(workflows).sort(), ["ci.yml", "pages.yml"]);
});

test("every action is pinned to a full commit, with its version beside it, and is one we have vetted", () => {
  for (const [name, text] of Object.entries(workflows)) {
    const uses = [...text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)(?:\s+#\s*(\S+))?\s*$/gm)];
    assert.ok(uses.length > 0, `${name} uses at least one action`);
    for (const [, spec, comment] of uses) {
      const [action, ref] = spec.split("@");
      assert.match(ref ?? "", /^[0-9a-f]{40}$/, `${name}: ${action} is pinned to a full commit`);
      const pin = PINS[action];
      assert.ok(pin, `${name}: ${action} is not on the vetted list`);
      assert.equal(ref, pin.sha, `${name}: ${action} uses the vetted commit`);
      assert.equal(comment, pin.version, `${name}: ${action} says which release the commit is`);
    }
  }
});

test("the token is read-only by default, and only the deploy job may write Pages", () => {
  for (const [name, text] of Object.entries(workflows)) {
    const top = text.slice(0, text.indexOf("\njobs:"));
    assert.match(top, /^permissions:\s*\n\s+contents: read\s*$/m, `${name} sets contents: read at the top`);
    assert.ok(!/(contents|issues|pull-requests|actions|packages|statuses|checks):\s*write/.test(text), `${name} grants no other write permission`);
  }
  const pages = workflows["pages.yml"];
  const deploy = pages.slice(pages.indexOf("  deploy:"));
  assert.match(deploy, /pages: write/);
  assert.match(deploy, /id-token: write/);
  assert.ok(!/pages: write|id-token: write/.test(pages.slice(0, pages.indexOf("  deploy:"))), "the build job cannot deploy");
  assert.ok(!/pages: write|id-token: write/.test(workflows["ci.yml"]));
});

test("nothing in a workflow can run code from a pull request's own text", () => {
  for (const [name, text] of Object.entries(workflows)) {
    assert.ok(!/pull_request_target/.test(text), `${name} does not use pull_request_target`);
    assert.ok(!/secrets\./.test(text), `${name} uses no secret`);
    for (const line of text.split("\n")) {
      if (/\$\{\{[^}]*github\.(event|head_ref)[^}]*\}\}/.test(line)) assert.match(line, /^\s+BASE:\s/, `${name}: an event field reaches only an env value: ${line.trim()}`);
    }
    for (const [, run] of text.matchAll(/^\s+run:\s*(.*)$/gm)) assert.ok(!/\$\{\{\s*github\./.test(run), `${name}: no github context inside a run line`);
  }
});

test("every checkout keeps no credentials, and the jobs that look at history fetch it", () => {
  for (const [name, text] of Object.entries(workflows)) {
    const checkouts = text.split("actions/checkout@").slice(1);
    for (const block of checkouts) assert.match(block.slice(0, 200), /persist-credentials: false/, `${name}: checkout leaves no token in .git`);
  }
  const ci = workflows["ci.yml"];
  const data = ci.slice(ci.indexOf("  data:"));
  assert.match(data, /fetch-depth: 0/, "the data job needs the whole history to diff and to scan");
});

test("CI runs the whole suite on Linux with Node 22 and 24 and on Windows, and checks the data four ways", () => {
  const ci = workflows["ci.yml"];
  assert.match(ci, /os: ubuntu-24\.04\s+node: 22/);
  assert.match(ci, /os: ubuntu-24\.04\s+node: 24/);
  assert.match(ci, /os: windows-latest\s+node: 24/);
  for (const [name, text] of Object.entries(workflows)) {
    assert.ok(!/ubuntu-latest/.test(text), `${name}: the Linux image is pinned, so a runner migration cannot break the nightly deploy`);
  }
  assert.match(ci, /node --test "test\/\*\*\/\*\.test\.mjs"/);
  for (const command of ["verify.mjs --all", "rank.mjs --check", "verify.mjs --ci --base", "verify.mjs --history"]) assert.ok(ci.includes(command), command);
});

test("the real-browser checks run on exactly one CI leg, a Linux one, and never gate the deploy", () => {
  const ci = workflows["ci.yml"];
  assert.equal((ci.match(/browser: "1"/g) ?? []).length, 1);
  assert.match(ci, /os: ubuntu-24\.04\s+node: 24\s+browser: "1"/);
  assert.match(ci, /MAEH_BROWSER_TESTS: \$\{\{ matrix\.browser \}\}/);
  assert.ok(!/MAEH_BROWSER_TESTS/.test(workflows["pages.yml"]), "a browser flake must never hold back the nightly deploy");
});

test("Pages deploys only after verification, and never at the same time as itself", () => {
  const pages = workflows["pages.yml"];
  assert.match(pages, /needs: build/);
  assert.match(pages, /concurrency:\s*\n\s+group: pages\s*\n\s+cancel-in-progress: false/);
  const build = pages.slice(pages.indexOf("  build:"), pages.indexOf("  deploy:"));
  assert.ok(build.indexOf("verify.mjs --all") < build.indexOf("build-site.mjs"), "verify first, then assemble");
  assert.ok(build.includes("rank.mjs --check") && build.includes("site-*.test.mjs") && build.includes("--verified"));
  assert.match(pages, /branches: \[main\]/);
});

test("dependabot keeps the pins fresh", () => {
  const text = readFileSync(join(REPO, ".github", "dependabot.yml"), "utf8");
  assert.match(text, /package-ecosystem: github-actions/);
  assert.match(text, /interval: weekly/);
});

test("line endings are LF, so the files read the same on every runner", () => {
  for (const [name, text] of Object.entries(workflows)) assert.ok(!text.includes("\r"), name);
});
