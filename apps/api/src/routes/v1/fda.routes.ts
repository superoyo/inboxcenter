// ตรวจข้อความโฆษณากับระบบ อย. — proxy เพื่อไม่ให้ API key ลงไปถึงเบราว์เซอร์
import { Router } from 'express';
import * as controller from '../../controllers/fda.controller';
import { asyncHandler } from '../../utils/async-handler';

export const fdaRouter = Router();

fdaRouter.post('/fda/check', asyncHandler(controller.check));
