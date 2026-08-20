// LINE Messaging API — ข้อมูลบอท / โปรไฟล์ผู้ใช้ / ส่งข้อความ
import { lineFetch } from './client';

export interface LineBotInfo {
  userId: string;
  basicId?: string;
  displayName?: string;
  pictureUrl?: string;
  chatMode?: string;
  markAsReadMode?: string;
}

export interface LineUserProfile {
  userId: string;
  displayName?: string;
  pictureUrl?: string;
  statusMessage?: string;
  language?: string;
}

/** ตรวจ token + ดึงข้อมูลบอท (ชื่อ, รูป, basicId) — ใช้ยืนยันตอนเชื่อมต่อ */
export async function getBotInfo(token: string): Promise<LineBotInfo> {
  return lineFetch<LineBotInfo>('/v2/bot/info', token);
}

/** โปรไฟล์ผู้ใช้ที่ทักเข้ามา (ต้องเป็น follower ของ OA) */
export async function getProfile(token: string, userId: string): Promise<LineUserProfile> {
  return lineFetch<LineUserProfile>(`/v2/bot/profile/${encodeURIComponent(userId)}`, token);
}

/** ส่งข้อความหาผู้ใช้ (push) — reply token มีอายุสั้น จึงใช้ push เพื่อความชัวร์ */
export async function pushMessage(token: string, to: string, text: string): Promise<unknown> {
  return lineFetch('/v2/bot/message/push', token, {
    method: 'POST',
    body: JSON.stringify({ to, messages: [{ type: 'text', text: String(text).slice(0, 5000) }] }),
  });
}

/**
 * ส่งรูปให้ผู้ใช้ LINE — ต้องเป็น URL สาธารณะแบบ HTTPS เท่านั้น (LINE ไปดึงเอง)
 * LINE ไม่มีชนิดข้อความสำหรับไฟล์เอกสาร จึงส่ง pdf/doc ทางนี้ไม่ได้
 */
export async function pushImage(token: string, to: string, imageUrl: string): Promise<unknown> {
  return lineFetch('/v2/bot/message/push', token, {
    method: 'POST',
    body: JSON.stringify({
      to,
      messages: [{ type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl }],
    }),
  });
}
