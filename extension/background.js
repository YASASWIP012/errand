// Label pass for the current tab: find unnamed controls in the viewport, draw
// numbered boxes over them, take one screenshot, ask the Errand server to name
// them, then write the names into the page for the user's screen reader.

async function settings() {
  const s = await chrome.storage.local.get(["server", "userId"]);
  if (!s.userId) {
    s.userId = crypto.randomUUID().replace(/-/g, "");
    await chrome.storage.local.set({ userId: s.userId });
  }
  return { server: s.server || "http://localhost:8787", userId: s.userId };
}

async function inPage(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result;
}

function announce(text) {
  let live = document.getElementById("errand-live");
  if (!live) {
    live = document.createElement("div");
    live.id = "errand-live";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)";
    document.body.appendChild(live);
  }
  live.textContent = "";
  setTimeout(() => { live.textContent = text; }, 50);
}

export async function labelTab(tab) {
  const { server, userId } = await settings();
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["scan.js"] });
  const unnamed = (await inPage(tab.id, () => window.__errand.findUnnamed())) ?? [];
  const visible = unnamed.filter((u) => u.inViewport).slice(0, 40);
  if (!visible.length) {
    await inPage(tab.id, announce, ["Errand: every control on screen already has a name."]);
    return { labelled: 0, found: 0 };
  }
  await inPage(tab.id, announce, [`Errand found ${visible.length} unnamed controls. Reading them now.`]);
  await inPage(tab.id, (ids) => window.__errand.drawMarks(ids), [visible.map((v) => v.id)]);
  const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
  await inPage(tab.id, () => window.__errand.clearMarks());
  const origin = new URL(tab.url).host;
  let labels = [];
  try {
    const res = await fetch(`${server}/api/label`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, origin, title: tab.title ?? "", screenshot, unnamed: visible }),
    });
    if (!res.ok) throw new Error(`server said ${res.status}`);
    labels = (await res.json()).labels;
  } catch (err) {
    await inPage(tab.id, announce, [`Errand couldn't reach its server: ${err.message}.`]);
    return { labelled: 0, found: visible.length, error: err.message };
  }
  const applied = await inPage(tab.id, (ls) => window.__errand.applyLabels(ls), [labels]);
  await inPage(tab.id, announce, [`Errand named ${applied} of ${visible.length} controls on screen.`]);
  return { labelled: applied, found: visible.length, labels };
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "label-page") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await labelTab(tab);
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "label") return;
  chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
    reply(tab?.id ? await labelTab(tab) : { error: "no tab" });
  });
  return true;
});
