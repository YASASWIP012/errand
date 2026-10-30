const $ = (id) => document.getElementById(id);

const SUGGESTIONS = {
  northgrid: ["Pay my electricity bill in full", "Turn on paperless billing", "Report that my power is out"],
  clinic: ["Book the earliest appointment with Dr. Okafor next week", "Cancel my appointment on 3 November"],
  library: ["Renew The Overstory", "Place a hold on Project Hail Mary"],
  grocer: ["Add two oat milks to my basket and place the order", "Remove the bananas from my basket"],
};
const ROLE_NAMES = { planner: "Nemotron 3 Ultra", actor: "Nemotron 3.5 Super VL", vision: "Nemotron 3.5 Super VL", guard: "Nemotron 3.5 Lightning" };
const ROLE_JOBS = { planner: "plans and checks", actor: "picks each step", vision: "reads the pixels", guard: "screens the page" };

let ws;
let currentSite = null;
let pendingKind = null;
let before = [];
let after = [];
const trace = [];

const userId = (() => {
  try {
    let id = localStorage.getItem("errand-user");
    if (!id) { id = crypto.randomUUID().replace(/-/g, ""); localStorage.setItem("errand-user", id); }
    return id;
  } catch { return crypto.randomUUID().replace(/-/g, ""); }
})();

function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => send({ type: "hello", userId });
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => { log("Connection lost. Reconnecting.", "err"); setTimeout(connect, 1500); };
}
const send = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));

function handle(m) {
  switch (m.type) {
    case "ready": renderSites(m.sites); break;
    case "frame": $("screen").src = `data:image/jpeg;base64,${m.data}`; $("empty").hidden = true; break;
    case "url": $("url").textContent = m.url.replace(/^https?:\/\/[^/]+/, ""); break;
    case "opened":
      before = m.controls; after = [];
      renderHear();
      log(`Opened ${m.title}. ${m.unnamed} controls here have no usable name for a screen reader.`);
      break;
    case "labelled":
      after = m.controls; renderHear();
      break;
    case "controls": after = m.controls; renderHear(); break;
    case "say": log(m.text); speak(m.text); break;
    case "ask": showAsk(m.kind, m.prompt); speak(m.prompt); break;
    case "event": onEvent(m.event); break;
    case "trace": trace.push(m.entry); renderTrace(); break;
    case "secure-ok": $("secureInput").value = ""; break;
    case "error": log(m.text, "err"); speak(m.text); break;
  }
}

function onEvent(e) {
  if (e.type === "plan") log(`Plan${e.fromMemory ? " (from memory)" : ""}: ${e.steps.join(" → ")}`);
  if (e.type === "repair") send({ type: "controls" });
  if (e.type === "guard" && e.flagged) log(`Blocked page text: "${(e.removed[0] ?? "").slice(0, 140)}"`, "err");
  if (e.type === "done") {
    hideAsk();
    log(`${e.success ? "Done" : "Not finished"}: ${e.summary} (${e.steps} steps, ${(e.ms / 1000).toFixed(1)} s, $${e.usd.toFixed(4)})`, e.success ? "ok" : "err");
    send({ type: "controls" });
  }
}

function renderSites(sites) {
  const list = $("siteList");
  list.replaceChildren();
  for (const s of sites) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "site"; b.setAttribute("aria-pressed", "false");
    b.innerHTML = `<strong></strong><span></span>`;
    b.querySelector("strong").textContent = s.name;
    b.querySelector("span").textContent = s.kind;
    b.onclick = () => {
      currentSite = s.id;
      for (const x of list.children) x.setAttribute("aria-pressed", String(x === b));
      send({ type: "open", site: s.id });
      renderSuggestions();
    };
    list.append(b);
  }
  renderSuggestions();
}

function renderSuggestions() {
  const box = $("suggestions");
  box.replaceChildren();
  const items = currentSite ? SUGGESTIONS[currentSite] : ["Open a site first, then pick an errand"];
  for (const text of items) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "suggestion"; b.textContent = text;
    b.disabled = !currentSite;
    b.onclick = () => goal(text);
    box.append(b);
  }
}

