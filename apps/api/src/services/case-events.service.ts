// สถานะเคส: "ปิดเคส" และ "รอคำตอบ"
//
// ⚠️ กฎเดียวกับ forwards: เก็บแยกจาก messages โดยสิ้นเชิง ลูกค้าไม่เห็นเด็ดขาด
// เส้นทางส่งถึงลูกค้าอ่านจาก messages เท่านั้น (reply.service)
import type { CaseEvent, CaseEventType, CaseState, Message } from '@inboxcenter/shared';
import { repository } from '../repositories';
import { AppError } from '../utils/app-error';

const TYPES: readonly string[] = ['closed', 'waiting', 'reopened'];
const MAX_NOTE = 1000;
const MAX_NAME = 60;

/** เวลาข้อความล่าสุดของลูกค้า (ไม่ใช่ของเพจ) — ใช้ตัดสินว่าสถานะเคสยังมีผลอยู่ไหม */
export function lastCustomerAt(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!messages[i]!.isFromPage) return new Date(messages[i]!.createdTime).getTime();
  }
  return 0;
}

/**
 * สถานะเคสล่าสุด + บอกว่ายังมีผลอยู่ไหม
 *
 * active = ลูกค้ายังไม่ทักมาใหม่หลังกด → ถือว่าจัดการแล้ว ไม่นับเป็นห้องค้างตอบ
 * ถ้าลูกค้าทักมาหลังจากนั้น ถือเป็นเคสใหม่ทันที ไม่ต้องกดอะไรเพิ่ม
 */
export function caseStateOf(
  events: CaseEvent[] | undefined,
  messages: Message[],
): CaseState | null {
  if (!events || !events.length) return null;
  // เรียงตามเวลาแล้วเอาตัวท้าย — ไม่พึ่งลำดับที่เก็บมา
  const latest = [...events].sort(
    (a, b) => new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime(),
  )[events.length - 1]!;
  // ยกเลิกไปแล้ว = ไม่มีสถานะค้างอยู่ กลับไปนับค้างตอบตามปกติ
  if (latest.type === 'reopened') return null;
  return {
    type: latest.type,
    by: latest.by,
    note: latest.note,
    createdTime: latest.createdTime,
    active: new Date(latest.createdTime).getTime() >= lastCustomerAt(messages),
  };
}

export interface CaseEventInput {
  type?: unknown;
  by?: unknown;
  note?: unknown;
}

export async function addCaseEvent(
  conversationId: string,
  input: CaseEventInput,
): Promise<CaseEvent> {
  const conv = await repository.getConversation(conversationId);
  if (!conv) throw AppError.notFound('ไม่พบการสนทนานี้');

  const type = String(input.type ?? '');
  if (!TYPES.includes(type)) {
    throw AppError.badRequest(
      'type ต้องเป็น closed (ปิดเคส) · waiting (รอคำตอบ) · reopened (ยกเลิกปิดเคส)',
    );
  }

  const entry: CaseEvent = {
    id: `cs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: type as CaseEventType,
    by:
      String(input.by ?? '')
        .trim()
        .slice(0, MAX_NAME) || 'ทีมงาน',
    note: String(input.note ?? '')
      .trim()
      .slice(0, MAX_NOTE),
    createdTime: new Date().toISOString(),
  };
  await repository.addCaseEvent(conv.id, entry);
  return entry;
}
