// LINE Messaging API — ชั้นเรียก HTTP (I/O เท่านั้น ไม่มี business logic)
const LINE_API = process.env.LINE_API_BASE || 'https://api.line.me';

/** error จาก LINE ที่แนบ status + details มาให้ชั้นบนตัดสินใจต่อ */
export class LineApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'LineApiError';
    this.status = status;
    this.details = details;
  }
}

interface LineErrorBody {
  message?: string;
  error_description?: string;
  details?: unknown;
}

export async function lineFetch<T = unknown>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${LINE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const body = (data ?? {}) as LineErrorBody;
    const msg = body.message || body.error_description || `LINE API ${res.status}`;
    throw new LineApiError(msg, res.status, body.details);
  }
  return data as T;
}
