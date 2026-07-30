import { Router } from 'express';
import * as controller from '../../controllers/competitors.controller';
import { asyncHandler } from '../../utils/async-handler';

export const competitorsRouter = Router();

competitorsRouter.get('/competitors', asyncHandler(controller.list));
competitorsRouter.post('/competitors', asyncHandler(controller.add));
competitorsRouter.get('/competitors/:id', asyncHandler(controller.detail));
competitorsRouter.delete('/competitors/:id', asyncHandler(controller.remove));
competitorsRouter.get('/competitors/:id/sync-history', asyncHandler(controller.syncHistory));
competitorsRouter.post('/competitors/:id/sync', asyncHandler(controller.sync));
