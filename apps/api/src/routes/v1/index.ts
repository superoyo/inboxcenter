// รวม route ของ v1 ทั้งหมด — เพิ่ม router ใหม่ที่นี่ทีละกลุ่มตามที่ย้ายจาก server.js เดิม
// ดู docs/REFACTOR-PLAN.md (เฟส 2)
import { Router } from 'express';
import { annotationsRouter } from './annotations.routes';
import { authRouter } from './auth.routes';
import { competitorsRouter } from './competitors.routes';
import { configRouter } from './config.routes';
import { connectionsRouter } from './connections.routes';
import { conversationsRouter } from './conversations.routes';
import { fdaRouter } from './fda.routes';
import { pageConfigRouter } from './page-config.routes';
import { pagesRouter } from './pages.routes';
import { productGroupsRouter } from './product-groups.routes';
import { projectsRouter } from './projects.routes';
import { savedRepliesRouter } from './saved-replies.routes';
import { syncRouter } from './sync.routes';
import { webhooksRouter } from './webhooks.routes';

export const v1Router = Router();

v1Router.use(configRouter);
v1Router.use(authRouter);
v1Router.use(projectsRouter);
v1Router.use(pageConfigRouter);
// sync ต้องมาก่อน pages เพราะมี /pages/:id/sync (เฉพาะเจาะจงกว่า /pages/:id)
v1Router.use(syncRouter);
v1Router.use(pagesRouter);
v1Router.use(savedRepliesRouter);
v1Router.use(annotationsRouter);
v1Router.use(conversationsRouter);
v1Router.use(competitorsRouter);
v1Router.use(productGroupsRouter);
v1Router.use(fdaRouter);
v1Router.use(connectionsRouter);
v1Router.use(webhooksRouter);
