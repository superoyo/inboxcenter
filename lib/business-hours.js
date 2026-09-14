// เวลาทำการ — ใช้วัด "ความเร็วในการตอบ" ให้ตรงกับที่ทีมทำงานจริง
//
// เดิมทุกตัวเลขใน Analytics นับเวลานาฬิกา 24 ชม. ลูกค้าทักตอนสองทุ่มแล้วทีมตอบ
// เช้าวันรุ่งขึ้นจึงถูกนับเป็นช้า 13 ชม. ทั้งที่ตอบทันทีที่เปิดทำการ — ค่าเฉลี่ยและ
// SLA จึงเพี้ยนไปตามปริมาณข้อความนอกเวลา ไม่ได้สะท้อนฝีมือของทีม
//
// ที่นี่นับเฉพาะเวลาที่อยู่ในช่วง 09:00–18:00 ตามเวลาท้องถิ่นของผู้ดู
// (หน้าเว็บส่ง ?tz= มาให้ ค่าเดียวกับที่ใช้แบ่งวันในกราฟ)
// ข้อความที่เข้ามานอกเวลาทำการ = เริ่มจับเวลาตอนเปิดทำการรอบถัดไป
//
// ตัวอย่างตามที่ตกลงกันไว้: ลูกค้าทัก 18:01 · ทีมตอบ 09:31 วันรุ่งขึ้น → 31 นาที
// (18:01 อยู่นอกเวลาทำการ นาฬิกาเริ่มเดิน 09:00)

const HOUR = 3600e3;
const DAY = 86400e3;

/** เปิด–ปิดทำการ (ชั่วโมงท้องถิ่น) */
const WORK_START_H = 9;
const WORK_END_H = 18;

/**
 * วันทำงาน (0 = อาทิตย์ … 6 = เสาร์)
 *
 * ตอนนี้นับทุกวันตามที่สั่งมา — ถ้าจะไม่นับเสาร์–อาทิตย์ แก้ที่นี่ที่เดียวเป็น
 * new Set([1, 2, 3, 4, 5]) แล้วทุกตัวเลขที่ใช้โมดูลนี้เปลี่ยนตามทันที
 */
const WORK_DAYS = new Set([0, 1, 2, 3, 4, 5, 6]);

const WORK_MS_PER_DAY = (WORK_END_H - WORK_START_H) * HOUR;

/** วันที่ dayIndex (นับจาก epoch) ตรงกับวันอะไร — 1 ม.ค. 1970 เป็นวันพฤหัสบดี (4) */
const weekdayOf = (dayIndex) => ((dayIndex % 7) + 7 + 4) % 7;

/** มีวันทำงานกี่วันใน [0, dayIndex) — คิดเป็นสัปดาห์ก่อน ที่เหลือค่อยไล่ทีละวัน */
function workDaysBefore(dayIndex) {
  if (dayIndex <= 0) return 0;
  const weeks = Math.floor(dayIndex / 7);
  let n = weeks * WORK_DAYS.size;
  for (let i = weeks * 7; i < dayIndex; i++) if (WORK_DAYS.has(weekdayOf(i))) n++;
  return n;
}

/**
 * เวลาทำการสะสมตั้งแต่ epoch ถึงเวลา x (x ต้องบวก offset เป็นเวลาท้องถิ่นมาแล้ว)
 *
 * ทำเป็นฟังก์ชันสะสมแทนการวนทีละวัน เพราะห้องที่ค้างมานานเป็นปีจะวนหลายร้อยรอบ
 * ต่อหนึ่งห้อง — หน้า Analytics คำนวณทุกห้องในทุกครั้งที่โหลด
 */
function elapsedSinceEpoch(x) {
  const dayIndex = Math.floor(x / DAY);
  const base = workDaysBefore(dayIndex) * WORK_MS_PER_DAY;
  if (!WORK_DAYS.has(weekdayOf(dayIndex))) return base;
  const intoDay = x - dayIndex * DAY;
  // ก่อนเปิด = 0 · หลังปิด = เต็มวันทำการ · ระหว่างนั้นคิดตามจริง
  return base + Math.min(Math.max(intoDay - WORK_START_H * HOUR, 0), WORK_MS_PER_DAY);
}

/**
 * สร้างตัวคำนวณสำหรับ timezone หนึ่ง ๆ
 * @param {number} offsetMs ระยะห่างจาก UTC เป็นมิลลิวินาที (เช่นไทย = +7 ชม.)
 * @returns {(startMs: number, endMs: number) => number} เวลาทำการระหว่างสองจุด (ms)
 */
function businessMsFactory(offsetMs) {
  return (startMs, endMs) => {
    if (!(endMs > startMs)) return 0;
    return Math.max(0, elapsedSinceEpoch(endMs + offsetMs) - elapsedSinceEpoch(startMs + offsetMs));
  };
}

module.exports = {
  businessMsFactory,
  WORK_START_H,
  WORK_END_H,
  WORK_DAYS,
  WORK_MS_PER_DAY,
};
