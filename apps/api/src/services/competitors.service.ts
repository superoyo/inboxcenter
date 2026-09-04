// เพจคู่แข่ง — ดึงโพสต์ผ่าน Apify แบบ "ดึงเฉพาะส่วนเพิ่ม"
import type {
  Competitor,
  CompetitorDetail,
  CompetitorListResponse,
  CompetitorOwner,
  CompetitorSyncRun,
  DateRange,
  SyncRangeKey,
} from '@inboxcenter/shared';
import * as apify from '../integrations/apify';
import { repository } from '../repositories';
import { AppError } from '../utils/app-error';
import { monthEndKey, monthStartKey, todayKey } from '../utils/date';
import { env } from '../config/env';

/** ช่วงเวลาที่เลือกได้จากหน้าเว็บ */
const RANGES: Record<SyncRangeKey, () => DateRange & { label: string }> = {
  current: () => ({ from: monthStartKey(0), to: todayKey(), label: 'เดือนปัจจุบัน' }),
  prev: () => ({ from: monthStartKey(-1), to: monthEndKey(-1), label: 'เดือนก่อนหน้า' }),
  '3m': () => ({ from: monthStartKey(-2), to: todayKey(), label: '3 เดือนย้อนหลัง' }),
  '6m': () => ({ from: monthStartKey(-5), to: todayKey(), label: '6 เดือนย้อนหลัง' }),
};

/**
 * คำนวณ "ช่วงที่ยังต้องดึง" จากช่วงที่ขอ เทียบกับช่วงที่ดึงมาแล้ว
 * โพสต์เก่าไม่เปลี่ยนแปลง → ข้ามช่วงที่ครอบคลุมแล้วได้
 * แต่ "เดือนปัจจุบัน" ต้องดึงซ้ำเสมอ เพราะมีโพสต์ใหม่เพิ่มเข้ามาได้
 */
export function missingRanges(
  requested: DateRange,
  covered: { from: string | null; to: string | null },
): DateRange[] {
  if (!covered.from || !covered.to) return [requested];
  const gaps: DateRange[] = [];
  if (requested.from < covered.from) {
    gaps.push({ from: requested.from, to: apify.addDays(covered.from, -1) }); // เติมย้อนหลัง
  }
  const refetchFrom = covered.to < monthStartKey(0) ? covered.to : monthStartKey(0);
  const fwdFrom = refetchFrom > requested.from ? refetchFrom : requested.from;
  if (fwdFrom <= requested.to) gaps.push({ from: fwdFrom, to: requested.to }); // ต่อยอด + เดือนปัจจุบัน
  return gaps;
}

/** ดึง handle ของเพจจาก URL — รองรับ /pagename, /profile.php?id=, /people/name/id */
export function competitorHandle(url: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    if (!/facebook\.com$/i.test(u.hostname.replace(/^www\./i, ''))) return null;
    const seg = u.pathname.split('/').filter(Boolean);
    if (!seg.length) return null;
    if (seg[0] === 'profile.php') return u.searchParams.get('id');
    if (seg[0] === 'people' && seg[2]) return seg[2];
    return decodeURIComponent(seg[0]!);
  } catch {
    return null;
  }
}

/** กันกดดึงซ้อนกันในคู่แข่งเดียว */
const syncing = new Set<string>();

async function findOrThrow(id: string): Promise<Competitor> {
  const c = (await repository.getCompetitors()).find((x) => x.id === id);
  if (!c) throw AppError.notFound('ไม่พบเพจคู่แข่งนี้');
  return c;
}

/** id ของเพจคู่แข่ง สร้างจาก handle เพื่อให้ URL เดียวกันได้ id เดิมเสมอ */
const idFromHandle = (handle: string): string =>
  `cmp_${handle.toLowerCase().replace(/[^a-z0-9._-]/g, '_')}`;

function newCompetitor(handle: string, name?: string): Competitor {
  return {
    id: idFromHandle(handle),
    url: `https://www.facebook.com/${handle}`,
    handle,
    name: (name || '').trim() || handle,
    pictureUrl: '',
    addedAt: new Date().toISOString(),
    lastSyncAt: null,
    coveredFrom: null,
    coveredTo: null,
  };
}

