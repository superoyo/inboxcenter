// ขยาย type ของ Express ให้รู้จักฟิลด์ที่ middleware ของเราเพิ่มเข้าไป
import type { ValidatedData } from '../middleware/validate';

declare global {
  namespace Express {
    interface Request {
      /** body ดิบ — เก็บเฉพาะ webhook ของ LINE เพื่อตรวจลายเซ็น HMAC */
      rawBody?: Buffer;
      /** ค่าที่ผ่าน zod แล้ว (ใส่โดย middleware validate) */
      valid?: ValidatedData;
      /** token ที่ผ่าน requireAuth แล้ว */
      authToken?: string;
    }
  }
}

export {};
