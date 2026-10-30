// Helpers shared by the test sites. They reproduce common real-world failures
// on purpose: text drawn into images, clickable divs and unlabeled icons.
window.fx = {
  site: document.documentElement.dataset.site,
  async state() {
    return (await fetch(`/fx/${fx.site}/state`, { credentials: "same-origin" })).json();
  },
  async act(body) {
    return (await fetch(`/fx/${fx.site}/act`, {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    })).json();
  },
  // Renders text into a PNG, the way many sites ship banners, prices and buttons.
  textImage(text, { size = 16, weight = 600, color = "#111", bg = "transparent", pad = 6, font = "system-ui, sans-serif" } = {}) {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    const ratio = 2;
    ctx.font = `${weight} ${size}px ${font}`;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const h = Math.ceil(size * 1.4) + pad * 2;
    c.width = w * ratio; c.height = h * ratio;
    ctx.scale(ratio, ratio);
    if (bg !== "transparent") { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(text, pad, h / 2 + 1);
    const img = new Image();
    img.src = c.toDataURL("image/png");
    img.width = w; img.height = h;
    img.draggable = false;
    return img;
  },
  icon(path, size = 22, color = "currentColor") {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size); svg.setAttribute("height", size);
    svg.innerHTML = `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    return svg;
  },
  clickable(el, fn) {
    el.style.cursor = "pointer";
    el.addEventListener("click", fn);
    return el;
  },
  el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "style") e.style.cssText = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  },
};

window.ICONS = {
  home: "M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  bill: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h6",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  arrow: "M5 12h14M13 6l6 6-6 6",
  left: "M15 18l-6-6 6-6",
  right: "M9 18l6-6-6-6",
  x: "M18 6L6 18M6 6l12 12",
  renew: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
  cart: "M3 3h2l2.4 12h11l2-8H6M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  check: "M5 12l5 5L20 7",
};
