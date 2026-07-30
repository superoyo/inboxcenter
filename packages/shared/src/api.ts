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
}

export interface AuthSession {
  access_token: string;
  /** ISO timestamp */
  expiration: string;
  user: AuthUser;
}

export interface AuthUser {
  empThaiName?: string;
  empEngName?: string;
  nickName?: string;
  email?: string;
  positionName?: string;
  departmentName?: string;
  photo?: string;
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
