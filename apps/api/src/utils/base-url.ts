// URL ฐานของเซิร์ฟเวอร์ (สำหรับสร้าง webhook URL ให้ผู้ใช้ไปวางใน LINE Console)
// อยู่หลัง reverse proxy จึงต้องเชื่อ x-forwarded-proto ก่อน req.protocol
import type { Request } from 'express';
import { env } from '../config/env';

export function baseUrl(req: Request): string {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const forwarded = req.headers['x-forwarded-proto'];
  const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded) || req.protocol || 'https';
  const proto = String(raw).split(',')[0]!.trim();
  return `${proto}://${req.get('host')}`;
}
