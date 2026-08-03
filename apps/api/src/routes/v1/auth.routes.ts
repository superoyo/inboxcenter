import { Router } from 'express';
import * as controller from '../../controllers/auth.controller';
import { asyncHandler } from '../../utils/async-handler';

export const authRouter = Router();

// login เข้าได้โดยไม่ต้องมี token (ดู middleware/require-auth.ts)
authRouter.post('/auth/login', asyncHandler(controller.login));
authRouter.get('/auth/profile', asyncHandler(controller.profile));
authRouter.get('/employees', asyncHandler(controller.employees));

// ---- IAMService / SSO (ดู docs/IAM-SSO.md) ----
// /auth/sso/status เข้าได้โดยไม่ต้อง login — หน้าเว็บต้องรู้ก่อนว่าจะแสดงปุ่ม SSO ไหม
authRouter.get('/auth/sso/status', controller.ssoStatus);
// แลก token จาก fragment เป็นโปรไฟล์ + roles (ต้องแนบ token มาแล้ว)
authRouter.get('/auth/sso/session', asyncHandler(controller.ssoSession));
// login ตรงกับ IAM (Operation 1) — สำรองไว้ ยังไม่ได้ใช้เป็นทางเข้าหลัก
authRouter.post('/auth/iam/login', asyncHandler(controller.iamLogin));
