import type { Request, Response } from 'express';
import * as conversations from '../services/conversations.service';
import * as forwards from '../services/forwards.service';
import * as reply from '../services/reply.service';

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export async function list(req: Request, res: Response): Promise<void> {
  res.json(
    await conversations.listConversations({
      pageId: str(req.query.pageId),
      project: str(req.query.project),
      q: str(req.query.q),
      date: str(req.query.date),
      forwarded: str(req.query.forwarded),
      limit: str(req.query.limit),
      offset: str(req.query.offset),
      tz: str(req.query.tz),
    }),
  );
}

export async function calendar(req: Request, res: Response): Promise<void> {
  res.json(
    await conversations.calendarCounts({
      pageId: str(req.query.pageId),
      project: str(req.query.project),
      q: str(req.query.q),
      tz: str(req.query.tz),
    }),
  );
}

export async function thread(req: Request, res: Response): Promise<void> {
  res.json(await conversations.getThread(String(req.params.id)));
}

export async function forward(req: Request, res: Response): Promise<void> {
  const entry = await forwards.addForward(String(req.params.id), req.body ?? {});
  res.json({ ok: true, forward: entry });
}

export async function sendReply(req: Request, res: Response): Promise<void> {
  const message = await reply.sendReply(String(req.params.convId), (req.body ?? {}).text);
  res.json({ ok: true, message });
}

export async function messages(req: Request, res: Response): Promise<void> {
  res.json(
    await conversations.listMessages({
      pageId: str(req.query.pageId),
      limit: str(req.query.limit),
    }),
  );
}
