// Apify — ดึงโพสต์ของเพจคู่แข่งจาก Facebook (เพจสาธารณะ)
// ใช้ actor ทางการ apify/facebook-posts-scraper ซึ่งรองรับกรองช่วงวันที่
// (onlyPostsNewerThan / onlyPostsOlderThan) จึงดึงเฉพาะช่วงที่ยังไม่มีได้
// ชี้ไปที่อื่นได้ผ่าน APIFY_API_BASE (ใช้ตอนทดสอบด้วย mock server)
const API = process.env.APIFY_API_BASE || 'https://api.apify.com/v2';
const ACTOR = process.env.APIFY_FB_ACTOR || 'apify~facebook-posts-scraper';
const POLL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;

function token() {
  const t = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || '';
  if (!t) {
    const err = new Error('ยังไม่ได้ตั้งค่า APIFY_TOKEN — ใส่ token ของ Apify ใน environment ก่อนใช้งาน');
    err.code = 'NO_TOKEN';
    throw err;
  }
  return t;
}
const hasToken = () => Boolean(process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN);

async function callApify(path, init = {}) {
  const res = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token())}`, init);
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error((data.error && data.error.message) || `Apify API ${res.status}`);
  }
  return data.data !== undefined ? data.data : data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ดึงโพสต์ของเพจเดียวในช่วง [from, to] (YYYY-MM-DD) — คืน array ของโพสต์ที่ normalize แล้ว
async function fetchPagePosts(pageUrl, { from, to, resultsLimit = 200, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const input = {
    startUrls: [{ url: pageUrl }],
    resultsLimit,
    captionText: false,
  };
  if (from) input.onlyPostsNewerThan = from;
  // to เป็นวันสุดท้ายที่ต้องการ (รวมวันนั้น) — actor ตัดที่ "เก่ากว่า" จึงบวก 1 วันให้ครอบคลุม
  if (to) input.onlyPostsOlderThan = addDays(to, 1);

  const run = await callApify(`/acts/${ACTOR}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const runId = run.id;
  const datasetId = run.defaultDatasetId;
  const deadline = Date.now() + timeoutMs;
  let status = run.status;
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
    if (Date.now() > deadline) throw new Error('ดึงข้อมูลนานเกินกำหนด — ลองลดช่วงเวลาที่ดึง');
    await sleep(POLL_MS);
    const cur = await callApify(`/actor-runs/${runId}`);
    status = cur.status;
  }
  if (status !== 'SUCCEEDED') throw new Error(`Apify run ${status} — ลองใหม่อีกครั้ง`);

  const items = await callApify(`/datasets/${datasetId}/items?clean=true&format=json`);
  const rows = Array.isArray(items) ? items : [];
  const posts = rows.map(normalizePost).filter((p) => p && p.id);

  // Actor คืน "แถว error" แทนโพสต์เมื่อดึงเพจนั้นไม่ได้ (เช่น เพจจำกัดอายุ/ภูมิภาค หรือไม่เปิดสาธารณะ)
  // ถ้าไม่ได้โพสต์เลยและมีแถว error → โยน error ให้ผู้ใช้รู้สาเหตุ ไม่ใช่รายงานว่า "ได้ 0 โพสต์"
  if (!posts.length) {
    const errRow = rows.find((r) => r && (r.error || r.errorDescription));
    if (errRow) {
      const detail = String(errRow.errorDescription || errRow.error || '');
      if (/private|no_items|empty/i.test(detail) || /no_items/i.test(String(errRow.error || ''))) {
        throw new Error(
          'Facebook ไม่เปิดเผยโพสต์ของเพจนี้ให้ผู้ที่ไม่ได้ล็อกอิน ' +
          '(เพจอาจจำกัดอายุ/ประเทศ หรือไม่ได้ตั้งเป็นสาธารณะ) — ' +
          `Apify แจ้งว่า: ${detail}`
        );
      }
      throw new Error(`Apify แจ้งว่า: ${detail}`);
    }
  }
  return posts;
}

