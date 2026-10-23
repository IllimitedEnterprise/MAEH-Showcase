/* The small amount of DOM code the pages need. Everything that decides what the markup says lives
 * in pure modules; this file only puts it on the page.
 *
 * The page runs under a CSP with no inline styles, so values that only exist at run time (a bar
 * width, a heat colour) are written as data-style="--w:37%" and applied here through the CSSOM,
 * which the policy allows. */

import { raw } from "./html.mjs";

const PROPERTY = /^--[a-z0-9-]{1,32}$/;
const VALUE = /^[#a-zA-Z0-9%.,()\s+-]{0,80}$/;

/* "--w:37%;--c:#fff" -> [["--w", "37%"], ["--c", "#fff"]]. Anything unexpected is dropped. */
export function parseStyleData(text) {
  const out = [];
  for (const declaration of String(text).split(";")) {
    const cut = declaration.indexOf(":");
    if (cut < 1) continue;
    const name = declaration.slice(0, cut).trim();
    const value = declaration.slice(cut + 1).trim();
    if (PROPERTY.test(name) && VALUE.test(value) && !/url\s*\(/i.test(value)) out.push([name, value]);
  }
  return out;
}

/* Attribute text for an element whose style is computed: data-style="--w:37%". */
export const styleData = (pairs) => raw(`data-style="${Object.entries(pairs).map(([name, value]) => `${name}:${value}`).join(";")}"`);

export function applyStyles(root) {
  for (const element of root.querySelectorAll("[data-style]")) {
    for (const [name, value] of parseStyleData(element.getAttribute("data-style"))) element.style.setProperty(name, value);
    element.removeAttribute("data-style");
  }
}

export function mount(element, markup) {
  element.innerHTML = String(markup);
  applyStyles(element);
}

/* Delegated listener: handler(event, matchedElement) for events whose target is inside `selector`. */
export function on(root, type, selector, handler, options) {
  root.addEventListener(type, (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (target && root.contains(target)) handler(event, target);
  }, options);
}

let announcer = null;
export function announce(message) {
  announcer ??= document.getElementById("announcer");
  if (!announcer) return;
  announcer.textContent = "";
  window.setTimeout(() => { announcer.textContent = message; }, 40);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = "sr-only";
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

export const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
