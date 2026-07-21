// Storage backend: ไฟล์ JSON ในโฟลเดอร์ data/ — ใช้ตอนรันในเครื่อง (ไม่มี DATABASE_URL)
// ทุกฟังก์ชันเป็น async ให้ interface ตรงกับ store-pg.js
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PAGES_FILE = path.join(DATA_DIR, 'pages.json');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const PICS_FILE = path.join(DATA_DIR, 'profile-pics.json');
const TAGS_FILE = path.join(DATA_DIR, 'tags.json');

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

async function init() {}

// ---- Pages ----
async function getPages() {
  return readJson(PAGES_FILE, []);
}

async function savePage(page) {
  const pages = (await getPages()).filter((p) => p.id !== page.id);
  pages.push(page);
  writeJson(PAGES_FILE, pages);
  return page;
}

async function deletePage(pageId) {
  writeJson(PAGES_FILE, (await getPages()).filter((p) => p.id !== pageId));
  const convs = readJson(CONVERSATIONS_FILE, {});
  delete convs[pageId];
  writeJson(CONVERSATIONS_FILE, convs);
}

// ---- Conversations ----
async function saveConversations(pageId, conversations) {
  const map = readJson(CONVERSATIONS_FILE, {});
  map[pageId] = conversations;
  writeJson(CONVERSATIONS_FILE, map);
}

// อัปเดต conversation เดียว (ใช้ตอนตอบกลับ ไม่ต้องเขียนทั้งเพจ)
async function saveConversation(conversation) {
  const map = readJson(CONVERSATIONS_FILE, {});
  const list = map[conversation.pageId] || [];
  const idx = list.findIndex((c) => c.id === conversation.id);
  if (idx >= 0) list[idx] = conversation;
  else list.push(conversation);
  map[conversation.pageId] = list;
  writeJson(CONVERSATIONS_FILE, map);
}

async function getAllConversations() {
  return Object.values(readJson(CONVERSATIONS_FILE, {})).flat();
}

async function getConversationsForPage(pageId) {
  return readJson(CONVERSATIONS_FILE, {})[pageId] || [];
}

// ---- Profile picture cache ----
async function getPicCache() {
  return readJson(PICS_FILE, {});
}

// upsert เฉพาะรายการใหม่/ที่เปลี่ยน — entries: { [customerId]: { url, fetchedAt } }
async function savePics(entries) {
  const cache = readJson(PICS_FILE, {});
  Object.assign(cache, entries);
  writeJson(PICS_FILE, cache);
}

// ---- Tags (เก็บแยกจากข้อมูลแชท จะได้ไม่หายตอน sync ทับ) ----
// รูปแบบ: { [conversationId]: ["VIP", "รอโอน", ...] }
async function getTags() {
  return readJson(TAGS_FILE, {});
}

async function setTags(conversationId, tags) {
  const map = readJson(TAGS_FILE, {});
  if (tags.length) map[conversationId] = tags;
  else delete map[conversationId];
  writeJson(TAGS_FILE, map);
}

module.exports = {
  init,
  getPages, savePage, deletePage,
  saveConversations, saveConversation, getAllConversations, getConversationsForPage,
  getPicCache, savePics,
  getTags, setTags,
};
