// ส่งต่อเคสภายในทีม
//
// ⚠️ กฎเหล็ก: เก็บ **แยกจาก messages โดยสิ้นเชิง** ไม่ merge เข้า messages เด็ดขาด
// เส้นทางส่งถึงลูกค้ามีเส้นเดียวคือ reply.service ซึ่งอ่านจาก messages เท่านั้น
// ข้อความที่ส่งต่อกันภายในจึงไม่มีทางหลุดถึงลูกค้า
import type { Forward } from '@inboxcenter/shared';
import { repository } from '../repositories';
import { AppError } from '../utils/app-error';

const MAX_TEXT = 2000;
const MAX_NAME = 60;
const MAX_RECIPIENTS = 20;

export interface ForwardInput {
  text?: unknown;
  fromName?: unknown;
  toNames?: unknown;
}

export async function addForward(conversationId: string, input: ForwardInput): Promise<Forward> {
  const conv = await repository.getConversation(conversationId);
  if (!conv) throw AppError.notFound('ไม่พบการสนทนานี้');

  const text = String(input.text ?? '')
    .trim()
    .slice(0, MAX_TEXT);
  if (!text) throw AppError.badRequest('กรุณาพิมพ์รายละเอียดที่ส่งต่อ');

  const toNames = Array.isArray(input.toNames)
    ? input.toNames
        .map((s) => String(s).trim().slice(0, MAX_NAME))
        .filter(Boolean)
        .slice(0, MAX_RECIPIENTS)
    : [];

  const entry: Forward = {
    id: `fw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fromName:
      String(input.fromName ?? 'ทีมงาน')
        .trim()
        .slice(0, MAX_NAME) || 'ทีมงาน',
    toNames,
    text,
    createdTime: new Date().toISOString(),
  };
  await repository.addForward(conv.id, entry);
  return entry;
}
