const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQtmYbiCts4N-LbpYey3tIsLcXhFDOYwiz-58cFaF50BE5I7lP8qifuXxb1jP7_SsyyfoDW1z3ioLNq/pub?gid=1879882486&single=true&output=csv";

const REFRESH_ALARM = "refresh-blocklist";
const REFRESH_INTERVAL_MINUTES = 360;

async function notifyYouTubeTabs() {
  const tabs = await browser.tabs.query({ url: "*://www.youtube.com/*" });
  for (const tab of tabs) {
    browser.tabs.sendMessage(tab.id, { type: "BLOCKLIST_UPDATED" }).catch(() => {});
  }
}

async function fetchAndCacheBlocklist() {
  const response = await fetch(SHEET_CSV_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  const { blocklist, channelNames, adVideoIds } = parseChannelsFromCSV(text);

  if (blocklist.length === 0) {
    throw new Error("Список каналов пуст");
  }

  await browser.storage.local.set({
    blocklist,
    channelNames,
    adVideoIds,
    channelCount: blocklist.length,
    adVideoCount: adVideoIds.length,
    lastUpdated: Date.now(),
  });

  await notifyYouTubeTabs();
  return { channelCount: blocklist.length, adVideoCount: adVideoIds.length };
}

async function refreshBlocklist() {
  try {
    const counts = await fetchAndCacheBlocklist();
    console.info(
      `[Alabuga Blocker] Обновлено каналов: ${counts.channelCount}, видео: ${counts.adVideoCount}`
    );
    return { ok: true, count: counts.channelCount, ...counts };
  } catch (err) {
    console.warn("[Alabuga Blocker] Ошибка обновления:", err.message);
    const stored = await browser.storage.local.get(["blocklist", "adVideoIds"]);
    return {
      ok: false,
      error: err.message,
      count: stored.blocklist?.length ?? 0,
      channelCount: stored.blocklist?.length ?? 0,
      adVideoCount: stored.adVideoIds?.length ?? 0,
    };
  }
}

async function ensureDefaults() {
  const stored = await browser.storage.local.get([
    "enabled",
    "blocklist",
    "channelNames",
    "adVideoIds",
  ]);
  if (stored.enabled === undefined) {
    await browser.storage.local.set({ enabled: true });
  }
  if (!stored.blocklist?.length || !stored.channelNames?.length || !stored.adVideoIds?.length) {
    await refreshBlocklist();
  }
}

browser.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  browser.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_INTERVAL_MINUTES });
});

browser.runtime.onStartup.addListener(() => {
  refreshBlocklist();
});

ensureDefaults();
browser.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_INTERVAL_MINUTES });

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    refreshBlocklist();
  }
});

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "REFRESH_BLOCKLIST") {
    refreshBlocklist().then(sendResponse);
    return true;
  }

  if (message.type === "GET_STATUS") {
    browser.storage.local
      .get([
        "enabled",
        "blocklist",
        "channelNames",
        "adVideoIds",
        "channelCount",
        "adVideoCount",
        "lastUpdated",
      ])
      .then(sendResponse);
    return true;
  }

  if (message.type === "SET_ENABLED") {
    browser.storage.local.set({ enabled: message.enabled }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
});
