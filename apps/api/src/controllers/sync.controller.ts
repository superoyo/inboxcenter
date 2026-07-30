import type { Request, Response } from 'express';
import { findPageOrThrow } from '../services/pages.service';
import * as sync from '../services/sync.service';

export async function status(_req: Request, res: Response): Promise<void> {
  res.json(await sync.getSyncStatus());
}

export async function history(_req: Request, res: Response): Promise<void> {
  res.json(await sync.getSyncRuns(50));
}

export function getInterval(_req: Request, res: Response): void {
  res.json({ minutes: sync.getIntervalMinutes() });
}

export async function setInterval(req: Request, res: Response): Promise<void> {
  const { minutes, nextRefreshAt } = await sync.setIntervalMinutes((req.body ?? {}).minutes);
  res.json({ ok: true, minutes, nextRefreshAt });
}

export async function syncPage(req: Request, res: Response): Promise<void> {
  const page = await findPageOrThrow(String(req.params.id));
  const { pageId, conversations } = await sync.syncOnePage(page);
  res.json({ ok: true, pageId, conversations });
}

export async function syncAll(_req: Request, res: Response): Promise<void> {
  const results = await sync.syncAllPages('manual');
  res.json({ results, lastRefreshAt: sync.getLastRefreshAt() });
}
