// Facebook Graph API client for pulling Page inbox (Messenger conversations)
const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

async function graphGet(path, params = {}) {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) {
    const err = new Error(json.error.message || 'Graph API error');
    err.code = json.error.code;
    err.type = json.error.type;
    err.fbtrace_id = json.error.fbtrace_id;
    throw err;
  }
  return json;
}

// ตรวจสอบ token และดึงข้อมูลเพจ (id, name, รูป)
async function getPageInfo(accessToken) {
  return graphGet('/me', {
    fields: 'id,name,picture{url}',
    access_token: accessToken,
  });
}

// แลก user token อายุสั้น (จาก Graph Explorer ~1-24 ชม.) เป็น long-lived (~60 วัน)
// จุดสำคัญ: Page token ที่ดึงผ่าน /me/accounts ด้วย user token แบบ long-lived จะ "ไม่มีวันหมดอายุ"
// ต้องตั้ง env: FB_APP_ID + FB_APP_SECRET — ถ้าไม่ตั้งจะคืน null (ระบบใช้ token เดิมตามปกติ)
async function exchangeLongLivedToken(shortToken) {
  const { FB_APP_ID, FB_APP_SECRET } = process.env;
  if (!FB_APP_ID || !FB_APP_SECRET) return null;
  const json = await graphGet('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: FB_APP_ID,
    client_secret: FB_APP_SECRET,
    fb_exchange_token: shortToken,
  });
  return json.access_token || null;
}

// ถ้าเป็น User token: ดึงรายชื่อเพจทั้งหมดที่ user ให้สิทธิ์แอปไว้ พร้อม Page token ของแต่ละเพจ
async function getUserPages(accessToken) {
  const pages = [];
  let json = await graphGet('/me/accounts', {
    fields: 'id,name,picture{url},access_token',
    limit: 100,
    access_token: accessToken,
  });
  pages.push(...(json.data || []));
  let rounds = 0;
  while (json.paging && json.paging.next && rounds < 10) {
    const res = await fetch(json.paging.next);
    json = await res.json();
    if (json.error) break;
    pages.push(...(json.data || []));
    rounds++;
  }
  return pages;
}

// ดึงรายการ conversations ของเพจ พร้อมข้อความล่าสุดในแต่ละห้อง
// ถ้าระบุ since: ดึงเฉพาะห้องที่มีความเคลื่อนไหวหลังเวลานั้น (incremental sync)
// — Graph API เรียงตาม updated_time ใหม่→เก่า จึงหยุด paginate ได้ทันทีที่เจอห้องเก่ากว่า since
async function getConversations(pageId, accessToken, { limit = 25, messagesPerConversation = 25, since = null } = {}) {
  const conversations = [];
  const sinceTime = since ? new Date(since) : null;
  const batchIsOlderThanSince = (batch) =>
    sinceTime && batch.length > 0 && new Date(batch[batch.length - 1].updated_time) < sinceTime;

  let json = await graphGet(`/${pageId}/conversations`, {
    platform: 'messenger',
    fields: [
      'id',
      'updated_time',
      'unread_count',
      'participants',
      `messages.limit(${messagesPerConversation}){id,message,from,created_time,attachments{mime_type,name,image_data,file_url}}`,
    ].join(','),
    limit,
    access_token: accessToken,
  });

  conversations.push(...(json.data || []));

  // ตามหน้าถัดไป (pagination) สูงสุด 10 หน้า กันดึงไม่รู้จบ
  let pages = 0;
  let stop = batchIsOlderThanSince(json.data || []);
  while (!stop && json.paging && json.paging.next && pages < 10) {
    const res = await fetch(json.paging.next);
    json = await res.json();
    if (json.error) break;
    conversations.push(...(json.data || []));
    stop = batchIsOlderThanSince(json.data || []);
    pages++;
  }

  return sinceTime
    ? conversations.filter((c) => new Date(c.updated_time) >= sinceTime)
    : conversations;
}

