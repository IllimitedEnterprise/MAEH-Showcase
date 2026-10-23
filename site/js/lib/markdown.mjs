/* A small, safe Markdown renderer for the files the site shows (day READMEs, account summaries,
 * the rules). Everything is HTML-escaped first and only then marked up, so a file can never
 * inject markup; links are limited to relative paths, anchors and https. Supports headings,
 * paragraphs, pipe tables, lists, fenced code, **bold**, *italic* and `code`. */

const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function safeHref(url) {
  const trimmed = url.trim();
  if (/^(https:\/\/|\.{0,2}\/|#)/.test(trimmed) || /^[A-Za-z0-9_./-]+(\.[A-Za-z]+)?$/.test(trimmed)) return trimmed;
  return null;
}

/* Inline markup over text that is ALREADY escaped. */
function inline(escaped) {
  return escaped
    .replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+)\)/g, (_m, label, url) => {
      const href = safeHref(url.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
      return href ? `<a href="${escapeHtml(href)}"${href.startsWith("https://") ? ' rel="noopener noreferrer" target="_blank"' : ""}>${label}</a>` : label;
    });
}

const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
const isRule = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const align = (rule) => cells(rule).map((cell) => (cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left"));

export function renderMarkdown(source) {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") { index += 1; continue; }

    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const body = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) body.push(lines[index++]);
      index += 1;
      html.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length + 1; // the page already has an h1
      html.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      index += 1;
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isRule(lines[index + 1])) {
      const head = cells(line);
      const alignments = align(lines[index + 1]);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") rows.push(cells(lines[index++]));
      const th = head.map((cell, i) => `<th scope="col" class="${alignments[i] ?? "left"}">${inline(escapeHtml(cell))}</th>`).join("");
      const tr = rows.map((row) => `<tr>${head.map((_c, i) => `<td class="${alignments[i] ?? "left"}">${inline(escapeHtml(row[i] ?? ""))}</td>`).join("")}</tr>`).join("");
      html.push(`<div class="table-wrap"><table class="table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const items = [];
      while (index < lines.length) {
        const match = (ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*]\s+(.*)$/).exec(lines[index]);
        if (!match) break;
        items.push(`<li>${inline(escapeHtml(match[1]))}</li>`);
        index += 1;
      }
      html.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() !== "" && !/^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s)/.test(lines[index])
      && !(lines[index].includes("|") && isRule(lines[index + 1] ?? ""))) {
      paragraph.push(lines[index++].trim());
    }
    html.push(`<p>${inline(escapeHtml(paragraph.join(" ")))}</p>`);
  }
  return html.join("\n");
}

export { escapeHtml };
