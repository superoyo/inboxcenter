import { Router } from 'express';
import * as controller from '../../controllers/connections.controller';
import { asyncHandler } from '../../utils/async-handler';

export const connectionsRouter = Router();

connectionsRouter.get('/connections/line', asyncHandler(controller.listLine));
connectionsRouter.post('/connections/line', asyncHandler(controller.connectLine));
connectionsRouter.delete('/connections/line/:id', asyncHandler(controller.disconnectLine));
