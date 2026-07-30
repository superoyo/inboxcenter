// ค่าคงที่ของระบบที่ใช้ร่วมหลาย service

/** ดึงย้อนหลังทับรอบก่อน 15 นาที กันข้อความหลุดช่วงรอยต่อของ incremental sync */
export const SYNC_OVERLAP_MS = 15 * 60 * 1000;

/** รอบดึงอัตโนมัติเริ่มต้น (นาที) */
export const DEFAULT_SYNC_MINUTES = 60;
/** ช่วงที่ตั้งรอบดึงอัตโนมัติได้ (นาที) */
export const SYNC_INTERVAL_MIN = 15;
export const SYNC_INTERVAL_MAX = 1440;

/** รูปโปรไฟล์ลูกค้า: อายุ cache ปกติ 7 วัน */
export const PIC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** ถ้าดึงรูปไม่ได้ (url ว่าง) ให้ลองใหม่เร็วขึ้นเป็นทุก 1 วัน */
export const PIC_RETRY_MS = 24 * 60 * 60 * 1000;

/** ข้อความเพจที่ซ้ำ ≥ ค่านี้ทั้งเพจ ถือว่าเป็นข้อความอัตโนมัติ (bot) */
export const BOT_REPEAT_THRESHOLD = 3;
