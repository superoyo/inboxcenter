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

  // ---- IAMService (ผู้ให้บริการ identity / SSO hub ขององค์กร) ----
  // ดู docs/IAM-SSO.md — ต้องให้ admin ของ IAM ลงทะเบียน origin ของเราเป็น System ก่อนใช้
  IAM_BASE_URL: z.string().default('https://iam.fareastfamelineddb.com'),
  /** '1'/'true' = เปิดปุ่ม SSO ให้หน้าเว็บ · ปิดไว้เป็นค่าเริ่มต้นจนกว่า origin จะลงทะเบียนแล้ว */
  IAM_SSO_ENABLED: z.string().optional(),
  /**
   * ตั้งค่านี้เมื่อได้ shared secret จาก IAM แล้ว → requireAuth จะ verify ลายเซ็น HS256 ด้วย
   * ไม่ตั้ง = เช็คแค่ exp เหมือนเดิม (พฤติกรรมปัจจุบัน)
   */
  IAM_JWT_SECRET: z.string().optional(),
  /** ตรวจ iss / aud เพิ่ม — ตั้งเฉพาะเมื่อ IAM_JWT_SECRET ถูกตั้งแล้ว (ไม่ตั้ง = ไม่ตรวจช่องนั้น) */
  IAM_JWT_ISSUER: z.string().optional(),
  IAM_JWT_AUDIENCE: z.string().optional(),

  /** ตั้งคู่นี้เพื่อให้แลก Page token เป็น long-lived อัตโนมัติ */
  FB_APP_ID: z.string().optional(),
  FB_APP_SECRET: z.string().optional(),

  // ---- ระบบตรวจโฆษณาอาหารของ อย. (fdavalidation) ----
  // ⚠️ key อยู่ฝั่ง server เท่านั้น หน้าเว็บเรียกผ่าน /api/fda/check ของเรา
  FDA_BASE_URL: z.string().default('https://fdavalidation-production.up.railway.app'),
  FDA_API_KEY: z.string().optional(),

  // ---- Agency Intelligence (feed Product Group + คู่แข่ง) ----
  // ⚠️ key อยู่ฝั่ง server เท่านั้น หน้าเว็บเรียกผ่าน /api/product-groups ของเรา
  /** เช่น https://agencyintelligence.fareastfameline.com (ไม่ต้องมี /app-api ต่อท้าย) */
  AGENCY_BASE_URL: z.string().optional(),
  /** shared secret ที่ต้องตรงกับ REPORT_SERVICE_KEY ฝั่ง Agency Intelligence */
  REPORT_SERVICE_KEY: z.string().optional(),

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
  /** ตั้ง FDA_API_KEY แล้วหรือยัง (ส่งให้หน้าเว็บผ่าน /api/config เพื่อซ่อน/แสดงปุ่ม) */
  fdaReady: Boolean(raw.FDA_API_KEY),
  /** เปิดทางเข้าแบบ SSO ให้หน้าเว็บหรือยัง */
  ssoEnabled: /^(1|true|yes)$/i.test(raw.IAM_SSO_ENABLED ?? ''),
  /** มี secret แล้ว → requireAuth verify ลายเซ็น token ได้ */
  verifyTokenSignature: Boolean(raw.IAM_JWT_SECRET),
} as const;

export type Env = typeof env;
