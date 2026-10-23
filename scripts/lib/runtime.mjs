/* Finding the tools the nightly job needs, and the private state folder.
 *
 * This repository is standalone, so nothing it needs is guaranteed to be on PATH: on the
 * machine that runs it, git and node live in version-stamped folders that move on update.
 * Each tool is resolved from an ordered list of places and proven by running `--version`. */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/* Paths are built with the rules of the platform being asked about, not of the machine running the
 * code, so a Windows lookup gives Windows paths (and ";" between PATH entries) on any host. */
const pathFor = (platform) => (platform === "win32" ? path.win32 : path.posix);

export function stateDir(env = process.env, platform = process.platform) {
  const p = pathFor(platform);
  if (env.MAEH_SHOWCASE_STATE) return env.MAEH_SHOWCASE_STATE;
  if (platform === "win32") return p.join(env.LOCALAPPDATA || p.join(homedir(), "AppData", "Local"), "MAEH-Showcase");
  return p.join(env.XDG_STATE_HOME || p.join(homedir(), ".local", "state"), "maeh-showcase");
}

/* Natural order for version-stamped folder names: app-3.10.0 sorts above app-3.6.7. */
export function compareVersionStrings(a, b) {
  const split = (text) => String(text).match(/\d+|\D+/g) ?? [];
  const left = split(a);
  const right = split(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index] ?? "";
    const y = right[index] ?? "";
    if (x === y) continue;
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    if (numeric) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return 0;
}

export function versionAtLeast(text, minimumMajor) {
  const match = /(\d+)\.(\d+)/.exec(String(text));
  return Boolean(match) && Number(match[1]) >= minimumMajor;
}

export function findOnPath(name, { env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const p = pathFor(platform);
  const extensions = platform === "win32" ? [".exe"] : [""];
  const dirs = String(env.PATH ?? env.Path ?? "").split(p.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const extension of extensions) {
      const full = p.join(dir, `${name}${extension}`);
      if (exists(full)) return full;
    }
  }
  return null;
}

/* Directories under `root` whose name matches `prefix`, newest version first. */
function newestUnder(root, prefix, listDir, p) {
  let names = [];
  try {
    names = listDir(root);
  } catch {
    return [];
  }
  return names.filter((name) => name.startsWith(prefix)).sort((a, b) => compareVersionStrings(b, a))
    .map((name) => p.join(root, name));
}

export function gitCandidates({ env = process.env, platform = process.platform, exists = existsSync, listDir = readdirSync } = {}) {
  const p = pathFor(platform);
  const found = [];
  const add = (path, source) => { if (path) found.push({ path, source }); };
  add(env.MAEH_GIT, "env MAEH_GIT");
  add(findOnPath("git", { env, platform, exists }), "PATH");
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || p.join(homedir(), "AppData", "Local");
    for (const dir of newestUnder(p.join(local, "hermes", "tools"), "git-", listDir, p))
      add(p.join(dir, "cmd", "git.exe"), "Hermes tools");
    add(p.join(local, "Programs", "MinGit", "cmd", "git.exe"), "MinGit");
    for (const dir of newestUnder(p.join(local, "GitHubDesktop"), "app-", listDir, p))
      add(p.join(dir, "resources", "app", "git", "cmd", "git.exe"), "GitHub Desktop");
    add(p.join(env.ProgramFiles || "C:\\Program Files", "Git", "cmd", "git.exe"), "Program Files");
  } else {
    add("/usr/bin/git", "system");
  }
  return found.filter((candidate) => candidate.path.length > 0);
}

export function ghCandidates({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const p = pathFor(platform);
  const found = [];
  const add = (path, source) => { if (path) found.push({ path, source }); };
  add(env.MAEH_GH, "env MAEH_GH");
  add(findOnPath("gh", { env, platform, exists }), "PATH");
  if (platform === "win32") add(p.join(env.ProgramFiles || "C:\\Program Files", "GitHub CLI", "gh.exe"), "Program Files");
  return found;
}

/* The first line of `<tool> --version`, or null if it does not run. */
export function probeVersion(path) {
  const result = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 15_000, windowsHide: true });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout).split(/\r?\n/)[0].trim() || null;
}

export function resolveTool(name, candidates, { probe = probeVersion, exists = existsSync } = {}) {
  const tried = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    if (candidate.source !== "PATH" && !candidate.source.startsWith("env") && !exists(candidate.path)) {
      tried.push(`${candidate.source}: not found`);
      continue;
    }
    const version = probe(candidate.path);
    if (version) return { name, path: candidate.path, version, source: candidate.source };
    tried.push(`${candidate.source}: did not run`);
  }
  throw new Error(`${name} not found (${tried.join("; ") || "no candidates"})`);
}

export const resolveGit = (options = {}) => resolveTool("git", gitCandidates(options), options);
export const resolveGh = (options = {}) => resolveTool("gh", ghCandidates(options), options);

export function assertNodeVersion(minimumMajor = 22, version = process.versions.node) {
  if (!versionAtLeast(version, minimumMajor))
    throw new Error(`Node ${minimumMajor} or newer is required (this is ${version})`);
}
