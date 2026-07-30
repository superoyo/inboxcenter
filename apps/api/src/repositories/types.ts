// สัญญาของชั้น storage — มี 2 implementation (ไฟล์ JSON / PostgreSQL) ที่ต้องเหมือนกันเป๊ะ
// เดิมต้องเทียบ export ด้วยมือ ตอนนี้ TypeScript บังคับให้ตรงกันตอน compile
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
  UrgencyLevel,
} from '@inboxcenter/shared';

/** เพจตามที่เก็บใน storage — ยังมี token/secret อยู่ (ชั้น service ต้องตัดออกก่อนส่งออก API) */
export interface StoredPage {
  id: string;
  name: string;
  pictureUrl: string;
  accessToken: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  platform?: string;
  channelId?: string;
  channelSecret?: string;
  basicId?: string;
  [key: string]: unknown;
}

export interface ProfilePicEntry {
  url: string;
  fetchedAt: string;
}

/** map: conversationId → ค่า */
export type TagsMap = Record<string, string[]>;
export type RemarksMap = Record<string, string>;
export type StatusMap = Record<string, UrgencyLevel | string>;
export type ForwardsMap = Record<string, Forward[]>;
export type PageConfigMapStored = Record<string, PageConfig>;
export type ProfilePicCache = Record<string, ProfilePicEntry>;

export interface UpsertPostsResult {
  /** จำนวนโพสต์ "ใหม่" ที่เพิ่มเข้ามา (ที่มีอยู่แล้วนับเป็นการอัปเดต) */
  added: number;
  total: number;
}

export interface StorageRepository {
  /** สร้างตาราง/เตรียม storage (ฝั่งไฟล์เป็น no-op) */
  init(): Promise<void>;

  // ---- Pages ----
  getPages(): Promise<StoredPage[]>;
  savePage(page: StoredPage): Promise<StoredPage>;
  /** ลบเพจ + ข้อความของเพจนั้น */
  deletePage(pageId: string): Promise<void>;

  // ---- Conversations ----
  /** เขียนทับทั้งเพจ (ใช้ตอน full sync) */
  saveConversations(pageId: string, conversations: Conversation[]): Promise<void>;
  /** merge เข้ากับของเดิม ไม่ลบห้องเก่า (ใช้ตอน incremental sync) */
  upsertConversations(pageId: string, conversations: Conversation[]): Promise<void>;
  /** อัปเดตห้องเดียว (ใช้ตอนตอบกลับ ไม่ต้องเขียนทั้งเพจ) */
  saveConversation(conversation: Conversation): Promise<void>;
  getAllConversations(): Promise<Conversation[]>;
  getConversationsForPage(pageId: string): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation | null>;

  // ---- Profile picture cache ----
  getPicCache(): Promise<ProfilePicCache>;
  savePics(entries: ProfilePicCache): Promise<void>;

  // ---- Annotations (เก็บแยกจากข้อมูลแชท จะได้ไม่หายตอน sync ทับ) ----
  getTags(): Promise<TagsMap>;
  setTags(conversationId: string, tags: string[]): Promise<void>;
  getRemarks(): Promise<RemarksMap>;
  setRemark(conversationId: string, remark: string): Promise<void>;
  getStatuses(): Promise<StatusMap>;
  setStatus(conversationId: string, status: string): Promise<void>;

  // ---- Saved replies (แยกตามเพจ) ----
  getSavedReplies(pageId: string): Promise<SavedReply[]>;
  addSavedReply(pageId: string, entry: SavedReply): Promise<SavedReply>;
  updateSavedReply(
    pageId: string,
    replyId: string,
    fields: Partial<SavedReply>,
  ): Promise<SavedReply | null>;
  deleteSavedReply(pageId: string, replyId: string): Promise<void>;

  // ---- Sync history (เก็บ 50 ครั้งล่าสุด) ----
  getSyncRuns(limit?: number): Promise<SyncRun[]>;
  addSyncRun(run: SyncRun): Promise<void>;

  // ---- Settings ----
  getSetting<T = unknown>(key: string, fallback?: T | null): Promise<T | null>;
  setSetting(key: string, value: unknown): Promise<void>;

  // ---- Projects ----
  getProjects(): Promise<Project[]>;
  saveProject(project: Project): Promise<Project>;
  deleteProject(id: string): Promise<void>;

  // ---- Page config (Admin) ----
  getPageConfigs(): Promise<PageConfigMapStored>;
  setPageConfig(pageId: string, config: PageConfig): Promise<PageConfig>;

  // ---- Forwards (ส่งต่อเคสภายในทีม — เก็บแยกจาก messages เด็ดขาด) ----
  getForwards(): Promise<ForwardsMap>;
  addForward(conversationId: string, entry: Forward): Promise<Forward>;

  // ---- Competitors ----
  getCompetitors(): Promise<Competitor[]>;
  saveCompetitor(competitor: Competitor): Promise<Competitor>;
  deleteCompetitor(id: string): Promise<void>;
  getCompetitorPosts(competitorId: string): Promise<CompetitorPost[]>;
  upsertCompetitorPosts(competitorId: string, posts: CompetitorPost[]): Promise<UpsertPostsResult>;
  getCompetitorSyncRuns(competitorId: string, limit?: number): Promise<CompetitorSyncRun[]>;
  addCompetitorSyncRun(competitorId: string, run: CompetitorSyncRun): Promise<CompetitorSyncRun>;
}
