import { html } from "../lib/html.mjs";
import { emptyState, pageHead } from "../ui.mjs";
import * as season from "./season.mjs";
import * as calendar from "./calendar.mjs";
import * as day from "./day.mjs";
import * as account from "./account.mjs";
import * as stars from "./stars.mjs";
import * as integrity from "./integrity.mjs";
import * as empty from "./empty.mjs";

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

export const views = { season, calendar, day, account, stars, integrity, empty, notfound };

/* Before the first night there is no day to show; every page but the 404 gives way to one explanation. */
export const viewFor = (core, route) => (core.index.days.length === 0 && route.name !== "notfound" ? views.empty : views[route.name]);
