// ตัวช่วยเรื่องวันที่ — ต้องคิดตาม "เวลาท้องถิ่นของผู้ใช้" เพราะหน้าเว็บส่ง tz offset มาด้วย
const DAY_MS = 86_400_000;

/**
 * สร้างฟังก์ชันแปลง timestamp → 'YYYY-MM-DD' ตามเวลาท้องถิ่นของผู้ใช้
 * tzMin = offset (นาที) จาก UTC ที่ฝั่งหน้าเว็บส่งมา (ไทย = 420)
 * ไม่ส่งมา → ใช้เวลาของเครื่องเซิร์ฟเวอร์
 */
export function dayKeyFactory(tzMin?: number | null): (value: string | number | Date) => string {
  const offsetMs = Number.isFinite(tzMin) ? (tzMin as number) * 60_000 : null;
  return (value) => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    if (offsetMs === null) {
      return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    }
    return new Date(d.getTime() + offsetMs).toISOString().slice(0, 10);
  };
}

/** 'YYYY-MM-DD' ของวันนี้ (UTC) */
export const todayKey = (): string => new Date().toISOString().slice(0, 10);

/** บวก/ลบวันจาก 'YYYY-MM-DD' (คำนวณบน UTC ไม่ให้ timezone เครื่องมาเบี่ยง) */
export function addDays(dayKey: string, n: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** วันแรกของเดือน โดยนับ offset เดือนจากเดือนนี้ (0 = เดือนนี้, -1 = เดือนก่อน) */
export function monthStartKey(offset = 0): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 10);
}

/** วันสุดท้ายของเดือน โดยนับ offset เดือนจากเดือนนี้ */
export function monthEndKey(offset = 0): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 0))
    .toISOString()
    .slice(0, 10);
}

export { DAY_MS };
