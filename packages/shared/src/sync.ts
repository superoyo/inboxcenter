/** ผลการดึง inbox ของเพจหนึ่งในรอบหนึ่ง */
export interface PageSyncResult {
  pageId: string;
  pageName: string;
  ok: boolean;
  /** จำนวนห้องที่มีความเคลื่อนไหว */
  conversations?: number;
  error?: string;
}

/** ประวัติการดึง inbox รายครั้ง (เก็บ 50 ครั้งล่าสุด) */
export interface SyncRun {
  id?: string;
  trigger: 'manual' | 'auto' | string;
  startedAt: string;
  finishedAt: string;
  results: PageSyncResult[];
}

export interface SyncStatus {
  lastRefreshAt: string | null;
  nextRefreshAt: string;
  running: boolean;
  autoRefreshMinutes: number;
  lastResults: PageSyncResult[];
}

export interface SyncIntervalSetting {
  /** 15–1440 นาที */
  minutes: number;
  nextRefreshAt?: string;
}
