const enabledToggle = document.getElementById("enabled-toggle");
const channelCountEl = document.getElementById("channel-count");
const adVideoCountEl = document.getElementById("ad-video-count");
const lastUpdatedEl = document.getElementById("last-updated");
const refreshBtn = document.getElementById("refresh-btn");
const statusMsg = document.getElementById("status-msg");

function formatDate(timestamp) {
  if (!timestamp) return "—";
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function showStatus(text, type) {
  statusMsg.textContent = text;
  statusMsg.className = `status-msg ${type}`;
  statusMsg.hidden = false;
  setTimeout(() => {
    statusMsg.hidden = true;
  }, 3000);
}

async function loadStatus() {
  const data = await browser.runtime.sendMessage({ type: "GET_STATUS" });
  enabledToggle.checked = data.enabled !== false;
  channelCountEl.textContent = data.channelCount ?? data.blocklist?.length ?? "—";
  adVideoCountEl.textContent = data.adVideoCount ?? data.adVideoIds?.length ?? "—";
  lastUpdatedEl.textContent = formatDate(data.lastUpdated);
}

enabledToggle.addEventListener("change", async () => {
  await browser.runtime.sendMessage({
    type: "SET_ENABLED",
    enabled: enabledToggle.checked,
  });
});

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Обновление…";

  try {
    const result = await browser.runtime.sendMessage({ type: "REFRESH_BLOCKLIST" });
    await loadStatus();

    if (result.ok) {
      showStatus(`Список обновлён: ${result.count} каналов`, "ok");
    } else {
      showStatus(`Ошибка: ${result.error}`, "err");
    }
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Обновить список";
  }
});

loadStatus();
