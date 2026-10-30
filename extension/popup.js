const status = document.getElementById("status");
const server = document.getElementById("server");

chrome.storage.local.get("server").then((s) => { server.value = s.server ?? ""; });
server.addEventListener("change", () => chrome.storage.local.set({ server: server.value.trim().replace(/\/$/, "") }));

document.getElementById("go").addEventListener("click", async () => {
  status.textContent = "Looking at the page…";
  const res = await chrome.runtime.sendMessage({ type: "label" });
  if (res?.error) status.textContent = `Problem: ${res.error}`;
  else if (!res?.found) status.textContent = "Every control on screen already has a name.";
  else status.textContent = `Named ${res.labelled} of ${res.found} controls. Your screen reader will read them now.`;
});
