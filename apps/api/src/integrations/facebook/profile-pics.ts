// Facebook Graph API — รูปโปรไฟล์ลูกค้า (Messenger User Profile API)
import { graphGet } from './client';

/**
 * ดึงรูปโปรไฟล์ลูกค้าหลายคนพร้อมกัน
 * คืนค่าเป็น { [psid]: profilePicUrl | '' } — id ที่ดึงไม่ได้จะเป็นค่าว่าง (ไม่ throw)
 */
export async function fetchProfilePics(
  psids: string[],
  accessToken: string,
  concurrency = 10,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const queue = [...psids];

  async function worker(): Promise<void> {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      try {
        const info = await graphGet<{ profile_pic?: string }>(`/${id}`, {
          fields: 'profile_pic',
          access_token: accessToken,
        });
        result[id] = info.profile_pic || '';
      } catch {
        result[id] = '';
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return result;
}
