// ประตูตรวจ token ของทุก /api/* ยกเว้นเส้นที่เปิดไว้
//
// ⚠️ ค่าเริ่มต้นเช็คแค่ exp ของ JWT ไม่ verify ลายเซ็น — ตั้งใจไว้แบบนี้ (login ผ่าน Wazzup)
// ตั้ง IAM_JWT_SECRET เมื่อได้ shared secret จาก IAM แล้ว จะ verify ลายเซ็น + iss/aud เพิ่ม
// ดู utils/jwt.ts และ docs/IAM-SSO.md
import type { RequestHandler } from 'express';
import { logger } from '../config/logger';
import { AppError } from '../utils/app-error';
import { bearerToken, decodeJwtExp, verifyEcosystemToken } from '../utils/jwt';

/** เส้นที่เข้าได้โดยไม่ต้อง login */
const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/iam/login',
  // หน้า login ต้องรู้ก่อนว่าเปิด SSO ไว้ไหม จึงยังไม่มี token ตอนเรียก
  '/api/auth/sso/status',
  '/api/config',
]);

/** LINE เรียก webhook เอง — ยืนยันด้วยลายเซ็น HMAC แทน token */
const isPublic = (path: string): boolean =>
  PUBLIC_PATHS.has(path) ||
  path.startsWith('/api/line/webhook/') ||
  // Facebook/LINE เข้ามาดึงไฟล์แนบเองโดยไม่มี token — ป้องกันด้วย id ที่สุ่มเดาไม่ได้แทน
  path.startsWith('/api/attachments/') ||
  path.startsWith('/api/v1/attachments/') ||
  // รองรับทั้ง /api/... และ /api/v1/... (ช่วงที่ยังคงเส้นเดิมไว้)
  PUBLIC_PATHS.has(path.replace('/api/v1/', '/api/')) ||
  path.startsWith('/api/v1/line/webhook/');

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.path.startsWith('/api/')) return next(); // static/html ผ่านได้
  if (isPublic(req.path)) return next();

  const token = bearerToken(req.headers.authorization);
  if (!token) return next(AppError.unauthorized());

  const exp = decodeJwtExp(token);
  if (!exp || exp * 1000 <= Date.now()) {
    return next(AppError.unauthorized('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'));
  }

  // ตรวจลายเซ็น/iss/aud เพิ่ม — ทำงานเฉพาะเมื่อตั้ง IAM_JWT_SECRET ไว้
  const verified = verifyEcosystemToken(token);
  if (!verified.ok) {
    // เหตุผลเก็บไว้ใน log ฝั่งเซิร์ฟเวอร์ — ผู้ใช้เห็นข้อความกลางเสมอ
    logger.warn({ path: req.path, reason: verified.reason }, 'ปฏิเสธ token');
    return next(AppError.unauthorized('เซสชันไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่'));
  }

  req.authToken = token;
  next();
};
