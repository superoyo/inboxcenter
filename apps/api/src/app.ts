// จุดประกอบ API — ระหว่างเปลี่ยนผ่าน server.js เดิมยัง mount router นี้เข้าไปใช้
//
// API versioning: เส้นทางใหม่อยู่ใต้ /api/v1/* แต่ยังคง /api/* ไว้ด้วย
// เพราะ Agency Intelligence proxy /api/* มาที่เราและหน้าเว็บเดิมเรียก /api/... ตรงๆ
// (ห้ามย้าย prefix /api — ดู docs/INBOX-CENTER-INTEGRATION.md)
import { Router } from 'express';
import { v1Router } from './routes/v1';

export interface ApiRouterOptions {
  /** ใส่ false เพื่อเลิกรองรับเส้นเดิม /api/* (ทำได้หลังแจ้งฝั่งที่ฝังเราแล้ว) */
  legacyAlias?: boolean;
}

/** router ที่ครอบทั้ง /api/v1/* และ /api/* (alias ช่วงเปลี่ยนผ่าน) */
export function createApiRouter({ legacyAlias = true }: ApiRouterOptions = {}): Router {
  const router = Router();
  router.use('/api/v1', v1Router);
  if (legacyAlias) router.use('/api', v1Router);
  return router;
}

export { errorHandler } from './middleware/error-handler';
export { requireAuth } from './middleware/require-auth';
export { logger } from './config/logger';
export { env } from './config/env';
export { repository, storageBackendName } from './repositories';
