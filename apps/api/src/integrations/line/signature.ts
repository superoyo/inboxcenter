// ตรวจลายเซ็น webhook ของ LINE — เป็นด่านความปลอดภัยเดียวของ endpoint นี้
// (webhook ไม่ผ่าน requireAuth เพราะ LINE เรียกเข้ามาเอง)
import crypto from 'node:crypto';

/**
 * ตรวจว่า base64(HMAC-SHA256(channelSecret, rawBody)) === X-Line-Signature
 * ต้องใช้ **rawBody** (Buffer/string ดิบ) ไม่ใช่ JSON ที่ parse แล้ว ไม่งั้นลายเซ็นไม่ตรง
 */
export function verifySignature(
  channelSecret: string | undefined | null,
  rawBody: Buffer | string | undefined | null,
  signature: string | string[] | undefined | null,
): boolean {
  if (!channelSecret || !rawBody || !signature || Array.isArray(signature)) return false;
  const expected = crypto.createHmac('SHA256', channelSecret).update(rawBody).digest('base64');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    // เทียบแบบ timing-safe กันการเดาลายเซ็นจากเวลาที่ใช้เทียบ
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
