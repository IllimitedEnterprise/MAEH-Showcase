import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./helpers/site-data.mjs";

const dir = join(REPO, "site", "assets", "fonts");
const doc = readFileSync(join(dir, "FONTS.md"), "utf8");
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

test("the bundled fonts are exactly the files FONTS.md records", () => {
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".woff2"))) {
    const hash = sha(join(dir, file));
    assert.ok(doc.includes(`\`${file}\``), `${file} is documented`);
    assert.ok(doc.includes(hash), `${file} matches the recorded SHA-256 ${hash}`);
  }
  assert.equal(readdirSync(dir).filter((name) => name.endsWith(".woff2")).length, 2, "two font files, both documented");
});

test("each family ships its licence next to it, and the licence is the SIL OFL 1.1", () => {
  for (const file of ["BricolageGrotesque-OFL.txt", "JetBrainsMono-OFL.txt"]) {
    const text = readFileSync(join(dir, "LICENSES", file), "utf8");
    assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/i);
    assert.match(text, /Copyright \d{4} The .* Project Authors/);
  }
});

test("the stylesheet declares only the weights each font really has", () => {
  const css = readFileSync(join(REPO, "site", "css", "tokens.css"), "utf8");
  assert.match(css, /Bricolage Grotesque[\s\S]*?font-weight: 200 800;/);
  assert.match(css, /JetBrains Mono[\s\S]*?font-weight: 400 800;/, "JetBrains Mono starts at 400");
  assert.ok(!/font-stretch/.test(css), "neither file has a width axis");
});