function goal(text) {
  if (!text.trim()) return;
  if (!currentSite) { log("Open one of the test sites first.", "err"); return; }
  log(text, "you");
  send({ type: "goal", text, baseline: $("baseline").checked });
}

function log(text, cls = "") {
  const li = document.createElement("li");
  if (cls) li.className = cls;
  li.textContent = text;
  $("log").append(li);
  $("log").scrollTop = $("log").scrollHeight;
}

// Spoken output. Screen reader users may prefer their own voice, which reads the
// live log region; they can turn this off.
function speak(text) {
  if (!$("voiceOut").checked || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

function showAsk(kind, prompt) {
  pendingKind = kind;
  $("askText").textContent = prompt;
  $("askConfirm").hidden = kind !== "confirm";
  $("askAnswer").hidden = kind !== "question";
  $("secureForm").hidden = kind !== "handoff";
  $("askBox").hidden = false;
  (kind === "confirm" ? $("yesBtn") : kind === "question" ? $("answerInput") : $("secureInput")).focus();
}
function hideAsk() { $("askBox").hidden = true; pendingKind = null; }
function answer(text) { log(text, "you"); send({ type: "answer", text }); hideAsk(); }

$("yesBtn").onclick = () => answer("yes");
$("noBtn").onclick = () => answer("no");
$("askAnswer").onsubmit = (e) => { e.preventDefault(); answer($("answerInput").value); $("answerInput").value = ""; };
$("secureForm").onsubmit = (e) => { e.preventDefault(); send({ type: "secure", text: $("secureInput").value }); log("(You typed into the secure box.)", "you"); };
$("handoffDone").onclick = () => answer("done");
$("goalForm").onsubmit = (e) => { e.preventDefault(); goal($("goalInput").value); $("goalInput").value = ""; };
$("labelBtn").onclick = () => { if (!currentSite) return log("Open one of the test sites first.", "err"); log("Make this page readable", "you"); send({ type: "label" }); };
$("stopBtn").onclick = () => { send({ type: "stop" }); hideAsk(); };
$("forgetBtn").onclick = () => send({ type: "forget" });

// What a screen reader would announce, in page order.
function announce(c) {
  const name = c.name && !/^(button|link)$/i.test(c.name) ? c.name : "";
  const role = c.role === "generic" ? "" : c.role;
  return name ? `${name}, ${role || "clickable"}` : role || "(silent: a screen reader skips this)";
}
function renderHear() {
  const fill = (ol, list, compare) => {
    ol.replaceChildren();
    for (const c of list) {
      const li = document.createElement("li");
      li.textContent = announce(c);
      const unnamed = !c.name || /^(button|link)$/i.test(c.name) || c.role === "generic";
      if (unnamed) li.className = "bad";
      else if (compare) {
        const old = before.find((b) => b.id === c.id);
        if (old && announce(old) !== announce(c)) li.className = "fixed";
      }
      ol.append(li);
    }
  };
  fill($("beforeList"), before, false);
  fill($("afterList"), after, true);
  const bad = (l) => l.filter((c) => !c.name || /^(button|link)$/i.test(c.name) || c.role === "generic").length;
  $("hearSummary").textContent = after.length
    ? `Before: ${bad(before)} of ${before.length} controls unusable by ear. After: ${bad(after)} of ${after.length}.`
    : before.length ? `${bad(before)} of ${before.length} controls are unusable by ear.` : "";
}
function playList(list) {
  speechSynthesis.cancel();
  for (const c of list.slice(0, 14)) {
    const u = new SpeechSynthesisUtterance(announce(c).replace("(silent: a screen reader skips this)", "…"));
    u.rate = 1.25;
    speechSynthesis.speak(u);
  }
}
$("playBefore").onclick = () => playList(before);
$("playAfter").onclick = () => playList(after.length ? after : before);

function renderTrace() {
  const rows = $("traceRows");
  const t = trace[trace.length - 1];
  const tr = document.createElement("tr");
  const color = `var(--${t.role})`;
  tr.innerHTML = `<td><span class="dot" style="background:${color}"></span></td><td></td><td>${(t.ms / 1000).toFixed(2)} s</td><td>${t.inputTokens + t.outputTokens}</td><td>$${t.usd.toFixed(5)}</td>`;
  tr.children[0].append(t.model.split("/").pop());
  tr.children[1].textContent = t.purpose + (t.ok ? "" : " (failed)");
  rows.append(tr);
  rows.scrollTop = rows.scrollHeight;
  const sum = (f) => trace.reduce((a, x) => a + f(x), 0);
  $("tTime").textContent = `${(sum((x) => x.ms) / 1000).toFixed(1)} s`;
  $("tTok").textContent = String(sum((x) => x.inputTokens + x.outputTokens));
  $("tCost").textContent = `$${sum((x) => x.usd).toFixed(4)}`;
  const lanes = $("lanes");
  lanes.replaceChildren();
  const total = sum((x) => x.ms) || 1;
  for (const role of ["planner", "vision", "guard", "actor"]) {
    const mine = trace.filter((x) => x.role === role && !x.model.startsWith("tavily"));
    const ms = mine.reduce((a, x) => a + x.ms, 0);
    const lane = document.createElement("div");
    lane.className = "lane";
    lane.innerHTML = `<span><span class="dot" style="background:var(--${role})"></span></span><div class="lane-bar" aria-hidden="true"><span style="width:${(ms / total) * 100}%;background:var(--${role})"></span></div><span class="num">${mine.length} calls</span>`;
    lane.firstChild.append(`${ROLE_NAMES[role]}: ${ROLE_JOBS[role]}`);
    lanes.append(lane);
  }
}

// Tabs with arrow-key support.
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  }
  tab.focus();
}
for (const t of tabs) {
  t.onclick = () => selectTab(t);
  t.onkeydown = (e) => {
    const i = tabs.indexOf(t);
    if (e.key === "ArrowRight") selectTab(tabs[(i + 1) % tabs.length]);
    if (e.key === "ArrowLeft") selectTab(tabs[(i - 1 + tabs.length) % tabs.length]);
  };
}

