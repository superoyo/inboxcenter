// ดึง inbox จาก Facebook — รายเพจ / ทุกเพจ / ตัวจับเวลาอัตโนมัติ
//
// ⚠️ scheduler ต้องรันครั้งเดียวต่อโปรเซส — โมดูลนี้ถือ state (timer) ไว้ระดับ module
// จึงต้องไม่ถูก import ซ้ำจากหลาย entry point
import type { Conversation, PageSyncResult, SyncRun, SyncStatus } from '@inboxcenter/shared';
import {
  DEFAULT_SYNC_MINUTES,
  PIC_MAX_AGE_MS,
  PIC_RETRY_MS,
  SYNC_INTERVAL_MAX,
  SYNC_INTERVAL_MIN,
  SYNC_OVERLAP_MS,
} from '../config/constants';
import { logger } from '../config/logger';
import * as fb from '../integrations/facebook';
import { repository } from '../repositories';
import type { StoredPage } from '../repositories';
import { AppError } from '../utils/app-error';

/** LINE รับข้อความผ่าน webhook — ไม่มีอะไรให้ดึง */
const isLine = (page: StoredPage): boolean => page.platform === 'line';

/** ดึง inbox ของเพจเดียว — คืนจำนวนห้องที่มีความเคลื่อนไหว */
export async function syncPage(page: StoredPage): Promise<number> {
  // เพจที่เคย sync แล้ว → ดึงเฉพาะห้องที่ขยับหลังรอบก่อน (incremental)
  const isFullSync = !page.lastSyncAt;
  const since = isFullSync
    ? null
    : new Date(new Date(page.lastSyncAt as string).getTime() - SYNC_OVERLAP_MS).toISOString();

  const raw = await fb.getConversations(page.id, page.accessToken, { since });
  const conversations = raw.map(
    (c) => fb.normalizeConversation(c, { id: page.id, name: page.name }) as Conversation,
  );

  // ดึงรูปโปรไฟล์ลูกค้า — เฉพาะคนที่ยังไม่มีใน cache หรือ cache เก่าแล้ว
  const cache = await repository.getPicCache();
  const now = Date.now();
  const needFetch = [...new Set(conversations.map((c) => c.customerId).filter(Boolean))].filter(
    (id) => {
      const entry = cache[id];
      if (!entry) return true;
      const age = now - new Date(entry.fetchedAt).getTime();
      // ดึงรูปไม่ได้ (url ว่าง) → ลองใหม่เร็วขึ้น
      return age > (entry.url ? PIC_MAX_AGE_MS : PIC_RETRY_MS);
    },
  );
  if (needFetch.length) {
    const pics = await fb.fetchProfilePics(needFetch, page.accessToken);
    const fetchedAt = new Date().toISOString();
    const updates: typeof cache = {};
    for (const [id, url] of Object.entries(pics)) {
      updates[id] = { url, fetchedAt };
      cache[id] = updates[id]!;
    }
    await repository.savePics(updates);
  }
  for (const c of conversations) c.customerPic = cache[c.customerId]?.url || '';

  if (isFullSync) await repository.saveConversations(page.id, conversations);
  else await repository.upsertConversations(page.id, conversations);
  await repository.savePage({ ...page, lastSyncAt: new Date().toISOString() });
  return conversations.length;
}

