/* The season before its first night: nothing is frozen yet, so every page that needs a day shows
 * this one instead, and says when the first one will arrive. */

import { html } from "../lib/html.mjs";
import { longDate, plural } from "../lib/fmt.mjs";
import { accountChip, emptyState, pageHead } from "../ui.mjs";

export async function load(ctx) {
  return { core: ctx.core };
}

export function render({ core }) {
  const { seasonStart, zone, accounts } = core.index;
  return {
    title: "Waiting for the first freeze",
    markup: html`<div class="page">
${pageHead({ eyebrow: "Season", title: "Waiting for the first freeze" })}
${emptyState(
    "No day has been frozen yet",
    html`The season begins on ${longDate(seasonStart)}. Each night at 01:00 (${zone} time) the results of the day before are checked, frozen and published here, with ${plural(accounts.length, "demo account")} ranked for a Star.`,
    html`<ul class="chip-list" role="list">${accounts.map((account) => html`<li>${accountChip(core, account.key, { link: false, label: account.label })}</li>`)}</ul>`,
  )}
</div>`,
    after() {},
  };
}
