// อ่าน exp จาก JWT โดย "ไม่ verify ลายเซ็น"
//
// ⚠️ ตั้งใจไว้แบบนี้: การ login ทำผ่าน Wazzup ซึ่งเป็นผู้ออก token
// ระบบนี้แค่เช็คว่า token ยังไม่หมดอายุ (พฤติกรรมเดิมของ requireAuth)
// อย่าเปลี่ยนให้ verify ลายเซ็นโดยไม่ตกลงกันก่อน เพราะไม่มี secret ฝั่งนี้

export function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2 || !parts[1]) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** token ยังใช้ได้อยู่หรือไม่ (มี exp และยังไม่ถึงกำหนด) */
export function isTokenValid(token: string): boolean {
  const exp = decodeJwtExp(token);
  return Boolean(exp && exp * 1000 > Date.now());
}

/** ดึง token จาก header Authorization: Bearer xxx */
export function bearerToken(authorization: string | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(authorization || '');
  return m?.[1] ?? null;
}
