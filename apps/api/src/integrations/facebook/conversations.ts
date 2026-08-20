// Facebook Graph API — กล่องข้อความ (Messenger conversations) + ส่งข้อความตอบกลับ
import type { Conversation, Message } from '@inboxcenter/shared';
import { followPaging, graphGet, GRAPH_BASE, throwIfGraphError, type GraphList } from './client';

export interface FbAttachment {
  mime_type?: string;
  name?: string;
  image_data?: { url?: string };
  file_url?: string;
}

export interface FbMessage {
  id: string;
  message?: string;
  from?: { id?: string; name?: string };
  created_time: string;
  attachments?: { data?: FbAttachment[] };
}

export interface FbConversation {
  id: string;
  updated_time: string;
  unread_count?: number;
  participants?: { data?: { id?: string; name?: string }[] };
  messages?: { data?: FbMessage[] };
}

export interface GetConversationsOptions {
  limit?: number;
  messagesPerConversation?: number;
  /** ISO time — ดึงเฉพาะห้องที่ขยับหลังเวลานี้ (incremental sync) */
  since?: string | null;
}

/**
 * ดึงรายการ conversations ของเพจ พร้อมข้อความล่าสุดในแต่ละห้อง
 * ถ้าระบุ since: ดึงเฉพาะห้องที่มีความเคลื่อนไหวหลังเวลานั้น (incremental sync)
 * — Graph API เรียงตาม updated_time ใหม่→เก่า จึงหยุด paginate ได้ทันทีที่เจอห้องเก่ากว่า since
 */
export async function getConversations(
  pageId: string,
  accessToken: string,
  { limit = 25, messagesPerConversation = 25, since = null }: GetConversationsOptions = {},
): Promise<FbConversation[]> {
  const sinceTime = since ? new Date(since) : null;
  const batchIsOlderThanSince = (batch: FbConversation[]): boolean => {
    if (!sinceTime || batch.length === 0) return false;
    const last = batch[batch.length - 1];
    return Boolean(last) && new Date(last!.updated_time) < sinceTime;
  };

  const first = await graphGet<GraphList<FbConversation>>(`/${pageId}/conversations`, {
    platform: 'messenger',
    fields: [
      'id',
      'updated_time',
      'unread_count',
      'participants',
      `messages.limit(${messagesPerConversation}){id,message,from,created_time,attachments{mime_type,name,image_data,file_url}}`,
    ].join(','),
    limit,
    access_token: accessToken,
  });

  // ตามหน้าถัดไปสูงสุด 10 หน้า กันดึงไม่รู้จบ
  const conversations = await followPaging(first, {
    maxPages: 10,
    shouldStop: batchIsOlderThanSince,
  });

  return sinceTime
    ? conversations.filter((c) => new Date(c.updated_time) >= sinceTime)
    : conversations;
}

export interface SendMessageResult {
  recipient_id?: string;
  message_id?: string;
}

/**
 * ส่งข้อความตอบกลับในนามเพจ (Send API)
 * ต้องอยู่ใน 24-hour window: ลูกค้าทักมาไม่เกิน 24 ชม. — เกินกว่านั้น Facebook จะปฏิเสธ
 */
export async function sendMessage(
  recipientPsid: string,
  text: string,
  pageAccessToken: string,
): Promise<SendMessageResult> {
  const url = new URL(`${GRAPH_BASE}/me/messages`);
  url.searchParams.set('access_token', pageAccessToken);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientPsid },
      messaging_type: 'RESPONSE',
      message: { text },
    }),
  });
  const json = await res.json();
  throwIfGraphError(json, 'Send API error');
  return json as SendMessageResult;
}

/**
 * ส่งไฟล์แนบให้ลูกค้าโดยให้ Facebook ไปดึงจาก URL ของเรา
 * type: 'image' รูป · 'file' เอกสาร (Facebook ดึงเองจึงต้องเป็น URL สาธารณะ)
 */
export async function sendAttachment(
  recipientPsid: string,
  url: string,
  type: 'image' | 'file',
  pageAccessToken: string,
): Promise<SendMessageResult> {
  const api = new URL(`${GRAPH_BASE}/me/messages`);
  api.searchParams.set('access_token', pageAccessToken);
  const res = await fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientPsid },
      messaging_type: 'RESPONSE',
      message: { attachment: { type, payload: { url, is_reusable: false } } },
    }),
  });
  const json = await res.json();
  throwIfGraphError(json, 'Send API error');
  return json as SendMessageResult;
}

/** เพจเท่าที่ normalizeConversation ต้องรู้ */
export interface PageRef {
  id: string;
  name: string;
}

/** แปลง conversation จาก Graph API ให้อยู่ในรูปแบบที่ระบบใช้ */
export function normalizeConversation(
  conv: FbConversation,
  page: PageRef,
): Omit<Conversation, 'customerPic'> {
  const messages: Message[] = (conv.messages?.data || [])
    .map((m) => ({
      id: m.id,
      text: m.message || '',
      fromId: m.from?.id || '',
      fromName: m.from?.name || '',
      isFromPage: m.from?.id === page.id,
      createdTime: m.created_time,
      attachments: (m.attachments?.data || []).map((a) => ({
        mimeType: a.mime_type,
        name: a.name,
        imageUrl: a.image_data?.url,
        fileUrl: a.file_url,
      })),
    }))
    .sort((a, b) => new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime());

  // คู่สนทนา = participant ที่ไม่ใช่ตัวเพจเอง
  const other = (conv.participants?.data || []).find((p) => p.id !== page.id);

  return {
    id: conv.id,
    pageId: page.id,
    pageName: page.name,
    customerId: other?.id || '',
    customerName: other?.name || 'ไม่ทราบชื่อ',
    updatedTime: conv.updated_time,
    unreadCount: conv.unread_count || 0,
    messages,
  };
}
