/* Checks that look at git rather than at one folder: what a pull request or push changed, and
 * everything that was ever committed. The second is the pre-publish gate: once a repository is
 * public its history cannot be taken back, so every blob that ever existed is scanned, not just
 * the files in today's tree. */

import { spawnSync } from "node:child_process";
import { buildDerived, checkDerived, loadModel } from "./derived.mjs";
import { describe, scanFile, scanFiles, scanSecrets } from "./privacy.mjs";
import { errorsOf, verifyRoot } from "./verify.mjs";

const DATED = /^results\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}\//;
const DERIVED_RESULTS = new Set(["results/index.json", "results/series.json"]);

/* What changed in results/ since `base`: only additions under dated folders (and the derived
 * catalogue), and history must not have been rewritten. */
export function ciDiff({ git, base }) {
  const findings = [];
  const add = (file, message) => findings.push({ severity: "error", day: null, file, message });
  if (!base || /^0+$/.test(base)) return { findings, skipped: true };
  if (git.exec(["merge-base", "--is-ancestor", base, "HEAD"], { allowFail: true }).status !== 0) {
    add("(history)", "the base commit is not an ancestor of HEAD: history was rewritten");
    return { findings, skipped: false };
  }
  const changes = git.exec(["diff", "--name-status", "--no-renames", `${base}..HEAD`, "--", "results"]).stdout
    .split(/\r?\n/).filter(Boolean).map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status, path: rest.join("\t") };
    });
  for (const change of changes) {
    if (DERIVED_RESULTS.has(change.path)) continue;
    if (!DATED.test(change.path)) add(change.path, "is not a place frozen data may be changed");
    else if (change.status !== "A") add(change.path, `a frozen file was ${change.status === "D" ? "deleted" : "changed"}; frozen files may only be added`);
  }
  return { findings, skipped: false, changes: changes.length };
}

/* Every blob in every commit: data under results/ and stars/ gets the full privacy scan; every
 * other text file is checked for secrets. */
export function scanHistory({ git }) {
  const findings = [];
  const listing = git.exec(["rev-list", "--objects", "--all"]).stdout.split(/\r?\n/).filter(Boolean);
  const paths = new Map();
  for (const line of listing) {
    const space = line.indexOf(" ");
    if (space > 0) paths.set(line.slice(0, space), line.slice(space + 1));
  }
  const shas = [...paths.keys()];
  if (shas.length === 0) return { findings, blobs: 0 };

  const result = spawnSync(git.gitPath, ["cat-file", "--batch"], {
    cwd: git.cwd, input: `${shas.join("\n")}\n`, maxBuffer: 1024 * 1024 * 1024, windowsHide: true,
  });
  if (result.status !== 0) throw new Error("git cat-file failed while scanning history");
  const out = result.stdout;
  let offset = 0;
  let blobs = 0;
  while (offset < out.length) {
    const newline = out.indexOf(0x0a, offset);
    if (newline < 0) break;
    const [sha, type, sizeText] = out.toString("utf8", offset, newline).split(" ");
    if (type === "missing") { offset = newline + 1; continue; }
    const size = Number(sizeText);
    const start = newline + 1;
    const body = out.subarray(start, start + size);
    offset = start + size + 1;
    if (type !== "blob") continue;
    blobs += 1;
    const path = paths.get(sha);
    if (body.subarray(0, 8000).includes(0)) continue; // binary: fonts and images are not text
    const text = body.toString("utf8");
    const scan = /^(results|stars)\//.test(path) ? scanFile(path, text) : scanSecrets(path, text);
    for (const finding of scan) findings.push({ severity: "error", day: null, file: path, message: `history ${sha.slice(0, 10)}: ${describe(finding)}` });
  }
  return { findings, blobs };
}

/* The full check of the working tree: days, chain, derived files, privacy. */
export function verifyEverything({ root, ctx }) {
  const rulesFor = ctx ? ctx.rulesFor : () => null;
  const base = verifyRoot(root, { rulesFor });
  const findings = [...base.findings];
  if (ctx) {
    const model = loadModel(root, { seasonStart: ctx.season.seasonStart, zone: ctx.season.zone, allow: ctx.allow, rulesFor: ctx.rulesFor });
    const files = buildDerived(model);
    findings.push(...checkDerived(root, files));
    for (const finding of scanFiles(files)) findings.push({ severity: "error", day: null, file: finding.file, message: `privacy: ${describe(finding)}` });
  }
  return { findings, days: base.days, errors: errorsOf(findings) };
}
