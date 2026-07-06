const BADGE_TEXT = "Реклама Алабуги";
const CHANNEL_LABEL_TEXT = "рекламировал Алабугу";
const WARNING_TEXT =
  "Этот канал рекламировал «ОЭЗ Алабуга» или колледж «Алабуга Политех» (список Alabuga-War-Bloggers).";

let blocklist = new Set();
let nameBlocklist = new Set();
let adVideoList = new Set();
let enabled = true;
let scanTimer = null;
let warningBannerEl = null;
let observerStarted = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeChannelName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractChannelIdFromHref(href) {
  if (!href) return null;
  const match = href.match(CHANNEL_LINK_RE);
  return match ? match[1] : null;
}

function extractVideoIdFromHref(href) {
  if (!href) return null;

  try {
    const url = new URL(href, location.origin);
    const watchId = url.searchParams.get("v");
    if (watchId) return watchId;

    const pathMatch = url.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/);
    if (pathMatch) return pathMatch[1];

    if (url.hostname === "youtu.be") {
      const shortMatch = url.pathname.match(/^\/([\w-]{11})/);
      if (shortMatch) return shortMatch[1];
    }
  } catch (_) {}

  const fallbackMatch = href.match(/(?:v=|\/shorts\/|\/embed\/|youtu\.be\/)([\w-]{11})/);
  return fallbackMatch ? fallbackMatch[1] : null;
}

function extractVideoIdFromElement(element) {
  const link = element.querySelector(
    'a#thumbnail[href], a[href*="/watch"][href], a[href*="/shorts/"][href], a[href*="youtu.be/"][href]'
  );
  return extractVideoIdFromHref(link?.href || link?.getAttribute("href"));
}

function extractChannelInfoFromElement(element) {
  let channelId = null;
  let channelName = null;

  const channelNameRoot =
    element.querySelector("ytd-channel-name") ||
    element.querySelector("#channel-name") ||
    element.querySelector("ytm-badge-and-byline-renderer");

  if (channelNameRoot) {
    const link = channelNameRoot.querySelector('a[href*="/channel/"], a[href^="/@"]');
    if (link) {
      if (link.href.includes("/channel/")) {
        channelId = extractChannelIdFromHref(link.href);
      }
      const text = link.textContent?.trim();
      if (text && !text.startsWith("@")) {
        channelName = text;
      }
    }

    if (!channelName) {
      const nameEl = channelNameRoot.querySelector(
        "#text, yt-formatted-string, .ytd-channel-name"
      );
      if (nameEl?.textContent?.trim()) {
        channelName = nameEl.textContent.trim();
      }
    }
  }

  if (!channelId) {
    const channelLink = element.querySelector('a[href*="/channel/UC"]');
    if (channelLink) {
      channelId = extractChannelIdFromHref(channelLink.href);
    }
  }

  return { channelId, channelName };
}

function isChannelBlocked({ channelId, channelName }) {
  if (channelId && blocklist.has(channelId)) return true;
  if (channelName && nameBlocklist.has(normalizeChannelName(channelName))) return true;
  return false;
}

function isAdVideo(videoId) {
  return !!videoId && adVideoList.has(videoId);
}

function findThumbnail(element) {
  return (
    element.querySelector("ytd-thumbnail") ||
    element.querySelector("ytm-media-item-thumbnail-container") ||
    element.querySelector("a#thumbnail") ||
    null
  );
}

function findThumbnailImage(element, thumbnail) {
  return (
    thumbnail?.querySelector("img") ||
    element.querySelector("ytd-thumbnail img") ||
    element.querySelector("a#thumbnail img") ||
    element.querySelector("ytm-media-item-thumbnail-container img") ||
    null
  );
}

function ensureThumbnailFrame(host) {
  const existingFrame = Array.from(host.children).find((child) =>
    child.classList?.contains("alabuga-marked-thumbnail-frame")
  );
  if (existingFrame) return existingFrame;

  const frame = document.createElement("div");
  frame.className = "alabuga-marked-thumbnail-frame";
  host.appendChild(frame);
  return frame;
}

function positionThumbnailVisuals(frame, badge, image, host) {
  if (!host) return;

  const hostRect = host.getBoundingClientRect();
  const imageRect = image?.getBoundingClientRect();
  const targetRect = imageRect?.width && imageRect?.height ? imageRect : hostRect;
  const top = Math.max(0, targetRect.top - hostRect.top);
  const left = Math.max(0, targetRect.left - hostRect.left);

  if (frame) {
    frame.style.top = `${top}px`;
    frame.style.left = `${left}px`;
    frame.style.width = `${targetRect.width}px`;
    frame.style.height = `${targetRect.height}px`;
  }

  if (badge) {
    badge.style.top = `${top + 8}px`;
    badge.style.left = `${left + 8}px`;
  }
}

