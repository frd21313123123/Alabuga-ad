const BADGE_TEXT = "Реклама Алабуги";
const CHANNEL_LABEL_TEXT = "рекламировал Алабугу Политех";
const WARNING_TEXT =
  "Этот канал рекламировал «ОЭЗ Алабуга» или колледж «Алабуга Политех» (список Alabuga-War-Bloggers).";

let blocklist = new Set();
let nameBlocklist = new Set();
let adVideoList = new Set();
let enabled = true;
let scanTimer = null;
let warningBannerEl = null;
let observerStarted = false;

const PAGE_HEADER_SCOPE_SELECTORS = [
  "yt-page-header-renderer",
  "yt-page-header-view-model",
  "ytd-page-header-renderer",
  "ytd-c4-tabbed-header-renderer",
  "#channel-header",
  "#page-header",
  "#page-header-container",
].join(",");

const CHANNEL_SURFACE_SELECTORS = [
  "ytd-miniplayer",
  "ytd-miniplayer-info-bar",
  "ytd-video-owner-renderer",
  "#owner",
  "ytd-watch-metadata",
  "ytd-channel-renderer",
  "ytd-grid-channel-renderer",
  "yt-lockup-metadata-view-model",
].join(",");

const CHANNEL_INFO_ROOT_SELECTORS = [
  "ytd-channel-name",
  "#channel-name",
  "ytm-badge-and-byline-renderer",
  "ytd-video-owner-renderer",
  "ytd-miniplayer",
  "ytd-miniplayer-info-bar",
  "yt-page-header-renderer",
  "yt-page-header-view-model",
  "ytd-page-header-renderer",
  "ytd-c4-tabbed-header-renderer",
  "#channel-header",
  "#page-header",
  "#page-header-container",
  "#owner",
  "#text-container",
  "#info-section",
  "yt-lockup-view-model",
  "yt-lockup-metadata-view-model",
  "yt-content-metadata-view-model",
  "yt-dynamic-text-view-model",
].join(",");

const CHANNEL_LABEL_SCOPE_SELECTORS = [
  CARD_SELECTORS,
  "ytd-video-owner-renderer",
  "ytd-miniplayer",
  "ytd-miniplayer-info-bar",
  "yt-page-header-renderer",
  "yt-page-header-view-model",
  "ytd-page-header-renderer",
  "ytd-c4-tabbed-header-renderer",
  "#channel-header",
  "#page-header",
  "#page-header-container",
  "#owner",
  "yt-lockup-view-model",
  "yt-lockup-metadata-view-model",
  "yt-content-metadata-view-model",
].join(",");

const CHANNEL_LABEL_ROOT_SELECTORS = [
  "ytd-channel-name",
  "#channel-name",
  "ytm-badge-and-byline-renderer",
  "yt-dynamic-text-view-model",
  "h1",
  "#page-header h1",
  "#page-header-container h1",
  "#text-container",
  "#info-section",
  'a[href^="/@"]',
  'a[href*="/@"]',
  'a[href*="/channel/UC"]',
].join(",");

const CHANNEL_LABEL_TEXT_SELECTORS = [
  "ytd-channel-name #text",
  "#channel-name #text",
  "yt-formatted-string#text",
  "yt-formatted-string",
  "h1 .ytAttributedStringHost",
  "h1 .yt-core-attributed-string",
  "h1",
  ".yt-core-attributed-string",
  ".ytAttributedStringHost",
  "yt-dynamic-text-view-model",
  'a[href^="/@"]',
  'a[href*="/@"]',
  'a[href*="/channel/UC"]',
].join(",");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectSearchRoots(root = document) {
  const roots = [];
  const queue = [];
  const seen = new Set();

  function enqueue(node) {
    if (!node || seen.has(node)) return;
    seen.add(node);
    roots.push(node);
    queue.push(node);
  }

  enqueue(root);
  if (root instanceof Element && root.shadowRoot) {
    enqueue(root.shadowRoot);
  }

  while (queue.length) {
    const current = queue.shift();
    const elements = current.querySelectorAll?.("*") || [];

    elements.forEach((element) => {
      if (element.shadowRoot) enqueue(element.shadowRoot);
    });
  }

  return roots;
}

function deepClosest(element, selector) {
  let current = element;

  while (current) {
    if (current instanceof Element && current.matches?.(selector)) {
      return current;
    }

    if (current.parentElement) {
      current = current.parentElement;
      continue;
    }

    const root = current.getRootNode?.();
    if (root instanceof ShadowRoot && root.host) {
      current = root.host;
      continue;
    }

    break;
  }

  return null;
}

function deepQuerySelector(selector, root = document) {
  for (const searchRoot of collectSearchRoots(root)) {
    const found = searchRoot.querySelector?.(selector);
    if (found) return found;
  }
  return null;
}

function deepQuerySelectorAll(selector, root = document) {
  const results = [];
  const seen = new Set();

  for (const searchRoot of collectSearchRoots(root)) {
    searchRoot.querySelectorAll?.(selector).forEach((element) => {
      if (seen.has(element)) return;
      seen.add(element);
      results.push(element);
    });
  }

  return results;
}

function deepQueryAllDocument(selector) {
  return deepQuerySelectorAll(selector, document.documentElement);
}

