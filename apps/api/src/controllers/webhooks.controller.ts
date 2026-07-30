// Webhook ของ LINE — LINE เรียกเข้ามาเอง ไม่ผ่าน requireAuth
// ความปลอดภัยอยู่ที่การตรวจลายเซ็น HMAC ด้วย channelSecret ของเพจนั้น
import type { Request, Response } from 'express';
import { verifySignature, type LineWebhookEvent } from '../integrations/line';
import * as lineService from '../services/line.service';

export async function lineWebhook(req: Request, res: Response): Promise<void> {
  const page = await lineService.findLinePage(String(req.params.channelId));
  if (!page) {
    res.status(404).end();
    return;
  }
  if (!verifySignature(page.channelSecret, req.rawBody, req.headers['x-line-signature'])) {
    res.status(401).end();
    return;
  }

  // ตอบ LINE ทันที (LINE มี timeout) แล้วค่อยประมวลผล event ต่อเบื้องหลัง
  res.status(200).end();
  const body = (req.body ?? {}) as { events?: LineWebhookEvent[] };
  await lineService.handleEvents(page, Array.isArray(body.events) ? body.events : []);
}
