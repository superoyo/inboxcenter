// IAMService — ผู้ให้บริการ identity / SSO hub ขององค์กร
//
// เรียกจากฝั่ง server เท่านั้น (ไม่ใช่จาก browser) จึง "ไม่ต้อง" อยู่ใน CORS allow-list
// ของ IAM — ข้อจำกัด CORS มีผลกับการเรียกตรงจาก browser เท่านั้น
// ส่วน SSO redirect (returnUrl) ยังต้องลงทะเบียน origin เป็น System — ดู docs/IAM-SSO.md
import { env } from '../../config/env';
import { AppError } from '../../utils/app-error';

const BASE = () => env.IAM_BASE_URL.replace(/\/+$/, '');

/** โปรไฟล์จาก IAM — ฟิลด์ที่ประกาศคือฟิลด์ที่ระบบนี้ใช้ (ตัวจริงมีมากกว่านี้) */
export interface IamProfile {
  id?: string;
  empCode?: string;
  empThaiName?: string;
  empEngName?: string;
  nickName?: string | null;
  positionName?: string;
  departmentName?: string;
  profileURL?: string | null;
  email?: string;
  /** มีเฉพาะตอน login (Operation 1) ไม่มีใน Operation 2 */
  access_token?: string;
  expiration?: string;
  wazzupPhotoBase64?: string | null;
  wazzupPhotoFileType?: string | null;
  wazzupPhotoName?: string | null;
}

export interface IamProfileResponse {
  profile: IamProfile;
  userRole: string[];
}

/**
 * ฟิลด์อ่อนไหวที่ต้องไม่หลุดออกจาก API ของเรา
 * hrPassword / birthdayDate = รหัสผ่านเข้าระบบของพนักงาน · aspNetUsers* = PII ที่หน้าเว็บไม่ใช้
 */
const SENSITIVE = ['hrPassword', 'birthdayDate', 'aspNetUsersId', 'aspNetUsersEmail'] as const;

/** ตัดฟิลด์อ่อนไหวทิ้งก่อนส่งต่อให้หน้าเว็บ (ทำทุกเส้นทางที่คืนโปรไฟล์) */
export function stripSensitive(profile: IamProfile): IamProfile {
  const safe: Record<string, unknown> = { ...profile };
  for (const key of SENSITIVE) delete safe[key];
  return safe as IamProfile;
}

async function callIam(path: string, init: RequestInit, failMessage: string): Promise<Response> {
  try {
    return await fetch(`${BASE()}${path}`, init);
  } catch {
    throw AppError.upstream(failMessage);
  }
}

/** ข้อความ 401 ที่ IAM ส่งมา (เช่น "This account is no longer active.") — ใช้บอกผู้ใช้ได้ */
async function messageFrom(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === 'string' && body.message.trim() ? body.message : fallback;
  } catch {
    return fallback;
  }
}

export interface IamLoginInput {
  userName: string;
  password: string;
}

/** Operation 1 — login ตรงด้วย userName + password (userName ไม่ใช่อีเมล) */
export async function login(input: IamLoginInput): Promise<IamProfileResponse> {
  const res = await callIam(
    '/api/User/Login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่',
  );
  if (res.status === 401) {
    throw AppError.unauthorized(
      await messageFrom(res, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีไม่ได้ใช้งานแล้ว'),
    );
  }
  if (res.status === 400) throw AppError.badRequest('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  if (!res.ok) throw AppError.upstream('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');

  const data = (await res.json()) as IamProfileResponse;
  return { profile: stripSensitive(data.profile ?? {}), userRole: data.userRole ?? [] };
}

/** Operation 2 — อ่านโปรไฟล์ + roles ของเจ้าของ token (self-scoped ไม่มีพารามิเตอร์) */
export async function getProfile(authorization: string): Promise<IamProfileResponse> {
  const res = await callIam(
    '/api/User/Profile',
    { headers: { Authorization: authorization } },
    'โหลดโปรไฟล์ไม่สำเร็จ',
  );
  // ไม่มี refresh token — 401 = ต้อง login ใหม่
  if (res.status === 401) throw AppError.unauthorized('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  if (!res.ok) throw AppError.upstream('โหลดโปรไฟล์ไม่สำเร็จ');

  const data = (await res.json()) as IamProfileResponse;
  return { profile: stripSensitive(data.profile ?? {}), userRole: data.userRole ?? [] };
}
