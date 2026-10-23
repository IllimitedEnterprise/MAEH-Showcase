/* Hash routes: parse a location hash into a route, and a route back into a hash.
 *
 *   #/                         season
 *   #/calendar[/YYYY-MM]       month grid
 *   #/day/YYYY-MM-DD[/file/PATH]
 *   #/account/KEY
 *   #/stars[/day|week|month|all]
 *   #/integrity
 *
 * Anything else is "notfound": a bad link says so instead of showing a blank page. */

const DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const KEY = /^[A-Za-z0-9._-]{1,48}$/;
const TABS = new Set(["day", "week", "month", "all"]);

export function parseRoute(hash) {
  const raw = String(hash ?? "").replace(/^#\/?/, "");
  let parts;
  try {
    parts = raw.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return { name: "notfound" };
  }
  const [head, second, third, ...rest] = parts;
  switch (head) {
    case undefined:
      return { name: "season" };
    case "calendar":
      if (second === undefined) return { name: "calendar", month: null };
      return MONTH.test(second) && parts.length === 2 ? { name: "calendar", month: second } : { name: "notfound" };
    case "day": {
      if (!DATE.test(second ?? "")) return { name: "notfound" };
      if (third === undefined) return { name: "day", date: second, file: null };
      const file = rest.join("/");
      return third === "file" && file && !file.split("/").includes("..") ? { name: "day", date: second, file } : { name: "notfound" };
    }
    case "account":
      return KEY.test(second ?? "") && parts.length === 2 ? { name: "account", key: second } : { name: "notfound" };
    case "stars":
      if (second === undefined) return { name: "stars", tab: "day" };
      return TABS.has(second) && parts.length === 2 ? { name: "stars", tab: second } : { name: "notfound" };
    case "integrity":
      return parts.length === 1 ? { name: "integrity" } : { name: "notfound" };
    default:
      return { name: "notfound" };
  }
}

const enc = (segment) => encodeURIComponent(segment);

export function href(route) {
  switch (route.name) {
    case "season": return "#/";
    case "calendar": return route.month ? `#/calendar/${route.month}` : "#/calendar";
    case "day": return route.file ? `#/day/${route.date}/file/${route.file.split("/").map(enc).join("/")}` : `#/day/${route.date}`;
    case "account": return `#/account/${enc(route.key)}`;
    case "stars": return route.tab && route.tab !== "day" ? `#/stars/${route.tab}` : "#/stars";
    case "integrity": return "#/integrity";
    default: return "#/";
  }
}

/* Which top-level nav item a route belongs to. */
export const section = (route) => ({ season: "season", calendar: "calendar", day: "calendar", account: "stars", stars: "stars", integrity: "integrity" })[route.name] ?? "season";

export const NAV = [
  { id: "season", label: "Season", route: { name: "season" } },
  { id: "calendar", label: "Calendar", route: { name: "calendar", month: null } },
  { id: "stars", label: "Stars", route: { name: "stars", tab: "day" } },
  { id: "integrity", label: "Integrity", route: { name: "integrity" } },
];
