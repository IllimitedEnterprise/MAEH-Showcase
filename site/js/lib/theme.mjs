/* Dark is the house look; light is one click away and remembered. A stored choice is a
 * convenience only: if storage is blocked the page still works, it just forgets. */

const KEY = "maeh-showcase-theme";

export function storedTheme() {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export const currentTheme = () => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f2f3ff" : "#060716");
}

export function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  try { window.localStorage.setItem(KEY, next); } catch { /* the choice just is not remembered */ }
  return next;
}
