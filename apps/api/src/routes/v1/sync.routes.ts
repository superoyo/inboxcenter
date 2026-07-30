import { Router } from 'express';
import * as controller from '../../controllers/sync.controller';
import { asyncHandler } from '../../utils/async-handler';

export const syncRouter = Router();

syncRouter.get('/sync-status', asyncHandler(controller.status));
syncRouter.get('/sync-history', asyncHandler(controller.history));
syncRouter.get('/settings/sync-interval', controller.getInterval);
syncRouter.put('/settings/sync-interval', asyncHandler(controller.setInterval));
syncRouter.post('/pages/:id/sync', asyncHandler(controller.syncPage));
syncRouter.post('/sync-all', asyncHandler(controller.syncAll));
