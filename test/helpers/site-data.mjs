/* A fetch that reads the repository's own files, so site code can be run in a test against the real,
 * committed data exactly as the browser would load it over HTTP. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));

export function fsFetch(root = REPO) {
  return async (url) => {
    const clean = decodeURIComponent(String(url).split("?")[0]).replace(/^\.?\//, "");
    const file = path.resolve(root, clean);
    if (!file.startsWith(path.resolve(root))) return { ok: false, status: 403 };
    let buffer;
    try {
      buffer = await readFile(file);
    } catch {
      return { ok: false, status: 404 };
    }
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(buffer.toString("utf8")),
      text: async () => buffer.toString("utf8"),
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };
  };
}

/* No NaN, undefined or [object Object] may ever reach a page. */
export const LEAKS = /\bNaN\b|\bundefined\b|\[object |\bnull\b(?![-\w])|Infinity/;
