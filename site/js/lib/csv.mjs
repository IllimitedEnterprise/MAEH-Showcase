/* A CSV reader for the small files this repo writes (no quoted fields with commas are produced,
 * but quotes are honoured so a hand-edited file still reads). Returns { header, rows }. */

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text).replace(/\r\n/g, "\n");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  const [header = [], ...body] = rows.filter((cells) => cells.some((cell) => cell !== ""));
  return { header, rows: body };
}
