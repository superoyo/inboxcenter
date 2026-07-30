import { Router } from 'express';
import * as controller from '../../controllers/conversations.controller';
import { asyncHandler } from '../../utils/async-handler';

export const conversationsRouter = Router();

conversationsRouter.get('/conversations', asyncHandler(controller.list));
conversationsRouter.get('/calendar', asyncHandler(controller.calendar));
conversationsRouter.get('/messages', asyncHandler(controller.messages));

conversationsRouter.get('/conversations/:id/thread', asyncHandler(controller.thread));
conversationsRouter.post('/conversations/:id/forward', asyncHandler(controller.forward));
// เส้นทางเดียวที่ส่งข้อความออกไปถึงลูกค้า (อ่านจาก messages เท่านั้น ไม่แตะ forwards)
conversationsRouter.post('/conversations/:convId/reply', asyncHandler(controller.sendReply));
