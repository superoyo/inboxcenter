// Unified inbox — รายการห้องแชท / ปฏิทิน / ห้องเดียวแบบเต็ม
import type {
  CalendarCounts,
  Conversation,
  ConversationListResponse,
  ConversationSummary,
  ConversationThread,
  Message,
  UrgencyLevel,
} from '@inboxcenter/shared';
import { BOT_REPEAT_THRESHOLD } from '../config/constants';
import { repository } from '../repositories';
import { AppError } from '../utils/app-error';
import { dayKeyFactory } from '../utils/date';
import { roomKeywords } from './keywords.service';
import { projectPageIds } from './projects.service';

/** ข้อความล่าสุดของ "ลูกค้า" (ไม่ใช่เพจ) — ใช้จัดระดับความเร่งด่วนฝั่งหน้าเว็บ */
export function lastCustomerText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!messages[i]!.isFromPage) return messages[i]!.text || '';
  }
  return '';
}

export interface ResponseTiming {
  replyMs: number | null;
  waitingMs: number | null;
}

/**
 * เวลาตอบของห้องนี้ — ดูข้อความลูกค้า "ก้อนล่าสุด" แล้วหาว่าเพจตอบหลังจากนั้นเมื่อไร
 *   replyMs   = ตอบไปแล้ว ใช้เวลาเท่าไร
 *   waitingMs = ยังไม่ได้ตอบ รอมานานเท่าไร (นับถึงตอนนี้)
 * คิดจากก้อนล่าสุดเพราะเป็นสิ่งที่คนดูรายการอยากรู้ ("ห้องนี้ตอบช้าไหม/ค้างอยู่ไหม")
 * ไม่ใช่ค่าเฉลี่ยตลอดอายุห้อง
 */
export function responseTiming(messages: Message[]): ResponseTiming {
  let i = messages.length - 1;
  // ชุดท้ายที่เป็นของเพจ — เก็บ "ตัวแรกสุดของชุด" ไว้เป็นเวลาที่ตอบ (ตอบครั้งแรกหลังลูกค้าถาม)
  let replyAt: string | null = null;
  while (i >= 0 && messages[i]!.isFromPage) {
    replyAt = messages[i]!.createdTime;
    i--;
  }
  // ถัดขึ้นไปคือก้อนข้อความลูกค้า — เอาตัวแรกสุดของก้อน (ถามติดกันหลายที นับจากทีแรก)
  let askAt: string | null = null;
  while (i >= 0 && !messages[i]!.isFromPage) {
    askAt = messages[i]!.createdTime;
    i--;
  }
  const ask = askAt ? new Date(askAt).getTime() : NaN;
  if (!Number.isFinite(ask)) return { replyMs: null, waitingMs: null }; // ไม่มีข้อความลูกค้าติดท้าย
  if (replyAt) {
    const rep = new Date(replyAt).getTime();
    return { replyMs: Number.isFinite(rep) && rep >= ask ? rep - ask : null, waitingMs: null };
  }
  return { replyMs: null, waitingMs: Date.now() - ask };
}

/**
 * ย่อ conversation ให้เหลือเฉพาะข้อมูลที่ "รายการห้องแชท" ต้องใช้ — ตัด messages ทั้งก้อนออก
 * (ข้อความเต็มโหลดทีหลังผ่าน /conversations/:id/thread เมื่อผู้ใช้เปิดห้อง)
 * annotation (tags/remark/status/forwardCount) เติมโดยผู้เรียก
 */
export function toSummary(
  c: Conversation,
): Omit<ConversationSummary, 'tags' | 'remark' | 'statusOverride' | 'forwardCount'> {
  const messages = c.messages || [];
  const last = messages[messages.length - 1];
  return {
    id: c.id,
    pageId: c.pageId,
    pageName: c.pageName,
    customerId: c.customerId,
    customerName: c.customerName,
    customerPic: c.customerPic || '',
    updatedTime: c.updatedTime,
    unreadCount: c.unreadCount || 0,
    messageCount: messages.length,
    preview: last ? { text: last.text || '', isFromPage: !!last.isFromPage } : null,
    lastCustomerText: lastCustomerText(messages),
    ...responseTiming(messages),
  };
}

const LEVELS: readonly string[] = ['red', 'yellow', 'green'];

/**
 * สถานะสีที่ผู้ใช้กำหนดเอง — ตอนเขียนมีการตรวจค่าแล้ว แต่ไฟล์เก่าอาจมีค่าที่ไม่รู้จัก
 * ค่าที่ไม่รู้จักถือเป็น "ไม่กำหนด" (หน้าเว็บก็ไม่ลงสีอยู่ดี)
 */
const toStatusOverride = (v: string | undefined): UrgencyLevel | '' =>
  v && LEVELS.includes(v) ? (v as UrgencyLevel) : '';

/** กรองด้วยคำค้น (ชื่อลูกค้า หรือข้อความในห้อง) */
export function matchesQuery(c: Conversation, needle: string): boolean {
  return (
    c.customerName.toLowerCase().includes(needle) ||
    c.messages.some((m) => (m.text || '').toLowerCase().includes(needle))
  );
}

export interface ConversationFilter {
  pageId?: string;
  project?: string;
  q?: string;
  tz?: string | number;
}

/** ดึงห้องแชทตามตัวกรองพื้นฐานที่ทั้งรายการและปฏิทินใช้ร่วมกัน */
async function filteredConversations(filter: ConversationFilter): Promise<Conversation[]> {
  // ดึงเฉพาะเพจที่เลือก (ใช้ index ใน Postgres) — เร็วกว่าดึงทุกเพจมา filter ทีหลังมาก
  let convs = filter.pageId
    ? await repository.getConversationsForPage(filter.pageId)
    : await repository.getAllConversations();

  const inProject = await projectPageIds(filter.project);
  if (inProject) convs = convs.filter((c) => inProject.has(c.pageId));

  if (filter.q) {
    const needle = String(filter.q).toLowerCase();
    convs = convs.filter((c) => matchesQuery(c, needle));
  }
  return convs;
}

