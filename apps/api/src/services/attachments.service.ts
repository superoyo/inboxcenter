// ไฟล์แนบที่ส่งให้ลูกค้า
//
// Facebook และ LINE ไม่รับไฟล์อัปโหลดตรง ทั้งคู่ "ไปดึงเอง" จาก URL ที่เราให้
// เราจึงต้องเก็บไฟล์ไว้ที่ตัวเองแล้วเสิร์ฟออกไปที่ /api/attachments/:id
//
// ⚠️ เส้นเสิร์ฟไฟล์เปิดสาธารณะ (ไม่ผ่าน requireAuth) เพราะ Facebook/LINE
// เข้ามาดึงโดยไม่มี token ของเรา — ความปลอดภัยจึงอยู่ที่ id ที่เดาไม่ได้ (สุ่ม 32 ไบต์)
import { randomBytes } from 'node:crypto';
import type { StoredAttachment } from '@inboxcenter/shared';
import { repository } from '../repositories';
import { AppError } from '../utils/app-error';

/** ขนาดไฟล์สูงสุด — อ้างเพดานของ Facebook Send API (25MB) แล้วเผื่อลงมา */
export const MAX_SIZE = 20 * 1024 * 1024;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const DOC_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]);

export const isImage = (mimeType: string): boolean => IMAGE_TYPES.has(mimeType.toLowerCase());

export interface SaveInput {
  conversationId: string;
  name: string;
  mimeType: string;
  data: Buffer;
}

export async function save(input: SaveInput): Promise<StoredAttachment> {
  if (!input.data || !input.data.length) throw AppError.badRequest('ไม่มีข้อมูลไฟล์');
  if (input.data.length > MAX_SIZE) {
    throw AppError.badRequest(`ไฟล์ใหญ่เกิน ${Math.round(MAX_SIZE / 1024 / 1024)}MB`);
  }
  const mimeType = (input.mimeType || '').toLowerCase().split(';')[0]!.trim();
  if (!isImage(mimeType) && !DOC_TYPES.has(mimeType)) {
    throw AppError.badRequest(`ยังไม่รองรับไฟล์ชนิด ${mimeType || 'ไม่ทราบชนิด'}`);
  }

  const meta: StoredAttachment = {
    id: randomBytes(24).toString('base64url'),
    conversationId: input.conversationId,
    // กันชื่อไฟล์แปลก ๆ ที่อาจถูกใส่ใน header ตอนเสิร์ฟกลับ
    name: (input.name || 'file').replace(/[\r\n"\\]/g, '').slice(0, 200),
    mimeType,
    size: input.data.length,
    createdAt: new Date().toISOString(),
  };
  await repository.saveAttachment(meta, input.data);
  return meta;
}

export async function read(id: string): Promise<{ meta: StoredAttachment; data: Buffer }> {
  const found = await repository.getAttachment(id);
  if (!found) throw AppError.notFound('ไม่พบไฟล์นี้');
  return found;
}