function scheduleThumbnailVisualsUpdate(frame, badge, image, host) {
  positionThumbnailVisuals(frame, badge, image, host);
  requestAnimationFrame(() => positionThumbnailVisuals(frame, badge, image, host));
  setTimeout(() => positionThumbnailVisuals(frame, badge, image, host), 300);
}

function updateMarkedElementVisuals(element) {
  const thumbnail = findThumbnail(element);
  const image = findThumbnailImage(element, thumbnail);
  const badge = element.querySelector(".alabuga-ad-badge");

  if (!thumbnail) return;

  thumbnail.classList.add("alabuga-marked-thumbnail", "alabuga-thumbnail-badge-host");

  element.querySelectorAll(".alabuga-marked-thumbnail-frame").forEach((frame) => {
    if (frame.parentElement !== thumbnail || frame.tagName !== "DIV") {
      frame.classList.remove("alabuga-marked-thumbnail-frame");
    }
  });

  const frame = ensureThumbnailFrame(thumbnail);

  scheduleThumbnailVisualsUpdate(frame, badge, image, thumbnail);
}

function updateAllMarkedVisuals() {
  document.querySelectorAll("[data-alabuga-video-marked]").forEach(updateMarkedElementVisuals);
}

function findChannelLabelTarget(element) {
  const root =
    element.querySelector("ytd-channel-name") ||
    element.querySelector("#channel-name") ||
    element.querySelector("ytm-badge-and-byline-renderer") ||
    element;

  const target =
    root.querySelector('a[href*="/channel/"], a[href^="/@"]') ||
    root.querySelector("#text, yt-formatted-string, .ytd-channel-name") ||
    root;

  return { root, target };
}

function addChannelLabel(element) {
  const { root, target } = findChannelLabelTarget(element);
  if (!root || root.querySelector(".alabuga-channel-label")) return;

  const label = document.createElement("span");
  label.className = "alabuga-channel-label";
  label.textContent = CHANNEL_LABEL_TEXT;
  target.insertAdjacentElement("afterend", label);
}

function clearChannelMark(element) {
  element.classList.remove("alabuga-marked-channel");
  delete element.dataset.alabugaChannelMarked;
  element.querySelectorAll(".alabuga-channel-label").forEach((label) => label.remove());
}

function clearAdVideoMark(element) {
  element.classList.remove("alabuga-marked-card");
  delete element.dataset.alabugaVideoMarked;
  delete element.dataset.alabugaMarked;
  element.querySelectorAll(".alabuga-marked-thumbnail").forEach((thumbnail) => {
    thumbnail.classList.remove("alabuga-marked-thumbnail");
  });
  element.querySelectorAll(".alabuga-marked-thumbnail-frame").forEach((frame) => {
    if (frame.tagName === "DIV") {
      frame.remove();
    } else {
      frame.classList.remove("alabuga-marked-thumbnail-frame");
    }
  });
  element.querySelectorAll(".alabuga-thumbnail-badge-host").forEach((thumbnail) => {
    thumbnail.classList.remove("alabuga-thumbnail-badge-host");
  });
  element.querySelector(".alabuga-ad-badge")?.remove();
  element.querySelector(".alabuga-ad-label")?.remove();
}

function markChannelElement(element) {
  try {
    element.classList.add("alabuga-marked-channel");
    element.dataset.alabugaChannelMarked = "1";
    addChannelLabel(element);
  } catch (err) {
    console.warn("[Alabuga Blocker] markChannelElement:", err);
  }
}

