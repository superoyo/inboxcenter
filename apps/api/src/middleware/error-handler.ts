// ตัวจับ error ตัวสุดท้าย — ต้อง app.use() หลัง route ทั้งหมด
// รูปแบบ response คงเดิม { error: string } เพื่อไม่ให้หน้าเว็บที่มีอยู่พัง
import type { ErrorRequestHandler } from 'express';
import { logger } from '../config/logger';
import { isAppError } from '../utils/app-error';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (isAppError(err)) {
    // error ที่ตั้งใจส่งให้ผู้ใช้ — ไม่ต้อง log stack
    logger.debug({ path: req.path, status: err.status, code: err.code }, err.message);
    res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  // error ที่ไม่คาดคิด — log ให้ครบเพื่อตามหาสาเหตุ แต่ไม่เปิดเผยรายละเอียดออกไป
  logger.error({ err, path: req.path, method: req.method }, 'ข้อผิดพลาดที่ไม่คาดคิด');
  res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ', code: 'INTERNAL_ERROR' });
};
