/* The Star system: who led the day, the week, the month, and who holds the most crowns. */

import { html, raw } from "../lib/html.mjs";
import { int, longDate, mediumDate, periodLabel, shortDate, two } from "../lib/fmt.mjs";
import { href } from "../lib/router.mjs";
import { renderMarkdown } from "../lib/markdown.mjs";
import { crownNote, labelOf, standings } from "../lib/model.mjs";
import { accountChip, badge, card, crownMark, icon, moneyHtml, pageHead, standingsTable, table, tabs } from "../ui.mjs";

export async function load(ctx, route) {
  let rules = "";
  try {
    rules = await ctx.data.text("stars/RULES.md");
  } catch {
    rules = "";
  }
  return { core: ctx.core, tab: route.tab, rules };
}

const TABS = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "all", label: "All-time" },
];

function crownBanner(core, { title, crown, rows, note }) {
  if (crown) {
    return html`<div class="crown-banner"><span class="crown-banner-icon">${icon("crown")}</span>
<div><p class="eyebrow">${title}</p><p class="crown-banner-name">${accountChip(core, crown.key, { label: crown.label })}</p>
<p class="muted">Score ${two(crown.score)} · net ${moneyHtml(crown.net)}</p></div></div>`;
  }
  return html`<div class="crown-banner is-empty"><span class="crown-banner-icon">${icon("crown")}</span><div><p class="eyebrow">${title}</p><p class="crown-banner-name">No Star</p><p class="muted">${note ?? crownNote(rows)}</p></div></div>`;
}

function dayTab(core) {
  const board = core.leaderboard.day;
  return html`${card({
    id: "star-day", title: `Day · ${longDate(board.date)}`, subtitle: "The latest frozen day. Older days are in the calendar, each with its own standings.",
    body: html`${crownBanner(core, { title: "Star of the day", crown: board.crown, rows: board.rows })}${standingsTable(core, board.rows, { crownKey: board.crown?.key ?? null, caption: `Day standings, ${longDate(board.date)}` })}`,
    actions: html`<a class="btn btn-ghost" href="${href({ name: "day", date: board.date, file: null })}">Open the day ${icon("arrow-right")}</a>`,
  })}`;
}

function periodTab(core, tab) {
  const board = standings(core, tab);
  const noun = tab === "week" ? "week" : "month";
  const state = board.complete ? (board.crown ? "crowned" : "no star") : "leading";
  const finished = core.crowns.periods.filter((p) => p.kind === tab).sort((a, b) => b.period.localeCompare(a.period));
  const through = `through ${mediumDate(board.through)}`;
  const intro = board.complete
    ? crownBanner(core, { title: `Star of the ${noun}`, crown: board.crown, rows: board.rows })
    : html`<div class="crown-banner is-leading"><span class="crown-banner-icon">${icon("crown")}</span><div><p class="eyebrow">${badge("Not yet crowned", "info")} Leading the ${noun}</p><p class="crown-banner-name">${board.leader ? accountChip(core, board.leader.key, { label: board.leader.label }) : "No one yet"}</p><p class="muted">The crown is awarded once every day of the ${noun} is frozen, and only if the leader finished in profit. This is a standing, not a crown.</p></div></div>`;
  return html`${card({
    id: `star-${tab}`, title: `${periodLabel(tab, board.period)} · ${through}`,
    subtitle: board.start < core.index.seasonStart ? html`Counted from ${mediumDate(core.index.seasonStart)}, when the season began.` : `${shortDate(board.start)} to ${shortDate(board.end)}`,
    body: html`${intro}${standingsTable(core, board.rows, { crownKey: board.crown?.key ?? null, caption: `${noun} standings, ${periodLabel(tab, board.period)}` })}`,
    className: `state-${state.replace(" ", "-")}`,
  })}
${card({
    id: `star-${tab}-done`, title: `Finished ${noun}s`, subtitle: finished.length ? null : `No ${noun} has been completed yet.`,
    body: finished.length ? table({
      caption: `Finished ${noun}s and their Stars`,
      columns: [
        { label: tab === "week" ? "Week" : "Month", cell: (row) => periodLabel(tab, row.period) },
        { label: "Days", className: "col-optional", cell: (row) => `${shortDate(row.start)} – ${shortDate(row.end)}` },
        { label: "Star", cell: (row) => (row.crown ? html`${crownMark()} ${accountChip(core, row.crown.key, { label: row.crown.label })}` : html`<span class="muted">No Star</span>`) },
        { label: "Score", align: "right", cell: (row) => (row.crown ? two(row.crown.score) : "") },
        { label: "Net", align: "right", cell: (row) => (row.crown ? moneyHtml(row.crown.net, { arrow: false }) : "") },
        { label: "Note", className: "col-note", cell: (row) => (row.partialPeriod ? badge("Partial", "neutral", { title: "The period began before the season did, so it covers fewer days." }) : "") },
      ],
      rows: finished,
    }) : "",
  })}`;
}

