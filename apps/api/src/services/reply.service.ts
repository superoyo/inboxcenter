// ตอบกลับลูกค้าใน inbox — เส้นทาง "เดียว" ที่ส่งข้อความออกไปถึงลูกค้า
//
// ⚠️ อ่านและเขียนที่ conversation.messages เท่านั้น
// ข้อความส่งต่อภายในทีม (forwards.service) เก็บแยกคนละที่ จึงไม่มีทางถูกส่งออกจากที่นี่
import type { Message } from '@inboxcenter/shared';
import { logger } from '../config/logger';
import * as fb from '../integrations/facebook';
import { GraphApiError } from '../integrations/facebook/client';
import * as line from '../integrations/line';
import { repository } from '../repositories';
import { AppError } from '../utils/app-error';

/** แปลง error จาก Send API เป็นข้อความไทยที่เข้าใจง่าย */
function sendErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const graph = err instanceof GraphApiError ? err : null;

  if (graph?.subcode === 2018278 || /outside of allowed window/i.test(message)) {
    return 'ส่งไม่ได้: เกินช่วงเวลา 24 ชั่วโมงหลังลูกค้าทักมาล่าสุด (กฎของ Facebook) — ต้องรอลูกค้าทักมาใหม่ก่อน';
  }
  if (graph?.code === 10 || /permission/i.test(message)) {
    return `ส่งไม่ได้: แอปยังไม่มีสิทธิ์ส่งข้อความถึงผู้ใช้รายนี้ — ${message}`;
  }
  return `ส่งไม่ได้: ${message}`;
}

export async function sendReply(conversationId: string, rawText: unknown): Promise<Message> {
  if (!rawText || !String(rawText).trim()) throw AppError.badRequest('กรุณาพิมพ์ข้อความ');
  const text = String(rawText).trim();

  const conv = (await repository.getAllConversations()).find((c) => c.id === conversationId);
  if (!conv) throw AppError.notFound('ไม่พบการสนทนานี้');
  const page = (await repository.getPages()).find((p) => p.id === conv.pageId);
  if (!page) throw AppError.notFound('ไม่พบเพจของการสนทนานี้');
  if (!conv.customerId) throw AppError.badRequest('ไม่ทราบตัวตนลูกค้าในการสนทนานี้');

  let messageId: string;
  try {
    if (page.platform === 'line') {
      await line.pushMessage(page.accessToken, conv.customerId, text);
      messageId = `line_out_${Date.now()}`; // LINE push ไม่คืน message id
    } else {
      const sent = await fb.sendMessage(conv.customerId, text, page.accessToken);
      // Send API สำเร็จต้องมี message_id — เผื่อไว้ไม่ให้ id ของข้อความที่เก็บกลายเป็น undefined
      messageId = sent.message_id || `fb_out_${Date.now()}`;
    }
  } catch (err) {
    throw AppError.badRequest(sendErrorMessage(err));
  }

  // บันทึกข้อความลง local ทันที ไม่ต้องรอ sync รอบใหม่
  //
  // จุดนี้ข้อความ "ถึงลูกค้าแล้ว" แน่นอน — ถ้าบันทึกลง storage พลาด ต้องไม่ตอบว่าส่งไม่สำเร็จ
  // (โค้ดเดิมครอบ try เดียวกับตอนส่ง ทำให้ตอบ "ส่งไม่ได้" ทั้งที่ส่งไปแล้ว → ผู้ใช้กดส่งซ้ำ
  //  ลูกค้าได้ข้อความสองรอบ) ที่นี่จึงแค่ log ไว้ แล้วตอบผลจริงกลับไป
  const message: Message = {
    id: messageId,
    text,
    fromId: page.id,
    fromName: page.name,
    isFromPage: true,
    createdTime: new Date().toISOString(),
    attachments: [],
  };
  try {
    const target = (await repository.getConversationsForPage(page.id)).find(
      (c) => c.id === conv.id,
    );
    if (target) {
      target.messages.push(message);
      target.updatedTime = message.createdTime;
      await repository.saveConversation(target);
    }
  } catch (err) {
    logger.error(
      { err, conversationId, pageId: page.id },
      'ส่งข้อความสำเร็จ แต่บันทึกลง storage ไม่ได้',
    );
  }
  return message;
}
