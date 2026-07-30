/** สรุปตัวเลขของเพจหนึ่งในหน้า Analytics */
export interface PageAnalytics {
  pageId: string;
  pageName: string;
  rooms: number;
  messages: number;
  customerMessages: number;
  pageMessages: number;
  /** วินาที */
  avgReplySeconds: number | null;
  botReplies: number;
  humanReplies: number;
  unanswered: number;
}

export interface WaitingRoom {
  conversationId: string;
  pageId: string;
  pageName: string;
  customerName: string;
  customerPic: string;
  lastMessageAt: string;
  /** มิลลิวินาทีที่รออยู่ */
  waitedMs: number;
  lastText: string;
}

export interface KeywordCount {
  word: string;
  count: number;
}

/** จุดข้อมูลรายวันสำหรับ sparkline */
export interface DailyPoint {
  /** YYYY-MM-DD */
  day: string;
  value: number;
}

export interface AnalyticsResponse {
  from: string;
  to: string;
  rooms: number;
  messages: number;
  customerMessages: number;
  pageMessages: number;
  avgReplySeconds: number | null;
  botReplies: number;
  humanReplies: number;
  unanswered: number;
  perPage?: PageAnalytics[];
  waiting?: WaitingRoom[];
  keywords?: KeywordCount[];
  daily?: DailyPoint[];
  /** ชั่วโมง 0–23 → จำนวนข้อความลูกค้า */
  hourly?: number[];
}
