// Apify REST API — ชั้นเรียก HTTP + รอ run จบ (I/O เท่านั้น)
// ชี้ไปที่อื่นได้ผ่าน APIFY_API_BASE (ใช้ตอนทดสอบด้วย mock server)
const API = process.env.APIFY_API_BASE || 'https://api.apify.com/v2';
const POLL_MS = 5000;
export const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;

const TERMINAL = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'] as const;

export class ApifyTokenMissingError extends Error {
  readonly code = 'NO_TOKEN';
  constructor() {
    super('ยังไม่ได้ตั้งค่า APIFY_TOKEN — ใส่ token ของ Apify ใน environment ก่อนใช้งาน');
    this.name = 'ApifyTokenMissingError';
  }
}

export const hasToken = (): boolean =>
  Boolean(process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN);

function token(): string {
  const t = process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || '';
  if (!t) throw new ApifyTokenMissingError();
  return t;
}

interface ApifyEnvelope<T> {
  data?: T;
  error?: { message?: string };
}

/** Apify ห่อผลลัพธ์ใน { data } บางเส้น แต่ /datasets/:id/items คืน array ตรงๆ — รองรับทั้งสองแบบ */
export async function callApify<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API}${path}${sep}token=${encodeURIComponent(token())}`, init);
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const env = (data ?? {}) as ApifyEnvelope<T>;
    throw new Error(env.error?.message || `Apify API ${res.status}`);
  }
  const env = data as ApifyEnvelope<T>;
  return (env && typeof env === 'object' && 'data' in env ? env.data : data) as T;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ApifyRun {
  id: string;
  status: string;
  defaultDatasetId: string;
}

/** สั่งรัน actor แล้วรอจนจบ — คืน datasetId ที่มีผลลัพธ์ */
export async function runActorToCompletion(
  actor: string,
  input: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const run = await callApify<ApifyRun>(`/acts/${actor}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const deadline = Date.now() + timeoutMs;
  let status = run.status;
  while (!(TERMINAL as readonly string[]).includes(status)) {
    if (Date.now() > deadline) throw new Error('ดึงข้อมูลนานเกินกำหนด — ลองลดช่วงเวลาที่ดึง');
    await sleep(POLL_MS);
    const cur = await callApify<ApifyRun>(`/actor-runs/${run.id}`);
    status = cur.status;
  }
  if (status !== 'SUCCEEDED') throw new Error(`Apify run ${status} — ลองใหม่อีกครั้ง`);
  return run.defaultDatasetId;
}

export async function getDatasetItems(datasetId: string): Promise<unknown[]> {
  const items = await callApify<unknown[]>(`/datasets/${datasetId}/items?clean=true&format=json`);
  return Array.isArray(items) ? items : [];
}
