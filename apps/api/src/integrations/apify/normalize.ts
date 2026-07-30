// แปลงโพสต์จาก Apify → รูปแบบที่ระบบเราเก็บ
// ยืดหยุ่นต่อ schema เพราะ actor เปลี่ยนชื่อฟิลด์ได้ตามเวอร์ชัน
import type { CompetitorPost } from '@inboxcenter/shared';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => Boolean(v) && typeof v === 'object';

/** คืนค่าแรกที่ไม่ว่างจาก key ที่ให้มา */
function pick(obj: Rec, keys: string[]): unknown {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

const str = (v: unknown): string => (v == null ? '' : String(v));

/**
 * รับเฉพาะ URL ที่เป็น "รูปจริง"
 * สำคัญ: media element แรกของโพสต์รูปเป็น mediaset ที่มี url ของ *โพสต์* ไม่ใช่รูป
 * ถ้าไม่กรอง จะได้ลิงก์โพสต์มาแสดงเป็นรูป → รูปเสียทุกใบ
 */
const looksLikeImage = (u: unknown): u is string =>
  typeof u === 'string' &&
  /^https?:\/\//.test(u) &&
  /fbcdn\.net|scontent|\.(?:jpg|jpeg|png|webp|gif)(?:\?|$)/i.test(u);

/** ค่าอาจเป็น string ตรงๆ หรือ object ที่มี uri/url/src ข้างใน */
function imgUrl(v: unknown): string {
  if (looksLikeImage(v)) return v;
  if (isRec(v)) {
    const u = pick(v, ['uri', 'url', 'src']);
    if (looksLikeImage(u)) return u;
  }
  return '';
}

function imageFromMediaEntry(m: unknown): string {
  if (!m) return '';
  if (typeof m === 'string') return looksLikeImage(m) ? m : '';
  if (!isRec(m)) return '';
  // ไล่ตามเส้นทางที่ actor ใช้จริง (ยืนยันจาก output จริงของ apify/facebook-posts-scraper)
  const preferred = isRec(m.preferred_thumbnail) ? m.preferred_thumbnail.image : undefined;
  const cands: unknown[] = [
    m.thumbnail,
    m.thumbnailUrl,
    m.full_picture,
    m.image,
    m.photo_image,
    m.thumbnailImage,
    preferred,
    m.clip_fallback_cover,
    m.url,
    m.uri,
    m.src, // ท้ายสุด และผ่านตัวกรอง looksLikeImage แล้วเท่านั้น
  ];
  for (const c of cands) {
    const u = imgUrl(c);
    if (u) return u;
  }
  return '';
}

/** media เป็น array (โพสต์รูป) หรือ object (วิดีโอ/reel) — รองรับทั้งสองแบบ */
export function firstImage(p: Rec): string {
  const direct = imgUrl(
    pick(p, ['thumbnailUrl', 'imageUrl', 'previewImage', 'full_picture', 'image', 'thumbnail']),
  );
  if (direct) return direct;
  for (const src of [p.media, p.attachments, p.images]) {
    if (!src) continue;
    if (Array.isArray(src)) {
      for (const m of src) {
        const u = imageFromMediaEntry(m);
        if (u) return u;
      }
    } else {
      const u = imageFromMediaEntry(src);
      if (u) return u;
    }
  }
  return '';
}

/** เวลาอาจมาเป็น ISO string หรือ epoch (วินาที/มิลลิวินาที) */
function toIso(rawTime: unknown): string {
  if (typeof rawTime === 'number') {
    return new Date(rawTime * (rawTime > 1e12 ? 1 : 1000)).toISOString();
  }
  if (rawTime) {
    const d = new Date(rawTime as string);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return '';
}

export type NormalizedPost = Omit<CompetitorPost, 'competitorId'>;

export function normalizePost(raw: unknown): NormalizedPost | null {
  if (!isRec(raw)) return null;
  const user = isRec(raw.user) ? raw.user : undefined;
  return {
    id: str(pick(raw, ['postId', 'post_id', 'id', 'legacyId'])),
    text: str(pick(raw, ['text', 'message', 'caption', 'postText'])),
    url: str(pick(raw, ['url', 'topLevelUrl', 'postUrl', 'link', 'facebookUrl'])),
    time: toIso(pick(raw, ['time', 'date', 'publishedTime', 'timestamp', 'createdTime'])),
    likes: num(pick(raw, ['likes', 'likesCount', 'reactionsCount', 'reactionCount'])),
    comments: num(pick(raw, ['comments', 'commentsCount', 'commentCount'])),
    shares: num(pick(raw, ['shares', 'sharesCount', 'shareCount'])),
    imageUrl: str(firstImage(raw)),
    pageName: str(pick(raw, ['pageName', 'facebookName', 'pageTitle']) ?? user?.name),
  };
}

/**
 * Actor คืน "แถว error" แทนโพสต์เมื่อดึงเพจนั้นไม่ได้
 * (เช่น เพจจำกัดอายุ/ภูมิภาค หรือไม่เปิดสาธารณะ) — ต้องแปลงเป็น error ที่อ่านรู้เรื่อง
 * ไม่ใช่ปล่อยให้รายงานว่า "ได้ 0 โพสต์"
 */
export function errorFromRows(rows: unknown[]): Error | null {
  const errRow = rows.find((r) => isRec(r) && (r.error || r.errorDescription));
  if (!isRec(errRow)) return null;
  const detail = str(errRow.errorDescription || errRow.error);
  if (/private|no_items|empty/i.test(detail) || /no_items/i.test(str(errRow.error))) {
    return new Error(
      'Facebook ไม่เปิดเผยโพสต์ของเพจนี้ให้ผู้ที่ไม่ได้ล็อกอิน ' +
        '(เพจอาจจำกัดอายุ/ประเทศ หรือไม่ได้ตั้งเป็นสาธารณะ) — ' +
        `Apify แจ้งว่า: ${detail}`,
    );
  }
  return new Error(`Apify แจ้งว่า: ${detail}`);
}
