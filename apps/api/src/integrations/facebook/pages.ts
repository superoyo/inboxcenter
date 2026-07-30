// Facebook Graph API — ข้อมูลเพจ / รายการเพจของ user / แลก long-lived token
import { followPaging, graphGet, type GraphList } from './client';

export interface FbPagePicture {
  data?: { url?: string };
}

export interface FbPageInfo {
  id: string;
  name?: string;
  picture?: FbPagePicture;
}

export interface FbUserPage extends FbPageInfo {
  access_token?: string;
}

/** ตรวจสอบ token และดึงข้อมูลเพจ (id, name, รูป) */
export async function getPageInfo(accessToken: string): Promise<FbPageInfo> {
  return graphGet<FbPageInfo>('/me', {
    fields: 'id,name,picture{url}',
    access_token: accessToken,
  });
}

/**
 * แลก user token อายุสั้น (จาก Graph Explorer ~1-24 ชม.) เป็น long-lived (~60 วัน)
 * จุดสำคัญ: Page token ที่ดึงผ่าน /me/accounts ด้วย user token แบบ long-lived จะ "ไม่มีวันหมดอายุ"
 * ต้องตั้ง env: FB_APP_ID + FB_APP_SECRET — ถ้าไม่ตั้งจะคืน null (ระบบใช้ token เดิมตามปกติ)
 */
export async function exchangeLongLivedToken(shortToken: string): Promise<string | null> {
  const { FB_APP_ID, FB_APP_SECRET } = process.env;
  if (!FB_APP_ID || !FB_APP_SECRET) return null;
  const json = await graphGet<{ access_token?: string }>('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: FB_APP_ID,
    client_secret: FB_APP_SECRET,
    fb_exchange_token: shortToken,
  });
  return json.access_token || null;
}

/** ถ้าเป็น User token: ดึงรายชื่อเพจทั้งหมดที่ user ให้สิทธิ์แอปไว้ พร้อม Page token ของแต่ละเพจ */
export async function getUserPages(accessToken: string): Promise<FbUserPage[]> {
  const first = await graphGet<GraphList<FbUserPage>>('/me/accounts', {
    fields: 'id,name,picture{url},access_token',
    limit: 100,
    access_token: accessToken,
  });
  return followPaging(first, { maxPages: 10 });
}
