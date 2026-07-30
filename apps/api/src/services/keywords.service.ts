// Keyword extraction จากข้อความลูกค้า — ตัดคำไทยด้วย Intl.Segmenter (ICU ใน Node)
// แล้วกรองคำฟุ่มเฟือย (stopwords) เหลือเฉพาะคำที่บอก "เนื้อหา" ของบทสนทนา

// prettier-ignore
export const STOPWORDS: ReadonlySet<string> = new Set([
  // คำลงท้าย / สรรพนาม / คำเชื่อม
  'ครับ', 'ค่ะ', 'คะ', 'ค๊ะ', 'ค่า', 'คับ', 'งับ', 'ฮะ', 'จ้า', 'จ้ะ', 'จร้า', 'นะ', 'น้า',
  'เนอะ', 'นะคะ', 'นะครับ', 'ครับผม', 'ไหม', 'มั้ย', 'มั๊ย', 'หรอ', 'เหรอ', 'หรือ', 'หรือเปล่า',
  'ไง', 'และ', 'แล้ว', 'ก็', 'ที่', 'ซึ่ง', 'อัน', 'ไม่', 'ใช่', 'ได้', 'เป็น', 'คือ', 'มี',
  'มา', 'ไป', 'ให้', 'ของ', 'ใน', 'บน', 'กับ', 'แต่', 'ว่า', 'จะ', 'ถ้า', 'พอ', 'ต้อง', 'อยาก',
  'เลย', 'ด้วย', 'อยู่', 'อย่าง', 'ยัง', 'แค่', 'เอา', 'ทำ', 'ดู', 'ขอ', 'ช่วย', 'หน่อย', 'กัน',
  'แบบ', 'เรื่อง', 'ต่อ', 'จาก', 'ถึง', 'ตาม', 'เอง', 'ทั้ง', 'บ้าง', 'ตอน', 'เพราะ', 'มัน',
  'นี้', 'นั้น', 'นี่', 'นั่น', 'โน่น', 'ทาง', 'อ่ะ', 'อะ', 'เดี๋ยว', 'จ๊ะ', 'จ๋า', 'ล่ะ', 'สิ',
  'เออ', 'อ๋อ', 'อืม', 'การ', 'ความ', 'มาก', 'พอดี', 'ก่อน', 'หลัง', 'อีก', 'ทุก', 'ต่างๆ',
  'ประมาณ', 'เรียบร้อย',
  // คำถามทั่วไป
  'อะไร', 'ไหน', 'ทำไม', 'เมื่อไหร่', 'เมื่อไร', 'ยังไง', 'อย่างไร', 'เท่าไหร่', 'เท่าไร',
  'กี่',
  // สรรพนามบุคคล
  'คุณ', 'ผม', 'ฉัน', 'เรา', 'เขา', 'เค้า', 'เธอ', 'ท่าน', 'พี่', 'น้อง', 'ลูกค้า', 'แอดมิน',
  'แอด',
  // คำทักทาย / มารยาท
  'สวัสดี', 'สวัสดีครับ', 'สวัสดีค่ะ', 'ขอบคุณ', 'ขอบคุณครับ', 'ขอบคุณค่ะ', 'ขอบคุณมากค่ะ',
  'ขอบคุณมากครับ', 'สอบถาม', 'รบกวน', 'ทราบ', 'ขอโทษ', 'ยินดี', 'บริการ', 'โอเค', 'ตอนนี้',
  'วันนี้',
  // อังกฤษ/URL ที่พบบ่อย
  'ok', 'okay', 'the', 'and', 'for', 'are', 'you', 'this', 'that', 'with', 'not', 'https',
  'http', 'www', 'com', 'bit', 'ly', 'co', 'th', 'net',
]);

export interface KeywordCount {
  word: string;
  count: number;
}

/** ข้อความที่ roomKeywords ต้องใช้ (รับ Message เต็มได้ เพราะเป็น structural typing) */
export interface KeywordSourceMessage {
  text?: string | null;
  isFromPage?: boolean;
}

let segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter {
  if (!segmenter) segmenter = new Intl.Segmenter('th', { granularity: 'word' });
  return segmenter;
}

/** แตกข้อความเป็นคำ เหลือเฉพาะคำที่มีความหมาย */
export function extractTokens(text: string | null | undefined): string[] {
  const tokens: string[] = [];
  for (const s of getSegmenter().segment(String(text || ''))) {
    if (!s.isWordLike) continue;
    const w = s.segment.trim().toLowerCase();
    if (w.length < 2) continue; // ตัดคำสั้นเกิน
    if (STOPWORDS.has(w)) continue;
    if (/^[\d.,:/-]+$/.test(w)) continue; // ตัดตัวเลขล้วน
    tokens.push(w);
  }
  return tokens;
}

/** คำสำคัญของห้องเดียว — นับความถี่จากข้อความฝั่งลูกค้า */
export function roomKeywords(messages: KeywordSourceMessage[], top = 8): KeywordCount[] {
  const counts: Record<string, number> = {};
  for (const m of messages) {
    if (m.isFromPage || !m.text) continue;
    for (const t of extractTokens(m.text)) counts[t] = (counts[t] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([word, count]) => ({ word, count }));
}