// ---------- Auto refresh (ตั้งรอบเวลาได้ ค่าเริ่มต้น 1 ชั่วโมง) ----------
const state = {
  lastRefreshAt: null as string | null,
  lastResults: [] as PageSyncResult[],
  running: false,
  intervalMinutes: DEFAULT_SYNC_MINUTES,
  nextRefreshAt: Date.now() + DEFAULT_SYNC_MINUTES * 60_000,
};
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** ดึง inbox ทุกเพจพร้อมกัน — กันรันซ้อน (กดปุ่มตอน auto กำลังทำงานจะได้ผลรอบเดิม) */
export async function syncAllPages(
  trigger: 'manual' | 'auto' = 'manual',
): Promise<PageSyncResult[]> {
  if (state.running) return state.lastResults;
  state.running = true;
  const startedAt = new Date().toISOString();
  try {
    const pages = (await repository.getPages()).filter((p) => !isLine(p));
    const results = await Promise.all(
      pages.map(async (page): Promise<PageSyncResult> => {
        try {
          const count = await syncPage(page);
          return { pageId: page.id, pageName: page.name, ok: true, conversations: count };
        } catch (err) {
          return {
            pageId: page.id,
            pageName: page.name,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    state.lastRefreshAt = new Date().toISOString();
    state.lastResults = results;

    const run: SyncRun = {
      id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      trigger,
      startedAt,
      finishedAt: state.lastRefreshAt,
      results,
    };
    // ประวัติเป็นข้อมูลเสริม — บันทึกไม่ได้ก็ไม่ควรทำให้การ sync ล้ม
    await repository.addSyncRun(run).catch(() => {});
    return results;
  } finally {
    state.running = false;
  }
}

/** ตั้งเวลารอบถัดไปตามค่าที่ผู้ใช้กำหนด (setting: syncIntervalMinutes) */
export async function scheduleAutoRefresh(): Promise<void> {
  if (refreshTimer) clearTimeout(refreshTimer);
  const saved = parseInt(
    String(await repository.getSetting('syncIntervalMinutes', DEFAULT_SYNC_MINUTES)),
    10,
  );
  state.intervalMinutes =
    Number.isFinite(saved) && saved >= SYNC_INTERVAL_MIN ? saved : DEFAULT_SYNC_MINUTES;
  state.nextRefreshAt = Date.now() + state.intervalMinutes * 60_000;
  refreshTimer = setTimeout(async () => {
    try {
      const r = await syncAllPages('auto');
      logger.info(
        {
          ok: r.filter((x) => x.ok).length,
          total: r.length,
          rooms: r.reduce((s, x) => s + (x.conversations || 0), 0),
        },
        '[auto-refresh] ดึง inbox เสร็จ',
      );
    } catch (err) {
      logger.error({ err }, '[auto-refresh] ล้มเหลว');
    }
    void scheduleAutoRefresh();
  }, state.intervalMinutes * 60_000);
}

/** หยุดตัวจับเวลา (ใช้ตอน graceful shutdown / เทสต์) */
export function stopAutoRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  // fallback หลัง restart: ใช้ lastSyncAt ล่าสุดของเพจ (เก็บถาวรใน storage)
  const pages = await repository.getPages();
  const lastPageSync =
    pages
      .map((p) => p.lastSyncAt)
      .filter((v): v is string => Boolean(v))
      .sort()
      .pop() || null;
  return {
    lastRefreshAt: state.lastRefreshAt || lastPageSync,
    nextRefreshAt: new Date(state.nextRefreshAt).toISOString(),
    running: state.running,
    autoRefreshMinutes: state.intervalMinutes,
    lastResults: state.lastResults,
  };
}

export const getSyncRuns = (limit = 50): Promise<SyncRun[]> => repository.getSyncRuns(limit);

export const getIntervalMinutes = (): number => state.intervalMinutes;
export const getNextRefreshAt = (): string => new Date(state.nextRefreshAt).toISOString();
export const getLastRefreshAt = (): string | null => state.lastRefreshAt;

export async function setIntervalMinutes(
  raw: unknown,
): Promise<{ minutes: number; nextRefreshAt: string }> {
  const minutes = parseInt(String(raw), 10);
  if (!Number.isFinite(minutes) || minutes < SYNC_INTERVAL_MIN || minutes > SYNC_INTERVAL_MAX) {
    throw AppError.badRequest('รอบเวลาต้องอยู่ระหว่าง 15 นาที ถึง 24 ชั่วโมง');
  }
  await repository.setSetting('syncIntervalMinutes', minutes);
  await scheduleAutoRefresh(); // รีเซ็ตตัวจับเวลาด้วยค่าใหม่ทันที
  return { minutes, nextRefreshAt: getNextRefreshAt() };
}

/** ดึงเพจเดียว — LINE ข้ามไปเลย (รับสดผ่าน webhook) */
export async function syncOnePage(
  page: StoredPage,
): Promise<{ pageId: string; conversations: number }> {
  if (isLine(page)) return { pageId: page.id, conversations: 0 };
  try {
    const count = await syncPage(page);
    return { pageId: page.id, conversations: count };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw AppError.badRequest(`ดึง inbox ไม่สำเร็จ: ${message}`);
  }
}
