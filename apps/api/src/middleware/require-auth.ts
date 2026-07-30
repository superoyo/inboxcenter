// ประตูตรวจ token ของทุก /api/* ยกเว้นเส้นที่เปิดไว้
//
// ⚠️ เช็คแค่ exp ของ JWT ไม่ verify ลายเซ็น — ตั้งใจไว้แบบนี้ (login ผ่าน Wazzup)
// ดู utils/jwt.ts
import type { RequestHandler } from 'express';
import { AppError } from '../utils/app-error';
import { bearerToken, decodeJwtExp } from '../utils/jwt';

/** เส้นที่เข้าได้โดยไม่ต้อง login */
const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/config']);

/** LINE เรียก webhook เอง — ยืนยันด้วยลายเซ็น HMAC แทน token */
const isPublic = (path: string): boolean =>
  PUBLIC_PATHS.has(path) ||
  path.startsWith('/api/line/webhook/') ||
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
  req.authToken = token;
  next();
};
