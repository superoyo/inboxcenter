// Product Group ของ Agency Intelligence → รูปที่หน้า Content ใช้ได้ทันที
//
// หน้า Content เดิมประกอบ "เพจเรา + คู่แข่ง" เองจาก /api/pages + /api/competitors
// (คู่แข่งมาจากที่กรอกในเมนู Admin) ตอนนี้ย้ายมาอ่านจากหน้า Brand & Competitors
// ของ Agency Intelligence แทน — ที่นั่นเป็นที่เดียวที่ทีมกรอกคู่แข่งจริง
//
// ประกอบให้เสร็จฝั่ง server ไม่ผลักภาระไปให้หน้าเว็บ: feed ให้มาแค่ URL กับ pageIds
// หน้าเว็บต้องรู้ต่อว่าเพจนั้นเชื่อมในระบบเราแล้วหรือยัง และคู่แข่งรายนั้นมี id อะไร
// ในระบบเรา (ต้องใช้ยิง /api/competitors/:id ต่อ) — สองอย่างนี้รู้ได้ที่นี่เท่านั้น
import type {
  ProductGroup,
  ProductGroupCompetitor,
  ProductGroupListResponse,
  ProductGroupPage,
} from '@inboxcenter/shared';
import * as agency from '../integrations/agency';
import { repository } from '../repositories';
import { logger } from '../config/logger';
import { AppError } from '../utils/app-error';
import { ensureCompetitorsByUrl } from './competitors.service';
import { toPublicPage } from './pages.service';

/**
 * รูปโปรไฟล์เพจที่ยังไม่ได้เชื่อม — เส้น /{page-id}/picture ของ Graph เปิดสาธารณะ
 * ไม่ต้องแนบ token จึงใช้ได้แม้ยังไม่มีเพจนี้ในระบบ (ตัวเดียวกับที่ pages.service ใช้)
 */
const fbPictureUrl = (pageId: string): string =>
  `https://graph.facebook.com/${encodeURIComponent(pageId)}/picture?type=square&width=96&height=96`;

/**
 * เพจของเราในกลุ่มหนึ่ง
 *
 * ชื่อที่แสดงเอาจากเพจที่เชื่อมไว้ก่อน (ตรงกับที่ผู้ใช้เห็นในเมนูอื่นของเรา) ถ้ายังไม่
 * เชื่อมค่อยใช้ชื่อแบรนด์ที่ปักหมุดจากฝั่งเขา · กลุ่มที่ยังไม่ได้เลือกเพจใน Agency
 * Intelligence ยังต้องมีบรรทัดใน dropdown เพื่อบอกสาเหตุ ไม่ใช่หายไปเงียบ ๆ
 */
function toPages(
  pageIds: string[],
  pinnedName: string,
  connected: Map<string, { name: string; pictureUrl: string }>,
): ProductGroupPage[] {
  if (!pageIds.length) {
    if (!pinnedName) return [];
    return [{ pageId: '', name: pinnedName, pictureUrl: '', connected: false }];
  }
  return pageIds.map((pageId) => {
    const hit = connected.get(pageId);
    return {
      pageId,
      name: hit?.name || pinnedName || pageId,
      pictureUrl: hit?.pictureUrl || fbPictureUrl(pageId),
      connected: Boolean(hit),
    };
  });
}

async function toCompetitors(brands: agency.FeedBrand[]): Promise<ProductGroupCompetitor[]> {
  const rivals = brands.filter((b) => !b.owned);
  const rows = await ensureCompetitorsByUrl(rivals.map((b) => ({ url: b.url, name: b.name })));
  const nameFromFeed = new Map<string, string>();
  for (const b of rivals) nameFromFeed.set(b.url.trim().toLowerCase(), b.name);

  return Promise.all(
    rows.map(async (c) => ({
      id: c.id,
      // ชื่อที่ทีมพิมพ์ไว้ฝั่ง Agency Intelligence เป็นตัวหลัก — เป็นชื่อที่เขาดูแลอยู่จริง
      name: nameFromFeed.get(c.url.trim().toLowerCase()) || c.name || c.handle,
      url: c.url,
      handle: c.handle,
      pictureUrl: c.pictureUrl,
      postCount: (await repository.getCompetitorPosts(c.id)).length,
      lastSyncAt: c.lastSyncAt,
      coveredFrom: c.coveredFrom,
      coveredTo: c.coveredTo,
    })),
  );
}

/**
 * Product Group ทั้งหมดพร้อมเพจเราและคู่แข่ง
 *
 * ต่อ feed ไม่ได้ = คืน `error` ไม่ใช่โยน 500 — หน้า Content ต้องบอกผู้ใช้ได้ว่า
 * "อ่านจาก Agency Intelligence ไม่ได้" แทนที่จะแสดง dropdown ว่างเปล่าโดยไม่มีเหตุผล
 */
export async function listProductGroups(): Promise<ProductGroupListResponse> {
  const ready = agency.isConfigured();
  if (!ready) return { items: [], ready };

  let groups: agency.FeedGroup[];
  try {
    groups = await agency.listGroups();
  } catch (err) {
    const message = err instanceof AppError ? err.message : 'อ่าน Product Group ไม่สำเร็จ';
    logger.warn({ err }, 'อ่าน Product Group จาก Agency Intelligence ไม่สำเร็จ');
    return { items: [], ready, error: message };
  }

  const pages = (await repository.getPages()).map(toPublicPage);
  const connected = new Map(
    pages.map((p) => [p.id, { name: p.name, pictureUrl: p.pictureUrl }] as const),
  );

  const items: ProductGroup[] = [];
  for (const g of groups) {
    // กลุ่มเดียวพังไม่ควรทำให้ทั้ง dropdown หาย — ข้ามกลุ่มนั้นแล้วไปต่อ
    let brands: agency.FeedBrand[];
    try {
      brands = await agency.listBrands(g.id);
    } catch (err) {
      logger.warn({ err, groupId: g.id }, 'อ่านแบรนด์ของกลุ่มไม่สำเร็จ — ข้ามกลุ่มนี้');
      continue;
    }
    const pinned = brands.find((b) => b.owned);
    items.push({
      id: g.id,
      name: g.name,
      color: g.color,
      logoUrl: g.logoUrl,
      pinnedName: pinned?.name ?? '',
      pinnedUrl: pinned?.url ?? '',
      pages: toPages(g.pageIds, pinned?.name ?? '', connected),
      competitors: await toCompetitors(brands),
    });
  }
  return { items, ready };
}
