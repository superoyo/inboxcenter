// แท็ก / โน้ต / สถานะสี ของห้องแชท (เก็บแยกจากข้อมูลแชท)
import { Router } from 'express';
import * as controller from '../../controllers/annotations.controller';
import { asyncHandler } from '../../utils/async-handler';

export const annotationsRouter = Router();

annotationsRouter.put('/conversations/:convId/status', asyncHandler(controller.setStatus));
annotationsRouter.put('/conversations/:convId/remark', asyncHandler(controller.setRemark));
annotationsRouter.put('/conversations/:convId/tags', asyncHandler(controller.setTags));
