// Facebook Graph API — ชั้นเรียก HTTP + แปลง error ของ Graph เป็น Error ที่มีรหัสติดมา
export const GRAPH_VERSION = 'v21.0';
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** error จาก Graph API — แนบ code/subcode ไว้ให้ชั้นบนแปลงเป็นข้อความผู้ใช้ได้ */
export class GraphApiError extends Error {
  code?: number;
  subcode?: number;
  type?: string;
  fbtrace_id?: string;
  constructor(message: string, extra: Partial<GraphApiError> = {}) {
    super(message);
    this.name = 'GraphApiError';
    Object.assign(this, extra);
  }
}

interface GraphErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    type?: string;
    fbtrace_id?: string;
  };
}

/** โยน GraphApiError ถ้า response มี error — ใช้ร่วมกันทุกที่ที่เรียก Graph */
export function throwIfGraphError(json: unknown, fallback = 'Graph API error'): void {
  const body = (json ?? {}) as GraphErrorBody;
  if (!body.error) return;
  throw new GraphApiError(body.error.message || fallback, {
    code: body.error.code,
    subcode: body.error.error_subcode,
    type: body.error.type,
    fbtrace_id: body.error.fbtrace_id,
  });
}

export type GraphParams = Record<string, string | number | boolean | undefined | null>;

export interface GraphPaging {
  next?: string;
  previous?: string;
}

export interface GraphList<T> {
  data?: T[];
  paging?: GraphPaging;
}

export async function graphGet<T = unknown>(path: string, params: GraphParams = {}): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  const json = await res.json();
  throwIfGraphError(json);
  return json as T;
}

/** ตาม paging.next ต่อไปเรื่อยๆ — หยุดเมื่อครบ maxPages, ไม่มีหน้าถัดไป, หรือ shouldStop คืน true */
export async function followPaging<T>(
  first: GraphList<T>,
  { maxPages = 10, shouldStop }: { maxPages?: number; shouldStop?: (batch: T[]) => boolean } = {},
): Promise<T[]> {
  const out: T[] = [...(first.data || [])];
  let json = first;
  let pages = 0;
  let stop = shouldStop ? shouldStop(json.data || []) : false;
  while (!stop && json.paging?.next && pages < maxPages) {
    const res = await fetch(json.paging.next);
    json = (await res.json()) as GraphList<T> & GraphErrorBody;
    if ((json as GraphErrorBody).error) break; // หน้าถัดไปพลาด — ใช้ที่ได้มาแล้วพอ
    out.push(...(json.data || []));
    stop = shouldStop ? shouldStop(json.data || []) : false;
    pages++;
  }
  return out;
}
