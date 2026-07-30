// แปลง webhook event ของ LINE → ข้อความในรูปแบบเดียวกับ inbox
import type { Attachment } from '@inboxcenter/shared';

export interface LineEventMessage {
  id?: string;
  type?: string;
  text?: string;
  fileName?: string;
  title?: string;
  address?: string;
}

export interface LineEventSource {
  type?: 'user' | 'group' | 'room';
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LineWebhookEvent {
  type?: string;
  timestamp?: number;
  source?: LineEventSource;
  message?: LineEventMessage;
  replyToken?: string;
}

export interface LineWebhookBody {
  destination?: string;
  events?: LineWebhookEvent[];
}

/** ข้อความที่ไม่ใช่ text เก็บเป็น placeholder อ่านออก (ระบบยังไม่โหลดไฟล์จาก LINE) */
export function messageTextFromEvent(ev: LineWebhookEvent): string {
  const m = ev.message || {};
  switch (m.type) {
    case 'text':
      return m.text || '';
    case 'image':
      return '📷 [รูปภาพ]';
    case 'video':
      return '🎬 [วิดีโอ]';
    case 'audio':
      return '🎧 [เสียง]';
    case 'file':
      return `📎 [ไฟล์: ${m.fileName || 'ไฟล์'}]`;
    case 'location':
      return `📍 [ตำแหน่ง: ${m.title || m.address || ''}]`;
    case 'sticker':
      return '🌟 [สติกเกอร์]';
    default:
      return `[${m.type || 'ข้อความ'}]`;
  }
}

/** LINE ไม่ได้ส่ง URL ไฟล์มากับ event — ยังไม่มี attachment ให้เก็บ */
export function attachmentsFromEvent(_ev: LineWebhookEvent): Attachment[] {
  return [];
}
