/* Raw file viewer text: escaped first, then lightly coloured. JSON gets keys, strings, numbers and
 * literals; everything else is shown as is. Lines are numbered by CSS, one span per line. */

import { escapeHtml, html, raw } from "./html.mjs";

const TOKEN = /("(?:\\.|[^"\\\n])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

function jsonLine(line) {
  let out = "";
  let last = 0;
  for (const match of line.matchAll(TOKEN)) {
    out += escapeHtml(line.slice(last, match.index));
    const [whole, string, colon, number, literal] = match;
    if (string !== undefined && colon !== undefined) out += `<span class="tk-key">${escapeHtml(string)}</span>${escapeHtml(colon)}`;
    else if (string !== undefined) out += `<span class="tk-str">${escapeHtml(string)}</span>`;
    else if (number !== undefined) out += `<span class="tk-num">${escapeHtml(number)}</span>`;
    else if (literal !== undefined) out += `<span class="tk-lit">${escapeHtml(literal)}</span>`;
    else out += escapeHtml(whole);
    last = match.index + whole.length;
  }
  return out + escapeHtml(line.slice(last));
}

export function highlight(text, kind = "text") {
  const lines = String(text).replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const body = lines.map((line) => `<span class="ln">${kind === "json" ? jsonLine(line) : escapeHtml(line)}</span>`).join("\n");
  return html`<pre class="code" tabindex="0"><code>${raw(body)}</code></pre>`;
}
