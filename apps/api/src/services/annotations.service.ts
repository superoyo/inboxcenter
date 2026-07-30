// แท็ก / โน้ต / สถานะสี ของห้องแชท
// เก็บแยกจากข้อมูลแชท เพราะตารางแชทถูกเขียนทับทุกครั้งที่ sync
import type { UrgencyLevel } from '@inboxcenter/shared';
import { repository } from '../repositories';
import { AppError } from '../utils/app-error';

const LEVELS: UrgencyLevel[] = ['red', 'yellow', 'green'];
const LIMITS = { remark: 2_000, tag: 30, tags: 10 } as const;

export async function setStatus(conversationId: string, status: unknown): Promise<string> {
  if (status && !LEVELS.includes(status as UrgencyLevel)) {
    throw AppError.badRequest('status ต้องเป็น red / yellow / green หรือค่าว่าง');
  }
  // ค่าว่าง = ล้างสถานะที่ผู้ใช้กำหนดเอง กลับไปใช้ค่าอัตโนมัติ
  await repository.setStatus(conversationId, (status as string) || '');
  return (status as string) || '';
}

export async function setRemark(conversationId: string, remark: unknown): Promise<string> {
  if (typeof remark !== 'string') throw AppError.badRequest('remark ต้องเป็นข้อความ');
  const clean = remark.trim().slice(0, LIMITS.remark);
  await repository.setRemark(conversationId, clean);
  return clean;
}

export async function setTags(conversationId: string, tags: unknown): Promise<string[]> {
  if (!Array.isArray(tags)) throw AppError.badRequest('tags ต้องเป็น array');
  const clean = [
    ...new Set(tags.map((t) => String(t).trim().slice(0, LIMITS.tag)).filter(Boolean)),
  ].slice(0, LIMITS.tags);
  await repository.setTags(conversationId, clean);
  return clean;
}
