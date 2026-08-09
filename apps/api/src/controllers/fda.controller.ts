import type { Request, Response } from 'express';
import * as service from '../services/fda.service';

export async function check(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  res.json(
    await service.checkText({
      text: body.text,
      productCategory: body.productCategory as string | string[] | undefined,
      mediaType: body.mediaType as 'print' | 'audio' | 'audiovisual' | undefined,
      weightControlApproved: Boolean(body.weightControlApproved),
    }),
  );
}
