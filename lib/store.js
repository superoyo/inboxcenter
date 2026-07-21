// เก็บข้อมูลลงไฟล์ JSON ในโฟลเดอร์ data/
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PAGES_FILE = path.join(DATA_DIR, 'pages.json');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const PICS_FILE = path.join(DATA_DIR, 'profile-pics.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ---- Pages (เพจที่เชื่อมต่อแล้ว) ----
function getPages() {
  return readJson(PAGES_FILE, []);
}

function savePage(page) {
  const pages = getPages().filter((p) => p.id !== page.id);
  pages.push(page);
  writeJson(PAGES_FILE, pages);
  return page;
}

function deletePage(pageId) {
  writeJson(PAGES_FILE, getPages().filter((p) => p.id !== pageId));
  const convs = getConversationsMap();
  delete convs[pageId];
  writeJson(CONVERSATIONS_FILE, convs);
}

// ---- Conversations (แยกเก็บตาม pageId) ----
function getConversationsMap() {
  return readJson(CONVERSATIONS_FILE, {});
}

function saveConversations(pageId, conversations) {
  const map = getConversationsMap();
  map[pageId] = conversations;
  writeJson(CONVERSATIONS_FILE, map);
}

function getAllConversations() {
  return Object.values(getConversationsMap()).flat();
}

function getConversationsForPage(pageId) {
  return getConversationsMap()[pageId] || [];
}

// ---- Profile picture cache (กันเรียก Graph API ซ้ำทุกครั้งที่ sync) ----
// รูปแบบ: { [customerId]: { url, fetchedAt } }
function getPicCache() {
  return readJson(PICS_FILE, {});
}

function savePicCache(cache) {
  writeJson(PICS_FILE, cache);
}

module.exports = {
  getPages, savePage, deletePage,
  saveConversations, getAllConversations, getConversationsForPage,
  getPicCache, savePicCache,
};
