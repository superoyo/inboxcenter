import { Router } from 'express';
import * as controller from '../../controllers/page-config.controller';
import { asyncHandler } from '../../utils/async-handler';

export const pageConfigRouter = Router();

pageConfigRouter.get('/page-config', asyncHandler(controller.list));
// อยู่ใต้ /pages/:id เพราะเป็นการตั้งค่า "ของเพจนั้น"
pageConfigRouter.put('/pages/:id/config', asyncHandler(controller.update));
