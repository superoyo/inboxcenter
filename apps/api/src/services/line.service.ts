// LINE OA — เชื่อมต่อ (เก็บเป็น "เพจ" platform=line) + รับ event จาก webhook
// LINE ดึงประวัติย้อนหลังไม่ได้ จึงรับข้อความสดผ่าน webhook เท่านั้น
import type { Conversation, LineConnection, Message } from '@inboxcenter/shared';
import * as line from '../integrations/line';
import type { LineWebhookEvent } from '../integrations/line';
import { repository } from '../repositories';
import type { StoredPage } from '../repositories';
import { AppError } from '../utils/app-error';
import { logger } from '../config/logger';

/** LINE OA เก็บเป็นเพจที่ id ขึ้นต้น line_ */
export const linePageId = (channelId: string): string => `line_${channelId}`;

export const lineWebhookPath = (channelId: string): string => `/api/line/webhook/${channelId}`;

/** ตัด token/secret ออกก่อนส่งออก API เสมอ */
function toConnection(page: StoredPage, baseUrl: string): LineConnection {
  const { accessToken: _t, channelSecret: _s, ...safe } = page;
  return {
    ...safe,
    channelId: String(page.channelId ?? ''),
    webhookUrl: `${baseUrl}${lineWebhookPath(String(page.channelId ?? ''))}`,
  } as LineConnection;
}

export async function listConnections(baseUrl: string): Promise<LineConnection[]> {
  return (await repository.getPages())
    .filter((p) => p.platform === 'line')
    .map((p) => toConnection(p, baseUrl));
}

export interface ConnectLineInput {
  channelId?: unknown;
  channelSecret?: unknown;
  accessToken?: unknown;
}

/** เชื่อมต่อ LINE OA — ตรวจ token กับ LINE ก่อนบันทึก */
export async function connect(input: ConnectLineInput, baseUrl: string): Promise<LineConnection> {
  const channelId = String(input.channelId || '').trim();
  const channelSecret = String(input.channelSecret || '').trim();
  const accessToken = String(input.accessToken || '').trim();
  if (!channelId || !channelSecret || !accessToken) {
    throw AppError.badRequest('ต้องระบุ Channel ID, Channel secret และ Channel access token');
  }

  let info;
  try {
    info = await line.getBotInfo(accessToken); // ยืนยัน token ใช้ได้จริง
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw AppError.badRequest(`เชื่อมต่อ LINE ไม่สำเร็จ: ${message}`);
  }

  const id = linePageId(channelId);
  const existing = (await repository.getPages()).find((p) => p.id === id);
  const page = await repository.savePage({
    id,
    platform: 'line',
    name: info.displayName || `LINE OA ${channelId}`,
    pictureUrl: info.pictureUrl || '',
    basicId: info.basicId || '',
    channelId,
    channelSecret,
    accessToken,
    connectedAt: existing ? existing.connectedAt : new Date().toISOString(),
    lastSyncAt: existing ? existing.lastSyncAt : null,
  });
  return toConnection(page, baseUrl);
}

export async function disconnect(id: string): Promise<void> {
  await repository.deletePage(id);
}

/** หาเพจ LINE จาก channelId ที่ webhook เรียกเข้ามา */
export async function findLinePage(channelId: string): Promise<StoredPage | null> {
  return (await repository.getPages()).find((p) => p.id === linePageId(channelId)) ?? null;
}

// จำชื่อ/รูปผู้ใช้ LINE ไว้ 6 ชั่วโมง กันยิง profile API ถี่เกินไป
const PROFILE_TTL_MS = 6 * 3600e3;
const profileCache = new Map<string, { at: number; displayName: string; pictureUrl: string }>();

async function lineProfile(
  page: StoredPage,
  userId: string,
): Promise<{ displayName: string; pictureUrl: string }> {
  const hit = profileCache.get(userId);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit;
  try {
    const p = await line.getProfile(page.accessToken, userId);
    const val = {
      at: Date.now(),
      displayName: p.displayName || 'ผู้ใช้ LINE',
      pictureUrl: p.pictureUrl || '',
    };
    profileCache.set(userId, val);
    return val;
  } catch {
    // ผู้ใช้ที่ไม่ได้ follow OA ดึงโปรไฟล์ไม่ได้ — ใช้ชื่อกลางๆ ไปก่อน (ไม่ throw)
    return { displayName: 'ผู้ใช้ LINE', pictureUrl: '' };
  }
}

/** แปลง event เป็นข้อความในห้องแชท (เฉพาะข้อความจากผู้ใช้รายบุคคล) */
export async function handleEvent(page: StoredPage, ev: LineWebhookEvent): Promise<void> {
  if (ev.type !== 'message' || ev.source?.type !== 'user') return;
  const userId = ev.source.userId;
  if (!userId) return;

  const prof = await lineProfile(page, userId);
  const convId = `${page.id}_${userId}`;
  const createdTime = new Date(ev.timestamp || Date.now()).toISOString();
  const message: Message = {
    id: ev.message?.id || `line_${ev.timestamp}`,
    text: line.messageTextFromEvent(ev),
    fromId: userId,
    fromName: prof.displayName,
    isFromPage: false,
    createdTime,
    attachments: [],
  };

  const convs = await repository.getConversationsForPage(page.id);
  const found = convs.find((c) => c.id === convId);
  const conv: Conversation = found
    ? {
        ...found,
        // LINE ส่ง event ซ้ำได้ — กันข้อความซ้ำด้วย id
        messages: found.messages.some((m) => m.id === message.id)
          ? found.messages
          : [...found.messages, message],
        customerName: prof.displayName,
        customerPic: prof.pictureUrl,
        updatedTime: createdTime,
      }
    : {
        id: convId,
        pageId: page.id,
        pageName: page.name,
        customerId: userId,
        customerName: prof.displayName,
        customerPic: prof.pictureUrl,
        updatedTime: createdTime,
        unreadCount: 1,
        messages: [message],
      };

  await repository.saveConversation(conv);
  await repository.savePage({ ...page, lastSyncAt: createdTime });
}

/** ประมวลผล event ทั้งชุด — error ของ event หนึ่งไม่ทำให้ที่เหลือหยุด */
export async function handleEvents(page: StoredPage, events: LineWebhookEvent[]): Promise<void> {
  for (const ev of events) {
    try {
      await handleEvent(page, ev);
    } catch (err) {
      logger.error({ err, pageId: page.id }, '[line webhook] ประมวลผล event ไม่สำเร็จ');
    }
  }
}
