/* One-time, repository-local git setup for the machine that runs the nightly freeze.
 *
 * Only this checkout's own config is ever touched, never the user's global git config. The plan is
 * always shown first; nothing changes without --yes. */

import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CREDENTIAL_KEY = "credential.https://github.com.helper";

export const NOREPLY = /^[0-9]*\+?[A-Za-z0-9-]+@users\.noreply\.github\.com$/;

export function wantedSettings({ ghPath = null, name = null, email = null } = {}) {
  const wanted = [
    { key: "core.hooksPath", value: ".githooks", why: "turns on the hooks that refuse any change to a frozen file" },
    { key: "core.autocrlf", value: "false", why: "frozen files are hashed byte for byte; .gitattributes already pins them to LF" },
  ];
  if (ghPath) {
    wanted.push({ key: CREDENTIAL_KEY, value: `!'${ghPath.replaceAll("\\", "/")}' auth git-credential`, why: "the unattended push uses the GitHub CLI's saved sign-in and never prompts" });
  }
  if (name) wanted.push({ key: "user.name", value: name, why: "who the nightly commits are made by" });
  if (email) wanted.push({ key: "user.email", value: email, why: "the commit address: use the GitHub noreply one so no private address is published" });
  return wanted;
}

/* What each setting is now (as git sees it here) and what would change. */
export function planSettings(git, wanted) {
  return wanted.map((setting) => {
    const current = git.exec(["config", "--local", "--get", setting.key], { allowFail: true }).stdout.trim();
    return { ...setting, current: current || null, change: current !== setting.value };
  });
}

export function applySettings(git, plan) {
  const done = [];
  for (const setting of plan.filter((entry) => entry.change)) {
    if (setting.key === CREDENTIAL_KEY) {
      /* an empty first entry resets any helper listed in a wider config, then ours is the only one */
      git.exec(["config", "--local", "--replace-all", setting.key, ""]);
      git.exec(["config", "--local", "--add", setting.key, setting.value]);
    } else {
      git.exec(["config", "--local", setting.key, setting.value]);
    }
    done.push(setting.key);
  }
  return done;
}

/* git runs a hook only if it is executable on Linux and macOS. */
export function makeHooksExecutable(root, platform = process.platform) {
  if (platform === "win32") return [];
  const dir = join(root, ".githooks");
  if (!existsSync(dir)) return [];
  const changed = [];
  for (const name of readdirSync(dir)) {
    chmodSync(join(dir, name), 0o755);
    changed.push(name);
  }
  return changed;
}

export function describePlan(plan) {
  const show = (value) => (value === null ? "(not set)" : value);
  return plan.map((setting) => `  ${setting.change ? "set " : "ok  "} ${setting.key}\n         ${setting.change ? `${show(setting.current)}  ->  ${setting.value}` : setting.value}\n         ${setting.why}`);
}