// ส่งข้อความตอบกลับในนามเพจ (Send API)
// ต้องอยู่ใน 24-hour window: ลูกค้าทักมาไม่เกิน 24 ชม. — เกินกว่านั้น Facebook จะปฏิเสธ
async function sendMessage(recipientPsid, text, pageAccessToken) {
  const url = new URL(`${GRAPH_BASE}/me/messages`);
  url.searchParams.set('access_token', pageAccessToken);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientPsid },
      messaging_type: 'RESPONSE',
      message: { text },
    }),
  });
  const json = await res.json();
  if (json.error) {
    const err = new Error(json.error.message || 'Send API error');
    err.code = json.error.code;
    err.subcode = json.error.error_subcode;
    throw err;
  }
  return json; // { recipient_id, message_id }
}

// ---------- Posts & Comments ----------

// โพสต์ล่าสุดของเพจ พร้อมจำนวนคอมเมนต์ (ต้องมีสิทธิ์ pages_read_engagement + pages_read_user_content)
const POST_FIELDS = 'id,message,story,created_time,full_picture,permalink_url,' +
  'comments.summary(true).limit(0),reactions.summary(true).limit(0),shares';

function mapPost(p) {
  // ลิงก์จริง: ใช้ permalink_url ถ้ามี ไม่งั้นสร้างจาก post id (รูปแบบ PAGEID_POSTID)
  let permalink = p.permalink_url || '';
  if (!permalink && p.id && p.id.includes('_')) {
    const [pageId, postId] = p.id.split('_');
    permalink = `https://www.facebook.com/${pageId}/posts/${postId}`;
  }
  const reactionCount = (p.reactions && p.reactions.summary && p.reactions.summary.total_count) || 0;
  const commentCount = (p.comments && p.comments.summary && p.comments.summary.total_count) || 0;
  const shareCount = (p.shares && p.shares.count) || 0;
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

async function getPosts(pageId, accessToken, limit = 50) {
  const json = await graphGet(`/${pageId}/posts`, {
    fields: POST_FIELDS, limit, access_token: accessToken,
  });
  return (json.data || []).map(mapPost);
}

// ดึงโพสต์ทั้งหมดตั้งแต่ sinceUnix (paginate) — ใช้ทำรายงานย้อนหลัง
async function getPostsSince(pageId, accessToken, sinceUnix, maxPages = 40) {
  const url = new URL(`${GRAPH_BASE}/${pageId}/posts`);
  url.searchParams.set('fields', POST_FIELDS);
  url.searchParams.set('limit', '100');
  if (sinceUnix) url.searchParams.set('since', String(sinceUnix));
  url.searchParams.set('access_token', accessToken);
  const posts = [];
  let next = url.toString();
  let pages = 0;
  while (next && pages < maxPages) {
    const res = await fetch(next);
    const json = await res.json();
    if (json.error) { if (pages === 0) throw Object.assign(new Error(json.error.message), { code: json.error.code }); break; }
    for (const p of (json.data || [])) posts.push(mapPost(p));
    next = (json.paging && json.paging.next) || null;
    pages++;
  }
  return posts;
}

// คอมเมนต์ใต้โพสต์ พร้อม reply ซ้อน 1 ชั้น
async function getComments(postId, accessToken) {
  const json = await graphGet(`/${postId}/comments`, {
    fields: 'id,message,from{id,name,picture{url}},created_time,like_count,attachment,comments.limit(25){id,message,from{id,name,picture{url}},created_time,like_count}',
    order: 'chronological',
    limit: 100,
    access_token: accessToken,
  });
  const norm = (c) => ({
    id: c.id,
    message: c.message || '',
    createdTime: c.created_time,
    fromId: (c.from && c.from.id) || '',
    fromName: (c.from && c.from.name) || 'ผู้ใช้ Facebook',
    fromPic: (c.from && c.from.picture && c.from.picture.data && c.from.picture.data.url) || '',
    likeCount: c.like_count || 0,
    attachmentUrl: (c.attachment && c.attachment.media && c.attachment.media.image && c.attachment.media.image.src) || '',
    replies: ((c.comments && c.comments.data) || []).map(norm),
  });
  return (json.data || []).map(norm);
}

// สถิติเชิงลึกของโพสต์ (Page Insights) — ต้องมีสิทธิ์ read_insights
// คืน available:false ถ้าสิทธิ์ไม่พอ/metric ใช้ไม่ได้ (ไม่ throw เพื่อให้หน้ายังแสดงส่วนอื่นได้)
async function getPostInsights(postId, accessToken) {
  const metric = [
    'post_impressions',
    'post_impressions_unique',
    'post_impressions_organic_unique',
    'post_impressions_paid_unique',
    'post_clicks',
  ].join(',');
  try {
    const json = await graphGet(`/${postId}/insights`, { metric, access_token: accessToken });
    const v = {};
    for (const d of (json.data || [])) v[d.name] = (d.values && d.values[0] && d.values[0].value) || 0;
    return {
      available: true,
      impressions: v.post_impressions || 0,
      reach: v.post_impressions_unique || 0,
      organicReach: v.post_impressions_organic_unique || 0,
      paidReach: v.post_impressions_paid_unique || 0,
      clicks: v.post_clicks || 0,
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

// ตอบกลับคอมเมนต์ในนามเพจ (ต้องมีสิทธิ์ pages_manage_engagement)
async function replyComment(commentId, message, accessToken) {
  const res = await fetch(`${GRAPH_BASE}/${commentId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, access_token: accessToken }),
  });
  const json = await res.json();
  if (json.error) {
    const err = new Error(json.error.message || 'Graph API error');
    err.code = json.error.code;
    throw err;
  }
  return json; // { id }
}

// ดึงรูปโปรไฟล์ลูกค้าหลายคนพร้อมกัน (Messenger User Profile API)
// คืนค่าเป็น { [psid]: profilePicUrl | '' } — id ที่ดึงไม่ได้จะเป็นค่าว่าง
async function fetchProfilePics(psids, accessToken, concurrency = 10) {
  const result = {};
  const queue = [...psids];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      try {
        const info = await graphGet(`/${id}`, {
          fields: 'profile_pic',
          access_token: accessToken,
        });
        result[id] = info.profile_pic || '';
      } catch {
        result[id] = '';
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return result;
}

// แปลง conversation จาก Graph API ให้อยู่ในรูปแบบที่ระบบใช้
function normalizeConversation(conv, page) {
  const messages = (conv.messages?.data || [])
    .map((m) => ({
      id: m.id,
      text: m.message || '',
      fromId: m.from?.id || '',
      fromName: m.from?.name || '',
      isFromPage: m.from?.id === page.id,
      createdTime: m.created_time,
      attachments: (m.attachments?.data || []).map((a) => ({
        mimeType: a.mime_type,
        name: a.name,
        imageUrl: a.image_data?.url,
        fileUrl: a.file_url,
      })),
    }))
    .sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));

  // คู่สนทนา = participant ที่ไม่ใช่ตัวเพจเอง
  const other = (conv.participants?.data || []).find((p) => p.id !== page.id);

  return {
    id: conv.id,
    pageId: page.id,
    pageName: page.name,
    customerId: other?.id || '',
    customerName: other?.name || 'ไม่ทราบชื่อ',
    updatedTime: conv.updated_time,
    unreadCount: conv.unread_count || 0,
    messages,
  };
}

module.exports = {
  getPageInfo, getUserPages, getConversations, normalizeConversation,
  fetchProfilePics, sendMessage, exchangeLongLivedToken,
  getPosts, getPostsSince, getComments, replyComment, getPostInsights,
};
