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

module.exports = {
  init,
  getPages, savePage, deletePage,
  saveConversations, saveConversation, getAllConversations, getConversationsForPage,
  getPicCache, savePics,
};
