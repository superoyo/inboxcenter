// รายชื่อพนักงาน — cache รวม 10 นาที เพราะรายชื่อไม่ค่อยเปลี่ยนและไม่ต้องยิง Wazzup ทุกครั้ง
// (requireAuth กันเส้นนี้อยู่แล้ว จึงแชร์ cache ข้ามผู้ใช้ได้)
import type { Employee } from '@inboxcenter/shared';
import { fetchEmployees } from '../integrations/wazzup/client';

const TTL_MS = 10 * 60 * 1000;

let cache: { at: number; data: Employee[] } | null = null;

export async function listEmployees(authorization: string): Promise<Employee[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const data = await fetchEmployees(authorization);
  cache = { at: Date.now(), data };
  return data;
}

/** ล้าง cache (ใช้ในเทสต์) */
export function clearEmployeesCache(): void {
  cache = null;
}
