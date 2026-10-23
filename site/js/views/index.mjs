import { html } from "../lib/html.mjs";
import { emptyState, pageHead } from "../ui.mjs";
import * as season from "./season.mjs";
import * as calendar from "./calendar.mjs";
import * as day from "./day.mjs";
import * as account from "./account.mjs";
import * as stars from "./stars.mjs";
import * as integrity from "./integrity.mjs";

const notfound = {
  async load() {
    return {};
  },
  render() {
    return {
      title: "Not found",
      markup: html`<div class="page">${pageHead({ eyebrow: "404", title: "Not found" })}${emptyState("That address does not lead anywhere", "The link may be mistyped, or it may point at a day that is not part of the season.", html`<p><a class="btn" href="#/">Back to the season</a> <a class="btn btn-ghost" href="#/calendar">Open the calendar</a></p>`)}</div>`,
      after() {},
    };
  },
};

export const views = { season, calendar, day, account, stars, integrity, notfound };
