// รวม route ของ v1 ทั้งหมด — เพิ่ม router ใหม่ที่นี่ทีละกลุ่มตามที่ย้ายจาก server.js เดิม
// ดู docs/REFACTOR-PLAN.md (เฟส 2)
import { Router } from 'express';
import { annotationsRouter } from './annotations.routes';
import { authRouter } from './auth.routes';
import { configRouter } from './config.routes';
import { pageConfigRouter } from './page-config.routes';
import { projectsRouter } from './projects.routes';
import { savedRepliesRouter } from './saved-replies.routes';

export const v1Router = Router();

v1Router.use(configRouter);
v1Router.use(authRouter);
v1Router.use(projectsRouter);
v1Router.use(pageConfigRouter);
v1Router.use(savedRepliesRouter);
v1Router.use(annotationsRouter);
