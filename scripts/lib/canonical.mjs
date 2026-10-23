/* Deterministic JSON and hashing.
 *
 * Every published file is written through `stringify`, so the same data always yields the
 * same bytes: that is what makes a SHA-256 over a file mean something. Objects keep the
 * order they were built in (builders construct them in a fixed, readable order); only
 * `canonical` sorts keys, for the places that compare or hash values rather than files. */

import { createHash } from "node:crypto";

function check(value, path) {
  if (value === undefined) throw new TypeError(`undefined at ${path}`);
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError(`non-finite number at ${path}`);
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint")
    throw new TypeError(`unsupported ${typeof value} at ${path}`);
  if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) check(inner, `${path}.${key}`);
  }
}

const normalise = (_key, value) => (Object.is(value, -0) ? 0 : value);

/* Pretty JSON, two-space indent, LF, trailing newline. Throws on NaN, Infinity or undefined. */
export function stringify(value) {
  check(value, "$");
  return `${JSON.stringify(value, normalise, 2)}\n`;
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
}

/* Compact JSON with keys sorted at every depth: equal values give equal strings. */
export function canonical(value) {
  check(value, "$");
  return JSON.stringify(sorted(value), normalise);
}

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/* Money is held in integer cents so sums never carry float noise. */
export const toCents = (amount) => Math.round(amount * 100);
export const fromCents = (cents) => cents / 100;
