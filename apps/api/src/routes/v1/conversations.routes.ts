import express, { Router } from 'express';
import * as controller from '../../controllers/conversations.controller';
import { asyncHandler } from '../../utils/async-handler';

export const conversationsRouter = Router();

conversationsRouter.get('/conversations', asyncHandler(controller.list));
conversationsRouter.get('/calendar', asyncHandler(controller.calendar));
conversationsRouter.get('/messages', asyncHandler(controller.messages));

conversationsRouter.get('/conversations/:id/thread', asyncHandler(controller.thread));
conversationsRouter.post('/conversations/:id/forward', asyncHandler(controller.forward));
// ปิดเคส / รอคำตอบ — เก็บแยกจาก messages เหมือน forward ลูกค้าไม่เห็น
conversationsRouter.post('/conversations/:id/case', asyncHandler(controller.caseEvent));
// เส้นทางเดียวที่ส่งข้อความออกไปถึงลูกค้า (อ่านจาก messages เท่านั้น ไม่แตะ forwards)
conversationsRouter.post('/conversations/:convId/reply', asyncHandler(controller.sendReply));

// ---- ไฟล์แนบ ----
// รับตัวไฟล์เป็น raw body — express.json ไม่แตะเส้นนี้เพราะ Content-Type ไม่ใช่ json
conversationsRouter.post(
  '/conversations/:id/attachment',
  express.raw({ type: () => true, limit: '21mb' }),
  asyncHandler(controller.sendFile),
);
// เส้นเสิร์ฟไฟล์เปิดสาธารณะ (Facebook/LINE เข้ามาดึงเอง) — ดู middleware/require-auth.ts
conversationsRouter.get('/attachments/:id', asyncHandler(controller.getFile));
