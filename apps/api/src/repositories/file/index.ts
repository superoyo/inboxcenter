// Storage backend: ไฟล์ JSON ในโฟลเดอร์ data/ — ใช้ตอนรันในเครื่อง (ไม่มี DATABASE_URL)
// ทุกฟังก์ชันเป็น async ให้ interface ตรงกับฝั่ง Postgres (บังคับด้วย StorageRepository)
import type {
  Competitor,
  CompetitorPost,
  CompetitorSyncRun,
  Conversation,
  Project,
  SavedReply,
  SyncRun,
} from '@inboxcenter/shared';
import { FILES, readJson, writeJson } from './json-file';
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

type ConversationMap = Record<string, Conversation[]>;
type SavedReplyMap = Record<string, SavedReply[]>;
type CompetitorPostMap = Record<string, CompetitorPost[]>;
type CompetitorRunMap = Record<string, CompetitorSyncRun[]>;

const MAX_SYNC_RUNS = 50;

export const fileRepository: StorageRepository = {
  async init() {
    // ไม่ต้องเตรียมอะไร — readJson สร้าง fallback ให้เอง และ writeJson สร้างโฟลเดอร์ตอนเขียน
  },

  // ---- Pages ----
  async getPages() {
    return readJson<StoredPage[]>(FILES.pages, []);
  },

  async savePage(page) {
    const pages = readJson<StoredPage[]>(FILES.pages, []).filter((p) => p.id !== page.id);
    pages.push(page);
    writeJson(FILES.pages, pages);
    return page;
  },

  async deletePage(pageId) {
    writeJson(
      FILES.pages,
      readJson<StoredPage[]>(FILES.pages, []).filter((p) => p.id !== pageId),
    );
    const convs = readJson<ConversationMap>(FILES.conversations, {});
    delete convs[pageId];
    writeJson(FILES.conversations, convs);
  },

  // ---- Conversations ----
  async saveConversations(pageId, conversations) {
    const map = readJson<ConversationMap>(FILES.conversations, {});
    map[pageId] = conversations;
    writeJson(FILES.conversations, map);
  },

  /** merge conversations ที่อัปเดตเข้ากับของเดิม (ใช้ตอน incremental sync — ไม่ลบห้องเก่า) */
  async upsertConversations(pageId, conversations) {
    const map = readJson<ConversationMap>(FILES.conversations, {});
    const byId = new Map((map[pageId] || []).map((c) => [c.id, c]));
    for (const c of conversations) byId.set(c.id, c);
    map[pageId] = [...byId.values()];
    writeJson(FILES.conversations, map);
  },

  async saveConversation(conversation) {
    const map = readJson<ConversationMap>(FILES.conversations, {});
    const list = map[conversation.pageId] || [];
    const idx = list.findIndex((c) => c.id === conversation.id);
    if (idx >= 0) list[idx] = conversation;
    else list.push(conversation);
    map[conversation.pageId] = list;
    writeJson(FILES.conversations, map);
  },

  async getAllConversations() {
    return Object.values(readJson<ConversationMap>(FILES.conversations, {})).flat();
  },

  async getConversationsForPage(pageId) {
    return readJson<ConversationMap>(FILES.conversations, {})[pageId] || [];
  },

  /** ดึงห้องเดียวตาม id (ใช้ตอนเปิดแชท — โหลดข้อความเต็มเฉพาะห้องที่เปิด) */
  async getConversation(id) {
    for (const list of Object.values(readJson<ConversationMap>(FILES.conversations, {}))) {
      const c = list.find((x) => x.id === id);
      if (c) return c;
    }
    return null;
  },

  // ---- Profile picture cache ----
  async getPicCache() {
    return readJson<ProfilePicCache>(FILES.pics, {});
  },

  /** upsert เฉพาะรายการใหม่/ที่เปลี่ยน */
  async savePics(entries) {
    const cache = readJson<ProfilePicCache>(FILES.pics, {});
    Object.assign(cache, entries);
    writeJson(FILES.pics, cache);
  },

  // ---- Annotations (เก็บแยกจากข้อมูลแชท จะได้ไม่หายตอน sync ทับ) ----
  async getTags() {
    return readJson<TagsMap>(FILES.tags, {});
  },

  async setTags(conversationId, tags) {
    const map = readJson<TagsMap>(FILES.tags, {});
    if (tags.length) map[conversationId] = tags;
    else delete map[conversationId];
    writeJson(FILES.tags, map);
  },

  async getRemarks() {
    return readJson<RemarksMap>(FILES.remarks, {});
  },

  async setRemark(conversationId, remark) {
    const map = readJson<RemarksMap>(FILES.remarks, {});
    if (remark) map[conversationId] = remark;
    else delete map[conversationId];
    writeJson(FILES.remarks, map);
  },

  async getStatuses() {
    return readJson<StatusMap>(FILES.statuses, {});
  },

  async setStatus(conversationId, status) {
    const map = readJson<StatusMap>(FILES.statuses, {});
    if (status) map[conversationId] = status;
    else delete map[conversationId];
    writeJson(FILES.statuses, map);
  },

  // ---- Saved replies (แยกตามเพจ) ----
  async getSavedReplies(pageId) {
    return readJson<SavedReplyMap>(FILES.savedReplies, {})[pageId] || [];
  },

  async addSavedReply(pageId, entry) {
    const map = readJson<SavedReplyMap>(FILES.savedReplies, {});
    map[pageId] = map[pageId] || [];
    map[pageId]!.push(entry);
    writeJson(FILES.savedReplies, map);
    return entry;
  },

  async updateSavedReply(pageId, replyId, fields) {
    const map = readJson<SavedReplyMap>(FILES.savedReplies, {});
    const entry = (map[pageId] || []).find((r) => r.id === replyId);
    if (entry) {
      Object.assign(entry, fields);
      writeJson(FILES.savedReplies, map);
    }
    return entry || null;
  },

  async deleteSavedReply(pageId, replyId) {
    const map = readJson<SavedReplyMap>(FILES.savedReplies, {});
    map[pageId] = (map[pageId] || []).filter((r) => r.id !== replyId);
    writeJson(FILES.savedReplies, map);
  },

  // ---- Sync history ----
  async getSyncRuns(limit = MAX_SYNC_RUNS) {
    return readJson<SyncRun[]>(FILES.syncHistory, []).slice(0, limit);
  },

  async addSyncRun(run) {
    const runs = readJson<SyncRun[]>(FILES.syncHistory, []);
    runs.unshift(run);
    writeJson(FILES.syncHistory, runs.slice(0, MAX_SYNC_RUNS));
  },

  // ---- Settings ----
  async getSetting<T = unknown>(key: string, fallback: T | null = null) {
    const s = readJson<Record<string, T>>(FILES.settings, {});
    return key in s ? (s[key] as T) : fallback;
  },

  async setSetting(key, value) {
    const s = readJson<Record<string, unknown>>(FILES.settings, {});
    s[key] = value;
    writeJson(FILES.settings, s);
  },

  // ---- Projects ----
  async getProjects() {
    return readJson<Project[]>(FILES.projects, []);
  },

  async saveProject(project) {
    const list = readJson<Project[]>(FILES.projects, []).filter((p) => p.id !== project.id);
    list.push(project);
    writeJson(FILES.projects, list);
    return project;
  },

  async deleteProject(id) {
    writeJson(
      FILES.projects,
      readJson<Project[]>(FILES.projects, []).filter((p) => p.id !== id),
    );
  },

  // ---- Page config (Admin) ----
  async getPageConfigs() {
    return readJson<PageConfigMapStored>(FILES.pageConfig, {});
  },

  async setPageConfig(pageId, config) {
    const map = readJson<PageConfigMapStored>(FILES.pageConfig, {});
    map[pageId] = config;
    writeJson(FILES.pageConfig, map);
    return config;
  },

  // ---- Forwards (ส่งต่อเคสภายในทีม — แยกจาก messages ไม่มีทางส่งถึงลูกค้า) ----
  async getForwards() {
    return readJson<ForwardsMap>(FILES.forwards, {});
  },

  async addForward(conversationId, entry) {
    const map = readJson<ForwardsMap>(FILES.forwards, {});
    (map[conversationId] = map[conversationId] || []).push(entry);
    writeJson(FILES.forwards, map);
    return entry;
  },

  // ---- Competitors ----
  async getCompetitors() {
    return readJson<Competitor[]>(FILES.competitors, []);
  },

  async saveCompetitor(competitor) {
    const list = readJson<Competitor[]>(FILES.competitors, []).filter(
      (x) => x.id !== competitor.id,
    );
    list.push(competitor);
    writeJson(FILES.competitors, list);
    return competitor;
  },

  async deleteCompetitor(id) {
    writeJson(
      FILES.competitors,
      readJson<Competitor[]>(FILES.competitors, []).filter((x) => x.id !== id),
    );
    const posts = readJson<CompetitorPostMap>(FILES.competitorPosts, {});
    delete posts[id];
    writeJson(FILES.competitorPosts, posts);
    const runs = readJson<CompetitorRunMap>(FILES.competitorSync, {});
    delete runs[id];
    writeJson(FILES.competitorSync, runs);
  },

  async getCompetitorPosts(competitorId) {
    return readJson<CompetitorPostMap>(FILES.competitorPosts, {})[competitorId] || [];
  },

  /** dedup ด้วย post.id — โพสต์เก่าไม่เปลี่ยน จึงเก็บทับได้ปลอดภัย */
  async upsertCompetitorPosts(competitorId, posts): Promise<UpsertPostsResult> {
    const map = readJson<CompetitorPostMap>(FILES.competitorPosts, {});
    const existing = map[competitorId] || [];
    const byId = new Map(existing.map((p) => [p.id, p]));
    let added = 0;
    for (const p of posts) {
      if (!byId.has(p.id)) added++;
      byId.set(p.id, { ...(byId.get(p.id) || {}), ...p });
    }
    const merged = [...byId.values()].sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
    );
    map[competitorId] = merged;
    writeJson(FILES.competitorPosts, map);
    return { added, total: merged.length };
  },

  async getCompetitorSyncRuns(competitorId, limit = MAX_SYNC_RUNS) {
    return (readJson<CompetitorRunMap>(FILES.competitorSync, {})[competitorId] || []).slice(
      0,
      limit,
    );
  },

  async addCompetitorSyncRun(competitorId, run) {
    const map = readJson<CompetitorRunMap>(FILES.competitorSync, {});
    const list = map[competitorId] || [];
    list.unshift(run);
    map[competitorId] = list.slice(0, MAX_SYNC_RUNS);
    writeJson(FILES.competitorSync, map);
    return run;
  },
};

export { readJson, writeJson, FILES, DATA_DIR } from './json-file';
export default fileRepository;
