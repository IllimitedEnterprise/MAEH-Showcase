/* Facts about the site itself, in one place. */

export const SITE_NAME = "MAEH Showcase";
export const REPO_URL = "https://github.com/IllimitedEnterprise/MAEH-Showcase";
export const REPO_FILE = (path) => `${REPO_URL}/blob/main/${path}`;
export const CLONE_STEPS = [
  `git clone ${REPO_URL}.git`,
  "cd MAEH-Showcase",
  "node scripts/verify.mjs --all",
  "node scripts/rank.mjs --check",
];
