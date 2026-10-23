import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { REPO } from "./helpers/site-data.mjs";
import { buildSite, contentType, createSiteServer, resolveRequest } from "../scripts/lib/site.mjs";

async function withServer(options, run) {
  const server = createSiteServer({ root: REPO, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("the preview serves the page, the assets, the data and a build file under the base path", async () => {
  await withServer({ base: "/MAEH-Showcase/" }, async (origin) => {
    const page = await fetch(`${origin}/MAEH-Showcase/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    const html = await page.text();
    assert.ok(!html.includes("__BUILD__"), "the placeholder is filled in");
    assert.match(html, /css\/tokens\.css\?v=dev/);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");

    const script = await fetch(`${origin}/MAEH-Showcase/js/app.mjs`);
    assert.match(script.headers.get("content-type"), /javascript/);
    const font = await fetch(`${origin}/MAEH-Showcase/assets/fonts/BricolageGrotesque-latin-VF.woff2`);
    assert.equal(font.headers.get("content-type"), "font/woff2");

    const index = await fetch(`${origin}/MAEH-Showcase/results/index.json`);
    assert.equal(index.status, 200);
    assert.deepEqual(await index.json(), JSON.parse(readFileSync(join(REPO, "results", "index.json"), "utf8")));
    assert.equal((await fetch(`${origin}/MAEH-Showcase/stars/RULES.md`)).status, 200);
    assert.equal((await fetch(`${origin}/MAEH-Showcase/results/2026/10/2026-10-22/accounts/M9-S-B/trades.csv`)).status, 200);

    const build = await (await fetch(`${origin}/MAEH-Showcase/build.json`)).json();
    assert.equal(build.build, "dev");
  });
});

test("the base path redirects and anything outside it is not found", async () => {
  await withServer({ base: "/MAEH-Showcase/" }, async (origin) => {
    const bare = await fetch(`${origin}/MAEH-Showcase`, { redirect: "manual" });
    assert.equal(bare.status, 301);
    assert.equal(bare.headers.get("location"), "/MAEH-Showcase/");
    assert.equal((await fetch(`${origin}/`, { redirect: "manual" })).status, 302);
    assert.equal((await fetch(`${origin}/other/`)).status, 404);
    assert.equal((await fetch(`${origin}/MAEH-Showcase/`, { method: "POST" })).status, 405);
  });
});

test("only the page, its assets and the data folders can be fetched, and no path can climb out", async () => {
  await withServer({ base: "/" }, async (origin) => {
    const attempts = [
      "/../package.json", "/%2e%2e/package.json", "/results/../package.json", "/results/%2e%2e/%2e%2e/AGENTS.md",
      "/results/..%2fAGENTS.md", "/css/..%5c..%5cpackage.json", "/%2e%2e%5cpackage.json", "/results/2026/10/..%2f..%2f..%2fLICENSE",
      "/config/season.json", "/scripts/nightly.mjs", "/test/site-lib.test.mjs", "/.git/config", "/.githooks/pre-commit", "/package.json",
      "/AGENTS.md", "/README.md", "/results/anything.exe", "/results/.sealing-x/day.json", "/stars/", "/js/", "/c:/windows/win.ini", "/results/%00.json",
    ];
    for (const path of attempts) {
      const response = await fetch(`${origin}${path}`);
      assert.ok(response.status === 404 || response.status === 400, `${path} answered ${response.status}`);
      const body = await response.text();
      assert.ok(!/"name": "maeh-showcase"|API keys|\[core\]/.test(body), `${path} leaked a file`);
    }
  });
});

test("request resolution lands only in site/ or the two data folders", () => {
  assert.equal(resolveRequest(REPO, "/js/app.mjs"), join(REPO, "site", "js", "app.mjs"));
  assert.equal(resolveRequest(REPO, "/results/index.json"), join(REPO, "results", "index.json"));
  assert.equal(resolveRequest(REPO, "/"), join(REPO, "site", "index.html"));
  for (const bad of ["/results/x.exe", "/../x", "/a/../../b", "/.hidden.json", "/results/.x.json", "/css/a:b.css", "/js/a\\b.mjs", "/stars/%zz"]) assert.equal(resolveRequest(REPO, bad), null, bad);
  assert.equal(contentType("x.woff2"), "font/woff2");
  assert.equal(contentType("x.unknown"), "application/octet-stream");
});

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(relative(dir, full).replaceAll("\\", "/") && full);
  }
  return out;
}

test("the Pages artifact holds the site, the data, the licences and a build file, and nothing else", () => {
  const scratch = mkdtempSync(join(tmpdir(), "maeh-site-"));
  try {
    const out = join(scratch, "_site");
    const result = buildSite({ root: REPO, out, build: "abc1234", commit: "abc1234def5678", verified: true, tip: { seq: 16 } });
    const files = listFiles(out).map((file) => relative(out, file).replaceAll("\\", "/"));
    assert.ok(files.includes("index.html") && files.includes("build.json") && files.includes("404.html") && files.includes(".nojekyll"));
    assert.ok(files.includes("results/index.json") && files.includes("stars/leaderboard.json"));
    assert.ok(files.includes("LICENSE.txt") && files.includes("LICENSE-DATA.md") && files.includes("DISCLAIMER.md"));
    assert.ok(files.includes("assets/fonts/FONTS.md") && files.includes("assets/fonts/LICENSES/BricolageGrotesque-OFL.txt") && files.includes("assets/fonts/LICENSES/JetBrainsMono-OFL.txt"), "the font licences are published with the fonts");
    assert.equal(files.length, result.files);
    for (const file of files) assert.ok(!/^(config|scripts|test|docs|deploy|\.git|\.agents|\.github|node_modules)\b/.test(file), `${file} must not be published`);
    assert.ok(!files.some((file) => /\.(mjs)$/.test(file) && !file.startsWith("js/")), "no script outside js/");

    const page = readFileSync(join(out, "index.html"), "utf8");
    assert.ok(!page.includes("__BUILD__"));
    assert.match(page, /tokens\.css\?v=abc1234/);
    const build = JSON.parse(readFileSync(join(out, "build.json"), "utf8"));
    assert.deepEqual({ build: build.build, commit: build.commit, verified: build.verified, tip: build.tip }, { build: "abc1234", commit: "abc1234def5678", verified: true, tip: { seq: 16 } });
    assert.deepEqual(readFileSync(join(out, "results", "index.json")), readFileSync(join(REPO, "results", "index.json")), "data is copied byte for byte");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("the build refuses a stray file in a data folder, a wrong output folder, and a missing placeholder", () => {
  const scratch = mkdtempSync(join(tmpdir(), "maeh-site-"));
  try {
    const root = join(scratch, "repo");
    mkdirSync(join(root, "site"), { recursive: true });
    mkdirSync(join(root, "results"), { recursive: true });
    mkdirSync(join(root, "stars"), { recursive: true });
    writeFileSync(join(root, "site", "index.html"), "<!doctype html><link href='a.css?v=__BUILD__'>");
    writeFileSync(join(root, "results", "index.json"), "{}");
    writeFileSync(join(root, "stars", "x.json"), "{}");
    const ok = buildSite({ root, out: join(scratch, "_site"), build: "b1" });
    assert.equal(ok.dataFiles, 2);

    writeFileSync(join(root, "results", "tool.exe"), "MZ");
    assert.throws(() => buildSite({ root, out: join(scratch, "_site"), build: "b1" }), /refusing to publish/);
    rmSync(join(root, "results", "tool.exe"));
    assert.throws(() => buildSite({ root, out: join(scratch, "dist"), build: "b1" }), /must be called _site/);
    assert.throws(() => buildSite({ root: join(scratch, "_site", "repo"), out: join(scratch, "_site"), build: "b1" }), /cannot contain the repository/);
    writeFileSync(join(root, "site", "index.html"), "<!doctype html>");
    assert.throws(() => buildSite({ root, out: join(scratch, "_site"), build: "b1" }), /no __BUILD__ placeholder/);
    assert.ok(statSync(scratch).isDirectory());
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
