// Storage backend: ไฟล์ JSON ในโฟลเดอร์ data/ — ใช้ตอนรันในเครื่อง (ไม่มี DATABASE_URL)
// ทุกฟังก์ชันเป็น async ให้ interface ตรงกับ store-pg.js
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PAGES_FILE = path.join(DATA_DIR, 'pages.json');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const PICS_FILE = path.join(DATA_DIR, 'profile-pics.json');
const TAGS_FILE = path.join(DATA_DIR, 'tags.json');
const REMARKS_FILE = path.join(DATA_DIR, 'remarks.json');
const STATUSES_FILE = path.join(DATA_DIR, 'statuses.json');
const SAVED_REPLIES_FILE = path.join(DATA_DIR, 'saved-replies.json');
const SYNC_HISTORY_FILE = path.join(DATA_DIR, 'sync-history.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

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

// merge conversations ที่อัปเดตเข้ากับของเดิม (ใช้ตอน incremental sync — ไม่ลบห้องเก่า)
async function upsertConversations(pageId, conversations) {
  const map = readJson(CONVERSATIONS_FILE, {});
  const list = map[pageId] || [];
  const byId = new Map(list.map((c) => [c.id, c]));
  for (const c of conversations) byId.set(c.id, c);
  map[pageId] = [...byId.values()];
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

// ดึงห้องเดียวตาม id (ใช้ตอนเปิดแชท — โหลดข้อความเต็มเฉพาะห้องที่เปิด)
async function getConversation(id) {
  for (const list of Object.values(readJson(CONVERSATIONS_FILE, {}))) {
    const c = list.find((x) => x.id === id);
    if (c) return c;
  }
  return null;
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

// ---- Remarks (โน้ตประจำลูกค้า เก็บแยกเหมือน tags) ----
async function getRemarks() {
  return readJson(REMARKS_FILE, {});
}

async function setRemark(conversationId, remark) {
  const map = readJson(REMARKS_FILE, {});
  if (remark) map[conversationId] = remark;
  else delete map[conversationId];
  writeJson(REMARKS_FILE, map);
}

// ---- Status override (สีแดง/เหลือง/เขียว ที่ผู้ใช้กำหนดเองทับค่าอัตโนมัติ) ----
async function getStatuses() {
  return readJson(STATUSES_FILE, {});
}

async function setStatus(conversationId, status) {
  const map = readJson(STATUSES_FILE, {});
  if (status) map[conversationId] = status;
  else delete map[conversationId];
  writeJson(STATUSES_FILE, map);
}

// ---- Saved replies (คำตอบสำเร็จรูป แยกตามเพจ) ----
// รูปแบบ: { [pageId]: [ { id, text, createdAt } ] }
async function getSavedReplies(pageId) {
  return readJson(SAVED_REPLIES_FILE, {})[pageId] || [];
}

async function addSavedReply(pageId, entry) {
  const map = readJson(SAVED_REPLIES_FILE, {});
  map[pageId] = map[pageId] || [];
  map[pageId].push(entry);
  writeJson(SAVED_REPLIES_FILE, map);
  return entry;
}

async function updateSavedReply(pageId, replyId, fields) {
  const map = readJson(SAVED_REPLIES_FILE, {});
  const entry = (map[pageId] || []).find((r) => r.id === replyId);
  if (entry) {
    Object.assign(entry, fields);
    writeJson(SAVED_REPLIES_FILE, map);
  }
  return entry || null;
}

async function deleteSavedReply(pageId, replyId) {
  const map = readJson(SAVED_REPLIES_FILE, {});
  map[pageId] = (map[pageId] || []).filter((r) => r.id !== replyId);
  writeJson(SAVED_REPLIES_FILE, map);
}

// ---- Sync history (ประวัติการดึง inbox รายครั้ง เก็บ 50 ครั้งล่าสุด) ----
async function getSyncRuns(limit = 50) {
  return readJson(SYNC_HISTORY_FILE, []).slice(0, limit);
}

async function addSyncRun(run) {
  const runs = readJson(SYNC_HISTORY_FILE, []);
  runs.unshift(run);
  writeJson(SYNC_HISTORY_FILE, runs.slice(0, 50));
}

// ---- Settings (การตั้งค่าระบบ เช่น รอบเวลาดึงอัตโนมัติ) ----
async function getSetting(key, fallback = null) {
  const s = readJson(SETTINGS_FILE, {});
  return key in s ? s[key] : fallback;
}

async function setSetting(key, value) {
  const s = readJson(SETTINGS_FILE, {});
  s[key] = value;
  writeJson(SETTINGS_FILE, s);
}

module.exports = {
  init,
  getPages, savePage, deletePage,
  saveConversations, upsertConversations, saveConversation, getAllConversations, getConversationsForPage, getConversation,
  getPicCache, savePics,
  getTags, setTags,
  getRemarks, setRemark,
  getStatuses, setStatus,
  getSavedReplies, addSavedReply, updateSavedReply, deleteSavedReply,
  getSyncRuns, addSyncRun, getSetting, setSetting,
};
