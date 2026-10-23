/* The second line of defence for public files.
 *
 * `project.mjs` builds every public object from an allowlist; this module distrusts the
 * result anyway. It reads the files that are about to be (or already were) published and
 * reports anything that looks like something that must never leave the desk: a forbidden
 * field name, a ticket-, address-, path- or secret-shaped string, an instant that is not
 * on the short list of places a time may appear. It runs on every sealed day, in CI, and
 * over the whole git history before the repository is made public. */

export const FORBIDDEN_KEYS = new Set([
  "ticket", "tickets", "login", "server", "id", "accountid", "account_id", "uuid", "comment", "comments",
  "model", "stage", "timeframe", "timeframes", "volume", "lots", "openprice", "closeprice", "entryprice",
  "price", "sl", "tp", "stoploss", "takeprofit", "commission", "swap", "fee", "openedat", "closedat",
  "at", "atiso", "sourceclosetime", "error", "errors", "message", "path", "port", "url", "host", "hostname",
  "terminalpath", "equity", "floating", "floatingprofit", "balance", "deposits", "password", "passwd",
  "token", "secret", "apikey", "api_key", "authorization",
]);

const SHAPES = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, "a UUID"],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/, "an IPv4 address"],
  [/\blocalhost\b|:\d{4,5}\b(?!\d)|\bport\s*[:=]?\s*\d{2,5}\b/i, "a host or port"],
  [/\b[A-Za-z]:[\\/]/, "a drive path"],
  [/\\\\[A-Za-z0-9_.-]+\\/, "a UNC path"],
  [/(?:^|[\s"'(])\/(?:Users|home|var|etc|mnt)\//, "a filesystem path"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "an e-mail address"],
  [/\bhttps?:\/\//i, "a URL"],
  [/\b(?:Vantage|terminal64|MetaQuotes|broker-closes)/i, "a broker or harness name"],
  [/\bpassword\s*["']?\s*[:=]/i, "a password field"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{12,}/, "a bearer token"],
  [/\bsk-[A-Za-z0-9_-]{16,}/, "an API key"],
  [/\b(?:api[_-]?key|secret|token)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{12,}/i, "a key or token assignment"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/, "a GitHub token"],
];

const ISO_TIME = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const LONG_DIGITS = /\b\d{7,}\b/;

/* JSON paths where an instant, or a long number, is allowed. Everything else is a finding. */
const TIME_PATHS = [/^\$\.capturedAt$/, /^\$\.window\.(startUtc|endUtc)$/];
const LONG_NUMBER_PATHS = [/^\$\.files\..+\.bytes$/];

const allowed = (patterns, path) => patterns.some((entry) => entry.test(path));

function scanString(value, path, findings, file) {
  for (const [regex, what] of SHAPES) {
    if (regex.test(value)) findings.push({ file, path, rule: "shape", detail: `looks like ${what}` });
  }
  if (ISO_TIME.test(value) && !allowed(TIME_PATHS, path))
    findings.push({ file, path, rule: "time", detail: "an instant outside the places a time may appear" });
  if (LONG_DIGITS.test(value) && !allowed(LONG_NUMBER_PATHS, path))
    findings.push({ file, path, rule: "digits", detail: "a run of seven or more digits" });
}

function walk(value, path, findings, file) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, findings, file));
  } else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase()))
        findings.push({ file, path: `${path}.${key}`, rule: "key", detail: `forbidden field name "${key}"` });
      scanString(key, `${path}{key}`, findings, file);
      walk(inner, `${path}.${key}`, findings, file);
    }
  } else if (typeof value === "string") {
    scanString(value, path, findings, file);
  } else if (typeof value === "number" && Number.isInteger(value) && Math.abs(value) >= 1e6
      && !allowed(LONG_NUMBER_PATHS, path)) {
    findings.push({ file, path, rule: "digits", detail: "an integer of seven or more digits" });
  }
}

/* Findings for one public file: { file, path, rule, detail }. Empty means clean. */
export function scanFile(file, content) {
  const findings = [];
  const body = String(content);
  if (/[^\x09\x0A\x20-\x7E]/.test(body)) {
    findings.push({ file, path: "$", rule: "bytes", detail: "characters outside printable ASCII, tab and newline" });
  }
  if (body.includes("\r")) findings.push({ file, path: "$", rule: "bytes", detail: "carriage return in a file that must be LF" });
  if (file.endsWith(".json")) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      findings.push({ file, path: "$", rule: "json", detail: `not valid JSON (${error.message})` });
      return findings;
    }
    walk(parsed, "$", findings, file);
  } else {
    scanString(body, "$", findings, file);
  }
  return findings;
}

/* `files` is a Map or object of relative path -> text. */
export function scanFiles(files) {
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files);
  return entries.flatMap(([file, content]) => scanFile(file, content));
}

export const describe = (finding) => `${finding.file} ${finding.path}: ${finding.detail}`;
