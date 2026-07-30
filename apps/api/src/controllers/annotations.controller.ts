import type { Request, Response } from 'express';
import * as service from '../services/annotations.service';

export async function setStatus(req: Request, res: Response): Promise<void> {
  const status = await service.setStatus(String(req.params.convId), (req.body ?? {}).status);
  res.json({ ok: true, status });
}

export async function setRemark(req: Request, res: Response): Promise<void> {
  const remark = await service.setRemark(String(req.params.convId), (req.body ?? {}).remark);
  res.json({ ok: true, remark });
}

export async function setTags(req: Request, res: Response): Promise<void> {
  const tags = await service.setTags(String(req.params.convId), (req.body ?? {}).tags);
  res.json({ ok: true, tags });
}
