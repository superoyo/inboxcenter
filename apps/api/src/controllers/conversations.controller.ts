import type { Request, Response } from 'express';
import * as attachments from '../services/attachments.service';
import * as caseEvents from '../services/case-events.service';
import * as conversations from '../services/conversations.service';
import * as forwards from '../services/forwards.service';
import * as reply from '../services/reply.service';
import { AppError } from '../utils/app-error';
import { baseUrl } from '../utils/base-url';

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

/** ปิดเคส / รอคำตอบ — สถานะภายในทีม ไม่ส่งถึงลูกค้า */
export async function caseEvent(req: Request, res: Response): Promise<void> {
  const entry = await caseEvents.addCaseEvent(String(req.params.id), req.body ?? {});
  res.json({ ok: true, event: entry });
}

/**
 * อัปโหลดไฟล์แล้วส่งให้ลูกค้าทันที
 * รับตัวไฟล์เป็น raw body (ไม่ใช้ multipart จึงไม่ต้องเพิ่ม dependency)
 * ชื่อไฟล์/ชนิดส่งมาทาง query — ?name=...&type=...
 */
export async function sendFile(req: Request, res: Response): Promise<void> {
  const body = req.body as Buffer | undefined;
  if (!Buffer.isBuffer(body)) throw AppError.badRequest('ไม่มีข้อมูลไฟล์');

  const meta = await attachments.save({
    conversationId: String(req.params.id),
    name: decodeURIComponent(String(req.query.name || 'file')),
    mimeType: String(req.query.type || req.headers['content-type'] || ''),
    data: body,
  });
  // URL ที่ Facebook/LINE จะเข้ามาดึง — ต้องเป็น absolute และเข้าถึงได้จากภายนอก
  const url = `${baseUrl(req)}/api/attachments/${meta.id}`;
  const message = await reply.sendAttachment(String(req.params.id), meta, url);
  res.json({ ok: true, message, attachment: meta });
}

/**
 * เสิร์ฟไฟล์แนบ — เส้นนี้ "เปิดสาธารณะ" (ดู middleware/require-auth.ts)
 * เพราะ Facebook/LINE เข้ามาดึงเองโดยไม่มี token ของเรา
 * ความปลอดภัยอยู่ที่ id ที่สุ่ม 24 ไบต์ จึงเดาไม่ได้
 */
export async function getFile(req: Request, res: Response): Promise<void> {
  const { meta, data } = await attachments.read(String(req.params.id));
  res.setHeader('Content-Type', meta.mimeType);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Cache-Control', 'private, max-age=86400');
  // inline สำหรับรูป (LINE/FB ต้องดูได้) · เอกสารให้ดาวน์โหลดพร้อมชื่อเดิม
  res.setHeader(
    'Content-Disposition',
    `${attachments.isImage(meta.mimeType) ? 'inline' : 'attachment'}; filename="${meta.name}"`,
  );
  res.end(data);
}

export async function messages(req: Request, res: Response): Promise<void> {
  res.json(
    await conversations.listMessages({
      pageId: str(req.query.pageId),
      limit: str(req.query.limit),
    }),
  );
}
