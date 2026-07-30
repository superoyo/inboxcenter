import type { Request, Response } from 'express';
import * as service from '../services/pages.service';

export async function list(req: Request, res: Response): Promise<void> {
  res.json(
    await service.listPages({
      project: req.query.project as string | undefined,
      pageId: req.query.pageId as string | undefined,
      tz: req.query.tz as string | undefined,
    }),
  );
}

export async function add(req: Request, res: Response): Promise<void> {
  const result = await service.addPageFromToken((req.body ?? {}).accessToken);
  // User token → ตอบรายชื่อเพจให้เลือก; Page token → ตอบเพจที่เชื่อมแล้ว
  res.json('needsSelection' in result && result.needsSelection ? result : result.page);
}

export async function addFromUserToken(req: Request, res: Response): Promise<void> {
  const body = req.body ?? {};
  const connected = await service.connectPagesFromUserToken(body.accessToken, body.pageIds);
  res.json({ ok: true, connected });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deletePage(String(req.params.id));
  res.json({ ok: true });
}
