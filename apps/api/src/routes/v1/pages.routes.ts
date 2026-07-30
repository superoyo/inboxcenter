import { Router } from 'express';
import * as controller from '../../controllers/pages.controller';
import { asyncHandler } from '../../utils/async-handler';

export const pagesRouter = Router();

pagesRouter.get('/pages', asyncHandler(controller.list));
pagesRouter.post('/pages', asyncHandler(controller.add));
// ต้องมาก่อน /pages/:id เพื่อไม่ให้ from-user-token ถูกจับเป็น :id
pagesRouter.post('/pages/from-user-token', asyncHandler(controller.addFromUserToken));
pagesRouter.delete('/pages/:id', asyncHandler(controller.remove));
