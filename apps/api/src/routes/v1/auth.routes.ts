import { Router } from 'express';
import * as controller from '../../controllers/auth.controller';
import { asyncHandler } from '../../utils/async-handler';

export const authRouter = Router();

// login เข้าได้โดยไม่ต้องมี token (ดู middleware/require-auth.ts)
authRouter.post('/auth/login', asyncHandler(controller.login));
authRouter.get('/auth/profile', asyncHandler(controller.profile));
authRouter.get('/employees', asyncHandler(controller.employees));
