// จุดเข้าเดียวของ integration Facebook — คง shape เดิมที่ server.js เรียกไว้ทุกตัว
export {
  GRAPH_BASE,
  GRAPH_VERSION,
  GraphApiError,
  graphGet,
  followPaging,
  throwIfGraphError,
} from './client';
export type { GraphList, GraphParams, GraphPaging } from './client';

export { getPageInfo, getUserPages, exchangeLongLivedToken } from './pages';
export type { FbPageInfo, FbUserPage } from './pages';

export { getConversations, sendMessage, normalizeConversation } from './conversations';
export type {
  FbConversation,
  FbMessage,
  FbAttachment,
  GetConversationsOptions,
  SendMessageResult,
  PageRef,
} from './conversations';

export { getPosts, getPostsSince, getPostInsights, mapPost } from './posts';
export type { FbPost, MappedPost, PostInsightsResult } from './posts';

export { getComments, replyComment } from './comments';
export type { FbComment, NormalizedComment } from './comments';

export { fetchProfilePics } from './profile-pics';
