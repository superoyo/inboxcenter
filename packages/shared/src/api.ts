/** รูปแบบ error ที่ API ตอบกลับ (คงรูปเดิม: { error: string }) */
export interface ApiError {
  error: string;
  /** รหัสอ้างอิงเชิงเครื่อง เพิ่มเข้ามาใน v1 */
  code?: string;
  /** รายละเอียดจาก validation */
  details?: unknown;
}

export interface OkResponse {
  ok: true;
}

/** ค่าที่หน้าเว็บต้องรู้ (ไม่เปิดเผย secret) */
export interface AppConfig {
  /** ตั้ง FB_APP_ID/FB_APP_SECRET แล้วหรือยัง (แลก long-lived token อัตโนมัติ) */
  longLivedTokens: boolean;
  sso: SsoConfig;
}

/** ข้อมูลที่หน้าเว็บใช้เริ่ม flow SSO ของ IAMService (ไม่มี secret) */
export interface SsoConfig {
  /** เปิดใช้แล้วหรือยัง (env IAM_SSO_ENABLED) — false = หน้าเว็บไม่ต้องแสดงปุ่ม SSO */
  enabled: boolean;
  /** ปลายทางที่ต้อง redirect ไป (ยังไม่ใส่ returnUrl/state) */
  authorizeUrl: string;
  /** ปลายทางล้าง session ของ IAM */
  logoutUrl: string;
}

/** ผู้ออก token ของ session นี้ — ใช้เลือกว่าจะอ่านโปรไฟล์/ออกจากระบบทางไหน */
export type IdentityProvider = 'wazzup' | 'iam';

export interface AuthSession {
  access_token: string;
  /** ISO timestamp */
  expiration: string;
  user: AuthUser;
}

export interface AuthUser {
  empCode?: string;
  empThaiName?: string;
  empEngName?: string;
  nickName?: string;
  email?: string;
  positionName?: string;
  departmentName?: string;
  photo?: string;
  roles?: string[];
}

/** query ที่ใช้ร่วมกันหลาย endpoint */
export interface ScopedQuery {
  /** id โปรเจกต์ */
  project?: string;
  /** ล็อกเพจ (รับหลายค่าคั่น comma) */
  pageId?: string;
  /** offset นาทีจาก UTC ของเครื่องผู้ใช้ */
  tz?: number;
}
