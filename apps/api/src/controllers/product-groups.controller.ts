import type { Request, Response } from 'express';
import * as service from '../services/product-groups.service';

export async function list(req: Request, res: Response): Promise<void> {
  // project.js แนบ ?project / ?pageId มาให้ทุก request /api อัตโนมัติ
  res.json(
    await service.listProductGroups({
      project: req.query.project ? String(req.query.project) : undefined,
      pageId: req.query.pageId ? String(req.query.pageId) : undefined,
    }),
  );
}
