// Storage backend: PostgreSQL — ใช้เมื่อมี DATABASE_URL (เช่นบน Railway)
// interface ต้องตรงกับฝั่งไฟล์เป๊ะ — บังคับด้วย StorageRepository
import fs from 'node:fs';
import path from 'node:path';
import type {
  Competitor,
  CompetitorPost,
  CompetitorSyncRun,
  Conversation,
  Forward,
  PageConfig,
  Project,
  SavedReply,
  SyncRun,
} from '@inboxcenter/shared';
import { getPool } from './pool';
import type {
  ForwardsMap,
  PageConfigMapStored,
  ProfilePicCache,
  RemarksMap,
  StatusMap,
  StorageRepository,
  StoredPage,
  TagsMap,
  UpsertPostsResult,
} from '../types';

/** เก็บ sync run ไว้ 100 ครั้งล่าสุด (ฝั่ง Postgres เก็บได้มากกว่าฝั่งไฟล์) */
const KEEP_SYNC_RUNS = 100;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : ((v as string) ?? null);

function rowToPage(r: Row): StoredPage {
  return {
    ...(r.meta || {}), // ฟิลด์เสริม (platform/channelId/channelSecret/basicId) — คอลัมน์หลักด้านล่างทับได้
    id: r.id,
    name: r.name,
    pictureUrl: r.picture_url,
    accessToken: r.access_token,
    connectedAt: iso(r.connected_at),
    lastSyncAt: iso(r.last_sync_at),
  };
}

const rowToCompetitor = (r: Row): Competitor => ({
  id: r.id,
  url: r.url,
  handle: r.handle,
  name: r.name,
  pictureUrl: r.picture_url,
  addedAt: iso(r.added_at) as string,
  lastSyncAt: iso(r.last_sync_at),
  coveredFrom: r.covered_from || null,
  coveredTo: r.covered_to || null,
});

const rowToSavedReply = (r: Row): SavedReply => ({
  id: r.id,
  title: r.title || '',
  text: r.text,
  tags: r.tags || [],
  createdAt: iso(r.created_at) as string,
});

