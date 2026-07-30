// อ่านและตรวจ environment ครั้งเดียวตอนบูต แล้ว export เป็นค่าที่ type ชัด
// ไม่ throw เมื่อค่าไม่จำเป็นหาย — ระบบต้องรันได้แม้ไม่ได้ตั้ง token ของ integration
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** URL สาธารณะของเซิร์ฟเวอร์ (ใช้สร้าง webhook URL ให้ LINE) — ไม่ตั้งก็เดาจาก request */
  PUBLIC_BASE_URL: z.string().optional(),

  /** มีค่า → ใช้ Postgres, ไม่มี → เก็บไฟล์ JSON ใน data/ */
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: z.string().optional(),
  DATA_DIR: z.string().optional(),

  WAZZUP_BASE_URL: z.string().default('https://api.fareastfamelineddb.com'),

  /** ตั้งคู่นี้เพื่อให้แลก Page token เป็น long-lived อัตโนมัติ */
  FB_APP_ID: z.string().optional(),
  FB_APP_SECRET: z.string().optional(),

  APIFY_TOKEN: z.string().optional(),
  APIFY_API_TOKEN: z.string().optional(),
  APIFY_FB_ACTOR: z.string().default('apify~facebook-posts-scraper'),
  APIFY_API_BASE: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // ค่าที่ผิดรูปแบบ (เช่น PORT ไม่ใช่ตัวเลข) ถือว่าตั้งค่าผิด ต้องหยุดทันที
  console.error('[env] ตั้งค่า environment ไม่ถูกต้อง:', z.treeifyError(parsed.error));
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  /** ใช้ Postgres หรือไม่ */
  usePostgres: Boolean(raw.DATABASE_URL),
  /** ระบบแลก long-lived token อัตโนมัติได้หรือยัง (ส่งให้หน้าเว็บผ่าน /api/config) */
  longLivedTokens: Boolean(raw.FB_APP_ID && raw.FB_APP_SECRET),
  /** ตั้ง APIFY_TOKEN ไว้แล้วหรือยัง */
  apifyReady: Boolean(raw.APIFY_TOKEN || raw.APIFY_API_TOKEN),
} as const;

export type Env = typeof env;
