import type { Request, Response } from 'express';
import * as service from '../services/product-groups.service';

export async function list(_req: Request, res: Response): Promise<void> {
  res.json(await service.listProductGroups());
}
