/* Why the numbers can be trusted, and how to check for yourself. */

import { html } from "../lib/html.mjs";
import { highlight } from "../lib/highlight.mjs";
import { int, longDate, mediumDate } from "../lib/fmt.mjs";
import { href } from "../lib/router.mjs";
import { CLONE_STEPS, REPO_FILE, REPO_URL } from "../lib/site.mjs";
import { missingDates } from "../lib/model.mjs";
import { badge, card, icon, kindBadge, moneyHtml, pageHead, statGrid, statTile, statusBadge, table } from "../ui.mjs";

export async function load(ctx) {
  return { core: ctx.core, build: ctx.build ?? null };
}

const hashShort = (hash) => `${hash.slice(0, 10)}…${hash.slice(-6)}`;

export function chainResultHtml(result) {
  const bad = result.rows.filter((row) => !row.hashOk || !row.prevOk || row.note);
  const days = result.rows.length;
  const summary = result.ok
    ? html`<p class="verify-ok" role="status">${icon("check")} ${days === 1 ? "The one day checks out: its manifest hashes to what the catalogue records, and the tip matches." : html`All ${int(days)} days check out: every manifest hashes to what the catalogue records, every day points back at the one before, and the tip matches.`}</p>`
    : html`<p class="verify-bad" role="alert">${icon("warn")} A problem was found. ${bad.length ? `First at ${bad[0].date}${bad[0].note ? `: ${bad[0].note}` : ""}.` : "The chain tip does not match the last day."} Do not rely on these numbers until it is explained.</p>`;
  return html`${summary}${table({
    caption: "Chain check, day by day",
    className: "table-compact",
    columns: [
      { label: "#", align: "right", cell: (row) => row.seq },
      { label: "Day", cell: (row) => html`<a href="${href({ name: "day", date: row.date, file: null })}">${mediumDate(row.date)}</a>` },
      { label: "Manifest hash", cell: (row) => (row.hashOk ? badge("Matches", "ok", { icon: "check" }) : badge("Differs", "bad", { icon: "warn" })) },
      { label: "Link to the day before", cell: (row) => (row.prevOk ? badge("Matches", "ok", { icon: "check" }) : badge("Broken", "bad", { icon: "warn" })) },
    ],
    rows: result.rows,
  })}`;
}

export function render(model) {
  const { core, build } = model;
  const { index } = core;
  const tip = index.tip;
  const kinds = index.days.reduce((count, day) => ({ ...count, [day.kind]: (count[day.kind] ?? 0) + 1 }), {});
  const gaps = missingDates(core);

  const rows = [...index.days].reverse();
  const daysTable = table({
    caption: "Every frozen day",
    className: "table-compact",
    columns: [
      { label: "#", align: "right", cell: (row) => row.seq },
      { label: "Day", cell: (row) => html`<a href="${href({ name: "day", date: row.date, file: null })}">${mediumDate(row.date)}</a>` },
      { label: "How", className: "col-optional", cell: (row) => kindBadge(row.kind) },
      { label: "Status", className: "col-optional", cell: (row) => statusBadge(row.status) },
      { label: "Closes", align: "right", cell: (row) => int(row.n) },
      { label: "Net", align: "right", cell: (row) => moneyHtml(row.net, { arrow: false }) },
      { label: "Manifest SHA-256", className: "col-hash", cell: (row) => html`<code class="hash" title="${row.sha256}">${hashShort(row.sha256)}</code>` },
    ],
    rows,
  });

  const markup = html`<div class="page integrity">
${pageHead({
    eyebrow: "Integrity",
    title: "Frozen means frozen",
    lede: "Each night the previous day is written once, hashed, and chained to the day before. Anyone can check that nothing has changed since: here in the browser, or with the repository's own tools.",
  })}

${statGrid(html`
${statTile({ label: "Days in the chain", value: int(index.days.length), hint: `from ${mediumDate(index.seasonStart)}` })}
${statTile({ label: "Latest freeze", value: `#${tip.seq}`, hint: mediumDate(tip.date) })}
${statTile({ label: "Backfilled days", value: int(kinds.backfilled ?? 0), hint: "read from the broker close ledgers when the project began" })}
${statTile({ label: "Gaps", value: int(gaps.length), hint: gaps.length ? gaps.slice(0, 3).map(mediumDate).join(", ") : "every day is present" })}`, "stats-4")}

${card({
    id: "tip", title: "Chain tip",
    subtitle: "The SHA-256 of the newest day's manifest. Every earlier day is folded into it.",
    body: html`<p class="tip-hash"><code class="hash hash-big">${tip.sha256}</code></p>
<p class="muted">Freeze #${tip.seq}, ${longDate(tip.date)}.</p>`,
  })}

