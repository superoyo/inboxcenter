// เพจที่เชื่อมต่อ (Facebook + LINE) — เพิ่ม / ลบ / รายการพร้อมตัวเลขข้อความวันนี้
import type { Page, PageWithToday } from '@inboxcenter/shared';
import * as fb from '../integrations/facebook';
import { repository } from '../repositories';
import type { StoredPage } from '../repositories';
import { AppError } from '../utils/app-error';
import { dayKeyFactory } from '../utils/date';
import { projectPageIds } from './projects.service';

/** ตัด token/secret ออกก่อนส่งออก API เสมอ — ชั้นเดียวที่ทำหน้าที่นี้ */
export function toPublicPage(page: StoredPage): Page {
  const { accessToken: _t, channelSecret: _s, ...safe } = page;
  return safe as unknown as Page;
}

export interface ListPagesQuery {
  project?: string;
  /** ล็อกเพจ — รับได้ทั้ง "123" และหลายเพจคั่นคอมมา "123,456" */
  pageId?: string;
  tz?: string | number;
}

export async function listPages(query: ListPagesQuery): Promise<PageWithToday[]> {
  const inProject = await projectPageIds(query.project);
  let pages = (await repository.getPages()).map(toPublicPage);
  if (inProject) pages = pages.filter((p) => inProject.has(p.id));

  // โหมดล็อกเพจ (?pageId=) — ใช้ตอนระบบอื่นฝังแบบเชื่อมเฉพาะเพจ (embed &page=)
  // หลายเพจ: UI ทำงานเหมือนปกติ (รายการเพจ/ทุกเพจ/ปฏิทินรวม) แต่เห็นเฉพาะเพจที่ล็อก
  if (query.pageId) {
    const locked = new Set(
      String(query.pageId)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    pages = pages.filter((p) => locked.has(p.id));
  }

  const localDayKey = dayKeyFactory(parseInt(String(query.tz ?? ''), 10));
  const today = localDayKey(Date.now());

  // นับ "จำนวนห้อง" ที่มีข้อความวันนี้ (ให้ตรงกับตัวเลขในปฏิทิน) — ไม่ใช่จำนวนข้อความ
  const rooms: Record<string, number> = {};
  for (const c of await repository.getAllConversations()) {
    if (c.messages.some((m) => localDayKey(m.createdTime) === today)) {
      rooms[c.pageId] = (rooms[c.pageId] || 0) + 1;
    }
  }
  return pages.map((p) => ({ ...p, todayNewMessages: rooms[p.id] || 0 }));
}

/**
 * แลก token เป็น long-lived ถ้าตั้ง FB_APP_ID/FB_APP_SECRET ไว้
 * แลกไม่สำเร็จ (เช่น token ประเภทที่แลกไม่ได้) → ใช้ตัวเดิม ไม่ทำให้ flow ล้ม
 */
async function toLongLived(token: string): Promise<string> {
  try {
    return (await fb.exchangeLongLivedToken(token)) || token;
  } catch {
    return token;
  }
}

export interface UserTokenPageOption {
  id: string;
  name?: string;
  pictureUrl: string;
  alreadyConnected: boolean;
}

export type AddPageResult =
  | { needsSelection: true; pages: UserTokenPageOption[] }
  | { needsSelection?: undefined; page: Page };

/**
 * เพิ่มเพจจาก access token — รองรับทั้ง User token และ Page token
 * User token: ตอบรายชื่อเพจกลับไปให้เลือกก่อน (needsSelection)
 * Page token: เชื่อมต่อทันที
 */
export async function addPageFromToken(accessTokenRaw: unknown): Promise<AddPageResult> {
  if (!accessTokenRaw || typeof accessTokenRaw !== 'string') {
    throw AppError.badRequest('กรุณาใส่ Access Token');
  }
  const token = await toLongLived(accessTokenRaw.trim());

  // ลองแบบ User token ก่อน: ถ้ามีเพจใน /me/accounts แสดงว่าเป็น user token
  try {
    const userPages = await fb.getUserPages(token);
    if (userPages.length > 0) {
      const connectedIds = new Set((await repository.getPages()).map((p) => p.id));
      return {
        needsSelection: true,
        pages: userPages.map((p) => ({
          id: p.id,
          name: p.name,
          pictureUrl: p.picture?.data?.url || '',
          alreadyConnected: connectedIds.has(p.id),
        })),
      };
    }
  } catch {
    // ไม่ใช่ user token — ลองแบบ page token ต่อ
  }

  // Page token: ตรวจกับ /me โดยตรง
  try {
    const info = await fb.getPageInfo(token);
    const page = await repository.savePage({
      id: info.id,
      name: info.name ?? '',
      pictureUrl: info.picture?.data?.url || '',
      accessToken: token,
      connectedAt: new Date().toISOString(),
      lastSyncAt: null,
    });
    return { page: toPublicPage(page) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw AppError.badRequest(
      `เชื่อมต่อไม่สำเร็จ: ${message} — ถ้าเป็น User token ต้องติ๊กเลือกเพจตอนขอสิทธิ์ ` +
        `หรือถ้าเป็น Page token ต้องมีสิทธิ์ pages_read_engagement`,
    );
  }
}

/** เชื่อมต่อเพจที่ผู้ใช้เลือกจากรายการของ user token */
export async function connectPagesFromUserToken(
  accessToken: unknown,
  pageIds: unknown,
): Promise<{ id: string; name?: string }[]> {
  if (
    !accessToken ||
    typeof accessToken !== 'string' ||
    !Array.isArray(pageIds) ||
    !pageIds.length
  ) {
    throw AppError.badRequest('ต้องระบุ accessToken และ pageIds');
  }
  try {
    const userPages = await fb.getUserPages(await toLongLived(accessToken.trim()));
    const wanted = new Set(pageIds.map(String));
    const connected: { id: string; name?: string }[] = [];
    for (const p of userPages) {
      if (!wanted.has(p.id) || !p.access_token) continue;
      await repository.savePage({
        id: p.id,
        name: p.name ?? '',
        pictureUrl: p.picture?.data?.url || '',
        accessToken: p.access_token,
        connectedAt: new Date().toISOString(),
        lastSyncAt: null,
      });
      connected.push({ id: p.id, name: p.name });
    }
    return connected;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw AppError.badRequest(`เชื่อมต่อไม่สำเร็จ: ${message}`);
  }
}

export async function deletePage(pageId: string): Promise<void> {
  await repository.deletePage(pageId);
}

export async function findPage(pageId: string): Promise<StoredPage | null> {
  return (await repository.getPages()).find((p) => p.id === pageId) ?? null;
}

/** หาเพจ หรือโยน 404 (ใช้ใน endpoint ที่ต้องมีเพจอยู่จริง) */
export async function findPageOrThrow(pageId: string): Promise<StoredPage> {
  const page = await findPage(pageId);
  if (!page) throw AppError.notFound('ไม่พบเพจนี้ในระบบ');
  return page;
}
