/** เพจคู่แข่งที่ติดตามผ่าน Apify (คนละอย่างกับ CompetitorRef ที่กรอกมือในหน้า Admin) */
export interface Competitor {
  /** cmp_<handle> */
  id: string;
  url: string;
  handle: string;
  name: string;
  pictureUrl: string;
  addedAt: string;
  lastSyncAt: string | null;
  /** ช่วงวันที่ที่ดึงครบแล้ว (YYYY-MM-DD) — ใช้คิดว่าจะดึงเฉพาะส่วนเพิ่ม */
  coveredFrom: string | null;
  coveredTo: string | null;
}

export interface CompetitorWithCount extends Competitor {
  postCount: number;
}

export interface CompetitorPost {
  /** postId จาก Facebook — ใช้ dedup (โพสต์เก่าไม่เปลี่ยน) */
  id: string;
  competitorId?: string;
  text: string;
  url: string;
  /** ISO timestamp */
  time: string;
  likes: number;
  comments: number;
  shares: number;
  imageUrl: string;
  pageName: string;
}

export interface CompetitorDetail extends Competitor {
  posts: CompetitorPost[];
  apifyReady: boolean;
}

export interface CompetitorListResponse {
  items: CompetitorWithCount[];
  /** ตั้ง APIFY_TOKEN ไว้แล้วหรือยัง */
  apifyReady: boolean;
}

/** ช่วงเวลาที่เลือกดึงได้จากหน้าเว็บ */
export type SyncRangeKey = 'current' | 'prev' | '3m' | '6m';

export interface DateRange {
  from: string;
  to: string;
}

export interface CompetitorSyncRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  range: SyncRangeKey | string;
  rangeLabel: string;
  /** ช่วงที่ผู้ใช้ขอ */
  requested: DateRange & { label?: string };
  /** ช่วงที่ "ดึงจริง" หลังตัดส่วนที่มีอยู่แล้วออก */
  gaps: DateRange[];
  fetched: number;
  added: number;
  skipped: boolean;
  ok: boolean;
  error?: string;
}
