// รายการคำขอที่ smoke test จะยิง — ครอบทั้ง 53 endpoints
// เรียงให้ mutation เกิดหลัง read ของสิ่งเดียวกัน เพื่อให้ผลลัพธ์คงที่ทุกครั้ง
import crypto from 'node:crypto';
import { CHANNEL_SECRET } from './fixtures.mjs';

const FB = '100000000000001';
const LINE_PAGE = 'line_smokechan';
const CONV = 't_smoke_1';
const CMP = 'cmp_smokebrand';

const lineBody = JSON.stringify({
  destination: 'x',
  events: [
    {
      type: 'message',
      timestamp: 1767000000000,
      source: { type: 'user', userId: 'Usmoke' },
      message: { id: 'lm_smoke', type: 'text', text: 'ทักจาก LINE' },
    },
  ],
});
const lineSig = crypto.createHmac('SHA256', CHANNEL_SECRET).update(lineBody).digest('base64');

/** @type {{name:string,method?:string,path:string,body?:unknown,raw?:string,headers?:Record<string,string>,auth?:boolean}[]} */
export const requests = [
  // ---------- public ----------
  { name: 'config', path: '/api/config', auth: false },
  { name: 'auth.login (creds ปลอม)', method: 'POST', path: '/api/auth/login', body: { empCode: 'X', birthDate: '01011990' }, auth: false },
  { name: 'noAuth → 401', path: '/api/projects', auth: false },

  // ---------- auth / employees ----------
  { name: 'auth.profile', path: '/api/auth/profile' },
  { name: 'employees', path: '/api/employees' },

  // ---------- pages ----------
  { name: 'pages', path: '/api/pages?tz=-420' },
  { name: 'pages (scope project)', path: '/api/pages?project=prj_smoke&tz=-420' },
  { name: 'pages (ล็อกเพจเดียว)', path: '/api/pages?pageId=' + FB + '&tz=-420' },
  { name: 'pages.add (token ปลอม)', method: 'POST', path: '/api/pages', body: { accessToken: 'BAD' } },
  { name: 'pages.fromUserToken (ปลอม)', method: 'POST', path: '/api/pages/from-user-token', body: { accessToken: 'BAD', pageIds: [FB] } },

  // ---------- page config ----------
  { name: 'pageConfig.list', path: '/api/page-config' },
  {
    name: 'pageConfig.update',
    method: 'PUT',
    path: `/api/pages/${FB}/config`,
    body: {
      packageImage: '',
      startDate: '2026-02-01',
      character: 'โทนสุภาพ',
      competitors: [
        { name: 'คู่แข่ง ข', url: 'example.com/b' }, // ไม่ใช่เพจ FB → ต้องไม่ถูกดึงเข้าหน้า Competitor
        // เป็นเพจ FB → หลัง PUT แล้ว competitors.list ต้องมีเพจนี้เพิ่มมาเอง พร้อม owners
        { name: 'คู่แข่ง ค', url: 'https://www.facebook.com/smokerival/?locale=th' },
        { name: 'คู่แข่ง ค', url: 'https://www.facebook.com/smokerival' }, // URL ซ้ำ ต้องยุบเป็นรายการเดียว
      ],
      teams: { content: [{ empCode: 'E002', name: 'มานี' }], graphic: [], chatInbox: [], am: [] },
    },
  },
  { name: 'pageConfig.list (หลังแก้)', path: '/api/page-config' },

  // ---------- projects ----------
  { name: 'projects.list', path: '/api/projects' },
  { name: 'projects.create', method: 'POST', path: '/api/projects', body: { name: 'โปรเจกต์ใหม่', description: 'x', pageIds: [FB] } },
  { name: 'projects.update', method: 'PUT', path: '/api/projects/prj_smoke', body: { name: 'โปรเจกต์ทดสอบ (แก้)', pageIds: [FB] } },
  { name: 'projects.list (หลังแก้)', path: '/api/projects' },

  // ---------- conversations ----------
  { name: 'conversations', path: '/api/conversations?tz=-420&limit=50&offset=0' },
  { name: 'conversations (scope project)', path: '/api/conversations?project=prj_smoke&tz=-420' },
  { name: 'conversations (ค้นหา)', path: '/api/conversations?q=' + encodeURIComponent('ใบเสนอราคา') + '&tz=-420' },
  { name: 'conversations (กรองวัน)', path: '/api/conversations?date=2026-01-05&tz=-420' },
  { name: 'conversations (แท็บส่งต่อ)', path: '/api/conversations?forwarded=1&tz=-420' },
  { name: 'calendar', path: '/api/calendar?tz=-420' },
  { name: 'thread', path: `/api/conversations/${CONV}/thread` },
  { name: 'messages', path: '/api/messages?limit=50' },
  { name: 'conv.status', method: 'PUT', path: `/api/conversations/${CONV}/status`, body: { status: 'red' } },
  { name: 'conv.remark', method: 'PUT', path: `/api/conversations/${CONV}/remark`, body: { remark: 'โน้ตใหม่' } },
  { name: 'conv.tags', method: 'PUT', path: `/api/conversations/${CONV}/tags`, body: { tags: ['VIP', 'ด่วน'] } },
  { name: 'conv.forward (ภายใน)', method: 'POST', path: `/api/conversations/${CONV}/forward`, body: { toNames: ['มานี'], text: 'ส่งต่อจาก smoke', fromName: 'ผู้ทดสอบ' } },
  { name: 'conv.reply (token ปลอม)', method: 'POST', path: `/api/conversations/${CONV}/reply`, body: { text: 'ตอบทดสอบ' } },
  { name: 'thread (หลัง mutate)', path: `/api/conversations/${CONV}/thread` },

  // ---------- saved replies ----------
  { name: 'savedReplies.list', path: `/api/pages/${FB}/saved-replies` },
  { name: 'savedReplies.add', method: 'POST', path: `/api/pages/${FB}/saved-replies`, body: { text: 'คำตอบใหม่', tags: ['ใหม่'] } },
  { name: 'savedReplies.update', method: 'PUT', path: `/api/pages/${FB}/saved-replies/sr_smoke`, body: { text: 'แก้แล้ว', tags: ['ทักทาย'] } },
  { name: 'savedReplies.delete', method: 'DELETE', path: `/api/pages/${FB}/saved-replies/sr_smoke` },
  { name: 'savedReplies.list (หลังแก้)', path: `/api/pages/${FB}/saved-replies` },

  // ---------- sync ----------
  { name: 'sync.status', path: '/api/sync-status' },
  { name: 'sync.history', path: '/api/sync-history' },
  { name: 'sync.interval.get', path: '/api/settings/sync-interval' },
  { name: 'sync.interval.put', method: 'PUT', path: '/api/settings/sync-interval', body: { minutes: 120 } },
  { name: 'sync.interval.put (นอกช่วง→400)', method: 'PUT', path: '/api/settings/sync-interval', body: { minutes: 5 } },
  { name: 'sync.page (LINE = ข้าม)', method: 'POST', path: `/api/pages/${LINE_PAGE}/sync` },
  { name: 'sync.page (FB token ปลอม)', method: 'POST', path: `/api/pages/${FB}/sync` },
  { name: 'sync.all', method: 'POST', path: '/api/sync-all' },

  // ---------- analytics / report ----------
  { name: 'analytics', path: '/api/analytics?tz=-420&from=2026-01-01&to=2026-01-31' },
  { name: 'analytics (รายเพจ)', path: `/api/analytics?pageId=${FB}&tz=-420&from=2026-01-01&to=2026-01-31` },
  { name: 'keywordRooms', path: '/api/keyword-rooms?tz=-420' },
  { name: 'report.inbox', path: `/api/pages/${FB}/report/inbox?tz=-420&from=2026-01-01&to=2026-01-31` },
  { name: 'report.posts (token ปลอม)', path: `/api/pages/${FB}/report/posts?from=2026-01-01&to=2026-01-31` },
  { name: 'report.comments (token ปลอม)', path: `/api/pages/${FB}/report/comments?from=2026-01-01&to=2026-01-31` },

  // ---------- posts / comments ----------
  { name: 'posts (token ปลอม)', path: `/api/pages/${FB}/posts` },
  { name: 'post.insights (token ปลอม)', path: `/api/posts/123_456/insights?pageId=${FB}` },
  { name: 'post.comments (token ปลอม)', path: `/api/posts/123_456/comments?pageId=${FB}` },
  { name: 'comment.reply (token ปลอม)', method: 'POST', path: '/api/comments/123_456/reply', body: { pageId: FB, message: 'ตอบคอมเมนต์' } },

  // ---------- competitors ----------
  { name: 'competitors.list', path: '/api/competitors' },
  { name: 'competitors.detail', path: `/api/competitors/${CMP}` },
  { name: 'competitors.syncHistory', path: `/api/competitors/${CMP}/sync-history` },
  { name: 'competitors.add', method: 'POST', path: '/api/competitors', body: { url: 'https://www.facebook.com/newbrand' } },
  { name: 'competitors.add (URL ผิด→400)', method: 'POST', path: '/api/competitors', body: { url: 'https://example.com/x' } },
  { name: 'competitors.add (ซ้ำ→400)', method: 'POST', path: '/api/competitors', body: { url: 'https://www.facebook.com/smokebrand' } },
  { name: 'competitors.sync (ไม่มี APIFY_TOKEN)', method: 'POST', path: `/api/competitors/${CMP}/sync`, body: { range: 'current' } },
  { name: 'competitors.delete', method: 'DELETE', path: '/api/competitors/cmp_newbrand' },

  // ---------- connections / webhook ----------
  { name: 'connections.line.list', path: '/api/connections/line' },
  { name: 'connections.line.add (token ปลอม)', method: 'POST', path: '/api/connections/line', body: { channelId: 'c1', channelSecret: 's1', accessToken: 'bad' } },
  { name: 'connections.line.add (ไม่ครบ→400)', method: 'POST', path: '/api/connections/line', body: { channelId: 'c1' } },
  { name: 'webhook.line (ลายเซ็นถูก)', method: 'POST', path: '/api/line/webhook/smokechan', raw: lineBody, headers: { 'X-Line-Signature': lineSig }, auth: false },
  { name: 'webhook.line (ลายเซ็นผิด→401)', method: 'POST', path: '/api/line/webhook/smokechan', raw: lineBody, headers: { 'X-Line-Signature': 'BAD' }, auth: false },
  { name: 'webhook.line (ไม่มีเพจ→404)', method: 'POST', path: '/api/line/webhook/nope', raw: lineBody, headers: { 'X-Line-Signature': lineSig }, auth: false },
];
