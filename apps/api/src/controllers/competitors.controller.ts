import type { Request, Response } from 'express';
import * as service from '../services/competitors.service';

export async function list(_req: Request, res: Response): Promise<void> {
  res.json(await service.listCompetitors());
}

export async function detail(req: Request, res: Response): Promise<void> {
  res.json(await service.getCompetitor(String(req.params.id)));
}

export async function add(req: Request, res: Response): Promise<void> {
  const competitor = await service.addCompetitor(String((req.body ?? {}).url ?? ''));
  res.json({ ok: true, competitor });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteCompetitor(String(req.params.id));
  res.json({ ok: true });
}

export async function syncHistory(req: Request, res: Response): Promise<void> {
  res.json(await service.listSyncRuns(String(req.params.id), 50));
}

export async function sync(req: Request, res: Response): Promise<void> {
  const run = await service.syncCompetitor(
    String(req.params.id),
    String((req.body ?? {}).range ?? 'current'),
  );
  res.json({ ok: true, run });
}