/**
 * ดึงคู่แข่งที่กรอกไว้ในหน้า Admin (ตั้งค่ารายเพจ) เข้ามาเป็นเพจคู่แข่งอัตโนมัติ
 * และคืนแผนที่ว่า "คู่แข่งรายนี้เป็นคู่แข่งของเพจไหนบ้าง"
 *
 * แถวที่ URL ไม่ใช่เพจ Facebook จะถูกข้าม (กรอกเว็บแบรนด์ไว้ก็มี) — ไม่ถือเป็นข้อผิดพลาด
 * เพจที่มีอยู่แล้วจะไม่ถูกเขียนทับ เพื่อไม่ให้ช่วงข้อมูลที่ดึงมาแล้วหาย
 */
async function ownersFromPageConfigs(): Promise<Map<string, CompetitorOwner[]>> {
  const [configs, pages, existing] = await Promise.all([
    repository.getPageConfigs(),
    repository.getPages(),
    repository.getCompetitors(),
  ]);
  const nameOfPage = new Map(pages.map((p) => [p.id, p.name]));
  const have = new Set(existing.map((c) => c.id));
  const owners = new Map<string, CompetitorOwner[]>();

  for (const [pageId, config] of Object.entries(configs)) {
    for (const ref of config.competitors ?? []) {
      const handle = competitorHandle(String(ref.url || ''));
      if (!handle) continue;
      const id = idFromHandle(handle);

      const list = owners.get(id) ?? [];
      // เพจเดียวกันกรอก URL ซ้ำสองแถว ไม่ต้องนับซ้ำ
      if (!list.some((o) => o.pageId === pageId)) {
        list.push({
          pageId,
          pageName: nameOfPage.get(pageId) || pageId,
          brandName: String(ref.name || '').trim(),
        });
        owners.set(id, list);
      }

      if (!have.has(id)) {
        await repository.saveCompetitor(newCompetitor(handle, ref.name));
        have.add(id);
      }
    }
  }
  return owners;
}

/**
 * แปลง "URL + ชื่อ" ที่มาจากที่อื่นให้เป็นเพจคู่แข่งของเรา สร้างแถวที่ยังไม่มีให้ด้วย
 *
 * ใช้กับคู่แข่งที่มาจาก Product Group ของ Agency Intelligence — ต้องมีแถวจริงในระบบ
 * ก่อน ผู้ใช้จึงกดดึงโพสต์ (Apify) และเปิดปฏิทินของเพจนั้นได้ · แถวที่มีอยู่แล้วไม่ถูก
 * เขียนทับ เพื่อไม่ให้ช่วงข้อมูลที่ดึงมาแล้ว (coveredFrom/To) หาย
 * URL ที่ไม่ใช่เพจ Facebook ถูกข้ามเงียบ ๆ เหมือน ownersFromPageConfigs
 */
export async function ensureCompetitorsByUrl(
  refs: { url: string; name?: string }[],
): Promise<Competitor[]> {
  const existing = await repository.getCompetitors();
  const byId = new Map(existing.map((c) => [c.id, c]));
  const out: Competitor[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    const handle = competitorHandle(String(ref.url || ''));
    if (!handle) continue;
    const id = idFromHandle(handle);
    if (seen.has(id)) continue; // กรอก URL เดียวกันสองแถวในกลุ่มเดียว
    seen.add(id);

    let competitor = byId.get(id);
    if (!competitor) {
      competitor = newCompetitor(handle, ref.name);
      await repository.saveCompetitor(competitor);
      byId.set(id, competitor);
    }
    out.push(competitor);
  }
  return out;
}

export async function listCompetitors(): Promise<CompetitorListResponse> {
  const owners = await ownersFromPageConfigs();
  const list = await repository.getCompetitors();
  const items = await Promise.all(
    list.map(async (c) => ({
      ...c,
      postCount: (await repository.getCompetitorPosts(c.id)).length,
      owners: owners.get(c.id) ?? [],
    })),
  );
  return { items, apifyReady: apify.hasToken() };
}

export async function getCompetitor(id: string): Promise<CompetitorDetail> {
  const c = await findOrThrow(id);
  return { ...c, posts: await repository.getCompetitorPosts(c.id), apifyReady: apify.hasToken() };
}

