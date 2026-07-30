// ตรวจ input ด้วย zod แล้วเขียนค่าที่ผ่านการแปลงกลับเข้า req
// ผิดรูปแบบ → 400 พร้อมบอกว่าฟิลด์ไหนผิด (คงข้อความหลักเป็นภาษาไทยเหมือน endpoint เดิม)
import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../utils/app-error';

type Source = 'body' | 'query' | 'params';

/** เก็บค่าที่ validate แล้วไว้ที่ req.valid เพื่อไม่ทับ req.query ของ Express 4 (ซึ่ง read-only บางกรณี) */
export interface ValidatedData {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

export function validate(schemas: Partial<Record<Source, ZodType>>): RequestHandler {
  return (req, _res, next) => {
    const valid: ValidatedData = req.valid || {};
    for (const source of Object.keys(schemas) as Source[]) {
      const schema = schemas[source];
      if (!schema) continue;
      const result = schema.safeParse(req[source]);
      if (!result.success) {
        const first = result.error.issues[0];
        const where = first?.path.join('.') || source;
        next(
          AppError.badRequest(
            `ข้อมูลไม่ถูกต้อง: ${where} — ${first?.message ?? 'รูปแบบไม่ถูกต้อง'}`,
            {
              issues: result.error.issues.map((i) => ({
                path: i.path.join('.'),
                message: i.message,
              })),
            },
          ),
        );
        return;
      }
      valid[source] = result.data;
    }
    req.valid = valid;
    next();
  };
}

/** ดึงค่าที่ validate แล้วแบบมี type (เรียกหลังผ่าน validate() เท่านั้น) */
export const validated = <T>(req: { valid?: ValidatedData }, source: Source): T =>
  (req.valid?.[source] ?? {}) as T;