function addDays(dayKey, n) {
  const d = new Date(dayKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const pick = (obj, keys) => {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};
const num = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

// ดึง URL รูปแรกจาก media — actor คืน media เป็น array สำหรับโพสต์รูป (element แรกเป็น
// "mediaset" ที่มี url ของ*โพสต์* ไม่ใช่รูป) และเป็น object สำหรับวิดีโอ/reel จึงรองรับทั้งสองแบบ
// สำคัญ: ต้องรับเฉพาะ URL ที่เป็นรูปจริง ไม่งั้นจะได้ลิงก์โพสต์มาแสดงเป็นรูป (รูปเสีย)
const looksLikeImage = (u) =>
  typeof u === 'string' && /^https?:\/\//.test(u) &&
  (/fbcdn\.net|scontent|\.(?:jpg|jpeg|png|webp|gif)(?:\?|$)/i.test(u));

// ค่าอาจเป็น string ตรงๆ หรือ object ที่มี uri/url/src ข้างใน
const imgUrl = (v) => {
  if (looksLikeImage(v)) return v;
  if (v && typeof v === 'object') {
    const u = pick(v, ['uri', 'url', 'src']);
    if (looksLikeImage(u)) return u;
  }
  return '';
};

function imageFromMediaEntry(m) {
  if (!m) return '';
  if (typeof m === 'string') return looksLikeImage(m) ? m : '';
  if (typeof m !== 'object') return '';
  // ไล่ตามเส้นทางที่ actor ใช้จริง (ยืนยันจาก output จริงของ apify/facebook-posts-scraper)
  const cands = [
    m.thumbnail, m.thumbnailUrl, m.full_picture,
    m.image, m.photo_image, m.thumbnailImage,
    m.preferred_thumbnail && m.preferred_thumbnail.image,
    m.clip_fallback_cover,
    m.url, m.uri, m.src, // ท้ายสุด และผ่านตัวกรอง looksLikeImage แล้วเท่านั้น
  ];
  for (const c of cands) {
    const u = imgUrl(c);
    if (u) return u;
  }
  return '';
}

function firstImage(p) {
  const direct = imgUrl(pick(p, ['thumbnailUrl', 'imageUrl', 'previewImage', 'full_picture', 'image', 'thumbnail']));
  if (direct) return direct;
  for (const src of [p.media, p.attachments, p.images]) {
    if (!src) continue;
    if (Array.isArray(src)) {
      for (const m of src) { const u = imageFromMediaEntry(m); if (u) return u; }
    } else {
      const u = imageFromMediaEntry(src);
      if (u) return u;
    }
  }
  return '';
}

// แปลงโพสต์จาก Apify → รูปแบบที่ระบบเราเก็บ (เผื่อชื่อฟิลด์ต่างกันตามเวอร์ชัน actor)
function normalizePost(p) {
  if (!p || typeof p !== 'object') return null;
  const id = String(pick(p, ['postId', 'post_id', 'id', 'legacyId']) || '');
  const rawTime = pick(p, ['time', 'date', 'publishedTime', 'timestamp', 'createdTime']);
  let iso = '';
  if (typeof rawTime === 'number') iso = new Date(rawTime * (rawTime > 1e12 ? 1 : 1000)).toISOString();
  else if (rawTime) { const d = new Date(rawTime); if (!isNaN(d)) iso = d.toISOString(); }
  return {
    id,
    text: String(pick(p, ['text', 'message', 'caption', 'postText']) || ''),
    url: String(pick(p, ['url', 'topLevelUrl', 'postUrl', 'link', 'facebookUrl']) || ''),
    time: iso,
    likes: num(pick(p, ['likes', 'likesCount', 'reactionsCount', 'reactionCount'])),
    comments: num(pick(p, ['comments', 'commentsCount', 'commentCount'])),
    shares: num(pick(p, ['shares', 'sharesCount', 'shareCount'])),
    imageUrl: String(firstImage(p) || ''),
    pageName: String(pick(p, ['pageName', 'facebookName', 'pageTitle']) || (p.user && p.user.name) || ''),
  };
}

module.exports = { fetchPagePosts, hasToken, addDays };
