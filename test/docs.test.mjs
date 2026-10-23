import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { REPO } from "./helpers/site-data.mjs";

/* The documents are part of the product: a link that goes nowhere, a command that no longer exists,
 * or a machine path in a public file is a defect. */

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === ".git" || entry === "node_modules" || entry === "_site" || entry === "results" || entry === "stars") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const docs = walk(REPO).filter((file) => file.endsWith(".md")).map((file) => ({ file, rel: relative(REPO, file).replaceAll("\\", "/"), text: readFileSync(file, "utf8") }));

test("there is a README and the four documents it points to", () => {
  const names = docs.map((doc) => doc.rel);
  for (const expected of ["README.md", "AGENTS.md", "DISCLAIMER.md", "LICENSE-DATA.md", "docs/METHODS.md", "docs/OPERATIONS.md", "docs/DESIGN.md", "docs/PROGRESS.md"]) assert.ok(names.includes(expected), expected);
});

test("every relative link and image in every document points at a file that exists", () => {
  const problems = [];
  for (const doc of docs) {
    for (const [, target] of doc.text.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)) {
      const path = resolve(dirname(doc.file), decodeURIComponent(target.split("#")[0]));
      if (!existsSync(path)) problems.push(`${doc.rel}: ${target}`);
    }
    for (const [, target] of doc.text.matchAll(/<img[^>]+src="(?!https?:)([^"]+)"/g)) {
      if (!existsSync(resolve(dirname(doc.file), target))) problems.push(`${doc.rel}: image ${target}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("every image the README shows is a real PNG of a sensible size", () => {
  const images = readdirSync(join(REPO, "docs", "images")).filter((name) => name.endsWith(".png"));
  assert.ok(images.length >= 4);
  for (const name of images) {
    const bytes = readFileSync(join(REPO, "docs", "images", name));
    assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", name);
    assert.ok(bytes.length > 50_000 && bytes.length < 1_500_000, `${name} is ${bytes.length} bytes`);
  }
});

test("no public document carries a machine path, a private address or a token", () => {
  const problems = [];
  for (const doc of docs) {
    if (/C:\\Users\\|\/Users\/[a-z]|\/home\/[a-z]+\//.test(doc.text)) problems.push(`${doc.rel}: a user folder path`);
    if (/[A-Za-z0-9._%+-]+@(gmail|outlook|hotmail|yahoo|icloud)\./i.test(doc.text)) problems.push(`${doc.rel}: a private address`);
    if (/gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY/.test(doc.text)) problems.push(`${doc.rel}: a secret`);
    if (/\b127\.0\.0\.1:8790\b/.test(doc.text)) problems.push(`${doc.rel}: the harness's address`);
  }
  assert.deepEqual(problems, []);
});

test("the commands the documents tell people to run exist", () => {
  const scripts = new Set(readdirSync(join(REPO, "scripts")).filter((name) => name.endsWith(".mjs")));
  const problems = [];
  for (const doc of docs) {
    for (const [, name] of doc.text.matchAll(/node scripts\/([a-z-]+\.mjs)/g)) if (!scripts.has(name)) problems.push(`${doc.rel}: scripts/${name}`);
  }
  assert.deepEqual(problems, []);
  const flags = readFileSync(join(REPO, "scripts", "nightly.mjs"), "utf8");
  for (const flag of ["--status", "--dry-run", "--retry-push", "--accept-partial"]) assert.ok(flags.includes(flag), `nightly.mjs understands ${flag}`);
});

test("the documents do not claim things that are not so", () => {
  const readme = docs.find((doc) => doc.rel === "README.md").text;
  assert.match(readme, /01:00/);
  assert.match(readme, /demo account/i);
  assert.match(readme, /simulated money/i);
  const operations = docs.find((doc) => doc.rel === "docs/OPERATIONS.md").text;
  for (const exit of ["| 0 |", "| 2 |", "| 3 |", "| 4 |", "| 5 |"]) assert.ok(operations.includes(exit), `OPERATIONS explains exit ${exit}`);
  const methods = docs.find((doc) => doc.rel === "docs/METHODS.md").text;
  const rules = JSON.parse(readFileSync(join(REPO, "config", "rules.v1.json"), "utf8"));
  for (const [kind, params] of Object.entries(rules.periods)) {
    const row = new RegExp(`\\| ${kind[0].toUpperCase()}${kind.slice(1)} \\| ${params.retHalf} % \\| ${params.ddZero} % \\| ${params.k} \\| ${params.minCloses} \\| ${params.minActiveDays} \\|`);
    assert.match(methods, row, `METHODS lists the ${kind} constants exactly as rules.v1.json has them`);
  }
  assert.match(methods, /0\.40·ret \+ 0\.20·pf \+ 0\.25·dd \+ 0\.15·win/);
  assert.deepEqual(rules.weights, { ret: 0.4, pf: 0.2, dd: 0.25, win: 0.15 });
  assert.match(methods, /25-hour day/);
});
