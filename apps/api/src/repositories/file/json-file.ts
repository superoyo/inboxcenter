// อ่าน/เขียนไฟล์ JSON ใน data/ — ชั้นล่างสุดของ storage แบบไฟล์
import fs from 'node:fs';
import path from 'node:path';

/** ตำแหน่งโฟลเดอร์ข้อมูล — ตั้งทับได้ด้วย DATA_DIR (ใช้ตอนทดสอบ/แยก environment) */
export const DATA_DIR =
  process.env.DATA_DIR || path.join(__dirname, '..', '..', '..', '..', '..', 'data');

export const FILES = {
  pages: 'pages.json',
  conversations: 'conversations.json',
  pics: 'profile-pics.json',
  tags: 'tags.json',
  remarks: 'remarks.json',
  statuses: 'statuses.json',
  savedReplies: 'saved-replies.json',
  syncHistory: 'sync-history.json',
  projects: 'projects.json',
  pageConfig: 'page-config.json',
  settings: 'settings.json',
  forwards: 'forwards.json',
  caseEvents: 'case-events.json',
  attachments: 'attachments.json',
  competitors: 'competitors.json',
  competitorPosts: 'competitor-posts.json',
  competitorSync: 'competitor-sync.json',
} as const;

export type DataFile = (typeof FILES)[keyof typeof FILES];

const filePath = (file: DataFile): string => path.join(DATA_DIR, file);

/** ไฟล์หาย/พังก็คืน fallback — ระบบยังทำงานต่อได้ */
export function readJson<T>(file: DataFile, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath(file), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: DataFile, data: unknown): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath(file), JSON.stringify(data, null, 2), 'utf8');
}
