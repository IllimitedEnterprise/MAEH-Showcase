/* A small, careful wrapper around the git command line.
 *
 * Only what the nightly job needs: look at the branch and the managed folders, stage by
 * explicit path, commit from a message passed on stdin, push without ever forcing, and make
 * an annotated tag. Prompts are disabled so an unattended run fails instead of hanging. */

import { spawnSync } from "node:child_process";

const firstLine = (text) => String(text ?? "").split(/\r?\n/).find((line) => line.trim()) ?? "";

export class GitError extends Error {
  constructor(message, { status = null, stderr = "" } = {}) {
    super(message);
    this.name = "GitError";
    this.status = status;
    this.stderr = stderr;
  }
}

export function createGit({ gitPath, cwd, env = process.env, run = spawnSync }) {
  const childEnv = { ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", LC_ALL: "C" };

  function exec(args, { allowFail = false, input } = {}) {
    const result = run(gitPath, args, { cwd, env: childEnv, encoding: "utf8", input, windowsHide: true, timeout: 180_000 });
    if (result.error) throw new GitError(`git ${args[0]} could not run: ${result.error.message}`);
    if (result.status !== 0 && !allowFail) {
      throw new GitError(`git ${args[0]} failed (${result.status}): ${firstLine(result.stderr)}`, { status: result.status, stderr: result.stderr });
    }
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  const lines = (text) => text.split(/\r?\n/).filter((line) => line !== "");

  return {
    gitPath,
    cwd,
    exec,
    isRepo: () => exec(["rev-parse", "--is-inside-work-tree"], { allowFail: true }).stdout.trim() === "true",
    branch: () => exec(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim(),
    headSha: () => exec(["rev-parse", "HEAD"]).stdout.trim(),
    /* Changed or untracked files under the given paths. Empty means clean. */
    dirty: (paths) => lines(exec(["status", "--porcelain", "--untracked-files=all", "--", ...paths]).stdout),
    remotes: () => lines(exec(["remote"]).stdout),
    add: (paths) => exec(["add", "--", ...paths]),
    /* [{ status, path }] for what is staged. */
    staged: () => lines(exec(["diff", "--cached", "--name-status", "--no-renames"]).stdout).map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status, path: rest.join("\t") };
    }),
    commit: (message) => exec(["commit", "-F", "-"], { input: message }),
    fetch: (remote, branch) => exec(["fetch", remote, branch], { allowFail: true }),
    /* [ahead, behind] of HEAD against remote/branch, or null when the remote branch is unknown. */
    aheadBehind: (remote, branch) => {
      const result = exec(["rev-list", "--left-right", "--count", `HEAD...${remote}/${branch}`], { allowFail: true });
      if (result.status !== 0) return null;
      const [ahead, behind] = result.stdout.trim().split(/\s+/).map(Number);
      return [ahead, behind];
    },
    rebase: (upstream) => exec(["rebase", upstream], { allowFail: true }),
    rebaseAbort: () => exec(["rebase", "--abort"], { allowFail: true }),
    /* Never forced: the pre-push hook and the remote's protection both refuse that anyway. */
    push: (remote, ref) => exec(["push", remote, ref], { allowFail: true }),
    tagExists: (name) => exec(["rev-parse", "--verify", "--quiet", `refs/tags/${name}`], { allowFail: true }).status === 0,
    tag: (name, message) => exec(["tag", "-a", name, "-F", "-"], { input: message }),
    config: (key) => exec(["config", "--get", key], { allowFail: true }).stdout.trim(),
    unpushed: (remote, branch) => {
      const result = exec(["rev-list", "--count", `${remote}/${branch}..HEAD`], { allowFail: true });
      return result.status === 0 ? Number(result.stdout.trim()) : null;
    },
  };
}

export { firstLine };
