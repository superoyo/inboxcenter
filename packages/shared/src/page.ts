/** ช่องทางที่ระบบรองรับ — LINE OA ถูกเก็บเป็น "เพจ" ที่ platform = 'line' (id ขึ้นต้น line_) */
export type Platform = 'facebook' | 'line' | 'instagram' | 'tiktok' | 'shopee' | 'lazada';

/** เพจตามที่ "ส่งออกทาง API" — ตัด accessToken / channelSecret ออกแล้วเสมอ */
export interface Page {
  id: string;
  name: string;
  pictureUrl: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  /** ไม่มีค่า = facebook (ข้อมูลเก่าไม่ได้เก็บฟิลด์นี้) */
  platform?: Platform;
  /** LINE เท่านั้น */
  channelId?: string;
  /** LINE เท่านั้น — @basicId ของ OA */
  basicId?: string;
}

/** เพจ + ตัวเลขจำนวนห้องที่มีข้อความวันนี้ (endpoint /pages) */
export interface PageWithToday extends Page {
  todayNewMessages: number;
}

/** LINE OA ที่เชื่อมต่อแล้ว + webhook URL ที่ต้องไปวางใน LINE Console */
export interface LineConnection extends Page {
  channelId: string;
  webhookUrl: string;
}

export interface TeamMember {
  empCode: string;
  name: string;
}

export type TeamKey = 'content' | 'graphic' | 'chatInbox' | 'am';

export type Teams = Record<TeamKey, TeamMember[]>;

/** คู่แข่งที่กรอกมือในหน้า Admin (แยกจาก feature Competitor ที่ดึงผ่าน Apify) */
export interface CompetitorRef {
  name: string;
  url: string;
}

/** ตั้งค่ารายเพจในเมนู Admin */
export interface PageConfig {
  /** data URL ของรูปแพ็กเกจ (จำกัด 4MB) */
  packageImage: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** คาแรกเตอร์/โทนของเพจ */
  character: string;
  competitors: CompetitorRef[];
  teams: Teams;
}

/** map: pageId → config */
export type PageConfigMap = Record<string, PageConfig>;

export interface Employee {
  empCode: string;
  thaiName: string;
  engName: string;
  nickName: string;
  position: string;
  department: string;
  photo: string;
}
