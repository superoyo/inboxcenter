import { Router } from 'express';
import * as controller from '../../controllers/saved-replies.controller';
import { asyncHandler } from '../../utils/async-handler';

export const savedRepliesRouter = Router();

savedRepliesRouter.get('/pages/:pageId/saved-replies', asyncHandler(controller.list));
savedRepliesRouter.post('/pages/:pageId/saved-replies', asyncHandler(controller.add));
savedRepliesRouter.put('/pages/:pageId/saved-replies/:replyId', asyncHandler(controller.update));
savedRepliesRouter.delete('/pages/:pageId/saved-replies/:replyId', asyncHandler(controller.remove));
