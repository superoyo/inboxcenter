// ครอบ async handler ให้ error ที่ throw ไหลเข้า next() เอง
// (Express 4 ไม่จับ rejected promise ให้ — ถ้าไม่ครอบ error จะหายเงียบ)
import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler =
  (fn: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
