/**
 * Product Group ของ Agency Intelligence — แหล่งที่มาของ "เพจเรา + คู่แข่ง" ในหน้า Content
 *
 * เดิมสองอย่างนี้มาจากเมนู Admin ของเราเอง (PageConfig.competitors) ตอนนี้ย้ายไป
 * อ่านจากหน้า Brand & Competitors ของ Agency Intelligence แทน ผ่าน feed ที่เขาเตรียมไว้
 * (`/app-api/v1/report-feed/*`) — ที่นั่นเป็นที่เดียวที่ทีมกรอกคู่แข่งจริง
 */

/** เพจของเราในกลุ่มหนึ่ง — ตัวเลือกหนึ่งบรรทัดใน dropdown ของหน้า Content */
export interface ProductGroupPage {
  /** page id ของ Facebook — ว่างได้เมื่อกลุ่มนั้นยังไม่ได้เลือกเพจใน Agency Intelligence */
  pageId: string;
  name: string;
  pictureUrl: string;
  /** เชื่อมเพจนี้ใน Inbox Center แล้วหรือยัง — ยังไม่เชื่อม = ไม่มี token ดึงโพสต์ไม่ได้ */
  connected: boolean;
}

/** คู่แข่งของกลุ่ม — map เข้ากับเพจคู่แข่งของเราแล้ว (id เดียวกับ /api/competitors) */
export interface ProductGroupCompetitor {
  /** cmp_<handle> — ตรงกับ id ใน /api/competitors เสมอ */
  id: string;
  name: string;
  url: string;
  handle: string;
  pictureUrl: string;
  postCount: number;
  /** สถานะการดึงโพสต์ — แถบล่างของหน้า Content อ่านจากที่นี่ ไม่ยิง API ซ้ำ */
  lastSyncAt: string | null;
  coveredFrom: string | null;
  coveredTo: string | null;
}

export interface ProductGroup {
  id: string;
  name: string;
  color: string;
  logoUrl: string | null;
  /** ชื่อแบรนด์ที่ปักหมุดไว้ในหน้า Brand & Competitors — ว่างได้ถ้ายังไม่ปักหมุด */
  pinnedName: string;
  pinnedUrl: string;
  pages: ProductGroupPage[];
  competitors: ProductGroupCompetitor[];
}

export interface ProductGroupListResponse {
  items: ProductGroup[];
  /** ตั้ง AGENCY_BASE_URL + REPORT_SERVICE_KEY ครบแล้วหรือยัง */
  ready: boolean;
  /** ต่อ feed ไม่ได้ (ปลายทางล่ม / คีย์ผิด) — หน้าเว็บเอาไปบอกผู้ใช้ ไม่ใช่แสดงว่าง ๆ */
  error?: string;
}
