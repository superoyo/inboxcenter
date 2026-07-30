import type { Request, Response } from 'express';
import * as service from '../services/line.service';
import { baseUrl } from '../utils/base-url';

export async function listLine(req: Request, res: Response): Promise<void> {
  res.json(await service.listConnections(baseUrl(req)));
}

export async function connectLine(req: Request, res: Response): Promise<void> {
  const connection = await service.connect(req.body ?? {}, baseUrl(req));
  res.json({ ok: true, connection });
}

export async function disconnectLine(req: Request, res: Response): Promise<void> {
  await service.disconnect(String(req.params.id));
  res.json({ ok: true });
}
