// Wazzup — ระบบ HR ที่ใช้เป็นผู้ออก token ให้ระบบนี้ (login + โปรไฟล์ + รายชื่อพนักงาน)
import type { AuthSession, AuthUser, Employee } from '@inboxcenter/shared';
import { env } from '../../config/env';
import { AppError } from '../../utils/app-error';

const BASE = env.WAZZUP_BASE_URL;

export interface LoginInput {
  authenticationName: string;
  authenticationPassword: string;
}

/** เข้าสู่ระบบ — Wazzup เป็นผู้ออก JWT ที่ระบบนี้ใช้ต่อ */
export async function login(input: LoginInput): Promise<AuthSession> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/User/Authentication`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw AppError.upstream('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
  }
  if (res.status === 401) throw AppError.unauthorized('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  if (!res.ok) throw AppError.upstream('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
  return (await res.json()) as AuthSession;
}

export async function getProfile(authorization: string): Promise<AuthUser> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/User/Profile`, { headers: { Authorization: authorization } });
  } catch {
    throw AppError.upstream('โหลดโปรไฟล์ไม่สำเร็จ');
  }
  if (res.status === 401) throw AppError.unauthorized('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  if (!res.ok) throw AppError.upstream('โหลดโปรไฟล์ไม่สำเร็จ');
  return (await res.json()) as AuthUser;
}

interface RawEmployee {
  empCode?: unknown;
  empThaiName?: unknown;
  empEngName?: unknown;
  nickName?: unknown;
  positionName?: unknown;
  departmentName?: unknown;
  /** รูปโปรไฟล์ (URL สาธารณะ ไม่ใช่ข้อมูลอ่อนไหว) */
  profileURL?: unknown;
}

/** ดึงรายชื่อพนักงานทั้งบริษัท แล้วคัดเฉพาะฟิลด์ที่ระบบนี้ใช้ */
export async function fetchEmployees(authorization: string): Promise<Employee[]> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/EmployeeAll/`, { headers: { Authorization: authorization } });
  } catch {
    throw AppError.upstream('โหลดรายชื่อพนักงานไม่สำเร็จ');
  }
  if (res.status === 401) throw AppError.unauthorized('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  if (!res.ok) throw AppError.upstream('โหลดรายชื่อพนักงานไม่สำเร็จ');

  const raw = (await res.json()) as unknown;
  const list: RawEmployee[] = Array.isArray(raw)
    ? raw
    : (((raw as Record<string, unknown>)?.data as RawEmployee[]) ??
      ((raw as Record<string, unknown>)?.employees as RawEmployee[]) ??
      []);

  return list
    .map((e) => ({
      empCode: String(e.empCode || ''),
      thaiName: String(e.empThaiName || ''),
      engName: String(e.empEngName || ''),
      nickName: String(e.nickName || ''),
      position: String(e.positionName || ''),
      department: String(e.departmentName || ''),
      photo: String(e.profileURL || ''),
    }))
    .filter((e) => e.empCode || e.thaiName || e.engName);
}