// Push to talk: hold the button or the Space bar (when not typing).
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function startListening() {
  if (!Recognition) { $("micLabel").textContent = "Voice needs Chrome. Type below."; return; }
  if (rec) return;
  speechSynthesis.cancel();
  rec = new Recognition();
  rec.lang = navigator.language || "en-US";
  rec.interimResults = false;
  rec.onresult = (e) => {
    const text = e.results[0][0].transcript;
    if (pendingKind === "confirm" || pendingKind === "question") answer(text);
    else if (pendingKind === "handoff" && /done|carry on|continue/i.test(text)) answer("done");
    else goal(text);
  };
  rec.onend = () => { rec = null; $("micBtn").classList.remove("listening"); $("micLabel").textContent = "Hold to talk"; };
  rec.start();
  $("micBtn").classList.add("listening");
  $("micLabel").textContent = "Listening";
}
function stopListening() { rec?.stop(); }
$("micBtn").addEventListener("pointerdown", startListening);
$("micBtn").addEventListener("pointerup", stopListening);
$("micBtn").addEventListener("pointerleave", stopListening);
const typing = () => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
addEventListener("keydown", (e) => { if (e.code === "Space" && !e.repeat && !typing() && document.activeElement?.tagName !== "BUTTON") { e.preventDefault(); startListening(); } });
addEventListener("keyup", (e) => { if (e.code === "Space" && !typing()) stopListening(); });

try { if (!localStorage.getItem("errand-intro")) { $("intro").showModal(); localStorage.setItem("errand-intro", "1"); } } catch { $("intro").showModal(); }
connect();
