import type { Request, Response } from 'express';
import * as service from '../services/saved-replies.service';

export async function list(req: Request, res: Response): Promise<void> {
  res.json(await service.listSavedReplies(String(req.params.pageId)));
}

export async function add(req: Request, res: Response): Promise<void> {
  res.json(await service.addSavedReply(String(req.params.pageId), req.body ?? {}));
}

export async function update(req: Request, res: Response): Promise<void> {
  res.json(
    await service.updateSavedReply(
      String(req.params.pageId),
      String(req.params.replyId),
      req.body as Record<string, unknown> | undefined,
    ),
  );
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteSavedReply(String(req.params.pageId), String(req.params.replyId));
  res.json({ ok: true });
}