function markAdVideoElement(element) {
  try {
    if (element.dataset.alabugaVideoMarked) {
      updateMarkedElementVisuals(element);
      return;
    }

    element.classList.add("alabuga-marked-card");
    element.dataset.alabugaVideoMarked = "1";

    const thumbnail = findThumbnail(element);
    const image = findThumbnailImage(element, thumbnail);

    if (thumbnail && !element.querySelector(".alabuga-ad-badge")) {
      thumbnail.classList.add("alabuga-marked-thumbnail", "alabuga-thumbnail-badge-host");
      const frame = ensureThumbnailFrame(thumbnail);
      const badge = document.createElement("div");
      badge.className = "alabuga-ad-badge";
      badge.innerHTML = `<span class="alabuga-ad-badge__icon">!</span><span>${BADGE_TEXT}</span>`;
      thumbnail.appendChild(badge);
      scheduleThumbnailVisualsUpdate(frame, badge, image, thumbnail);

      if (image && !image.complete) {
        image.addEventListener(
          "load",
          () => {
            scheduleThumbnailVisualsUpdate(frame, badge, image, thumbnail);
          },
          { once: true }
        );
      }
    }

    updateMarkedElementVisuals(element);
  } catch (err) {
    console.warn("[Alabuga Blocker] markAdVideoElement:", err);
  }
}

function unmarkAllCards() {
  document.querySelectorAll(
    "[data-alabuga-marked], [data-alabuga-channel-marked], [data-alabuga-video-marked]"
  ).forEach((el) => {
    clearChannelMark(el);
    clearAdVideoMark(el);
  });
}

function scanCards() {
  if (!enabled || (blocklist.size === 0 && nameBlocklist.size === 0 && adVideoList.size === 0)) return;
  if (!document.body) return;

  document.body.querySelectorAll(CARD_SELECTORS).forEach((card) => {
    const info = extractChannelInfoFromElement(card);
    const channelBlocked = isChannelBlocked(info);
    const videoAd = isAdVideo(extractVideoIdFromElement(card));

    if (channelBlocked) {
      markChannelElement(card);
    } else if (card.dataset.alabugaChannelMarked) {
      clearChannelMark(card);
    }

    if (videoAd) {
      markAdVideoElement(card);
    } else if (card.dataset.alabugaVideoMarked || card.dataset.alabugaMarked) {
      clearAdVideoMark(card);
    }
  });

  updateAllMarkedVisuals();
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scanCards, 200);
}

function getPageWindow() {
  return typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
}

function getChannelInfoFromPage() {
  const path = location.pathname;

  const channelMatch = path.match(/^\/channel\/(UC[\w-]+)/);
  if (channelMatch) {
    return { channelId: channelMatch[1], channelName: null };
  }

  if (path.startsWith("/watch")) {
    try {
      const player = getPageWindow().ytInitialPlayerResponse;
      if (player?.videoDetails?.channelId) {
        return { channelId: player.videoDetails.channelId, channelName: null };
      }
      if (player?.videoDetails?.author) {
        return { channelId: null, channelName: player.videoDetails.author };
      }
    } catch (_) {}

    const meta = document.querySelector('meta[itemprop="channelId"]');
    if (meta?.content) {
      return { channelId: meta.content, channelName: null };
    }

    const channelLink = document.querySelector(
      "ytd-video-owner-renderer ytd-channel-name a, #owner ytd-channel-name a"
    );
    if (channelLink) {
      const id = extractChannelIdFromHref(channelLink.href);
      if (id) return { channelId: id, channelName: null };
      const name = channelLink.textContent?.trim();
      if (name) return { channelId: null, channelName: name };
    }
  }

  if (path.match(/^\/@[^/]+/)) {
    try {
      const data = getPageWindow().ytInitialData;
      const id = data?.metadata?.channelMetadataRenderer?.externalId;
      if (id) return { channelId: id, channelName: null };
      const title = data?.metadata?.channelMetadataRenderer?.title;
      if (title) return { channelId: null, channelName: title };
    } catch (_) {}

    const channelNameEl = document.querySelector(
      "#channel-header ytd-channel-name #text, ytd-channel-name #text"
    );
    if (channelNameEl?.textContent?.trim()) {
      return { channelId: null, channelName: channelNameEl.textContent.trim() };
    }
  }

  return { channelId: null, channelName: null };
}

function removeWarningBanner() {
  if (warningBannerEl) {
    warningBannerEl.remove();
    warningBannerEl = null;
  }
}

function showWarningBanner(title) {
  try {
    removeWarningBanner();

    warningBannerEl = document.createElement("div");
    warningBannerEl.id = "alabuga-warning-banner";
    warningBannerEl.innerHTML = `
      <div class="alabuga-warning-banner__content">
        <span class="alabuga-warning-banner__icon">!</span>
        <div>
          <strong>${title}</strong>
          <p>${WARNING_TEXT}</p>
        </div>
      </div>
    `;

    const anchor =
      document.querySelector("#above-the-fold") ||
      document.querySelector("#primary-inner");

    if (anchor) {
      anchor.insertAdjacentElement("afterbegin", warningBannerEl);
    }
  } catch (err) {
    console.warn("[Alabuga Blocker] showWarningBanner:", err);
  }
}