export async function addCompetitor(url: string): Promise<Competitor> {
  const handle = competitorHandle(String(url || '').trim());
  if (!handle) {
    throw AppError.badRequest(
      'ใส่ URL เพจ Facebook ให้ถูกต้อง เช่น https://www.facebook.com/systemathailand',
    );
  }
  const id = idFromHandle(handle);
  const existing = (await repository.getCompetitors()).find((c) => c.id === id);
  if (existing) throw AppError.badRequest(`มีเพจ "${existing.name || handle}" อยู่แล้ว`);

  const competitor = newCompetitor(handle);
  await repository.saveCompetitor(competitor);
  return competitor;
}

export async function deleteCompetitor(id: string): Promise<void> {
  await repository.deleteCompetitor(id);
}

export async function listSyncRuns(id: string, limit = 50): Promise<CompetitorSyncRun[]> {
  return repository.getCompetitorSyncRuns(id, limit);
}

/** ประมาณจำนวนเดือนในช่วง เพื่อกำหนด resultsLimit ให้พอ */
const monthsBetween = (from: string, to: string): number =>
  Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 2.6e9) + 1);

/** ดึงโพสต์เพิ่ม — ดึงเฉพาะช่วงที่ยังไม่มี (เดือนปัจจุบันดึงซ้ำเสมอ) */
export async function syncCompetitor(id: string, rangeKey: string): Promise<CompetitorSyncRun> {
  const c = await findOrThrow(id);
  if (!env.apifyReady) {
    throw AppError.badRequest(
      'ยังไม่ได้ตั้งค่า APIFY_TOKEN — ใส่ token ของ Apify ใน environment ก่อน',
    );
  }
  const key = (rangeKey || 'current') as SyncRangeKey;
  const requested = (RANGES[key] || RANGES.current)();

  if (syncing.has(c.id)) throw new AppError(409, 'กำลังดึงข้อมูลเพจนี้อยู่ รอให้เสร็จก่อน');
  syncing.add(c.id);

  const startedAt = new Date().toISOString();
  const gaps = missingRanges(
    { from: requested.from, to: requested.to },
    { from: c.coveredFrom, to: c.coveredTo },
  );

  try {
    let added = 0;
    let fetched = 0;
    let name = c.name;
    for (const g of gaps) {
      const months = monthsBetween(g.from, g.to);
      const posts = await apify.fetchPagePosts(c.url, {
        from: g.from,
        to: g.to,
        resultsLimit: Math.min(1000, Math.max(60, months * 120)),
      });
      fetched += posts.length;
      const r = await repository.upsertCompetitorPosts(
        c.id,
        posts.map((p) => ({ ...p, competitorId: c.id })),
      );
      added += r.added;
      // อัปเดตชื่อเพจจากโพสต์ที่ได้ (ครั้งแรกจะยังเป็นแค่ handle)
      const named = posts.find((p) => p.pageName);
      if (named && (!name || name === c.handle)) name = named.pageName;
    }

    // ขยายช่วงที่ครอบคลุมแล้ว
    const coveredFrom =
      !c.coveredFrom || requested.from < c.coveredFrom ? requested.from : c.coveredFrom;
    const coveredTo = !c.coveredTo || requested.to > c.coveredTo ? requested.to : c.coveredTo;
    await repository.saveCompetitor({
      ...c,
      name,
      coveredFrom,
      coveredTo,
      lastSyncAt: new Date().toISOString(),
    });

    const run: CompetitorSyncRun = {
      id: `crun_${Date.now()}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      range: key,
      rangeLabel: requested.label,
      requested,
      gaps,
      fetched,
      added,
      skipped: !gaps.length,
      ok: true,
    };
    await repository.addCompetitorSyncRun(c.id, run);
    return run;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // บันทึกความล้มเหลวไว้ในประวัติด้วย ผู้ใช้จะเห็นสาเหตุย้อนหลังได้
    await repository.addCompetitorSyncRun(c.id, {
      id: `crun_${Date.now()}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      range: key,
      rangeLabel: requested.label,
      requested,
      gaps,
      fetched: 0,
      added: 0,
      skipped: false,
      ok: false,
      error: message,
    });
    throw AppError.badRequest(`ดึงข้อมูลไม่สำเร็จ: ${message}`);
  } finally {
    syncing.delete(c.id);
  }
}
