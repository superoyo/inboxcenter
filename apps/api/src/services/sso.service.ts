// SSO ผ่าน IAMService — ฝั่ง server มีหน้าที่แค่ 2 อย่าง
//   1. บอกหน้าเว็บว่าเปิดใช้แล้วหรือยัง + URL ที่ต้อง redirect ไป (ไม่มี secret)
//   2. อ่านโปรไฟล์ด้วย token ที่ได้จาก fragment (fragment ให้มาแค่ token ไม่มีชื่อ/แผนก)
//
// ตัว flow redirect + state + การอ่าน fragment อยู่ฝั่ง browser (public/sso.js)
// เพราะ token เดินทางมาใน URL fragment ซึ่ง "ไม่ถูกส่งมาถึง server" โดยการออกแบบ
import type { AuthUser, SsoConfig } from '@inboxcenter/shared';
import { env } from '../config/env';
import * as iam from '../integrations/iam';
import { rolesFromClaims, decodeJwtPayload } from '../utils/jwt';

export function ssoConfig(): SsoConfig {
  const base = env.IAM_BASE_URL.replace(/\/+$/, '');
  return {
    enabled: env.ssoEnabled,
    authorizeUrl: `${base}/api/sso/authorize`,
    logoutUrl: `${base}/api/sso/logout`,
  };
}

/** รูปโปรไฟล์: ใช้ base64 ก่อน (ฝังในหน้าได้ ไม่ติด CORS) ตกไปใช้ URL เมื่อไม่มี */
function photoFrom(p: iam.IamProfile): string {
  if (p.wazzupPhotoBase64) {
    const type = p.wazzupPhotoFileType || 'image/jpeg';
    return p.wazzupPhotoBase64.startsWith('data:')
      ? p.wazzupPhotoBase64
      : `data:${type};base64,${p.wazzupPhotoBase64}`;
  }
  return p.profileURL || '';
}

export interface SsoSessionInfo {
  user: AuthUser;
  /** roles ที่ใช้ตัดสินสิทธิ์ — เอาจากโปรไฟล์ก่อน ถ้าไม่ได้ค่อยอ่านจาก claim ใน token */
  roles: string[];
}

/**
 * แปลง token จาก SSO เป็นข้อมูลผู้ใช้ที่หน้าเว็บใช้แสดงผล
 * โปรไฟล์โหลดไม่ได้ก็ยังใช้งานต่อได้ (degrade เป็น session ที่มีแต่ claim) ตาม checklist ข้อ 7
 */
export async function sessionFromToken(token: string): Promise<SsoSessionInfo> {
  const claims = decodeJwtPayload(token);
  const claimRoles = rolesFromClaims(claims);

  try {
    const { profile, userRole } = await iam.getProfile(`Bearer ${token}`);
    return {
      user: {
        empCode: profile.empCode || '',
        empThaiName: profile.empThaiName || '',
        empEngName: profile.empEngName || '',
        nickName: profile.nickName || '',
        positionName: profile.positionName || '',
        departmentName: profile.departmentName || '',
        email: profile.email || '',
        photo: photoFrom(profile),
        roles: userRole.length ? userRole : claimRoles,
      },
      roles: userRole.length ? userRole : claimRoles,
    };
  } catch {
    // โหลดโปรไฟล์ไม่ได้ → ใช้เท่าที่ token บอก (ชื่อผู้ใช้ + roles)
    const name = typeof claims?.name === 'string' ? claims.name : '';
    const empCode = typeof claims?.empCode === 'string' ? claims.empCode : '';
    return {
      user: { empCode, empEngName: name, roles: claimRoles },
      roles: claimRoles,
    };
  }
}
