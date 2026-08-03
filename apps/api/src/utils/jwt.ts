// อ่าน/ตรวจ JWT ของระบบ ecosystem (Wazzup / IAMService — เซ็นด้วย HS256 secret เดียวกัน)
//
// ⚠️ ค่าเริ่มต้นยังเช็คแค่ exp เหมือนเดิม เพราะฝั่งนี้ไม่มี shared secret
// ตั้ง IAM_JWT_SECRET แล้วจะ verify ลายเซ็น (+ iss/aud ถ้าตั้งไว้) ตาม Operation 5 ของ
// skill iam-authentication — ดู docs/IAM-SSO.md
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

export interface JwtPayload {
  exp?: unknown;
  nbf?: unknown;
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  name?: unknown;
  empCode?: unknown;
  role?: unknown;
  [claim: string]: unknown;
}

/** อ่าน payload ของ JWT โดยไม่ verify ลายเซ็น (null = รูปแบบไม่ใช่ JWT) */
export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2 || !parts[1]) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
}

export function decodeJwtExp(token: string): number | null {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === 'number' ? exp : null;
}

/** token ยังใช้ได้อยู่หรือไม่ (มี exp และยังไม่ถึงกำหนด) */
export function isTokenValid(token: string): boolean {
  const exp = decodeJwtExp(token);
  return Boolean(exp && exp * 1000 > Date.now());
}

/** ดึง token จาก header Authorization: Bearer xxx */
export function bearerToken(authorization: string | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(authorization || '');
  return m?.[1] ?? null;
}

// claim role มาได้หลายชื่อ/หลายรูป — ดู checklist ข้อ 5 ของ Operation 3
const ROLE_CLAIMS = [
  'role',
  'roles',
  'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',
] as const;

/** รวม role จาก claim ทุกชื่อที่เป็นไปได้ (string หรือ array) แล้วตัดตัวซ้ำ */
export function rolesFromClaims(payload: JwtPayload | null): string[] {
  if (!payload) return [];
  const out = new Set<string>();
  for (const key of ROLE_CLAIMS) {
    const v = payload[key];
    if (typeof v === 'string') out.add(v);
    else if (Array.isArray(v)) for (const r of v) if (typeof r === 'string') out.add(r);
  }
  return [...out];
}

/** เทียบ string แบบไม่ปล่อยข้อมูลผ่านเวลาที่ใช้เทียบ */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface VerifyResult {
  ok: boolean;
  /** เหตุผลที่ไม่ผ่าน — สำหรับ log ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่ส่งให้ผู้ใช้ */
  reason?: string;
}

/**
 * ตรวจ token ตาม Operation 5: ลายเซ็น HS256 + iss + aud + exp/nbf
 * ตรวจเฉพาะช่องที่ตั้งค่าไว้ — ไม่ตั้ง IAM_JWT_SECRET = ข้ามทั้งหมด (คืน ok เสมอ)
 * เพื่อให้ requireAuth ยังทำงานแบบเดิมจนกว่าจะได้ secret มา
 */
export function verifyEcosystemToken(token: string): VerifyResult {
  const secret = env.IAM_JWT_SECRET;
  if (!secret) return { ok: true };

  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return { ok: false, reason: 'รูปแบบไม่ใช่ JWT 3 ส่วน' };
  }
  const [header, body, signature] = parts as [string, string, string];

  // ยอมรับแค่ HS256 — กัน alg=none และการสลับไป alg อื่น
  const alg = (() => {
    try {
      return (JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: unknown })
        .alg;
    } catch {
      return null;
    }
  })();
  if (alg !== 'HS256') return { ok: false, reason: `alg ไม่ใช่ HS256 (${String(alg)})` };

  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  if (!safeEqual(signature, expected)) return { ok: false, reason: 'ลายเซ็นไม่ตรง' };

  const payload = decodeJwtPayload(token);
  if (!payload) return { ok: false, reason: 'อ่าน payload ไม่ได้' };

  const nowSec = Date.now() / 1000;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    return { ok: false, reason: 'หมดอายุ' };
  }
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec) {
    return { ok: false, reason: 'ยังไม่ถึงเวลาใช้ (nbf)' };
  }
  if (env.IAM_JWT_ISSUER && payload.iss !== env.IAM_JWT_ISSUER) {
    return { ok: false, reason: 'issuer ไม่ตรง' };
  }
  if (env.IAM_JWT_AUDIENCE) {
    // IAM ประทับ aud หนึ่งช่องต่อหนึ่ง audience ที่ตั้งไว้ → เป็น string หรือ array ก็ได้
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.IAM_JWT_AUDIENCE)) return { ok: false, reason: 'audience ไม่ตรง' };
  }
  return { ok: true };
}
