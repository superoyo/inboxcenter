// ระบบตรวจโฆษณาอาหารของ อย. (fdavalidation) — ตรวจข้อความกับหลักเกณฑ์การโฆษณาอาหาร พ.ศ. 2569
//
// ⚠️ API key อยู่ฝั่ง server เท่านั้น (env FDA_API_KEY) ห้ามส่งลงไปถึงเบราว์เซอร์
// หน้าเว็บเรียกผ่าน /api/fda/check ของเรา แล้วเราค่อยแนบ key ยิงต่อ
import { env } from '../../config/env';
import { AppError } from '../../utils/app-error';

/** ข้อความยาวเกินนี้ถูกตัด — กันยิง payload ใหญ่เกินจำเป็น (โพสต์ FB ยาวสุดราว 5,000 ตัว) */
export const MAX_TEXT = 8000;

export interface FdaCheckInput {
  text: string;
  /** หมวดอาหาร (ไม่ระบุ = ให้ระบบตรวจจับเอง) */
  productCategory?: string | string[];
  mediaType?: 'print' | 'audio' | 'audiovisual';
  /** ผลิตภัณฑ์เป็นอาหารควบคุมน้ำหนักที่ อย. อนุญาตแล้ว */
  weightControlApproved?: boolean;
}

/** ผลดิบจากระบบ อย. — ประกาศเฉพาะฟิลด์ที่เราใช้ (ของจริงมีมากกว่านี้) */
export interface RawFdaResponse {
  verdict?: string;
  verdictLabel?: string;
  riskLevel?: string;
  riskScore?: number;
  violations?: unknown[];
  approvalsRequired?: unknown[];
  conditionalItems?: unknown[];
  requiredWarnings?: unknown[];
  recommendations?: unknown[];
  manualChecks?: unknown[];
  suggestedRewrite?: { markedText?: string };
  regulation?: { title?: string };
  checkedAt?: string;
}

export async function check(input: FdaCheckInput): Promise<RawFdaResponse> {
  if (!env.FDA_API_KEY) {
    throw AppError.badRequest(
      'ยังไม่ได้ตั้งค่า FDA_API_KEY ที่ฝั่งเซิร์ฟเวอร์ — ตรวจกับระบบ อย. ไม่ได้',
    );
  }
  const base = env.FDA_BASE_URL.replace(/\/+$/, '');

  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': env.FDA_API_KEY },
      body: JSON.stringify({
        text: input.text.slice(0, MAX_TEXT),
        ...(input.productCategory ? { productCategory: input.productCategory } : {}),
        ...(input.mediaType ? { mediaType: input.mediaType } : {}),
        ...(input.weightControlApproved ? { weightControlApproved: true } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw AppError.upstream('เชื่อมต่อระบบตรวจโฆษณาของ อย. ไม่ได้ กรุณาลองใหม่');
  }

  // 401 = คีย์ผิด/ถูกถอด — เป็นปัญหาการตั้งค่าฝั่งเรา ไม่ใช่ผู้ใช้ทำอะไรผิด
  if (res.status === 401)
    throw AppError.upstream('ระบบ อย. ปฏิเสธคีย์ที่ใช้เรียก — ต้องตรวจสอบ FDA_API_KEY');
  if (!res.ok) throw AppError.upstream(`ระบบ อย. ตอบกลับผิดพลาด (${res.status})`);

  return (await res.json()) as RawFdaResponse;
}
