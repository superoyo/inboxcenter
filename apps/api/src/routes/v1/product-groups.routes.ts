import { Router } from 'express';
import * as controller from '../../controllers/product-groups.controller';
import { asyncHandler } from '../../utils/async-handler';

export const productGroupsRouter = Router();

// Product Group + เพจที่ปักหมุด + คู่แข่ง จาก Agency Intelligence
// (เราเป็นคนแนบ X-Service-Key ให้ — คีย์ห้ามลงไปถึงเบราว์เซอร์)
productGroupsRouter.get('/product-groups', asyncHandler(controller.list));
