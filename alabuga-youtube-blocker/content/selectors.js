const CARD_SELECTORS = [
  "ytd-video-renderer",
  "ytd-rich-item-renderer",
  "ytd-grid-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-playlist-video-renderer",
  "ytd-reel-item-renderer",
  "ytd-search-pyv-renderer",
  "yt-lockup-view-model",
  "ytm-video-with-context-renderer",
  "ytm-compact-video-renderer",
  "ytd-channel-renderer",
  "ytd-grid-channel-renderer",
].join(",");

const CHANNEL_LINK_RE = /\/channel\/(UC[\w-]+)/;