function getCurrentVideoId() {
  if (location.pathname.startsWith("/watch")) {
    return extractVideoIdFromHref(location.href);
  }

  const shortsMatch = location.pathname.match(/^\/shorts\/([\w-]{11})/);
  return shortsMatch ? shortsMatch[1] : null;
}

function markCurrentPageChannel(channelBlocked) {
  const roots = document.querySelectorAll(
    "ytd-video-owner-renderer ytd-channel-name, #owner ytd-channel-name, #channel-header ytd-channel-name"
  );

  roots.forEach((root) => {
    if (channelBlocked) {
      addChannelLabel(root);
    } else {
      root.querySelectorAll(".alabuga-channel-label").forEach((label) => label.remove());
    }
  });
}

function checkCurrentPage() {
  if (!enabled || (blocklist.size === 0 && nameBlocklist.size === 0 && adVideoList.size === 0)) {
    removeWarningBanner();
    markCurrentPageChannel(false);
    return;
  }

  const info = getChannelInfoFromPage();
  const channelBlocked = isChannelBlocked(info);
  markCurrentPageChannel(channelBlocked);

  const currentVideoId = getCurrentVideoId();
  if (isAdVideo(currentVideoId)) {
    showWarningBanner(`В этом ролике — ${BADGE_TEXT.toLowerCase()}`);
  } else {
    removeWarningBanner();
  }
}

function onNavigate() {
  checkCurrentPage();
  scheduleScan();
}

async function applyStorage(data) {
  blocklist = new Set(data.blocklist || []);
  nameBlocklist = new Set(data.channelNames || []);
  adVideoList = new Set(data.adVideoIds || []);
  enabled = data.enabled !== false;
}

async function loadState() {
  const data = await browser.storage.local.get([
    "blocklist",
    "channelNames",
    "adVideoIds",
    "enabled",
  ]);
  await applyStorage(data);
  return blocklist.size > 0 || nameBlocklist.size > 0 || adVideoList.size > 0;
}

async function ensureStateLoaded() {
  for (let attempt = 0; attempt < 12; attempt++) {
    const loaded = await loadState();
    if (loaded) return true;

    try {
      await browser.runtime.sendMessage({ type: "REFRESH_BLOCKLIST" });
    } catch (_) {}

    await sleep(500);
  }

  return blocklist.size > 0 || nameBlocklist.size > 0 || adVideoList.size > 0;
}

function initObserver() {
  if (observerStarted || !document.body) return;
  observerStarted = true;

  const observer = new MutationObserver(() => {
    scheduleScan();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function initNavigationListener() {
  window.addEventListener("yt-navigate-finish", onNavigate);
  window.addEventListener("popstate", onNavigate);
  window.addEventListener("pageshow", onNavigate);
  window.addEventListener("resize", updateAllMarkedVisuals);
}

function initDelayedScans() {
  [500, 1500, 3000, 6000].forEach((delay) => {
    setTimeout(() => {
      onNavigate();
    }, delay);
  });
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.blocklist || changes.channelNames || changes.adVideoIds) {
    if (changes.blocklist) {
      blocklist = new Set(changes.blocklist.newValue || []);
    }
    if (changes.channelNames) {
      nameBlocklist = new Set(changes.channelNames.newValue || []);
    }
    if (changes.adVideoIds) {
      adVideoList = new Set(changes.adVideoIds.newValue || []);
    }
    unmarkAllCards();
    scheduleScan();
    checkCurrentPage();
  }

  if (changes.enabled) {
    enabled = changes.enabled.newValue !== false;
    if (!enabled) {
      removeWarningBanner();
      unmarkAllCards();
    } else {
      scheduleScan();
      checkCurrentPage();
    }
  }
});

browser.runtime.onMessage.addListener((message) => {
  if (message.type === "BLOCKLIST_UPDATED") {
    loadState().then(() => {
      scheduleScan();
      checkCurrentPage();
    });
  }
});

async function init() {
  try {
    await ensureStateLoaded();
    initObserver();
    initNavigationListener();
    onNavigate();
    initDelayedScans();
  } catch (err) {
    console.error("[Alabuga Blocker] init failed:", err);
  }
}

if (document.body) {
  init();
} else {
  document.addEventListener("DOMContentLoaded", init);
}
