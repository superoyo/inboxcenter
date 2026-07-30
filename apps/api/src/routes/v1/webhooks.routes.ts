import { Router } from 'express';
import * as controller from '../../controllers/webhooks.controller';
import { asyncHandler } from '../../utils/async-handler';

export const webhooksRouter = Router();

// ไม่ผ่าน requireAuth (ดู middleware/require-auth.ts) — ยืนยันด้วยลายเซ็น HMAC
webhooksRouter.post('/line/webhook/:channelId', asyncHandler(controller.lineWebhook));