export interface ListConversationsQuery extends ConversationFilter {
  /** กรองตามวัน 'YYYY-MM-DD' (ตามเวลาท้องถิ่นของผู้ใช้) */
  date?: string;
  /** มีค่าใดๆ = เอาเฉพาะห้องที่มีการส่งต่อเคสภายใน (แท็บ "ข้อความที่ส่งต่อ") */
  forwarded?: string;
  limit?: string | number;
  offset?: string | number;
}

/** รายการห้องแชท (สรุป ไม่รวมข้อความเต็ม) — แบ่งหน้าทีละ limit ห้อง */
export async function listConversations(
  query: ListConversationsQuery,
): Promise<ConversationListResponse> {
  const limit = Math.min(Math.max(parseInt(String(query.limit ?? ''), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(query.offset ?? ''), 10) || 0, 0);
  const dayKey = dayKeyFactory(parseInt(String(query.tz ?? ''), 10));

  let convs = await filteredConversations(query);
  if (query.date) {
    convs = convs.filter((c) => c.messages.some((m) => dayKey(m.createdTime) === query.date));
  }

  const [tagsMap, remarksMap, statusMap, forwardsMap] = await Promise.all([
    repository.getTags(),
    repository.getRemarks(),
    repository.getStatuses(),
    repository.getForwards(),
  ]);

  // แท็บ "ข้อความที่ส่งต่อ" — เฉพาะห้องที่มีการส่งต่อเคสภายใน
  if (query.forwarded) {
    convs = convs.filter((c) => (forwardsMap[c.id] || []).length > 0);
  }
  convs.sort((a, b) => new Date(b.updatedTime).getTime() - new Date(a.updatedTime).getTime());

  const total = convs.length;
  const items: ConversationSummary[] = convs.slice(offset, offset + limit).map((c) => ({
    ...toSummary(c),
    tags: tagsMap[c.id] || [],
    remark: remarksMap[c.id] || '',
    statusOverride: toStatusOverride(statusMap[c.id]),
    forwardCount: (forwardsMap[c.id] || []).length,
  }));
  return { items, total, hasMore: offset + items.length < total };
}

/**
 * จำนวนห้องที่มีข้อความในแต่ละวัน (สำหรับปฏิทิน)
 * แยกจากรายการแบ่งหน้า เพราะปฏิทินต้องนับทุกห้อง ไม่ใช่แค่ 50 ห้องแรก
 */
export async function calendarCounts(filter: ConversationFilter): Promise<CalendarCounts> {
  const dayKey = dayKeyFactory(parseInt(String(filter.tz ?? ''), 10));
  const convs = await filteredConversations(filter);

  const map: Record<string, Set<string>> = {};
  for (const c of convs) {
    for (const day of new Set(c.messages.map((m) => dayKey(m.createdTime)))) {
      (map[day] ??= new Set()).add(c.id);
    }
  }
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.size]));
}

/**
 * ข้อความเต็มของห้องเดียว — โหลดตอนผู้ใช้เปิดห้อง
 * แนบ botTexts (ข้อความเพจที่ซ้ำ ≥ BOT_REPEAT_THRESHOLD ครั้งทั้งเพจ = ข้อความอัตโนมัติ)
 * ให้ฝั่งหน้าเว็บใช้แยกสถิติ bot/คน
 */
export async function getThread(id: string): Promise<ConversationThread> {
  const conv = await repository.getConversation(id);
  if (!conv) throw AppError.notFound('ไม่พบการสนทนานี้');

  const [tagsMap, remarksMap, statusMap, forwardsMap, pageConvs] = await Promise.all([
    repository.getTags(),
    repository.getRemarks(),
    repository.getStatuses(),
    repository.getForwards(),
    repository.getConversationsForPage(conv.pageId),
  ]);

  const counts: Record<string, number> = {};
  for (const c of pageConvs) {
    for (const m of c.messages) {
      if (m.isFromPage && m.text) counts[m.text] = (counts[m.text] || 0) + 1;
    }
  }
  const botTexts = Object.entries(counts)
    .filter(([, n]) => n >= BOT_REPEAT_THRESHOLD)
    .map(([t]) => t);

  return {
    ...conv,
    tags: tagsMap[conv.id] || [],
    remark: remarksMap[conv.id] || '',
    statusOverride: toStatusOverride(statusMap[conv.id]),
    // การส่งต่อเคสภายใน (แสดงแทรกในแชท — ไม่ใช่ข้อความถึงลูกค้า)
    forwards: forwardsMap[conv.id] || [],
    botTexts,
    keywords: roomKeywords(conv.messages), // คำสำคัญของห้องนี้ (จากข้อความลูกค้า)
  };
}

export interface FlatMessage extends Message {
  conversationId: string;
  pageId: string;
  pageName: string;
  customerName: string;
}

/** ข้อความทั้งหมดจากทุกเพจ (flat) เรียงใหม่ล่าสุดก่อน */
export async function listMessages(query: {
  pageId?: string;
  limit?: string | number;
}): Promise<FlatMessage[]> {
  let convs = await repository.getAllConversations();
  if (query.pageId) convs = convs.filter((c) => c.pageId === query.pageId);
  return convs
    .flatMap((c) =>
      c.messages.map((m) => ({
        ...m,
        conversationId: c.id,
        pageId: c.pageId,
        pageName: c.pageName,
        customerName: c.customerName,
      })),
    )
    .sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime())
    .slice(0, Number(query.limit ?? 200));
}
