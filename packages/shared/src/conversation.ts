import type { KeywordCount } from './analytics';

export interface Attachment {
  mimeType?: string;
  name?: string;
  imageUrl?: string;
  fileUrl?: string;
}

export interface Message {
  id: string;
  text: string;
  fromId: string;
  fromName: string;
  /** true = ข้อความที่เพจส่งออก (รวมข้อความที่ตอบจากระบบนี้) */
  isFromPage: boolean;
  createdTime: string;
  attachments: Attachment[];
}

/**
 * การส่งต่อเคสภายในทีม — เก็บ **แยกจาก messages โดยสิ้นเชิง**
 * เส้นทางส่งถึงลูกค้าอ่านจาก messages เท่านั้น ข้อความนี้จึงไม่มีทางถึงลูกค้า
 */
export interface Forward {
  id: string;
  fromName: string;
  toNames: string[];
  text: string;
  createdTime: string;
}

/** ระดับความเร่งด่วนของห้อง (แดง/เหลือง/เขียว) */
export type UrgencyLevel = 'red' | 'yellow' | 'green';

export interface Conversation {
  id: string;
  pageId: string;
  pageName: string;
  customerId: string;
  customerName: string;
  customerPic: string;
  updatedTime: string;
  unreadCount: number;
  messages: Message[];
}

/** ห้องแชทเต็ม (endpoint /conversations/:id/thread) */
export interface ConversationThread extends Conversation {
  tags: string[];
  remark: string;
  statusOverride: UrgencyLevel | '';
  forwards: Forward[];
  /** ข้อความของเพจที่ซ้ำ ≥3 ครั้งทั้งเพจ = ถือว่าเป็นข้อความอัตโนมัติ */
  botTexts: string[];
  /** คำสำคัญของห้องนี้ (นับจากข้อความลูกค้า) — หน้าเว็บแสดงเป็นชิป word + count */
  keywords: KeywordCount[];
}

export interface ConversationPreview {
  text: string;
  isFromPage: boolean;
}

/** สรุปห้องแชทสำหรับ "รายการ" — ตัด messages ออกให้ payload เล็ก */
export interface ConversationSummary {
  id: string;
  pageId: string;
  pageName: string;
  customerId: string;
  customerName: string;
  customerPic: string;
  updatedTime: string;
  unreadCount: number;
  messageCount: number;
  preview: ConversationPreview | null;
  lastCustomerText: string;
  /**
   * เวลาตอบของ "ก้อนล่าสุด" — ตอบแล้วใช้เวลาเท่าไร (replyMs)
   * หรือยังไม่ตอบ รอมานานเท่าไร (waitingMs) · null ทั้งคู่ = ไม่มีข้อความลูกค้าติดท้าย
   * ยังไม่มีหน้าไหนใช้ แต่คงไว้เพราะเป็นสัญญาเดิมของ API
   */
  replyMs: number | null;
  waitingMs: number | null;
  tags: string[];
  remark: string;
  statusOverride: UrgencyLevel | '';
  /** จำนวนครั้งที่ห้องนี้ถูกส่งต่อเคสภายใน */
  forwardCount: number;
}

export interface ConversationListResponse {
  items: ConversationSummary[];
  total: number;
  hasMore: boolean;
}

/** map: 'YYYY-MM-DD' → จำนวนห้องที่มีข้อความในวันนั้น */
export type CalendarCounts = Record<string, number>;

export interface SavedReply {
  id: string;
  /** ชื่อย่อของคำตอบ (ตั้งได้ ไม่บังคับ — ข้อมูลเก่าไม่มีฟิลด์นี้) */
  title?: string;
  text: string;
  tags: string[];
  createdAt: string;
}
