// Runs inside the page. Shared by the Chrome extension (content script) and
// the hosted demo (injected by Playwright). Finds the controls a screen reader
// cannot name, applies labels, and draws numbered marks for the agent.
(() => {
  if (window.__errand) return;

  const INTERACTIVE_ROLES = new Set([
    "button", "link", "checkbox", "radio", "tab", "menuitem", "switch", "option", "combobox", "textbox", "slider",
  ]);
  // Names a screen reader would announce that tell the user nothing.
  const GENERIC = /^(button|link|image|img|icon|click|click here|here|more|go|submit|null|undefined|graphic|picture|logo|\W*)$/i;
  const PRIVATE_USE = /^[-\s]+$/;

  const state = { nextId: 1, labels: new Map() };

  function idOf(el) {
    if (!el.dataset.errandId) el.dataset.errandId = String(state.nextId++);
    return el.dataset.errandId;
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
    return !el.closest("[aria-hidden='true'],[hidden],[inert]");
  }

  function textOf(node) {
    let out = "";
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) out += child.textContent;
      else if (child.nodeType === Node.ELEMENT_NODE) {
        const c = child;
        if (c.getAttribute("aria-hidden") === "true") continue;
        if (c.tagName === "IMG") out += " " + (c.getAttribute("alt") ?? "") + " ";
        else if (c.tagName === "svg" || c.tagName === "SVG") out += " " + (c.querySelector("title")?.textContent ?? c.getAttribute("aria-label") ?? "") + " ";
        else if (c.tagName !== "SCRIPT" && c.tagName !== "STYLE") out += " " + (c.getAttribute("aria-label") ?? textOf(c)) + " ";
      }
    }
    return out.replace(/\s+/g, " ").trim();
  }

  // A practical approximation of the accessible name computation (accname 1.2),
  // close enough to tell "has a usable name" from "does not".
  function accessibleName(el) {
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
      if (t) return t;
    }
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab?.textContent?.trim()) return lab.textContent.trim();
      }
      const wrap = el.closest("label");
      if (wrap?.textContent?.trim()) return wrap.textContent.trim();
      if (["submit", "button", "reset"].includes(el.type) && el.value) return el.value;
      if (el.type === "image" && el.alt) return el.alt;
      if (el.placeholder) return el.placeholder;
    }
    if (el.tagName === "IMG") return (el.getAttribute("alt") ?? "").trim();
    const t = textOf(el);
    if (t) return t;
    return (el.getAttribute("title") ?? "").trim();
  }

  function roleOf(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName;
    if (tag === "A" && el.hasAttribute("href")) return "link";
    if (tag === "BUTTON") return "button";
    if (tag === "SELECT") return "combobox";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "IMG") return "img";
    if (tag === "INPUT") {
      const t = el.type;
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (["submit", "button", "reset", "image"].includes(t)) return "button";
      if (t === "range") return "slider";
      return "textbox";
    }
    return "generic";
  }

  function isInteractive(el) {
    const tag = el.tagName;
    if (tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA") return !el.disabled;
    if (tag === "INPUT") return el.type !== "hidden" && !el.disabled;
    if (tag === "A") return el.hasAttribute("href");
    const role = el.getAttribute("role");
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (el.hasAttribute("onclick") || el.dataset.errandClickable === "1") return true;
    const ti = el.getAttribute("tabindex");
    if (ti !== null && Number(ti) >= 0) return true;
    // Divs and spans that only look clickable: pointer cursor set on the element
    // itself rather than inherited from a clickable ancestor.
    if ((tag === "DIV" || tag === "SPAN" || tag === "LI" || tag === "IMG" || tag === "TD") && getComputedStyle(el).cursor === "pointer") {
      const parent = el.parentElement;
      return !parent || getComputedStyle(parent).cursor !== "pointer";
    }
    return false;
  }

  function insideInteractive(el) {
    let n = el.parentElement;
    for (let i = 0; n && i < 5; i++, n = n.parentElement) if (isInteractive(n)) return true;
    return false;
  }

  function contextOf(el) {
    let row = el.closest("tr, li, [role=row], fieldset, form, section, article, .card") ?? el.parentElement;
    // Climb until the surrounding text says something (a product card, a table row).
    for (let i = 0; row && i < 6 && textOf(row).length < 15; i++) row = row.parentElement;
    let heading = "";
    let n = el;
    while (n && !heading) {
      let sib = n.previousElementSibling;
      while (sib && !heading) {
        if (/^H[1-6]$/.test(sib.tagName) || sib.getAttribute("role") === "heading") heading = sib.textContent.trim();
        else {
          const h = sib.querySelector?.("h1,h2,h3,h4,h5,h6,[role=heading]");
          if (h) heading = h.textContent.trim();
        }
        sib = sib.previousElementSibling;
      }
      n = n.parentElement;
    }
    const hints = [el.id, el.className && typeof el.className === "string" ? el.className : "", el.getAttribute("href") ?? "", (el.getAttribute("src") ?? "").startsWith("data:") ? "inline-image" : el.getAttribute("src") ?? "", el.getAttribute("name") ?? "", el.type ?? ""]
      .filter(Boolean).join(" ").slice(0, 160);
    return {
      heading: heading.slice(0, 100),
      row: (row ? textOf(row) : "").slice(0, 200),
      hints,
    };
  }

  function needsLabel(el, name, role) {
    if (role === "img") return !name && el.naturalWidth >= 24 && el.naturalHeight >= 10;
    return !name || GENERIC.test(name) || PRIVATE_USE.test(name) || role === "generic";
  }

  // Many custom widgets show selection only through styling, which a screen
  // reader never hears. The class name or pressed state is the best signal left.
  function looksSelected(el) {
    if (el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-selected") === "true") return true;
    return [...el.classList].some((c) => /^(sel|selected|active|on|checked|current)$/i.test(c));
  }

  function describe(el) {
    const r = el.getBoundingClientRect();
    const role = roleOf(el);
    const name = state.labels.get(idOf(el))?.label ?? accessibleName(el);
    return {
      id: idOf(el),
      tag: el.tagName.toLowerCase(),
      role: role === "generic" && state.labels.has(idOf(el)) ? state.labels.get(idOf(el)).role : role,
      name: name.slice(0, 120),
      type: el.type ?? undefined,
      value: el.tagName === "SELECT" ? el.selectedOptions[0]?.textContent.trim() : el.tagName === "INPUT" && el.type !== "password" ? String(el.value ?? "").slice(0, 60) : undefined,
      checked: el.type === "checkbox" || el.type === "radio" ? el.checked : el.getAttribute("aria-checked") ?? (looksSelected(el) ? true : undefined),
      options: el.tagName === "SELECT" ? [...el.options].map((o) => o.textContent.trim()).slice(0, 20) : undefined,
      password: el.type === "password",
      labelled: el.dataset.errandLabelled === "1",
      autocomplete: el.getAttribute("autocomplete") ?? undefined,
      rect: { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      inViewport: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    };
  }

  function candidates() {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest("#errand-marks")) continue;
      const tag = el.tagName;
      const interactive = isInteractive(el);
      const isImage = tag === "IMG" && !insideInteractive(el);
      if (!interactive && !isImage) continue;
      if (!isVisible(el)) continue;
      // Skip elements nested inside another interactive element; the outer one is the control.
      if (interactive && el.parentElement?.closest("a[href],button,[role=button],[role=link]")) continue;
      out.push(el);
    }
    return out;
  }

  // Elements a screen reader user cannot identify, with context for the vision model.
  function findUnnamed() {
    const out = [];
    for (const el of candidates()) {
      const id = idOf(el);
      if (state.labels.has(id)) continue;
      const role = roleOf(el);
      const name = accessibleName(el);
      if (!needsLabel(el, name, role)) continue;
      out.push({ ...describe(el), announcedAs: name ? `${name}, ${role}` : role === "generic" ? "(not announced)" : role, context: contextOf(el) });
    }
    return out;
  }

  // What a screen reader user hears for each control right now.
  function controls() {
    return candidates().filter((el) => isInteractive(el)).map((el) => describe(el));
  }

  function applyLabels(labels) {
    let applied = 0;
    for (const { id, label, role } of labels) {
      const el = document.querySelector(`[data-errand-id="${id}"]`);
      if (!el || !label) continue;
      state.labels.set(id, { label, role: role || roleOf(el) });
      if (el.tagName === "IMG") el.setAttribute("alt", label);
      else el.setAttribute("aria-label", label);
      if (roleOf(el) === "generic") {
        el.setAttribute("role", role && role !== "generic" ? role : "button");
        if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
        if (!el.dataset.errandKeys) {
          el.dataset.errandKeys = "1";
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
          });
        }
      }
      el.dataset.errandLabelled = "1";
      applied++;
    }
    return applied;
  }

  function drawMarks(ids) {
    clearMarks();
    const layer = document.createElement("div");
    layer.id = "errand-marks";
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:2147483647";
    for (const id of ids) {
      const el = document.querySelector(`[data-errand-id="${id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const box = document.createElement("div");
      box.style.cssText = `position:absolute;left:${r.x + scrollX}px;top:${r.y + scrollY}px;width:${r.width}px;height:${r.height}px;outline:2px solid #ff3d00;`;
      const tag = document.createElement("span");
      tag.textContent = id;
      tag.style.cssText = "position:absolute;left:-2px;top:-16px;background:#ff3d00;color:#fff;font:bold 11px/14px monospace;padding:0 3px;";
      box.appendChild(tag);
      layer.appendChild(box);
    }
    document.body.appendChild(layer);
  }

  function clearMarks() {
    document.getElementById("errand-marks")?.remove();
  }

  // innerText, except images speak their alt text, so a name that exists only
  // as a picture reaches the agent once it has been labelled.
  function readable(node) {
    let out = "";
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { out += child.textContent; continue; }
      if (child.nodeType !== Node.ELEMENT_NODE || child.id === "errand-marks") continue;
      const style = getComputedStyle(child);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (child.tagName === "IMG") { out += ` ${child.getAttribute("alt") ?? ""} `; continue; }
      const block = !style.display.startsWith("inline");
      out += (block ? "\n" : "") + readable(child) + (block ? "\n" : " ");
    }
    return out;
  }

  function pageText(limit = 4000) {
    return readable(document.body).replace(/[ \t]+/g, " ").replace(/( ?\n ?)+/g, "\n").trim().slice(0, limit);
  }

  function blockers() {
    const frames = [...document.querySelectorAll("iframe")].map((f) => f.src);
    const captcha = frames.some((s) => /recaptcha|hcaptcha|turnstile|captcha/i.test(s))
      || !!document.querySelector(".g-recaptcha,.h-captcha,.cf-turnstile,[data-captcha]")
      || /i'?m not a robot|verify you are human/i.test(document.body.innerText);
    const password = [...document.querySelectorAll("input[type=password]")].some(isVisible);
    return { captcha, password };
  }

  window.__errand = { findUnnamed, controls, applyLabels, drawMarks, clearMarks, pageText, blockers, accessibleName };
})();
