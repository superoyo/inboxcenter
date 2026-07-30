// ดึงโพสต์ของเพจคู่แข่งจาก Facebook (เพจสาธารณะ) ผ่าน actor ทางการของ Apify
// actor รองรับกรองช่วงวันที่ (onlyPostsNewerThan / onlyPostsOlderThan) จึงดึงเฉพาะช่วงที่ยังไม่มีได้
import { DEFAULT_TIMEOUT_MS, getDatasetItems, runActorToCompletion } from './client';
import { errorFromRows, normalizePost, type NormalizedPost } from './normalize';

const ACTOR = process.env.APIFY_FB_ACTOR || 'apify~facebook-posts-scraper';

export interface FetchPagePostsOptions {
  /** YYYY-MM-DD (รวมวันนี้) */
  from?: string;
  /** YYYY-MM-DD (รวมวันนี้) */
  to?: string;
  resultsLimit?: number;
  timeoutMs?: number;
}

/** บวก/ลบวันจาก YYYY-MM-DD (คำนวณบน UTC ไม่ให้ timezone ของเครื่องมาเบี่ยง) */
export function addDays(dayKey: string, n: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ดึงโพสต์ของเพจเดียวในช่วง [from, to] — คืน array ของโพสต์ที่ normalize แล้ว */
export async function fetchPagePosts(
  pageUrl: string,
  { from, to, resultsLimit = 200, timeoutMs = DEFAULT_TIMEOUT_MS }: FetchPagePostsOptions = {},
): Promise<NormalizedPost[]> {
  const input: Record<string, unknown> = {
    startUrls: [{ url: pageUrl }],
    resultsLimit,
    captionText: false,
  };
  if (from) input.onlyPostsNewerThan = from;
  // to เป็นวันสุดท้ายที่ต้องการ (รวมวันนั้น) — actor ตัดที่ "เก่ากว่า" จึงบวก 1 วันให้ครอบคลุม
  if (to) input.onlyPostsOlderThan = addDays(to, 1);

  const datasetId = await runActorToCompletion(ACTOR, input, timeoutMs);
  const rows = await getDatasetItems(datasetId);
  const posts = rows.map(normalizePost).filter((p): p is NormalizedPost => Boolean(p && p.id));

  if (!posts.length) {
    const err = errorFromRows(rows);
    if (err) throw err;
  }
  return posts;
}
