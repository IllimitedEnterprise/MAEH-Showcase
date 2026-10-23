/* The pointer, touch and keyboard layer over a drawn chart: a cursor that snaps to the nearest
 * day, and one tooltip that lists everything at that day. Tooltips only repeat what the table
 * twin and the labels already say; nothing here is the sole way to reach a value.
 *
 * A chart lives in a <div class="chart-box" tabindex="0"> that stays in the page while its SVG is
 * redrawn at the container's width, so the listeners are bound once and read the current model. */

import { announce, applyStyles } from "../lib/dom.mjs";

let tipElement = null;

function tip() {
  if (!tipElement) {
    tipElement = document.createElement("div");
    tipElement.className = "tip";
    tipElement.setAttribute("role", "presentation");
    tipElement.hidden = true;
    document.body.append(tipElement);
  }
  return tipElement;
}

export function hideTip() {
  if (tipElement) tipElement.hidden = true;
}

function showTip(markup, clientX, clientY) {
  const element = tip();
  element.innerHTML = String(markup);
  applyStyles(element);
  element.hidden = false;
  const { offsetWidth: width, offsetHeight: height } = element;
  const margin = 10;
  let left = clientX + 16;
  if (left + width > window.innerWidth - margin) left = clientX - width - 16;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  const top = Math.max(margin, Math.min(clientY - height / 2, window.innerHeight - height - margin));
  element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

export function nearestIndex(xs, x) {
  let best = 0;
  let distance = Infinity;
  for (let index = 0; index < xs.length; index += 1) {
    const d = Math.abs(xs[index] - x);
    if (d < distance) { best = index; distance = d; }
  }
  return best;
}

/* Draw `build(width)` into `box` now and whenever its width changes. */
export function mountChart(box, build) {
  let drawnWidth = 0;
  let model = null;
  let active = -1;

  const clear = () => {
    active = -1;
    box.querySelector(".cursor")?.classList.remove("is-on");
    for (const hot of box.querySelectorAll(".is-hot")) hot.classList.remove("is-hot");
    hideTip();
  };

  const draw = () => {
    const width = Math.floor(box.getBoundingClientRect().width);
    if (width < 160 || width === drawnWidth) return;
    drawnWidth = width;
    const out = build(width);
    box.innerHTML = String(out.markup);
    applyStyles(box);
    model = out.model;
    active = -1;
    hideTip();
  };

  const show = (index, { speak = false } = {}) => {
    if (!model || index < 0 || index >= model.count) return;
    active = index;
    const point = model.at(index);
    const svg = box.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / model.width;
    const cursor = box.querySelector(".cursor");
    if (cursor) {
      cursor.classList.add("is-on");
      const line = cursor.querySelector(".cursor-line");
      line?.setAttribute("x1", point.x);
      line?.setAttribute("x2", point.x);
      for (const dot of cursor.querySelectorAll(".cursor-dot")) {
        const found = point.dots.find((d) => d.key === dot.dataset.key);
        if (found) { dot.setAttribute("cx", point.x); dot.setAttribute("cy", found.cy); dot.removeAttribute("hidden"); } else dot.setAttribute("hidden", "");
      }
    }
    for (const hot of box.querySelectorAll(".is-hot")) hot.classList.remove("is-hot");
    box.querySelector(`[data-i="${index}"]`)?.classList.add("is-hot");
    showTip(point.tip, rect.left + point.x * scale, rect.top + point.tipY * scale);
    if (speak) announce(point.speak);
  };

  const fromPointer = (event) => {
    if (!model) return -1;
    const rect = box.querySelector("svg")?.getBoundingClientRect();
    if (!rect || rect.width === 0) return -1;
    const x = (event.clientX - rect.left) * (model.width / rect.width);
    if (x < model.plot.x0 - 12 || x > model.plot.x1 + 12) return -1;
    return nearestIndex(model.xs, x);
  };

  box.addEventListener("pointermove", (event) => {
    const index = fromPointer(event);
    if (index < 0) clear();
    else if (index !== active) show(index);
  });
  box.addEventListener("pointerdown", (event) => {
    const index = fromPointer(event);
    if (index >= 0) show(index);
  });
  box.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "touch") clear();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!box.contains(event.target)) clear();
  });
  box.addEventListener("focus", () => {
    if (model && active < 0) show(model.count - 1, { speak: true });
  });
  box.addEventListener("blur", clear);
  box.addEventListener("keydown", (event) => {
    if (!model) return;
    const last = model.count - 1;
    const keys = { ArrowLeft: Math.max(0, (active < 0 ? last : active) - 1), ArrowRight: Math.min(last, (active < 0 ? last : active) + 1), Home: 0, End: last };
    if (event.key === "Escape") { clear(); return; }
    if (event.key in keys) {
      event.preventDefault();
      show(keys[event.key], { speak: true });
    }
  });

  if (typeof ResizeObserver === "function") new ResizeObserver(draw).observe(box);
  draw();
  return { redraw: () => { drawnWidth = 0; draw(); } };
}
