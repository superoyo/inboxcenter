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

/**
 * สถานะเคสที่ทีมกดเอง — เก็บเป็น "เหตุการณ์" เรียงตามเวลา ตัวล่าสุดคือสถานะปัจจุบัน
 * เก็บแยกจาก messages เหมือน forwards ลูกค้าจึงไม่เห็นเด็ดขาด
 *
 * closed   = ปิดเคส · waiting = รอคำตอบ · ทั้งสองทำให้ไม่ถูกนับเป็นห้องค้างตอบ
 * reopened = ยกเลิกสถานะที่กดไว้ กลับมานับค้างตอบตามปกติ
 */
export type CaseEventType = 'closed' | 'waiting' | 'reopened';

export interface CaseEvent {
  id: string;
  type: CaseEventType;
  /** ชื่อผู้กด */
  by: string;
  /** รายละเอียด — "รอคำตอบ" ใช้บันทึกว่ารออะไรอยู่ */
  note: string;
  createdTime: string;
}

/** สถานะล่าสุดของเคส พร้อมบอกว่ายังมีผลอยู่ไหม (reopened ถือว่าไม่มีสถานะ → เป็น null) */
export interface CaseState {
  type: 'closed' | 'waiting';
  by: string;
  note: string;
  createdTime: string;
  /**
   * true = ลูกค้ายังไม่ทักมาใหม่หลังกด → ถือว่าจัดการแล้ว ไม่นับเป็นห้องค้างตอบ
   * false = ลูกค้าทักมาใหม่หลังจากนั้น → กลับมาเป็นเคสใหม่ที่ต้องตอบ
   */
  active: boolean;
}

/** ไฟล์แนบที่อัปโหลดขึ้นมาเพื่อส่งให้ลูกค้า */
export interface StoredAttachment {
  /** id สุ่มยาว — เป็นส่วนหนึ่งของ URL สาธารณะ จึงต้องเดาไม่ได้ */
  id: string;
  conversationId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
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
  /** ประวัติการกดปิดเคส/รอคำตอบ (แสดงแทรกในแชท — ลูกค้าไม่เห็น) */
  caseEvents: CaseEvent[];
  /** สถานะเคสล่าสุด · null = ไม่เคยกด */
  caseState: CaseState | null;
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
  /** สถานะเคสล่าสุด · null = ไม่เคยกด — ใช้ตัดสินว่ายังค้างตอบอยู่ไหม */
  caseState: CaseState | null;
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
