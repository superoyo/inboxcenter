import { Router } from 'express';
import * as controller from '../../controllers/projects.controller';
import { asyncHandler } from '../../utils/async-handler';

export const projectsRouter = Router();

projectsRouter.get('/projects', asyncHandler(controller.list));
projectsRouter.post('/projects', asyncHandler(controller.create));
projectsRouter.put('/projects/:id', asyncHandler(controller.update));
projectsRouter.delete('/projects/:id', asyncHandler(controller.remove));
