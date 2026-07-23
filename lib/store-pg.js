// Storage backend: PostgreSQL — ใช้เมื่อมี DATABASE_URL (เช่นบน Railway)
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // การเชื่อมต่อภายใน Railway (postgres.railway.internal) ไม่ใช้ SSL
      // ถ้าต่อผ่าน public proxy จากนอก Railway ให้ตั้ง DATABASE_SSL=true
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

async function init() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS pages (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL DEFAULT '',
      picture_url   TEXT NOT NULL DEFAULT '',
      access_token  TEXT NOT NULL,
      connected_at  TIMESTAMPTZ,
      last_sync_at  TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id           TEXT PRIMARY KEY,
      page_id      TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      updated_time TIMESTAMPTZ,
      data         JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_page ON conversations(page_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_time DESC);

    CREATE TABLE IF NOT EXISTS profile_pics (
      customer_id TEXT PRIMARY KEY,
      url         TEXT NOT NULL DEFAULT '',
      fetched_at  TIMESTAMPTZ NOT NULL
    );

    -- แท็กเก็บแยกจาก conversations เพราะตารางนั้นถูกลบ-เขียนใหม่ทุกครั้งที่ sync
    CREATE TABLE IF NOT EXISTS conversation_tags (
      conversation_id TEXT PRIMARY KEY,
      tags            JSONB NOT NULL DEFAULT '[]'
    );

    -- โน้ตประจำลูกค้า เก็บแยกเช่นเดียวกับแท็ก
    CREATE TABLE IF NOT EXISTS conversation_remarks (
      conversation_id TEXT PRIMARY KEY,
      remark          TEXT NOT NULL DEFAULT ''
    );

    -- สถานะสี (แดง/เหลือง/เขียว) ที่ผู้ใช้กำหนดเองทับค่าอัตโนมัติ
    CREATE TABLE IF NOT EXISTS conversation_status (
      conversation_id TEXT PRIMARY KEY,
      status          TEXT NOT NULL
    );

    -- ประวัติการดึง inbox รายครั้ง
    CREATE TABLE IF NOT EXISTS sync_runs (
      id         TEXT PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL,
      data       JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_runs_time ON sync_runs(started_at DESC);

    -- การตั้งค่าระบบ (เช่น รอบเวลาดึงอัตโนมัติ)
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );

    -- คำตอบสำเร็จรูป แยกตามเพจ
    CREATE TABLE IF NOT EXISTS saved_replies (
      id         TEXT PRIMARY KEY,
      page_id    TEXT NOT NULL,
      text       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_replies_page ON saved_replies(page_id);
    ALTER TABLE saved_replies ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]';

    -- โปรเจกต์: กลุ่มเพจ
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      page_ids    JSONB NOT NULL DEFAULT '[]',
      created_at  TIMESTAMPTZ NOT NULL
    );
  `);
}

function rowToPage(r) {
  return {
    id: r.id,
    name: r.name,
    pictureUrl: r.picture_url,
    accessToken: r.access_token,
    connectedAt: r.connected_at ? r.connected_at.toISOString() : null,
    lastSyncAt: r.last_sync_at ? r.last_sync_at.toISOString() : null,
  };
}

// ---- Pages ----
async function getPages() {
  const { rows } = await getPool().query('SELECT * FROM pages ORDER BY connected_at');
  return rows.map(rowToPage);
}

async function savePage(page) {
  await getPool().query(
    `INSERT INTO pages (id, name, picture_url, access_token, connected_at, last_sync_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       picture_url = EXCLUDED.picture_url,
       access_token = EXCLUDED.access_token,
       connected_at = EXCLUDED.connected_at,
       last_sync_at = EXCLUDED.last_sync_at`,
    [page.id, page.name || '', page.pictureUrl || '', page.accessToken,
     page.connectedAt || null, page.lastSyncAt || null]
  );
  return page;
}

async function deletePage(pageId) {
  await getPool().query('DELETE FROM pages WHERE id = $1', [pageId]); // conversations ลบตามด้วย CASCADE
}

// ---- Conversations (เก็บทั้งก้อนเป็น JSONB) ----
async function saveConversations(pageId, conversations) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM conversations WHERE page_id = $1', [pageId]);
    for (const c of conversations) {
      await client.query(
        `INSERT INTO conversations (id, page_id, updated_time, data) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET page_id = EXCLUDED.page_id,
           updated_time = EXCLUDED.updated_time, data = EXCLUDED.data`,
        [c.id, pageId, c.updatedTime || null, JSON.stringify(c)]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// merge conversations ที่อัปเดตเข้ากับของเดิม (ใช้ตอน incremental sync — ไม่ลบห้องเก่า)
async function upsertConversations(pageId, conversations) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const c of conversations) {
      await client.query(
        `INSERT INTO conversations (id, page_id, updated_time, data) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET page_id = EXCLUDED.page_id,
           updated_time = EXCLUDED.updated_time, data = EXCLUDED.data`,
        [c.id, pageId, c.updatedTime || null, JSON.stringify(c)]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function saveConversation(conversation) {
  await getPool().query(
    `INSERT INTO conversations (id, page_id, updated_time, data) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET updated_time = EXCLUDED.updated_time, data = EXCLUDED.data`,
    [conversation.id, conversation.pageId, conversation.updatedTime || null, JSON.stringify(conversation)]
  );
}

async function getAllConversations() {
  const { rows } = await getPool().query('SELECT data FROM conversations');
  return rows.map((r) => r.data);
}

async function getConversationsForPage(pageId) {
  const { rows } = await getPool().query('SELECT data FROM conversations WHERE page_id = $1', [pageId]);
  return rows.map((r) => r.data);
}

// ดึงห้องเดียวตาม id (ใช้ตอนเปิดแชท — โหลดข้อความเต็มเฉพาะห้องที่เปิด) — ใช้ primary key จึงเร็ว
async function getConversation(id) {
  const { rows } = await getPool().query('SELECT data FROM conversations WHERE id = $1', [id]);
  return rows[0] ? rows[0].data : null;
}

// ---- Profile picture cache ----
async function getPicCache() {
  const { rows } = await getPool().query('SELECT * FROM profile_pics');
  return Object.fromEntries(rows.map((r) => [r.customer_id, { url: r.url, fetchedAt: r.fetched_at.toISOString() }]));
}

async function savePics(entries) {
  const ids = Object.keys(entries);
  if (!ids.length) return;
  const urls = ids.map((id) => entries[id].url || '');
  const times = ids.map((id) => entries[id].fetchedAt);
  await getPool().query(
    `INSERT INTO profile_pics (customer_id, url, fetched_at)
     SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[])
     ON CONFLICT (customer_id) DO UPDATE SET url = EXCLUDED.url, fetched_at = EXCLUDED.fetched_at`,
    [ids, urls, times]
  );
}

// ---- Tags ----
async function getTags() {
  const { rows } = await getPool().query('SELECT * FROM conversation_tags');
  return Object.fromEntries(rows.map((r) => [r.conversation_id, r.tags]));
}

async function setTags(conversationId, tags) {
  if (!tags.length) {
    await getPool().query('DELETE FROM conversation_tags WHERE conversation_id = $1', [conversationId]);
    return;
  }
  await getPool().query(
    `INSERT INTO conversation_tags (conversation_id, tags) VALUES ($1, $2)
     ON CONFLICT (conversation_id) DO UPDATE SET tags = EXCLUDED.tags`,
    [conversationId, JSON.stringify(tags)]
  );
}

// ---- Remarks ----
async function getRemarks() {
  const { rows } = await getPool().query('SELECT * FROM conversation_remarks');
  return Object.fromEntries(rows.map((r) => [r.conversation_id, r.remark]));
}

async function setRemark(conversationId, remark) {
  if (!remark) {
    await getPool().query('DELETE FROM conversation_remarks WHERE conversation_id = $1', [conversationId]);
    return;
  }
  await getPool().query(
    `INSERT INTO conversation_remarks (conversation_id, remark) VALUES ($1, $2)
     ON CONFLICT (conversation_id) DO UPDATE SET remark = EXCLUDED.remark`,
    [conversationId, remark]
  );
}

// ---- Status override ----
async function getStatuses() {
  const { rows } = await getPool().query('SELECT * FROM conversation_status');
  return Object.fromEntries(rows.map((r) => [r.conversation_id, r.status]));
}

async function setStatus(conversationId, status) {
  if (!status) {
    await getPool().query('DELETE FROM conversation_status WHERE conversation_id = $1', [conversationId]);
    return;
  }
  await getPool().query(
    `INSERT INTO conversation_status (conversation_id, status) VALUES ($1, $2)
     ON CONFLICT (conversation_id) DO UPDATE SET status = EXCLUDED.status`,
    [conversationId, status]
  );
}

// ---- Saved replies (คำตอบสำเร็จรูป แยกตามเพจ) ----
async function getSavedReplies(pageId) {
  const { rows } = await getPool().query(
    'SELECT id, text, tags, created_at FROM saved_replies WHERE page_id = $1 ORDER BY created_at',
    [pageId]
  );
  return rows.map((r) => ({ id: r.id, text: r.text, tags: r.tags || [], createdAt: r.created_at.toISOString() }));
}

async function addSavedReply(pageId, entry) {
  await getPool().query(
    'INSERT INTO saved_replies (id, page_id, text, tags, created_at) VALUES ($1, $2, $3, $4, $5)',
    [entry.id, pageId, entry.text, JSON.stringify(entry.tags || []), entry.createdAt]
  );
  return entry;
}

async function updateSavedReply(pageId, replyId, fields) {
  if (fields.tags !== undefined) {
    await getPool().query(
      'UPDATE saved_replies SET tags = $3 WHERE page_id = $1 AND id = $2',
      [pageId, replyId, JSON.stringify(fields.tags)]
    );
  }
  if (fields.text !== undefined) {
    await getPool().query(
      'UPDATE saved_replies SET text = $3 WHERE page_id = $1 AND id = $2',
      [pageId, replyId, fields.text]
    );
  }
  const { rows } = await getPool().query(
    'SELECT id, text, tags, created_at FROM saved_replies WHERE page_id = $1 AND id = $2',
    [pageId, replyId]
  );
  return rows[0] ? { id: rows[0].id, text: rows[0].text, tags: rows[0].tags || [], createdAt: rows[0].created_at.toISOString() } : null;
}

async function deleteSavedReply(pageId, replyId) {
  await getPool().query('DELETE FROM saved_replies WHERE page_id = $1 AND id = $2', [pageId, replyId]);
}

// ---- Sync history ----
async function getSyncRuns(limit = 50) {
  const { rows } = await getPool().query(
    'SELECT data FROM sync_runs ORDER BY started_at DESC LIMIT $1', [limit]
  );
  return rows.map((r) => r.data);
}

async function addSyncRun(run) {
  await getPool().query(
    'INSERT INTO sync_runs (id, started_at, data) VALUES ($1, $2, $3)',
    [run.id, run.startedAt, JSON.stringify(run)]
  );
  // เก็บเฉพาะ 100 ครั้งล่าสุด
  await getPool().query(
    'DELETE FROM sync_runs WHERE id NOT IN (SELECT id FROM sync_runs ORDER BY started_at DESC LIMIT 100)'
  );
}

// ---- Settings ----
async function getSetting(key, fallback = null) {
  const { rows } = await getPool().query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : fallback;
}

async function setSetting(key, value) {
  await getPool().query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}

// ---- Projects ----
async function getProjects() {
  const { rows } = await getPool().query('SELECT * FROM projects ORDER BY created_at DESC');
  return rows.map((r) => ({
    id: r.id, name: r.name, description: r.description || '',
    pageIds: r.page_ids || [], createdAt: r.created_at.toISOString(),
  }));
}
async function saveProject(project) {
  await getPool().query(
    `INSERT INTO projects (id, name, description, page_ids, created_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, page_ids = EXCLUDED.page_ids`,
    [project.id, project.name, project.description || '', JSON.stringify(project.pageIds || []), project.createdAt]
  );
  return project;
}
async function deleteProject(id) {
  await getPool().query('DELETE FROM projects WHERE id = $1', [id]);
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
  getProjects, saveProject, deleteProject,
};
