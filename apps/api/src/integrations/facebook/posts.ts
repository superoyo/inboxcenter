// Facebook Graph API — โพสต์ของเพจ + สถิติเชิงลึก (insights)
import { GraphApiError, graphGet, GRAPH_BASE, type GraphList } from './client';

/** ต้องมีสิทธิ์ pages_read_engagement + pages_read_user_content */
const POST_FIELDS =
  'id,message,story,created_time,full_picture,permalink_url,' +
  'comments.summary(true).limit(0),reactions.summary(true).limit(0),shares';

export interface FbPost {
  id: string;
  message?: string;
  story?: string;
  created_time: string;
  full_picture?: string;
  permalink_url?: string;
  comments?: { summary?: { total_count?: number } };
  reactions?: { summary?: { total_count?: number } };
  shares?: { count?: number };
}

export interface MappedPost {
  id: string;
  message: string;
  createdTime: string;
  picture: string;
  permalink: string;
  commentCount: number;
  reactionCount: number;
  shareCount: number;
  engagementTotal: number;
}

export function mapPost(p: FbPost): MappedPost {
  // ลิงก์จริง: ใช้ permalink_url ถ้ามี ไม่งั้นสร้างจาก post id (รูปแบบ PAGEID_POSTID)
  let permalink = p.permalink_url || '';
  if (!permalink && p.id && p.id.includes('_')) {
    const [pageId, postId] = p.id.split('_');
    permalink = `https://www.facebook.com/${pageId}/posts/${postId}`;
  }
  const reactionCount = p.reactions?.summary?.total_count || 0;
  const commentCount = p.comments?.summary?.total_count || 0;
  const shareCount = p.shares?.count || 0;
  return {
    id: p.id,
    message: p.message || p.story || '(ไม่มีข้อความ)',
    createdTime: p.created_time,
    picture: p.full_picture || '',
    permalink,
    commentCount,
    reactionCount,
    shareCount,
    engagementTotal: reactionCount + commentCount + shareCount,
  };
}

export async function getPosts(
  pageId: string,
  accessToken: string,
  limit = 50,
): Promise<MappedPost[]> {
  const json = await graphGet<GraphList<FbPost>>(`/${pageId}/posts`, {
    fields: POST_FIELDS,
    limit,
    access_token: accessToken,
  });
  return (json.data || []).map(mapPost);
}

/** ดึงโพสต์ทั้งหมดตั้งแต่ sinceUnix (paginate) — ใช้ทำรายงานย้อนหลัง */
export async function getPostsSince(
  pageId: string,
  accessToken: string,
  sinceUnix?: number | null,
  untilUnix?: number | null,
  maxPages = 40,
): Promise<MappedPost[]> {
  const url = new URL(`${GRAPH_BASE}/${pageId}/posts`);
  url.searchParams.set('fields', POST_FIELDS);
  url.searchParams.set('limit', '100');
  if (sinceUnix) url.searchParams.set('since', String(sinceUnix));
  if (untilUnix) url.searchParams.set('until', String(untilUnix)); // ช่วงกำหนดเอง: จำกัดถึงเวลานี้
  url.searchParams.set('access_token', accessToken);

  const posts: MappedPost[] = [];
  let next: string | null = url.toString();
  let pages = 0;
  while (next && pages < maxPages) {
    const res = await fetch(next);
    const json = (await res.json()) as GraphList<FbPost> & {
      error?: { message?: string; code?: number };
    };
    if (json.error) {
      // หน้าแรกพลาด = ดึงไม่ได้เลย ต้องแจ้ง; หน้าถัดๆ ไปพลาด ใช้ที่ได้มาแล้วพอ
      if (pages === 0) {
        throw new GraphApiError(json.error.message || 'Graph API error', { code: json.error.code });
      }
      break;
    }
    for (const p of json.data || []) posts.push(mapPost(p));
    next = json.paging?.next || null;
    pages++;
  }
  return posts;
}

export interface PostInsightsResult {
  available: boolean;
  reason?: string;
  impressions?: number;
  reach?: number;
  organicReach?: number;
  paidReach?: number;
  clicks?: number;
}

/**
 * สถิติเชิงลึกของโพสต์ (Page Insights) — ต้องมีสิทธิ์ read_insights
 * คืน available:false ถ้าสิทธิ์ไม่พอ/metric ใช้ไม่ได้ (ไม่ throw เพื่อให้หน้ายังแสดงส่วนอื่นได้)
 */
export async function getPostInsights(
  postId: string,
  accessToken: string,
): Promise<PostInsightsResult> {
  const metric = [
    'post_impressions',
    'post_impressions_unique',
    'post_impressions_organic_unique',
    'post_impressions_paid_unique',
    'post_clicks',
  ].join(',');
  try {
    const json = await graphGet<GraphList<{ name: string; values?: { value?: number }[] }>>(
      `/${postId}/insights`,
      { metric, access_token: accessToken },
    );
    const v: Record<string, number> = {};
    for (const d of json.data || []) v[d.name] = d.values?.[0]?.value || 0;
    return {
      available: true,
      impressions: v.post_impressions || 0,
      reach: v.post_impressions_unique || 0,
      organicReach: v.post_impressions_organic_unique || 0,
      paidReach: v.post_impressions_paid_unique || 0,
      clicks: v.post_clicks || 0,
    };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
