// feed ของ Agency Intelligence — Product Group + แบรนด์/คู่แข่งบน Facebook
//
// ⚠️ REPORT_SERVICE_KEY อยู่ฝั่ง server เท่านั้น ห้ามส่งลงไปถึงเบราว์เซอร์
// หน้าเว็บเรียกผ่าน /api/product-groups ของเรา แล้วเราค่อยแนบคีย์ยิงต่อ
// (เหมือน FDA_API_KEY ที่ integrations/fda ทำ)
//
// ฝั่งนั้นเปิดเส้นนี้ไว้เป็นข้อยกเว้นข้อเดียวของกฎ "ไม่มี service key" ใช้อ่านได้อย่างเดียว
// ดู AgencyIntelligence/docs/SYSTEM-INTEGRATION-GUIDELINE.md หัวข้อ report-feed
import { env } from '../../config/env';
import { AppError } from '../../utils/app-error';

/** กลุ่มสินค้าหนึ่งกลุ่มตามที่ feed ส่งมา */
export interface FeedGroup {
  id: string;
  name: string;
  color: string;
  logoUrl: string | null;
  facebookBrands: number;
  /** page id ของเพจเราที่ล็อกไว้ให้กลุ่มนี้ — ก้อนว่าง = ยังไม่ได้เลือกเพจ */
  pageIds: string[];
  /** ชื่อคู่แข่งที่ติ๊กเข้า Content Analysis ไว้แล้วแต่ยังไม่ได้กรอกลิงก์ Facebook */
  analysisNoLink?: string[];
}

/** แบรนด์หนึ่งรายในกลุ่ม — `owned: true` = เพจที่ปักหมุด (ของเราเอง) ไม่ใช่คู่แข่ง */
export interface FeedBrand {
  key: string;
  name: string;
  url: string;
  owned: boolean;
}

/** ตั้งค่าครบพอที่จะเรียก feed ได้หรือยัง */
export const isConfigured = (): boolean => Boolean(env.AGENCY_BASE_URL && env.REPORT_SERVICE_KEY);

async function get<T>(path: string): Promise<T> {
  if (!isConfigured()) {
    throw AppError.badRequest(
      'ยังไม่ได้ตั้ง AGENCY_BASE_URL หรือ REPORT_SERVICE_KEY ที่ฝั่งเซิร์ฟเวอร์ — ' +
        'อ่าน Product Group จาก Agency Intelligence ไม่ได้',
    );
  }
  const base = env.AGENCY_BASE_URL!.replace(/\/+$/, '');

  let res: Response;
  try {
    res = await fetch(`${base}/app-api/v1/report-feed${path}`, {
      headers: { 'X-Service-Key': env.REPORT_SERVICE_KEY! },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw AppError.upstream('เชื่อมต่อ Agency Intelligence ไม่ได้ กรุณาลองใหม่');
  }

  // 401 = คีย์ผิด/ถูกถอด · 503 = ฝั่งนั้นยังไม่ได้ตั้ง REPORT_SERVICE_KEY
  // ทั้งคู่เป็นปัญหาการตั้งค่า ไม่ใช่ผู้ใช้ทำอะไรผิด — บอกให้ชัดว่าต้องไปแก้ที่ไหน
  if (res.status === 401)
    throw AppError.upstream(
      'Agency Intelligence ปฏิเสธคีย์ที่ใช้เรียก — ต้องตรวจ REPORT_SERVICE_KEY',
    );
  if (res.status === 503)
    throw AppError.upstream(
      'Agency Intelligence ยังไม่ได้ตั้ง REPORT_SERVICE_KEY ฝั่งเซิร์ฟเวอร์เขา',
    );
  if (!res.ok) throw AppError.upstream(`Agency Intelligence ตอบกลับผิดพลาด (${res.status})`);

  return (await res.json()) as T;
}

/** Product Group ที่ถูก enable เข้า My Job แล้ว (กลุ่มในแคตตาล็อกที่ยังไม่ enable ไม่มาด้วย) */
export const listGroups = (): Promise<FeedGroup[]> => get<FeedGroup[]>('/groups');

/** แบรนด์ที่มีลิงก์ Facebook ของกลุ่มหนึ่ง — ฝั่งนั้นตัดแบรนด์ที่ไม่มีลิงก์ออกให้แล้ว */
export const listBrands = (groupId: string): Promise<FeedBrand[]> =>
  get<FeedBrand[]>(`/groups/${encodeURIComponent(groupId)}/brands`);
