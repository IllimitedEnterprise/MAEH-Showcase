/* Where the site's numbers come from: the same JSON files the repository holds, fetched as they
 * are. A tiny loader with a cache, a typed error, and a SHA-256 check so a viewer's own browser can
 * confirm that a file matches the hash its day's manifest recorded.
 *
 * Paths are relative to the page, so the same build works at /MAEH-Showcase/ on GitHub Pages and at
 * any path of a local preview. `build` (from build.json) is appended to every request so a fresh
 * deploy is never shadowed by a ten-minute CDN copy of the previous one. */

export class DataError extends Error {
  constructor(message, { path = "", status = 0, cause } = {}) {
    super(message, { cause });
    this.name = "DataError";
    this.path = path;
    this.status = status;
  }
}

export function createData({ fetchImpl, build = "" } = {}) {
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const cache = new Map();

  const versioned = (path) => (build ? `${path}${path.includes("?") ? "&" : "?"}v=${encodeURIComponent(build)}` : path);

  async function fetchOk(path, options = {}) {
    let response;
    try {
      response = await doFetch(versioned(path), options);
    } catch (error) {
      throw new DataError(`Could not reach ${path}`, { path, cause: error });
    }
    if (!response.ok) throw new DataError(`${path} answered ${response.status}`, { path, status: response.status });
    return response;
  }

  function memo(key, make) {
    if (!cache.has(key)) {
      const promise = make();
      cache.set(key, promise);
      promise.catch(() => cache.delete(key));
    }
    return cache.get(key);
  }

  return {
    build,
    versioned,
    json: (path) => memo(`json:${path}`, async () => {
      const response = await fetchOk(path);
      try {
        return await response.json();
      } catch (error) {
        throw new DataError(`${path} is not valid JSON`, { path, cause: error });
      }
    }),
    text: (path) => memo(`text:${path}`, async () => (await fetchOk(path)).text()),
    bytes: (path) => memo(`bytes:${path}`, async () => new Uint8Array(await (await fetchOk(path)).arrayBuffer())),
    /* Never cached by this loader or the browser: used for build.json, which says what is current. */
    fresh: async (path) => (await fetchOk(path, { cache: "no-store" })).json(),
    forget: () => cache.clear(),
  };
}

export const dayDir = (date) => `results/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}`;
export const dayFile = (date, rel) => `${dayDir(date)}/${rel}`;

export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const CORE = ["results/index.json", "results/series.json", "stars/leaderboard.json", "stars/crowns.json"];

/* Everything the landing pages need: the catalogue, the cumulative series, the standings, the
 * crowns, and one small report per account. */
export async function loadCore(data) {
  const [index, series, leaderboard, crowns] = await Promise.all(CORE.map((path) => data.json(path)));
  const reports = await Promise.all(index.accounts.map((account) => data.json(`stars/accounts/${account.key}.json`)));
  return { index, series, leaderboard, crowns, reports: Object.fromEntries(reports.map((report) => [report.key, report])) };
}

/* One frozen day's manifest. The date must be one the catalogue lists. */
export async function loadDay(data, date) {
  return data.json(dayFile(date, "day.json"));
}

/* Fetch a file of a day and check it against what the manifest recorded. `expected` is the manifest
 * entry ({ sha256, bytes }) or, for day.json itself, the hash the catalogue holds. */
export async function loadFile(data, date, rel, expected) {
  const bytes = await data.bytes(dayFile(date, rel));
  const actual = await sha256Hex(bytes);
  const text = new TextDecoder("utf-8").decode(bytes);
  const known = expected && typeof expected.sha256 === "string";
  return {
    rel,
    text,
    size: bytes.length,
    actual,
    expected: known ? expected.sha256 : null,
    ok: known ? expected.sha256 === actual && (expected.bytes === undefined || expected.bytes === bytes.length) : null,
  };
}

/* Check every file of one day against its manifest, a few at a time. Returns what failed, by name. */
export async function verifyDayFiles(data, date, manifest, catalogueEntry, onProgress = () => {}) {
  const jobs = [["day.json", { sha256: catalogueEntry.sha256 }], ...Object.entries(manifest.files)];
  const queue = jobs.slice();
  const results = [];
  const worker = async () => {
    while (queue.length > 0) {
      const [rel, expected] = queue.shift();
      try {
        const file = await loadFile(data, date, rel, expected);
        results.push({ rel, ok: file.ok === true });
      } catch (error) {
        results.push({ rel, ok: false, error: error.message });
      }
      onProgress(results.length, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { total: jobs.length, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).map((r) => r.rel).sort() };
}

/* Walk the whole chain from the viewer's side: every day.json must hash to what the catalogue says,
 * and every day must point back at the hash of the one before it. */
export async function verifyChain(data, core, onProgress = () => {}) {
  const rows = [];
  let previous = null;
  for (const entry of core.index.days) {
    let hashOk = false;
    let prevOk = false;
    let note = "";
    try {
      const bytes = await data.bytes(dayFile(entry.date, "day.json"));
      hashOk = (await sha256Hex(bytes)) === entry.sha256;
      const manifest = JSON.parse(new TextDecoder("utf-8").decode(bytes));
      prevOk = previous === null ? manifest.prev === null : manifest.prev?.sha256 === previous.sha256 && manifest.prev?.seq === previous.seq;
      if (manifest.seq !== entry.seq) note = "sequence number differs from the catalogue";
    } catch (error) {
      note = error.message;
    }
    rows.push({ seq: entry.seq, date: entry.date, hashOk, prevOk, note });
    previous = entry;
    onProgress(rows.length, core.index.days.length);
  }
  const tip = core.index.tip;
  const last = core.index.days.at(-1);
  const tipOk = Boolean(last) && tip.seq === last.seq && tip.sha256 === last.sha256 && tip.date === last.date;
  return { rows, tipOk, ok: tipOk && rows.every((row) => row.hashOk && row.prevOk && !row.note) };
}

export const KIND_OF_PATH = (rel) => {
  const name = rel.split("/").at(-1);
  if (name.endsWith(".md")) return "markdown";
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".json")) return "json";
  return "text";
};
