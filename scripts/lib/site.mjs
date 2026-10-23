/* Serving and assembling the dashboard.
 *
 * The site is static: `site/` holds the page, and the data it reads lives in `results/` and `stars/`
 * next to it. On GitHub Pages they are assembled into one folder; for a local preview this module
 * serves the same layout straight from the repository. Nothing else is ever served: not config,
 * not scripts, not .git. */

import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export const DATA_EXTENSIONS = new Set([".json", ".md", ".csv"]);
/* .md and .txt are the font licences and notes that must travel with the font files. */
export const SITE_EXTENSIONS = new Set([".html", ".css", ".js", ".mjs", ".json", ".svg", ".woff2", ".txt", ".md"]);

export const contentType = (path) => TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";

const isInside = (parent, child) => {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`) && !resolve(rel).startsWith(`${sep}${sep}`) && !/^[a-zA-Z]:/.test(rel);
};

/* Map a request path (base already removed) to a file, or null. Three kinds of thing are served:
 * the page and its assets from site/, and the data folders results/ and stars/ (data files only). */
export function resolveRequest(root, pathname) {
  let parts;
  try {
    parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (parts.some((part) => part === ".." || part === "." || /[\\:\0]/.test(part) || part.startsWith("."))) return null;
  if (parts.length === 0) parts = ["index.html"];
  const [head] = parts;
  const isData = head === "results" || head === "stars";
  const baseDir = resolve(root, isData ? "." : "site");
  const file = resolve(baseDir, ...parts);
  if (!isInside(baseDir, file)) return null;
  const extension = extname(file).toLowerCase();
  if (isData && !DATA_EXTENSIONS.has(extension)) return null;
  if (!isData && !SITE_EXTENSIONS.has(extension)) return null;
  return file;
}

export function createSiteServer({ root, base = "/", build = "dev", commit = "dev" } = {}) {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const send = (response, status, body, type = "text/plain; charset=utf-8", extra = {}) => {
    response.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...extra,
    });
    response.end(body);
  };

  return createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, "Method not allowed", "text/plain", { Allow: "GET, HEAD" });
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === prefix.slice(0, -1) && prefix !== "/") return send(response, 301, "", "text/plain", { Location: prefix });
    if (url.pathname === "/" && prefix !== "/") return send(response, 302, "", "text/plain", { Location: prefix });
    if (!url.pathname.startsWith(prefix)) return send(response, 404, "Not found");
    const inner = url.pathname.slice(prefix.length - 1);

    if (inner === "/build.json") {
      return send(response, 200, JSON.stringify({ build, commit, builtAt: new Date().toISOString(), verified: false }), TYPES[".json"]);
    }
    const file = resolveRequest(root, inner);
    if (!file || !existsSync(file) || !statSync(file).isFile()) return send(response, 404, "Not found");
    let body = readFileSync(file);
    if (basename(file) === "index.html" && dirname(file) === resolve(root, "site")) body = Buffer.from(body.toString("utf8").replaceAll("__BUILD__", build), "utf8");
    return send(response, 200, request.method === "HEAD" ? "" : body, contentType(file));
  });
}

function copyTree(from, to, { allowed, log }) {
  let count = 0;
  let bytes = 0;
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(target, { recursive: true });
      const inner = copyTree(source, target, { allowed, log });
      count += inner.count;
      bytes += inner.bytes;
    } else if (entry.isFile()) {
      if (!allowed.has(extname(entry.name).toLowerCase())) throw new Error(`refusing to publish ${relative(dirname(from), source)}: a ${extname(entry.name) || "extensionless"} file is not expected here`);
      copyFileSync(source, target);
      count += 1;
      bytes += statSync(source).size;
    }
  }
  return { count, bytes };
}

const NOT_FOUND_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found - MAEH Showcase</title><meta name="color-scheme" content="dark light">
<link rel="stylesheet" href="/MAEH-Showcase/css/tokens.css"><link rel="stylesheet" href="/MAEH-Showcase/css/base.css"><link rel="stylesheet" href="/MAEH-Showcase/css/components.css">
</head><body><main><div class="page"><div class="empty"><h1 class="empty-title">Not found</h1><p>That address is not part of the showcase.</p><p><a class="btn" href="/MAEH-Showcase/">Back to the season</a></p></div></div></main></body></html>
`;

/* Assemble the Pages artifact: the page and assets at the top, the data beside them. */
export function buildSite({ root, out, build, commit = "local", builtAt = new Date().toISOString(), verified = false, tip = null }) {
  const target = resolve(out);
  if (basename(target) !== "_site") throw new Error(`the output folder must be called _site (got ${basename(target)})`);
  if (target === resolve(root) || resolve(root).startsWith(target + sep)) throw new Error("the output folder cannot contain the repository");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });

  const shell = join(root, "site");
  if (!existsSync(join(shell, "index.html"))) throw new Error("site/index.html is missing");
  const site = copyTree(shell, target, { allowed: SITE_EXTENSIONS });
  const indexPath = join(target, "index.html");
  const page = readFileSync(indexPath, "utf8");
  if (!page.includes("__BUILD__")) throw new Error("site/index.html has no __BUILD__ placeholder to version its files with");
  writeFileSync(indexPath, page.replaceAll("__BUILD__", build), "utf8");

  let data = { count: 0, bytes: 0 };
  for (const folder of ["results", "stars"]) {
    const from = join(root, folder);
    if (!existsSync(from)) throw new Error(`${folder}/ is missing`);
    mkdirSync(join(target, folder), { recursive: true });
    const copied = copyTree(from, join(target, folder), { allowed: DATA_EXTENSIONS });
    data = { count: data.count + copied.count, bytes: data.bytes + copied.bytes };
  }
  let extras = 0;
  for (const name of ["LICENSE", "LICENSE-DATA.md", "DISCLAIMER.md"]) {
    if (existsSync(join(root, name))) {
      copyFileSync(join(root, name), join(target, name === "LICENSE" ? "LICENSE.txt" : name));
      extras += 1;
    }
  }
  writeFileSync(join(target, "404.html"), NOT_FOUND_PAGE, "utf8");
  writeFileSync(join(target, ".nojekyll"), "", "utf8");
  writeFileSync(join(target, "build.json"), `${JSON.stringify({ build, commit, builtAt, verified, tip }, null, 2)}\n`, "utf8");
  extras += 3;
  return { out: target, files: site.count + data.count + extras, siteFiles: site.count, dataFiles: data.count, bytes: site.bytes + data.bytes };
}