function isChannelHref(href) {
  if (!href) return false;

  try {
    const url = new URL(href, location.origin);
    const path = url.pathname;
    if (
      path.includes("/watch") ||
      path.includes("/shorts") ||
      path.includes("/playlist") ||
      path.includes("/results")
    ) {
      return false;
    }
    return (
      /\/channel\/UC[\w-]+/.test(path) ||
      /\/@[^/]+/.test(path) ||
      /\/c\/[^/]+/.test(path) ||
      /\/user\/[^/]+/.test(path)
    );
  } catch (_) {
    return /\/channel\/UC[\w-]+|\/@[^/?#]+|\/c\/|\/user\//.test(href);
  }
}

function getLinkHref(link) {
  return link?.href || link?.getAttribute?.("href") || "";
}

function safelyDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

function getCleanText(element) {
  return stripInjectedMarkerText(element?.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isElementVisible(element) {
  if (!(element instanceof Element)) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function getUploaderLinkScore(link, originalIndex = 0) {
  let score = -originalIndex;
  const text = getCleanText(link);

  if (isElementVisible(link)) score += 1000;
  if (text) score += 200;
  if (deepClosest(link, "#channel-info")) score += 80;
  if (deepClosest(link, "ytd-channel-name.long-byline")) score += 60;
  if (deepClosest(link, "#byline-container")) score += 30;
  if (link.id === "channel-thumbnail" || deepClosest(link, "#channel-thumbnail, #avatar")) {
    score -= 120;
  }

  return score;
}

function addPagePathChannelCandidates(channelNames) {
  const handleMatch = location.pathname.match(/^\/(@[^/?#]+)/);
  if (handleMatch) {
    addNormalizedChannelCandidate(channelNames, safelyDecodeURIComponent(handleMatch[1]));
  }
}

function ingestChannelLink(info, link) {
  if (!link) return info;

  const href = getLinkHref(link);
  if (!isChannelHref(href)) return info;

  const channelNames = new Set(info.channelNames || []);
  if (info.channelName) channelNames.add(normalizeChannelName(info.channelName));

  if (href.includes("/channel/")) {
    info.channelId = info.channelId || extractChannelIdFromHref(href);
  }

  const displayName = addNormalizedChannelCandidate(channelNames, link.textContent);
  addNormalizedChannelCandidate(channelNames, link.getAttribute?.("title"));
  addNormalizedChannelCandidate(channelNames, extractChannelNameFromAriaLabel(link.getAttribute?.("aria-label")));

  const handleMatch = href.match(/\/(@[^/?#]+)/);
  if (handleMatch) {
    addNormalizedChannelCandidate(channelNames, safelyDecodeURIComponent(handleMatch[1]));
  }

  info.channelNames = channelNames;
  if (!info.channelName) {
    if (displayName && !displayName.startsWith("@")) {
      info.channelName = displayName;
    }
  }

  return info;
}

function extractChannelNameFromAriaLabel(label) {
  const text = stripInjectedMarkerText(label).trim();
  if (!text) return "";

  const quotedMatch = text.match(/[«"“](.+?)[»"”]/);
  if (quotedMatch?.[1]) return quotedMatch[1];

  return text
    .replace(/^(перейти|go)\s+(на|to)\s+(канал|channel)\s*/i, "")
    .trim();
}

function findUploaderLinks(element) {
  const prioritySelectors = [
    "ytd-channel-name a[href]",
    "#channel-name a[href]",
    "#byline-container a[href]",
    "#metadata-line a[href]",
    "ytm-badge-and-byline-renderer a[href]",
    "yt-content-metadata-view-model a[href]",
    "yt-lockup-metadata-view-model a[href]",
    "ytd-video-meta-block a[href]",
    "a[href]",
  ];
  const links = [];
  const seen = new Set();

  prioritySelectors.forEach((selector) => {
    deepQuerySelectorAll(selector, element).forEach((link) => {
      if (seen.has(link) || !isChannelHref(getLinkHref(link))) return;
      seen.add(link);
      links.push(link);
    });
  });

  return links;
}

function findPrimaryUploaderLink(element) {
  return (
    findUploaderLinks(element)
      .map((link, index) => ({ link, score: getUploaderLinkScore(link, index) }))
      .sort((a, b) => b.score - a.score)[0]?.link || null
  );
}

function findUploaderLabelTarget(scope, uploaderLink) {
  if (!uploaderLink) return null;

  const textTarget =
    deepQuerySelector(
      "yt-formatted-string, #text, .yt-core-attributed-string, span",
      uploaderLink
    ) || uploaderLink;

  const root =
    deepClosest(
      uploaderLink,
      "ytd-channel-name, #channel-name, #byline-container, #metadata-line, yt-content-metadata-view-model, yt-lockup-metadata-view-model, ytm-badge-and-byline-renderer"
    ) || uploaderLink;

  const labelHost =
    deepClosest(
      uploaderLink,
      "#byline-container, #metadata-line, #channel-info, yt-lockup-metadata-view-model, ytd-video-meta-block"
    ) ||
    root.parentElement ||
    root;

  return { root, target: textTarget, labelHost };
}

function extractLockupChannelInfo(element, info) {
  const metadataRows = deepQuerySelectorAll("yt-content-metadata-view-model", element);
  if (metadataRows.length < 2) return info;

  for (let i = 1; i < metadataRows.length; i++) {
    const row = metadataRows[i];
    const link = deepQuerySelector('a[href*="/channel/"], a[href*="/@"]', row);
    if (link && isChannelHref(getLinkHref(link))) {
      info = ingestChannelLink(info, link);
      continue;
    }

    const rowText = stripInjectedMarkerText(row.textContent).trim();
    const channelText = rowText.split("•")[0]?.trim();
    if (channelText) {
      const rawText = addNormalizedChannelCandidate(info.channelNames, channelText);
      if (rawText && !info.channelName && !rawText.startsWith("@")) {
        info.channelName = rawText;
      }
    }
  }

  return info;
}

function isOnChannelPage() {
  return /^\/(channel\/UC[\w-]+|@[^/]+|c\/[^/]+|user\/[^/]+)/.test(location.pathname);
}

const FALLBACK_LABEL_HOST_SELECTORS = [
  "ytd-miniplayer-info-bar",
  "#info-bar",
  ".miniplayer-info-bar",
  "#owner-name",
  "ytd-channel-name",
  "#channel-name",
  "#byline-container",
  "#metadata-line",
  "yt-content-metadata-view-model",
  "yt-lockup-metadata-view-model",
  "h1",
].join(",");

function createChannelLabel(extraClass = "") {
  const label = document.createElement("span");
  label.className = ["alabuga-channel-label", extraClass].filter(Boolean).join(" ");
  label.textContent = CHANNEL_LABEL_TEXT;
  return label;
}

function resolveFallbackLabelHost(scope) {
  if (!(scope instanceof Element) && !(scope instanceof ShadowRoot)) return null;
  const preferred = deepQuerySelector(FALLBACK_LABEL_HOST_SELECTORS, scope);
  if (preferred) return preferred;
  return scope instanceof Element ? scope : scope.host || null;
}

function isPageHeaderElement(element) {
  if (!(element instanceof Element)) return false;
  return !!(
    element.matches?.(PAGE_HEADER_SCOPE_SELECTORS) ||
    deepClosest(element, PAGE_HEADER_SCOPE_SELECTORS)
  );
}

function isVideoCardScope(scope) {
  if (!(scope instanceof Element)) return false;
  return !!(
    scope.matches?.(CARD_SELECTORS) &&
    !isChannelCardScope(scope)
  );
}

function hasVideoLink(element) {
  return !!deepQuerySelector(
    'a[href*="/watch"], a[href*="/shorts/"], a[href*="youtu.be/"]',
    element
  );
}

function hasChannelLink(element) {
  return deepQuerySelectorAll("a[href]", element).some((link) => isChannelHref(getLinkHref(link)));
}

function hasSubscribeActionText(element) {
  return /(подписаться|subscribe)/i.test(getCleanText(element));
}

function isChannelCardScope(scope) {
  if (!(scope instanceof Element)) return false;
  if (scope.matches?.("ytd-channel-renderer, ytd-grid-channel-renderer")) return true;

  if (scope.matches?.("yt-lockup-view-model, ytd-rich-item-renderer")) {
    return !hasVideoLink(scope) && (hasChannelLink(scope) || hasSubscribeActionText(scope));
  }

  return false;
}

function addChannelNameCandidate(info, text) {
  const channelNames = new Set(info.channelNames || []);
  if (info.channelName) channelNames.add(normalizeChannelName(info.channelName));

  const rawText = addNormalizedChannelCandidate(channelNames, text);
  if (rawText && !info.channelName && !rawText.startsWith("@")) {
    info.channelName = rawText;
  }

  info.channelNames = channelNames;
  return rawText;
}

function addChannelUrlCandidate(info, href) {
  if (!href || !isChannelHref(href)) return info;

  const channelNames = new Set(info.channelNames || []);
  if (info.channelName) channelNames.add(normalizeChannelName(info.channelName));

  const channelId = extractChannelIdFromHref(href);
  if (channelId) info.channelId = info.channelId || channelId;

  const handleMatch = href.match(/\/(@[^/?#]+)/);
  if (handleMatch) {
    addNormalizedChannelCandidate(channelNames, safelyDecodeURIComponent(handleMatch[1]));
  }

  info.channelNames = channelNames;
  return info;
}

function extractChannelCardNameFromText(text) {
  const compactText = stripInjectedMarkerText(text).replace(/\s+/g, " ").trim();
  if (!compactText) return "";

  const subscriberMatch = compactText.match(
    /^(.+?)(?=\s*[\d\s.,]+(?:тыс\.?|млн|млрд|k|m|b)?\s*(?:подписчик|subscribers?))/i
  );
  if (subscriberMatch?.[1]) return subscriberMatch[1].trim();

  return compactText
    .replace(/\s+(?:подписаться|subscribe)\b.*$/i, "")
    .split(/[•|]/)[0]
    .trim();
}

function extractChannelInfoFromStructuredValue(info, value, depth = 0, seen = new Set()) {
  if (!value || depth > 4) return info;

  if (typeof value === "string") {
    if (/^UC[\w-]+$/.test(value)) {
      info.channelId = info.channelId || value;
      return info;
    }

    info = addChannelUrlCandidate(info, value);
    const handleMatch = value.match(/\/(@[^/?#]+)/);
    if (handleMatch) {
      addChannelNameCandidate(info, safelyDecodeURIComponent(handleMatch[1]));
    }
    return info;
  }

  if (typeof value !== "object" || seen.has(value)) return info;
  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    if (!child) continue;

    if (
      typeof child === "string" &&
      /^(browseId|channelId|externalId|webPageType|url|canonicalBaseUrl|vanityChannelUrl|simpleText|text|label)$/i.test(key)
    ) {
      if (/^(browseId|channelId|externalId)$/i.test(key) && /^UC[\w-]+$/.test(child)) {
        info.channelId = info.channelId || child;
      } else if (/^(url|canonicalBaseUrl|vanityChannelUrl)$/i.test(key)) {
        info = addChannelUrlCandidate(info, child);
      } else if (/^(simpleText|text|label)$/i.test(key)) {
        addChannelNameCandidate(info, extractChannelCardNameFromText(child) || child);
      }
      continue;
    }

    info = extractChannelInfoFromStructuredValue(info, child, depth + 1, seen);
  }

  return info;
}

function extractChannelInfoFromElementData(info, element) {
  const sources = [];
  const elements = getUniqueElements(
    [element],
    deepQuerySelectorAll("a, yt-lockup-view-model, yt-lockup-metadata-view-model, yt-button-view-model", element)
  );

  elements.slice(0, 40).forEach((node) => {
    ["data", "endpoint", "navigationEndpoint", "command", "urlEndpoint"].forEach((key) => {
      try {
        if (node[key]) sources.push(node[key]);
      } catch (_) {}
    });
  });

  sources.slice(0, 20).forEach((source) => {
    info = extractChannelInfoFromStructuredValue(info, source);
  });

  return info;
}

function getEnrichedPageChannelInfo() {
  let info = getChannelInfoFromPage();
  const channelNames = new Set(info.channelNames || []);
  if (info.channelName) channelNames.add(normalizeChannelName(info.channelName));
  addPagePathChannelCandidates(channelNames);

  if (!isOnChannelPage()) {
    return { ...info, channelNames };
  }

  try {
    const data = getPageWindow().ytInitialData;
    const metadata = data?.metadata?.channelMetadataRenderer;
    if (metadata?.externalId) info.channelId = info.channelId || metadata.externalId;
    if (metadata?.title) {
      addNormalizedChannelCandidate(channelNames, metadata.title);
      info.channelName = info.channelName || metadata.title;
    }
    if (metadata?.vanityChannelUrl) {
      const handleMatch = metadata.vanityChannelUrl.match(/\/(@[^/?#]+)/);
      if (handleMatch) {
        addNormalizedChannelCandidate(channelNames, safelyDecodeURIComponent(handleMatch[1]));
      }
    }
  } catch (_) {}

  info.channelId = info.channelId || extractChannelIdFromPageMetadata();
  info.channelNames = channelNames;
  return info;
}

function findPageHeaderLabelTarget(headerScope) {
  return (
    deepQuerySelector(
      "h1 .ytAttributedStringHost, h1 yt-dynamic-text-view-model, h1 .yt-core-attributed-string, h1",
      headerScope
    ) ||
    deepQuerySelector("ytd-channel-name #text, #channel-name #text, #text-container", headerScope) ||
    deepQuerySelector("ytd-channel-name, #channel-name", headerScope)
  );
}

function findPageHeaderLabelPlacement(headerScope) {
  const titleHost = deepQuerySelector(
    [
      "yt-dynamic-text-view-model.ytPageHeaderViewModelTitle",
      ".ytPageHeaderViewModelTitle",
      "h1.dynamicTextViewModelH1",
    ].join(","),
    headerScope
  );

  if (titleHost) {
    return {
      target:
        deepQuerySelector("h1 .ytAttributedStringHost, h1 .yt-core-attributed-string, h1", titleHost) ||
        titleHost,
      insertAfter: titleHost,
    };
  }

  const target = findPageHeaderLabelTarget(headerScope);
  return target ? { target, insertAfter: target } : null;
}

function getPageHeaderScopes() {
  const selectorGroups = [
    "yt-page-header-view-model",
    "yt-page-header-renderer",
    "ytd-page-header-renderer",
    "ytd-c4-tabbed-header-renderer",
    "#channel-header",
    "#page-header",
    "#page-header-container",
  ];

  for (const selector of selectorGroups) {
    const scopes = deepQueryAllDocument(selector);
    if (scopes.length) return getUniqueElements(scopes);
  }

  return [];
}

function getDocumentMetadataValue(selector, attribute) {
  return document.querySelector(selector)?.getAttribute(attribute) || "";
}

function extractChannelIdFromPageMetadata() {
  const directId = getDocumentMetadataValue('meta[itemprop="channelId"]', "content");
  if (/^UC[\w-]+$/.test(directId)) return directId;

  const pageUrls = [
    getDocumentMetadataValue('meta[property="og:url"]', "content"),
    getDocumentMetadataValue('meta[itemprop="url"]', "content"),
    getDocumentMetadataValue('link[rel="canonical"]', "href"),
    getDocumentMetadataValue('link[itemprop="url"]', "href"),
  ];

  for (const pageUrl of pageUrls) {
    const channelId = extractChannelIdFromHref(pageUrl);
    if (channelId) return channelId;
  }

  return null;
}

function stripInjectedMarkerText(text) {
  return (text || "")
    .replace(/рекламировал\s+Алабугу(?:\s+Политех)?/gi, "")
    .replace(BADGE_TEXT, "")
    .replace(CHANNEL_LABEL_TEXT, "");
}

function normalizeChannelName(name) {
  return stripInjectedMarkerText(name)
    .trim()
    .replace(/[✓✔︎]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
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

function getUniqueElements(...collections) {
  const elements = [];
  const seen = new Set();

  collections.flat().forEach((element) => {
    if (!element || seen.has(element)) return;
    seen.add(element);
    elements.push(element);
  });

  return elements;
}

function addNormalizedChannelCandidate(candidates, text) {
  const rawText = stripInjectedMarkerText(text).trim();
  const normalized = normalizeChannelName(rawText);
  if (!normalized) return null;
  if (!isLikelyChannelIdentity(rawText, normalized)) return null;

  candidates.add(normalized);

  if (rawText.startsWith("@")) {
    const handleWithoutAt = normalizeChannelName(rawText.slice(1));
    if (handleWithoutAt) candidates.add(handleWithoutAt);
  }

  return rawText;
}

function isLikelyChannelIdentity(rawText, normalized) {
  if (!normalized || normalized.length > 100) return false;

  return !(
    /[•\n\r]/.test(rawText) ||
    /https?:\/\//i.test(rawText) ||
    /(подписчик|подписаться|subscribers?|subscribe|просмотр|views?|видео|videos?|назад|ago)/i.test(normalized)
  );
}

function extractChannelInfoFromChannelCard(element, info) {
  const cardScope = isChannelCardScope(element) ? element : deepClosest(element, CARD_SELECTORS);
  if (!isChannelCardScope(cardScope)) return info;

  findUploaderLinks(cardScope).forEach((link) => {
    info = ingestChannelLink(info, link);
    addChannelNameCandidate(info, extractChannelNameFromAriaLabel(link.getAttribute?.("aria-label")));
    addChannelNameCandidate(info, link.getAttribute?.("title"));
  });

  deepQuerySelectorAll("img[alt]", cardScope).forEach((image) => {
    addChannelNameCandidate(info, image.getAttribute("alt"));
  });

  deepQuerySelectorAll(
    [
      "yt-lockup-metadata-view-model a[href]",
      "yt-lockup-metadata-view-model [role='heading']",
      "yt-lockup-metadata-view-model yt-attributed-string",
      "yt-lockup-metadata-view-model .ytAttributedStringHost",
      "yt-lockup-metadata-view-model .yt-core-attributed-string",
      "yt-lockup-metadata-view-model yt-formatted-string",
      "yt-lockup-metadata-view-model #text",
      "yt-dynamic-text-view-model",
      "yt-attributed-string",
      ".ytAttributedStringHost",
      ".yt-core-attributed-string",
      "ytd-channel-name #text",
      "#channel-name #text",
      "#text",
      "h3",
    ].join(","),
    cardScope
  ).forEach((nameEl) => {
    addChannelNameCandidate(info, nameEl.getAttribute?.("title"));
    addChannelNameCandidate(info, extractChannelNameFromAriaLabel(nameEl.getAttribute?.("aria-label")));
    addChannelNameCandidate(info, nameEl.textContent || "");
  });

  addChannelNameCandidate(info, extractChannelCardNameFromText(cardScope.textContent || ""));
  return extractChannelInfoFromElementData(info, cardScope);
}

function extractChannelInfoFromElement(element) {
  let info = { channelId: null, channelName: null, channelNames: new Set() };

  findUploaderLinks(element).forEach((link) => {
    info = ingestChannelLink(info, link);
  });

  const channelNameText = deepQuerySelector(
    "ytd-channel-name #text, #channel-name #text, #byline-container yt-formatted-string, ytd-video-meta-block yt-formatted-string",
    element
  );
  if (channelNameText) {
    const rawText = addNormalizedChannelCandidate(info.channelNames, channelNameText.textContent || "");
    if (rawText && !info.channelName && !rawText.startsWith("@")) {
      info.channelName = rawText;
    }
    addNormalizedChannelCandidate(info.channelNames, channelNameText.getAttribute?.("title"));
    addNormalizedChannelCandidate(info.channelNames, channelNameText.getAttribute?.("aria-label"));
  }

  info = extractChannelInfoFromChannelCard(element, info);
  info = extractLockupChannelInfo(element, info);

  const channelNameRoots = getUniqueElements(
    element.matches?.(CHANNEL_INFO_ROOT_SELECTORS) ? [element] : [],
    deepQuerySelectorAll(CHANNEL_INFO_ROOT_SELECTORS, element)
  );

  channelNameRoots.forEach((channelNameRoot) => {
    if (channelNameRoot.matches?.("a[href]") && isChannelHref(getLinkHref(channelNameRoot))) {
      info = ingestChannelLink(info, channelNameRoot);
      return;
    }

    deepQuerySelectorAll(
      "h1, yt-dynamic-text-view-model, #text, yt-formatted-string, .ytd-channel-name, .yt-core-attributed-string",
      channelNameRoot
    ).forEach((nameEl) => {
      const rawText = addNormalizedChannelCandidate(info.channelNames, nameEl.textContent || "");
      if (rawText && !info.channelName && !rawText.startsWith("@")) {
        info.channelName = rawText;
      }
      addNormalizedChannelCandidate(info.channelNames, nameEl.getAttribute?.("title"));
      addNormalizedChannelCandidate(info.channelNames, nameEl.getAttribute?.("aria-label"));
    });
  });

  return info;
}

function enrichFromPageChannelContext(info, element) {
  const cardScope = deepClosest(element, CARD_SELECTORS);
  if (!cardScope || !isOnChannelPage() || isChannelCardScope(cardScope)) return info;

  const pageInfo = getEnrichedPageChannelInfo();
  const channelNames = new Set(info.channelNames || []);
  if (info.channelName) channelNames.add(normalizeChannelName(info.channelName));
  if (pageInfo.channelName) channelNames.add(normalizeChannelName(pageInfo.channelName));
  (pageInfo.channelNames || []).forEach((name) => channelNames.add(name));

  return {
    channelId: info.channelId || pageInfo.channelId || null,
    channelName: info.channelName || pageInfo.channelName || null,
    channelNames,
  };
}

function isChannelBlocked({ channelId, channelName, channelNames }) {
  const names = channelNames || new Set();
  addNormalizedChannelCandidate(names, channelName);

  if (channelId && blocklist.has(channelId)) {
    return true;
  }

  for (const name of names) {
    if (nameBlocklist.has(name)) {
      return true;
    }

    if (name.startsWith("@") && nameBlocklist.has(name.slice(1))) {
      return true;
    }
  }

  return false;
}

function isChannelNameBlockedText(text) {
  const name = normalizeChannelName(text || "");
  if (!name) return false;
  if (nameBlocklist.has(name)) return true;

  const handleWithoutAt = name.startsWith("@") ? name.slice(1) : "";
  if (handleWithoutAt && nameBlocklist.has(handleWithoutAt)) {
    return true;
  }

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

function findChannelCardTitleTarget(scope) {
  return (
    deepQuerySelector(
      [
        "yt-lockup-metadata-view-model a[href] yt-attributed-string",
        "yt-lockup-metadata-view-model a[href] .ytAttributedStringHost",
        "yt-lockup-metadata-view-model a[href] .yt-core-attributed-string",
        "yt-lockup-metadata-view-model [role='heading']",
        "yt-lockup-metadata-view-model yt-attributed-string",
        "yt-lockup-metadata-view-model .ytAttributedStringHost",
        "yt-lockup-metadata-view-model .yt-core-attributed-string",
        "ytd-channel-name #text",
        "#channel-name #text",
        "#text",
        "h3",
      ].join(","),
      scope
    ) || null
  );
}

function findChannelLabelTarget(element) {
  const scope =
    deepClosest(element, CARD_SELECTORS) ||
    deepClosest(element, CHANNEL_LABEL_SCOPE_SELECTORS) ||
    deepClosest(element, CHANNEL_SURFACE_SELECTORS) ||
    element;

  if (isChannelCardScope(scope)) {
    const channelCardTarget = findChannelCardTitleTarget(scope);
    if (channelCardTarget) {
      return {
        scope,
        root: channelCardTarget,
        target: channelCardTarget,
        labelHost: channelCardTarget.parentElement || scope,
      };
    }
  }

  const uploaderLink = findPrimaryUploaderLink(scope);
  if (uploaderLink) {
    const uploaderTarget = findUploaderLabelTarget(scope, uploaderLink);
    if (uploaderTarget?.target) {
      return { scope, ...uploaderTarget };
    }
  }

  if (isVideoCardScope(scope) && !isPageHeaderElement(scope)) {
    const lockupMetaRows = deepQuerySelectorAll("yt-content-metadata-view-model", scope);
    if (lockupMetaRows.length >= 2) {
      const channelRow = lockupMetaRows[1];
      const channelRowTarget =
        deepQuerySelector('a[href*="/channel/"], a[href*="/@"], yt-formatted-string, span', channelRow) ||
        channelRow;
      return { scope, root: channelRow, target: channelRowTarget, labelHost: channelRow };
    }
  }

  if (isPageHeaderElement(scope)) {
    const headerTarget = findPageHeaderLabelTarget(scope);
    if (headerTarget) {
      return { scope, root: headerTarget, target: headerTarget, labelHost: headerTarget.parentElement || scope };
    }
  }

  const root =
    (element.matches?.(CHANNEL_LABEL_ROOT_SELECTORS) ? element : null) ||
    deepQuerySelector(CHANNEL_LABEL_ROOT_SELECTORS, scope) ||
    deepQuerySelector(CHANNEL_INFO_ROOT_SELECTORS, scope);

  const target =
    deepQuerySelector(CHANNEL_LABEL_TEXT_SELECTORS, root || scope) ||
    deepQuerySelector(
      "ytd-channel-name #text, #channel-name #text, #byline-container yt-formatted-string, ytd-video-meta-block yt-formatted-string",
      scope
    ) ||
    deepQuerySelector(
      "h1 yt-dynamic-text-view-model, h1 .yt-core-attributed-string, h1",
      scope
    ) ||
    root;

  const labelHost =
    deepQuerySelector("#byline-container, #metadata-line, #owner-name, #channel-info", scope) ||
    deepQuerySelector("ytd-channel-name, #channel-name, yt-content-metadata-view-model", scope) ||
    root?.parentElement ||
    root;

  return { scope, root, target, labelHost };
}

function enrichChannelInfoFromPageData(info, element) {
  const channelNames = new Set(info.channelNames || []);
  if (info.channelName) channelNames.add(normalizeChannelName(info.channelName));

  const inPageHeader =
    isPageHeaderElement(element) ||
    (isOnChannelPage() && (element === document.documentElement || element === document.body));
  const onWatchPage = element.closest?.("ytd-watch-flexy, ytd-watch-metadata, #owner, ytd-video-owner-renderer");
  const inMiniplayer = element.closest?.("ytd-miniplayer, ytd-miniplayer-info-bar");

  try {
    if (inPageHeader) {
      addPagePathChannelCandidates(channelNames);

      const data = getPageWindow().ytInitialData;
      const metadata = data?.metadata?.channelMetadataRenderer;
      if (metadata?.externalId) info.channelId = info.channelId || metadata.externalId;
      if (metadata?.title) {
        addNormalizedChannelCandidate(channelNames, metadata.title);
        info.channelName = info.channelName || metadata.title;
      }
      if (metadata?.vanityChannelUrl) {
        const handleMatch = metadata.vanityChannelUrl.match(/\/(@[^/?#]+)/);
        if (handleMatch) {
          addNormalizedChannelCandidate(channelNames, safelyDecodeURIComponent(handleMatch[1]));
        }
      }
    }

    if (onWatchPage || inMiniplayer) {
      const player = getPageWindow().ytInitialPlayerResponse;
      if (player?.videoDetails?.channelId) {
        info.channelId = info.channelId || player.videoDetails.channelId;
      }
      if (player?.videoDetails?.author) {
        addNormalizedChannelCandidate(channelNames, player.videoDetails.author);
        info.channelName = info.channelName || player.videoDetails.author;
      }
    }
  } catch (_) {}

  info.channelNames = channelNames;
  return info;
}

function isChannelElementBlocked(element) {
  let info = extractChannelInfoFromElement(element);
  info = enrichFromPageChannelContext(info, element);
  info = enrichChannelInfoFromPageData(info, element);

  return isChannelBlocked(info);
}

function cleanupChannelLabels(scope) {
  if (!scope) return;

  collectSearchRoots(scope).forEach((searchRoot) => {
    searchRoot.querySelectorAll?.(".alabuga-channel-label").forEach((label) => label.remove());
    searchRoot
      .querySelectorAll?.(".alabuga-channel-name-mark")
      .forEach((el) => el.classList.remove("alabuga-channel-name-mark"));
    searchRoot.querySelectorAll?.("[data-alabuga-label-attached]").forEach((root) => {
      delete root.dataset.alabugaLabelAttached;
    });
  });

  scope.classList?.remove("alabuga-channel-name-mark");
  delete scope.dataset.alabugaLabelAttached;

  if (scope.nextElementSibling?.classList?.contains("alabuga-channel-label")) {
    scope.nextElementSibling.remove();
  }
}

function scopeHasChannelLabel(scope) {
  if (!scope) return false;
  const labels = [];

  if (scope.matches?.(".alabuga-channel-label")) labels.push(scope);
  collectSearchRoots(scope).forEach((searchRoot) => {
    searchRoot.querySelectorAll?.(".alabuga-channel-label").forEach((label) => {
      labels.push(label);
    });
  });

  return labels.some((label) => isElementVisible(label));
}

function addChannelLabel(element) {
  const { scope, root, target, labelHost } = findChannelLabelTarget(element);
  const labelScope = scope || element;
  if (scopeHasChannelLabel(labelScope)) return;

  cleanupChannelLabels(labelScope);

  const label = createChannelLabel();

  if (target && root) {
    target.classList?.add("alabuga-channel-name-mark");
    try {
      target.insertAdjacentElement("afterend", label);
    } catch (_) {
      (labelHost || root).appendChild(label);
    }
    labelScope.dataset.alabugaLabelAttached = "1";
    root.dataset.alabugaLabelAttached = "1";
    return;
  }

  // Fallback: канал точно в списке, но точный элемент с ником не найден
  // (мини-плеер, нестандартная вёрстка) — метку всё равно показываем.
  const host = resolveFallbackLabelHost(labelScope);
  if (!host) return;

  try {
    host.appendChild(label);
  } catch (_) {
    return;
  }

  labelScope.dataset.alabugaLabelAttached = "1";
  if (host instanceof Element) host.dataset.alabugaLabelAttached = "1";
}

function clearChannelMark(element) {
  element.classList.remove("alabuga-marked-channel");
  delete element.dataset.alabugaChannelMarked;
  const { scope } = findChannelLabelTarget(element);
  cleanupChannelLabels(scope || element);
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

  deepQueryAllDocument(CARD_SELECTORS).forEach((card) => {
    const channelBlocked = isChannelElementBlocked(card);
    const videoAd = isAdVideo(extractVideoIdFromElement(card));

    if (channelBlocked) {
      markChannelElement(card);
    } else if (card.dataset.alabugaChannelMarked || scopeHasChannelLabel(card)) {
      clearChannelMark(card);
    }

    if (videoAd) {
      markAdVideoElement(card);
    } else if (card.dataset.alabugaVideoMarked || card.dataset.alabugaMarked) {
      clearAdVideoMark(card);
    }
  });

  deepQueryAllDocument(CHANNEL_SURFACE_SELECTORS).forEach((surface) => {
    if (deepClosest(surface, CARD_SELECTORS)) return;
    if (isPageHeaderElement(surface)) return;

    const channelBlocked = isChannelElementBlocked(surface);

    if (channelBlocked) {
      markChannelElement(surface);
    } else if (
      surface.dataset.alabugaChannelMarked ||
      surface.dataset.alabugaLabelAttached ||
      scopeHasChannelLabel(surface)
    ) {
      clearChannelMark(surface);
    }
  });

  markChannelProfileHeader();
  updateAllMarkedVisuals();
}

function markChannelProfileHeader() {
  if (!enabled || !isOnChannelPage()) return;

  const pageInfo = getEnrichedPageChannelInfo();
  const channelBlocked = isChannelBlocked(pageInfo);
  const allHeaderScopes = deepQueryAllDocument(PAGE_HEADER_SCOPE_SELECTORS);
  const headerScopes = getPageHeaderScopes();
  const markedScopes = new Set();

  allHeaderScopes.forEach((headerScope) => {
    cleanupChannelLabels(headerScope);
    delete headerScope.dataset.alabugaChannelMarked;
    delete headerScope.dataset.alabugaLabelAttached;
    headerScope.classList?.remove("alabuga-marked-channel");
  });

  if (!channelBlocked) return;

  headerScopes.forEach((headerScope) => {
    if (markedScopes.has(headerScope)) return;
    markedScopes.add(headerScope);

    const placement = findPageHeaderLabelPlacement(headerScope);
    const label = createChannelLabel("alabuga-channel-label--header");

    if (placement?.target && placement?.insertAfter) {
      placement.target.classList?.add("alabuga-channel-name-mark");
      placement.insertAfter.insertAdjacentElement("afterend", label);
    } else {
      const host = resolveFallbackLabelHost(headerScope);
      if (!host) return;
      host.appendChild(label);
    }

    headerScope.dataset.alabugaLabelAttached = "1";
    headerScope.dataset.alabugaChannelMarked = "1";
    headerScope.classList?.add("alabuga-marked-channel");
  });
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
  const metadataChannelId = extractChannelIdFromPageMetadata();

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

    if (metadataChannelId) {
      return { channelId: metadataChannelId, channelName: null };
    }

    const meta = document.querySelector('meta[itemprop="channelId"]');
    if (meta?.content) {
      return { channelId: meta.content, channelName: null };
    }

    const channelLink = deepQuerySelector(
      "ytd-video-owner-renderer ytd-channel-name a, #owner ytd-channel-name a, ytd-watch-metadata ytd-channel-name a"
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
      const metadata = data?.metadata?.channelMetadataRenderer;
      const id = metadata?.externalId || metadataChannelId;
      const title = metadata?.title || null;
      if (id || title) return { channelId: id || null, channelName: title };
    } catch (_) {}

    const channelNameEl =
      deepQuerySelector(
        [
          "yt-page-header-view-model h1 yt-dynamic-text-view-model",
          "yt-page-header-renderer h1 yt-dynamic-text-view-model",
          "yt-page-header-view-model h1",
          "yt-page-header-renderer h1",
          "#page-header h1",
          "#page-header-container h1",
          "#channel-header ytd-channel-name #text",
          "ytd-channel-name #text",
        ].join(",")
      ) ||
      document.querySelector(
        [
          "yt-page-header-view-model h1",
          "yt-page-header-renderer h1",
          "#page-header h1",
          "#page-header-container h1",
        ].join(",")
      );
    if (channelNameEl?.textContent?.trim()) {
      return { channelId: metadataChannelId || null, channelName: channelNameEl.textContent.trim() };
    }

    if (metadataChannelId) {
      return { channelId: metadataChannelId, channelName: null };
    }
  }

  const pageHeader = deepQuerySelector(
    [
      "yt-page-header-view-model",
      "yt-page-header-renderer",
      "ytd-page-header-renderer",
      "ytd-c4-tabbed-header-renderer",
      "#channel-header",
      "#page-header",
      "#page-header-container",
    ].join(",")
  );
  if (pageHeader) {
    const info = extractChannelInfoFromElement(pageHeader);
    info.channelId = info.channelId || metadataChannelId;
    if (info.channelId || info.channelName || info.channelNames?.size) return info;
  }

  return { channelId: null, channelName: null, channelNames: new Set() };
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

function markCurrentPageChannel() {
  const markedScopes = new Set();

  deepQueryAllDocument(CHANNEL_SURFACE_SELECTORS).forEach((surface) => {
    if (isPageHeaderElement(surface)) return;

    const { scope } = findChannelLabelTarget(surface);
    if (!scope || markedScopes.has(scope)) return;
    markedScopes.add(scope);

    if (isChannelElementBlocked(surface)) {
      addChannelLabel(surface);
    } else if (
      scope.dataset.alabugaLabelAttached ||
      scope.dataset.alabugaChannelMarked ||
      scopeHasChannelLabel(scope)
    ) {
      cleanupChannelLabels(scope);
      delete scope.dataset.alabugaChannelMarked;
      scope.classList?.remove("alabuga-marked-channel");
    }
  });

  markChannelProfileHeader();
}

function checkCurrentPage() {
  if (!enabled || (blocklist.size === 0 && nameBlocklist.size === 0 && adVideoList.size === 0)) {
    removeWarningBanner();
    markCurrentPageChannel();
    return;
  }

  markCurrentPageChannel();

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
    if (loaded && nameBlocklist.size > 0) return true;

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