/** upsert conversation หลายห้องในทรานแซกชันเดียว — clearFirst = true คือ full sync */
async function writeConversations(
  pageId: string,
  conversations: Conversation[],
  clearFirst: boolean,
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (clearFirst) await client.query('DELETE FROM conversations WHERE page_id = $1', [pageId]);
    for (const c of conversations) {
      await client.query(
        `INSERT INTO conversations (id, page_id, updated_time, data) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET page_id = EXCLUDED.page_id,
           updated_time = EXCLUDED.updated_time, data = EXCLUDED.data`,
        [c.id, pageId, c.updatedTime || null, JSON.stringify(c)],
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

export const postgresRepository: StorageRepository = {
  /** สร้างตารางทั้งหมดจากไฟล์ migration (idempotent — CREATE TABLE IF NOT EXISTS) */
  async init() {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', '001_init.sql'), 'utf8');
    await getPool().query(sql);
  },

  // ---- Pages ----
  async getPages() {
    const { rows } = await getPool().query('SELECT * FROM pages ORDER BY connected_at');
    return rows.map(rowToPage);
  },

  async savePage(page) {
    // แยกคอลัมน์หลักออก ที่เหลือเก็บลง meta (JSONB) — รองรับ LINE/ช่องทางอื่นโดยไม่ต้องเพิ่มคอลัมน์
    const { id, name, pictureUrl, accessToken, connectedAt, lastSyncAt, ...meta } = page;
    await getPool().query(
      `INSERT INTO pages (id, name, picture_url, access_token, connected_at, last_sync_at, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         picture_url = EXCLUDED.picture_url,
         access_token = EXCLUDED.access_token,
         connected_at = EXCLUDED.connected_at,
         last_sync_at = EXCLUDED.last_sync_at,
         meta = EXCLUDED.meta`,
      [
        id,
        name || '',
        pictureUrl || '',
        accessToken || '',
        connectedAt || null,
        lastSyncAt || null,
        JSON.stringify(meta),
      ],
    );
    return page;
  },

  async deletePage(pageId) {
    // conversations ลบตามด้วย CASCADE
    await getPool().query('DELETE FROM pages WHERE id = $1', [pageId]);
  },

  // ---- Conversations (เก็บทั้งก้อนเป็น JSONB) ----
  async saveConversations(pageId, conversations) {
    await writeConversations(pageId, conversations, true);
  },

  /** merge conversations ที่อัปเดตเข้ากับของเดิม (ใช้ตอน incremental sync — ไม่ลบห้องเก่า) */
  async upsertConversations(pageId, conversations) {
    await writeConversations(pageId, conversations, false);
  },

  async saveConversation(conversation) {
    await getPool().query(
      `INSERT INTO conversations (id, page_id, updated_time, data) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET updated_time = EXCLUDED.updated_time, data = EXCLUDED.data`,
      [
        conversation.id,
        conversation.pageId,
        conversation.updatedTime || null,
        JSON.stringify(conversation),
      ],
    );
  },

  async getAllConversations() {
    const { rows } = await getPool().query('SELECT data FROM conversations');
    return rows.map((r) => r.data as Conversation);
  },

  async getConversationsForPage(pageId) {
    const { rows } = await getPool().query('SELECT data FROM conversations WHERE page_id = $1', [
      pageId,
    ]);
    return rows.map((r) => r.data as Conversation);
  },

  /** ใช้ primary key จึงเร็ว — โหลดข้อความเต็มเฉพาะห้องที่เปิด */
  async getConversation(id) {
    const { rows } = await getPool().query('SELECT data FROM conversations WHERE id = $1', [id]);
    return rows[0] ? (rows[0].data as Conversation) : null;
  },

  // ---- Profile picture cache ----
  async getPicCache() {
    const { rows } = await getPool().query('SELECT * FROM profile_pics');
    return Object.fromEntries(
      rows.map((r) => [r.customer_id, { url: r.url, fetchedAt: iso(r.fetched_at) as string }]),
    ) as ProfilePicCache;
  },

  async savePics(entries) {
    const ids = Object.keys(entries);
    if (!ids.length) return;
    const urls = ids.map((id) => entries[id]?.url || '');
    const times = ids.map((id) => entries[id]?.fetchedAt);
    await getPool().query(
      `INSERT INTO profile_pics (customer_id, url, fetched_at)
       SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[])
       ON CONFLICT (customer_id) DO UPDATE SET url = EXCLUDED.url, fetched_at = EXCLUDED.fetched_at`,
      [ids, urls, times],
    );
  },

  // ---- Annotations ----
  async getTags() {
    const { rows } = await getPool().query('SELECT * FROM conversation_tags');
    return Object.fromEntries(rows.map((r) => [r.conversation_id, r.tags])) as TagsMap;
  },

  async setTags(conversationId, tags) {
    if (!tags.length) {
      await getPool().query('DELETE FROM conversation_tags WHERE conversation_id = $1', [
        conversationId,
      ]);
      return;
    }
    await getPool().query(
      `INSERT INTO conversation_tags (conversation_id, tags) VALUES ($1, $2)
       ON CONFLICT (conversation_id) DO UPDATE SET tags = EXCLUDED.tags`,
      [conversationId, JSON.stringify(tags)],
    );
  },

  async getRemarks() {
    const { rows } = await getPool().query('SELECT * FROM conversation_remarks');
    return Object.fromEntries(rows.map((r) => [r.conversation_id, r.remark])) as RemarksMap;
  },

  async setRemark(conversationId, remark) {
    if (!remark) {
      await getPool().query('DELETE FROM conversation_remarks WHERE conversation_id = $1', [
        conversationId,
      ]);
      return;
    }
    await getPool().query(
      `INSERT INTO conversation_remarks (conversation_id, remark) VALUES ($1, $2)
       ON CONFLICT (conversation_id) DO UPDATE SET remark = EXCLUDED.remark`,
      [conversationId, remark],
    );
  },

  async getStatuses() {
    const { rows } = await getPool().query('SELECT * FROM conversation_status');
    return Object.fromEntries(rows.map((r) => [r.conversation_id, r.status])) as StatusMap;
  },

  async setStatus(conversationId, status) {
    if (!status) {
      await getPool().query('DELETE FROM conversation_status WHERE conversation_id = $1', [
        conversationId,
      ]);
      return;
    }
    await getPool().query(
      `INSERT INTO conversation_status (conversation_id, status) VALUES ($1, $2)
       ON CONFLICT (conversation_id) DO UPDATE SET status = EXCLUDED.status`,
      [conversationId, status],
    );
  },

  // ---- Saved replies ----
  async getSavedReplies(pageId) {
    const { rows } = await getPool().query(
      'SELECT id, title, text, tags, created_at FROM saved_replies WHERE page_id = $1 ORDER BY created_at',
      [pageId],
    );
    return rows.map(rowToSavedReply);
  },

  async addSavedReply(pageId, entry) {
    await getPool().query(
      'INSERT INTO saved_replies (id, page_id, title, text, tags, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        entry.id,
        pageId,
        entry.title || '',
        entry.text,
        JSON.stringify(entry.tags || []),
        entry.createdAt,
      ],
    );
    return entry;
  },

  async updateSavedReply(pageId, replyId, fields) {
    // อัปเดตเฉพาะฟิลด์ที่ส่งมา (undefined = ไม่แตะ)
    if (fields.title !== undefined) {
      await getPool().query('UPDATE saved_replies SET title = $3 WHERE page_id = $1 AND id = $2', [
        pageId,
        replyId,
        fields.title,
      ]);
    }
    if (fields.tags !== undefined) {
      await getPool().query('UPDATE saved_replies SET tags = $3 WHERE page_id = $1 AND id = $2', [
        pageId,
        replyId,
        JSON.stringify(fields.tags),
      ]);
    }
    if (fields.text !== undefined) {
      await getPool().query('UPDATE saved_replies SET text = $3 WHERE page_id = $1 AND id = $2', [
        pageId,
        replyId,
        fields.text,
      ]);
    }
    const { rows } = await getPool().query(
      'SELECT id, title, text, tags, created_at FROM saved_replies WHERE page_id = $1 AND id = $2',
      [pageId, replyId],
    );
    return rows[0] ? rowToSavedReply(rows[0]) : null;
  },

  async deleteSavedReply(pageId, replyId) {
    await getPool().query('DELETE FROM saved_replies WHERE page_id = $1 AND id = $2', [
      pageId,
      replyId,
    ]);
  },

  // ---- Sync history ----
  async getSyncRuns(limit = 50) {
    const { rows } = await getPool().query(
      'SELECT data FROM sync_runs ORDER BY started_at DESC LIMIT $1',
      [limit],
    );
    return rows.map((r) => r.data as SyncRun);
  },

  async addSyncRun(run) {
    await getPool().query('INSERT INTO sync_runs (id, started_at, data) VALUES ($1, $2, $3)', [
      run.id,
      run.startedAt,
      JSON.stringify(run),
    ]);
    await getPool().query(
      `DELETE FROM sync_runs WHERE id NOT IN (
         SELECT id FROM sync_runs ORDER BY started_at DESC LIMIT ${KEEP_SYNC_RUNS}
       )`,
    );
  },

  // ---- Settings ----
  async getSetting<T = unknown>(key: string, fallback: T | null = null) {
    const { rows } = await getPool().query('SELECT value FROM app_settings WHERE key = $1', [key]);
    return rows[0] ? (rows[0].value as T) : fallback;
  },

  async setSetting(key, value) {
    await getPool().query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)],
    );
  },

  // ---- Projects ----
  async getProjects() {
    const { rows } = await getPool().query('SELECT * FROM projects ORDER BY created_at DESC');
    return rows.map((r): Project => ({
      id: r.id,
      name: r.name,
      description: r.description || '',
      pageIds: r.page_ids || [],
      createdAt: iso(r.created_at) as string,
    }));
  },

  async saveProject(project) {
    await getPool().query(
      `INSERT INTO projects (id, name, description, page_ids, created_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
         description = EXCLUDED.description, page_ids = EXCLUDED.page_ids`,
      [
        project.id,
        project.name,
        project.description || '',
        JSON.stringify(project.pageIds || []),
        project.createdAt,
      ],
    );
    return project;
  },

  async deleteProject(id) {
    await getPool().query('DELETE FROM projects WHERE id = $1', [id]);
  },

  // ---- Page config ----
  async getPageConfigs() {
    const { rows } = await getPool().query('SELECT page_id, config FROM page_config');
    return Object.fromEntries(
      rows.map((r) => [r.page_id, (r.config || {}) as PageConfig]),
    ) as PageConfigMapStored;
  },

  async setPageConfig(pageId, config) {
    await getPool().query(
      `INSERT INTO page_config (page_id, config) VALUES ($1, $2)
       ON CONFLICT (page_id) DO UPDATE SET config = EXCLUDED.config`,
      [pageId, JSON.stringify(config)],
    );
    return config;
  },

  // ---- Forwards (ส่งต่อเคสภายในทีม — แยกจาก messages ไม่มีทางส่งถึงลูกค้า) ----
  async getForwards() {
    const { rows } = await getPool().query(
      'SELECT conversation_id, forwards FROM conversation_forwards',
    );
    return Object.fromEntries(
      rows.map((r) => [r.conversation_id, (r.forwards || []) as Forward[]]),
    ) as ForwardsMap;
  },

  async addForward(conversationId, entry) {
    await getPool().query(
      `INSERT INTO conversation_forwards (conversation_id, forwards)
       VALUES ($1, jsonb_build_array($2::jsonb))
       ON CONFLICT (conversation_id) DO UPDATE
         SET forwards = conversation_forwards.forwards || $2::jsonb`,
      [conversationId, JSON.stringify(entry)],
    );
    return entry;
  },

  // ---- Competitors ----
  async getCompetitors() {
    const { rows } = await getPool().query('SELECT * FROM competitors ORDER BY added_at');
    return rows.map(rowToCompetitor);
  },

  async saveCompetitor(competitor) {
    const c = competitor;
    await getPool().query(
      `INSERT INTO competitors
         (id, url, handle, name, picture_url, added_at, last_sync_at, covered_from, covered_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         url = EXCLUDED.url, handle = EXCLUDED.handle, name = EXCLUDED.name,
         picture_url = EXCLUDED.picture_url, last_sync_at = EXCLUDED.last_sync_at,
         covered_from = EXCLUDED.covered_from, covered_to = EXCLUDED.covered_to`,
      [
        c.id,
        c.url,
        c.handle || '',
        c.name || '',
        c.pictureUrl || '',
        c.addedAt || null,
        c.lastSyncAt || null,
        c.coveredFrom || null,
        c.coveredTo || null,
      ],
    );
    return c;
  },

  async deleteCompetitor(id) {
    // posts/runs ลบตาม CASCADE
    await getPool().query('DELETE FROM competitors WHERE id = $1', [id]);
  },

  async getCompetitorPosts(competitorId) {
    const { rows } = await getPool().query(
      'SELECT data FROM competitor_posts WHERE competitor_id = $1 ORDER BY post_time DESC NULLS LAST',
      [competitorId],
    );
    return rows.map((r) => r.data as CompetitorPost);
  },

  async upsertCompetitorPosts(competitorId, posts): Promise<UpsertPostsResult> {
    const countPosts = async (): Promise<number> => {
      const { rows } = await getPool().query(
        'SELECT COUNT(*)::int AS n FROM competitor_posts WHERE competitor_id = $1',
        [competitorId],
      );
      return rows[0]?.n ?? 0;
    };

    if (!posts.length) return { added: 0, total: await countPosts() };

    let added = 0;
    for (const p of posts) {
      // xmax = 0 → เป็นการ INSERT จริง (ไม่ใช่ UPDATE ทับ) ใช้นับจำนวนโพสต์ใหม่
      const { rows } = await getPool().query(
        `INSERT INTO competitor_posts (competitor_id, id, post_time, data)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (competitor_id, id) DO UPDATE
           SET post_time = EXCLUDED.post_time, data = EXCLUDED.data
         RETURNING (xmax = 0) AS inserted`,
        [competitorId, p.id, p.time || null, JSON.stringify(p)],
      );
      if (rows[0]?.inserted) added++;
    }
    return { added, total: await countPosts() };
  },

  async getCompetitorSyncRuns(competitorId, limit = 50) {
    const { rows } = await getPool().query(
      'SELECT data FROM competitor_sync_runs WHERE competitor_id = $1 ORDER BY started_at DESC LIMIT $2',
      [competitorId, limit],
    );
    return rows.map((r) => r.data as CompetitorSyncRun);
  },

  async addCompetitorSyncRun(competitorId, run) {
    await getPool().query(
      'INSERT INTO competitor_sync_runs (id, competitor_id, started_at, data) VALUES ($1,$2,$3,$4)',
      [run.id, competitorId, run.startedAt || null, JSON.stringify(run)],
    );
    return run;
  },
};

export { getPool, closePool } from './pool';
export default postgresRepository;
