// error ที่ตั้งใจส่งให้ผู้ใช้เห็น — มี HTTP status ติดมาด้วย
// error อื่นที่ไม่ใช่ชนิดนี้ถือเป็นข้อผิดพลาดที่ไม่คาดคิด → 500 + log stack
export class AppError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(status: number, message: string, options: { code?: string; details?: unknown } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = options.code;
    this.details = options.details;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, message, { code: 'BAD_REQUEST', details });
  }

  static unauthorized(message = 'ต้องเข้าสู่ระบบก่อน'): AppError {
    return new AppError(401, message, { code: 'UNAUTHORIZED' });
  }

  static notFound(message: string): AppError {
    return new AppError(404, message, { code: 'NOT_FOUND' });
  }

  static conflict(message: string): AppError {
    return new AppError(409, message, { code: 'CONFLICT' });
  }

  static upstream(message: string): AppError {
    return new AppError(502, message, { code: 'UPSTREAM_ERROR' });
  }
}

export const isAppError = (err: unknown): err is AppError => err instanceof AppError;
