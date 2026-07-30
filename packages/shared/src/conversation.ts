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
  keywords: string[];
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
  text: string;
  tags: string[];
  createdAt: string;
}