function allTimeTab(core) {
  const rows = [...core.crowns.tally].sort((a, b) => b.points - a.points || b.day - a.day || a.label.localeCompare(b.label));
  const top = Math.max(1, ...rows.map((row) => row.points));
  const awards = [...core.crowns.awards].sort((a, b) => b.end.localeCompare(a.end) || b.kind.localeCompare(a.kind));
  const link = (award) => (award.kind === "day" ? href({ name: "day", date: award.period, file: null }) : href({ name: "stars", tab: award.kind }));
  return html`${card({
    id: "tally", title: "Crown tally", subtitle: "A day Star is 1 point, a week Star 5, a month Star 20.",
    body: table({
      caption: "All-time crown tally",
      columns: [
        { label: "Account", cell: (row) => accountChip(core, row.key, { label: row.label }) },
        { label: "Day", align: "right", cell: (row) => int(row.day) },
        { label: "Week", align: "right", cell: (row) => int(row.week) },
        { label: "Month", align: "right", cell: (row) => int(row.month) },
        { label: "Points", align: "right", className: "col-score", cell: (row) => html`<span class="score-figure">${int(row.points)}</span><span class="meter" aria-hidden="true"><span class="meter-fill" data-style="--w:${Math.round((row.points / top) * 100)}%"></span></span>` },
        { label: "Streak", align: "right", className: "col-optional", cell: (row) => (row.streak.best > 0 ? html`${row.streak.cur > 0 ? html`<strong>${row.streak.cur}</strong> now · ` : ""}best ${row.streak.best}` : "") },
      ],
      rows,
    }),
  })}
${card({
    id: "timeline", title: "Every Star awarded", subtitle: `${awards.length} so far, newest first.`,
    body: awards.length === 0 ? html`<p class="muted">No Star has been awarded yet.</p>` : html`<ol class="timeline" role="list">${awards.map((award) => html`<li class="tl-${award.kind}"><span class="tl-kind">${award.kind === "day" ? "Day" : award.kind === "week" ? "Week" : "Month"}</span><a class="tl-period" href="${link(award)}">${award.kind === "day" ? mediumDate(award.period) : periodLabel(award.kind, award.period)}</a>${accountChip(core, award.key, { label: award.label })}<span class="tl-score">score ${two(award.score)}</span>${moneyHtml(award.net, { arrow: false })}</li>`)}</ol>`,
  })}`;
}

export function render(model) {
  const { core, tab, rules } = model;
  const body = tab === "all" ? allTimeTab(core) : tab === "day" ? dayTab(core) : periodTab(core, tab);
  const markup = html`<div class="page stars">
${pageHead({
    eyebrow: "Stars",
    title: "Star accounts",
    lede: "Every day, week and month the top-ranked account that finished in profit wears the crown. The score weighs return, profit factor, drawdown and win rate, and trusts an account less when it made few trades. Demo accounts only: a Star describes what happened, it is not advice.",
  })}
${tabs({ label: "Standings", items: TABS.map((item) => ({ label: item.label, href: href({ name: "stars", tab: item.id }), current: item.id === tab })) })}
${body}
${card({ id: "rules", title: "How the Star is scored", subtitle: "stars/RULES.md, as published. Days are sealed under the rules in force that day.", body: rules ? html`<div class="prose">${raw(renderMarkdown(rules))}</div>` : html`<p class="muted">The rules file could not be loaded.</p>`, className: "card-rules" })}
</div>`;
  return { title: `Stars · ${TABS.find((item) => item.id === tab)?.label ?? ""}`, markup, after() {} };
}
