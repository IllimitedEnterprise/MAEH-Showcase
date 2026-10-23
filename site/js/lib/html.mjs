/* A tiny HTML templating helper that escapes by default.
 *
 *   html`<p>${label}</p>`        label is escaped, whatever it contains
 *   html`<div>${html`<b>x</b>`}</div>`   a template result is trusted markup and goes in as is
 *   html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`   arrays are joined
 *
 * null, undefined and booleans render as nothing, so `${cond && html`...`}` works. Every value
 * that came from a data file is text; only markup built by these templates is ever trusted. */

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

export const isSafe = (value) => value instanceof SafeHtml;

/* Mark a string as markup that is already safe. Only for strings this code built itself. */
export const raw = (value) => new SafeHtml(String(value));

function part(value) {
  if (value === null || value === undefined || value === false || value === true) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(part).join("");
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let index = 0; index < values.length; index += 1) out += part(values[index]) + strings[index + 1];
  return new SafeHtml(out);
}

export const join = (items, separator = "") => new SafeHtml(items.map(part).join(part(separator)));

export const empty = new SafeHtml("");
