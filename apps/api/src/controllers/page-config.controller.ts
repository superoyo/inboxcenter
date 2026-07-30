import type { Request, Response } from 'express';
import * as pageConfig from '../services/page-config.service';

export async function list(_req: Request, res: Response): Promise<void> {
  res.json(await pageConfig.listPageConfigs());
}

export async function update(req: Request, res: Response): Promise<void> {
  const config = await pageConfig.setPageConfig(String(req.params.id), req.body);
  res.json({ ok: true, config });
}
