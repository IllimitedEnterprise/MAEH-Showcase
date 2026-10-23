/* Checks on markup a view produced, without a browser: balanced tags, unique ids, resolvable
 * references, no inline script or style, and links that go somewhere real. */

import { parseStyleData } from "../../site/js/lib/dom.mjs";

const VOID = new Set(["br", "hr", "img", "input", "link", "meta", "wbr"]);
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)(\/?)>/g;

/* Everything that is not part of the raw-file viewer, whose text may legitimately say "null". */
export const withoutCode = (markup) => String(markup).replace(/<pre class="code"[\s\S]*?<\/pre>/g, "");

export function checkMarkup(markup) {
  const text = String(markup);
  const problems = [];
  const stack = [];
  for (const match of text.matchAll(TAG)) {
    const [, closing, name, , selfClose] = match;
    const lower = name.toLowerCase();
    if (selfClose || VOID.has(lower)) continue;
    if (!closing) stack.push(lower);
    else if (stack.at(-1) === lower) stack.pop();
    else problems.push(`unbalanced </${lower}> (open: ${stack.slice(-3).join(">")})`);
  }
  if (stack.length) problems.push(`unclosed: ${stack.join(">")}`);

  const ids = [...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) problems.push(`duplicate id ${id}`);
    seen.add(id);
  }
  for (const m of text.matchAll(/aria-labelledby="([^"]+)"/g)) {
    for (const target of m[1].split(/\s+/)) if (!seen.has(target)) problems.push(`aria-labelledby points at missing id ${target}`);
  }
  for (const m of text.matchAll(/aria-controls="([^"]+)"/g)) if (!seen.has(m[1])) problems.push(`aria-controls points at missing id ${m[1]}`);

  if (/\sstyle="/.test(text)) problems.push("inline style attribute (blocked by the CSP)");
  if (/\son[a-z]+="/i.test(text)) problems.push("inline event handler");
  if (/javascript:/i.test(text)) problems.push("javascript: url");
  if (/<script/i.test(text)) problems.push("script element");
  for (const m of text.matchAll(/data-style="([^"]*)"/g)) {
    if (parseStyleData(m[1]).length === 0) problems.push(`data-style that sets nothing: ${m[1]}`);
  }
  if ((text.match(/<h1[\s>]/g) ?? []).length !== 1) problems.push(`expected one h1, found ${(text.match(/<h1[\s>]/g) ?? []).length}`);
  for (const m of text.matchAll(/<img\b[^>]*>/g)) if (!/\balt="/.test(m[0])) problems.push("image without alt text");
  for (const m of text.matchAll(/<button\b([^>]*)>/g)) if (!/\btype="/.test(m[1])) problems.push("button without a type");
  return problems;
}

export const hashLinks = (markup) => [...String(markup).matchAll(/href="(#\/[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
export const externalLinks = (markup) => [...String(markup).matchAll(/href="(https?:[^"]*)"/g)].map((m) => m[1]);