${card({
    id: "verify", title: "Check the chain in your browser",
    subtitle: "Your browser downloads every day's manifest, hashes it itself, and compares it with the catalogue and with the link each day holds to the one before.",
    actions: html`<button type="button" class="btn" data-action="verify-chain">${icon("shield")} Check the chain</button>`,
    body: html`<div class="progress" id="chain-progress" hidden><div class="progress-fill" id="chain-progress-fill"></div></div><div id="chain-result" aria-live="polite"><p class="muted">Nothing has been checked yet. It takes a few seconds.</p></div>`,
  })}

<div class="grid-2">
${card({ id: "how", title: "How a day is protected", body: html`<ol class="steps" role="list">
<li><strong>Written once.</strong> A night's files are built in a temporary folder, checked, and moved into place in one step. A day that exists is never overwritten.</li>
<li><strong>Chained.</strong> Each manifest records the SHA-256 of the day before. Change one byte of any past file and every link after it breaks.</li>
<li><strong>Append-only history.</strong> Git hooks refuse a commit that edits or deletes a frozen file, and a push that rewrites history. CI repeats the check on every push, and a tag marks the chain tip each week.</li>
<li><strong>Public.</strong> The data is plain JSON, Markdown and CSV in the repository. Nothing here needs trust in this page.</li>
</ol>` })}
${card({ id: "limits", title: "What this does and does not show", body: html`<p>A chain kept in a repository its owner controls shows <em>tamper-evidence</em>: if anything changes after publication, you can see that it did. It cannot prove the numbers were true when written, only that they have not moved since.</p>
<p>Every account here is a demo account trading simulated money. Nothing on this site is investment advice, and a Star describes what happened, not what will.</p>
<p class="small"><a href="${REPO_FILE("DISCLAIMER.md")}" target="_blank" rel="noopener noreferrer">Disclaimer</a> · <a href="${REPO_FILE("LICENSE")}" target="_blank" rel="noopener noreferrer">Code: MIT</a> · <a href="${REPO_FILE("LICENSE-DATA.md")}" target="_blank" rel="noopener noreferrer">Data: CC BY 4.0</a></p>` })}
</div>

${card({ id: "yourself", title: "Check it yourself", subtitle: "You need Git and Node 22 or newer. Nothing is installed; the tools have no dependencies.", body: html`${highlight(CLONE_STEPS.join("\n"), "text")}<p class="muted small">The first checks every file of every day against its manifest, the chain, the rules, the privacy scan and the derived standings. The second rebuilds the Star files and compares them byte for byte.</p>`, actions: html`<a class="btn btn-ghost" href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${icon("github")} Repository</a>` })}

${card({ id: "days", title: "Every frozen day", subtitle: "Newest first.", body: daysTable })}
${build ? card({ id: "build", title: "This build of the site", body: html`<dl class="facts"><div><dt>Build</dt><dd><code>${build.build}</code></dd></div><div><dt>Commit</dt><dd><code>${build.commit}</code></dd></div><div><dt>Built</dt><dd>${build.builtAt}</dd></div><div><dt>Checks at build time</dt><dd>${build.verified ? "all passed" : "not recorded"}</dd></div></dl>` }) : ""}
</div>`;

  return { title: "Integrity", markup, after() {} };
}
