/**
 * Minimal RFC 4180 CSV parser for Google Sheets export.
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || (char === "\r" && next === "\n")) {
      if (char === "\r") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

const CHANNEL_ID_RE = /^UC[\w-]{22}$/;
const VIDEO_ID_RE = /(?:youtube\.com\/watch\?[^"\s]*v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/g;

function normalizeChannelName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractVideoIds(text) {
  const ids = new Set();
  let match;

  VIDEO_ID_RE.lastIndex = 0;
  while ((match = VIDEO_ID_RE.exec(text)) !== null) {
    ids.add(match[1]);
  }

  return ids;
}

function extractActiveAdCount(text) {
  const match = text.match(/Активных реклам:\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function extractChannels(rows) {
  let headerIndex = -1;
  let nameColIndex = -1;
  let channelColIndex = -1;
  let videoLinksColIndex = -1;
  let videoStatusColIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    const idColIdx = rows[i].findIndex((cell) => cell.includes("ID") && cell.includes("Канала"));
    if (idColIdx !== -1) {
      headerIndex = i;
      channelColIndex = idColIdx;
      nameColIndex = rows[i].findIndex((cell) => cell.trim() === "Канал");
      videoLinksColIndex = rows[i].findIndex((cell) => cell.includes("Ссылки") && cell.includes("видео"));
      videoStatusColIndex = rows[i].findIndex((cell) => cell.includes("Статус") && cell.includes("видео"));
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error("Колонка «ID Канала» не найдена в CSV");
  }

  const ids = new Set();
  const names = new Set();
  const videoIds = new Set();

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length <= channelColIndex) continue;

    const id = row[channelColIndex].trim();
    if (CHANNEL_ID_RE.test(id)) {
      ids.add(id);
    }

    if (nameColIndex !== -1 && row.length > nameColIndex) {
      const name = normalizeChannelName(row[nameColIndex]);
      if (name) names.add(name);
    }

    if (
      videoLinksColIndex !== -1 &&
      videoStatusColIndex !== -1 &&
      row.length > videoLinksColIndex &&
      row.length > videoStatusColIndex &&
      extractActiveAdCount(row[videoStatusColIndex]) > 0
    ) {
      extractVideoIds(row[videoLinksColIndex]).forEach((videoId) => videoIds.add(videoId));
    }
  }

  return {
    blocklist: Array.from(ids),
    channelNames: Array.from(names),
    adVideoIds: Array.from(videoIds),
  };
}

function parseChannelIdsFromCSV(text) {
  return extractChannels(parseCSV(text)).blocklist;
}

function parseChannelsFromCSV(text) {
  return extractChannels(parseCSV(text));
}
