// คำตอบสำเร็จรูป แยกตามเพจ
import type { SavedReply } from '@inboxcenter/shared';
import { repository } from '../repositories';
import { AppError } from '../utils/app-error';

const LIMITS = { title: 120, text: 1_000, tag: 20, tags: 5 } as const;

/** แท็กหมวดหมู่: ตัดซ้ำ ตัดค่าว่าง จำกัดความยาวและจำนวน */
export function cleanReplyTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => String(t).trim().slice(0, LIMITS.tag)).filter(Boolean))].slice(
    0,
    LIMITS.tags,
  );
}

export async function listSavedReplies(pageId: string): Promise<SavedReply[]> {
  return repository.getSavedReplies(pageId);
}

export interface AddSavedReplyInput {
  title?: unknown;
  text?: unknown;
  tags?: unknown;
}

/** เพิ่มคำตอบ — ถ้าข้อความซ้ำกับที่มีอยู่ คืนตัวเดิมพร้อม duplicated:true (ไม่สร้างซ้ำ) */
export async function addSavedReply(
  pageId: string,
  input: AddSavedReplyInput,
): Promise<SavedReply & { duplicated?: boolean }> {
  const text = String(input.text || '')
    .trim()
    .slice(0, LIMITS.text);
  if (!text) throw AppError.badRequest('กรุณาใส่ข้อความคำตอบ');

  const existing = await repository.getSavedReplies(pageId);
  const dup = existing.find((r) => r.text === text);
  if (dup) return { ...dup, duplicated: true };

  const entry: SavedReply = {
    id: `sr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: String(input.title || '')
      .trim()
      .slice(0, LIMITS.title),
    text,
    tags: cleanReplyTags(input.tags),
    createdAt: new Date().toISOString(),
  };
  await repository.addSavedReply(pageId, entry);
  return entry;
}

/** อัปเดตเฉพาะฟิลด์ที่ส่งมา (undefined = ไม่แตะ) */
export async function updateSavedReply(
  pageId: string,
  replyId: string,
  body: Record<string, unknown> | undefined,
): Promise<SavedReply> {
  const fields: Partial<SavedReply> = {};
  if (body?.title !== undefined) {
    fields.title = String(body.title).trim().slice(0, LIMITS.title);
  }
  if (body?.tags !== undefined) {
    fields.tags = cleanReplyTags(body.tags);
  }
  if (body?.text !== undefined) {
    const t = String(body.text).trim().slice(0, LIMITS.text);
    if (!t) throw AppError.badRequest('ข้อความคำตอบห้ามว่าง');
    fields.text = t;
  }
  const updated = await repository.updateSavedReply(pageId, replyId, fields);
  if (!updated) throw AppError.notFound('ไม่พบคำตอบนี้');
  return updated;
}

export async function deleteSavedReply(pageId: string, replyId: string): Promise<void> {
  await repository.deleteSavedReply(pageId, replyId);
}
