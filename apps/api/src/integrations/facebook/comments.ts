// Facebook Graph API — คอมเมนต์ใต้โพสต์ + ตอบคอมเมนต์ในนามเพจ
import { graphGet, GRAPH_BASE, throwIfGraphError, type GraphList } from './client';

export interface FbCommentAuthor {
  id?: string;
  name?: string;
  picture?: { data?: { url?: string } };
}

export interface FbComment {
  id: string;
  message?: string;
  created_time: string;
  from?: FbCommentAuthor;
  like_count?: number;
  attachment?: { media?: { image?: { src?: string } } };
  comments?: { data?: FbComment[] };
}

export interface NormalizedComment {
  id: string;
  message: string;
  createdTime: string;
  fromId: string;
  fromName: string;
  fromPic: string;
  likeCount: number;
  attachmentUrl: string;
  replies: NormalizedComment[];
}

function norm(c: FbComment): NormalizedComment {
  return {
    id: c.id,
    message: c.message || '',
    createdTime: c.created_time,
    fromId: c.from?.id || '',
    fromName: c.from?.name || 'ผู้ใช้ Facebook',
    fromPic: c.from?.picture?.data?.url || '',
    likeCount: c.like_count || 0,
    attachmentUrl: c.attachment?.media?.image?.src || '',
    replies: (c.comments?.data || []).map(norm),
  };
}

/** คอมเมนต์ใต้โพสต์ พร้อม reply ซ้อน 1 ชั้น */
export async function getComments(
  postId: string,
  accessToken: string,
): Promise<NormalizedComment[]> {
  const json = await graphGet<GraphList<FbComment>>(`/${postId}/comments`, {
    fields:
      'id,message,from{id,name,picture{url}},created_time,like_count,attachment,' +
      'comments.limit(25){id,message,from{id,name,picture{url}},created_time,like_count}',
    order: 'chronological',
    limit: 100,
    access_token: accessToken,
  });
  return (json.data || []).map(norm);
}

/** ตอบกลับคอมเมนต์ในนามเพจ (ต้องมีสิทธิ์ pages_manage_engagement) */
export async function replyComment(
  commentId: string,
  message: string,
  accessToken: string,
): Promise<{ id?: string }> {
  const res = await fetch(`${GRAPH_BASE}/${commentId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, access_token: accessToken }),
  });
  const json = await res.json();
  throwIfGraphError(json);
  return json as { id?: string };
}
