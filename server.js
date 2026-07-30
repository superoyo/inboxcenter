const express = require('express');
const path = require('path');
const fb = require('./lib/facebook');
const line = require('./lib/line');
const apify = require('./lib/apify');
const store = require('./lib/store');
const urgency = require('./lib/urgency');
const keywords = require('./lib/keywords');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({
  limit: '6mb', // เผื่อรูปแพ็กเกจ (data URL) ในตั้งค่ารายเพจ
  // เก็บ raw body ไว้เฉพาะ webhook ของ LINE เพื่อตรวจลายเซ็น (HMAC ต้องใช้ body ดิบ)
  verify: (req, _res, buf) => { if (req.url.startsWith('/api/line/webhook')) req.rawBody = buf; },
}));
// หน้าแรกของเว็บ = หน้าโปรเจกต์ (เดียวกับปลายทางหลัง login)
// ต้องมาก่อน express.static ไม่งั้น static จะเสิร์ฟ index.html ให้เอง
// จงใจจับแค่ '/' เท่านั้น — /index.html ยังเปิดหน้ากล่องข้อความรวมได้เหมือนเดิม
// (Agency Intelligence ฝัง /inbox/index.html?embed=1 อยู่ ห้ามให้เด้ง)
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'projects.html')));

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Helpers ----------

// สร้างฟังก์ชันแปลง timestamp → 'YYYY-MM-DD' ตามเวลาท้องถิ่นของผู้ใช้
// tzMin = offset (นาที) จาก UTC ที่ฝั่งหน้าเว็บส่งมา (ไทย = 420)
function dayKeyFactory(tzMin) {
  const offsetMs = (Number.isFinite(tzMin) ? tzMin : 0) * 60000;
  return (time) => new Date(new Date(time).getTime() + offsetMs).toISOString().slice(0, 10);
}

// ข้อความล่าสุดของ "ลูกค้า" (ไม่ใช่เพจ) — ใช้จัดระดับความเร่งด่วนฝั่งหน้าเว็บ
function lastCustomerText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!messages[i].isFromPage) return messages[i].text || '';
  }
  return '';
}

// เวลาตอบของห้องนี้ — ดูข้อความลูกค้า "ก้อนล่าสุด" แล้วหาว่าเพจตอบหลังจากนั้นเมื่อไร
//   replyMs   = ตอบไปแล้ว ใช้เวลาเท่าไร
//   waitingMs = ยังไม่ได้ตอบ รอมานานเท่าไร (นับถึงตอนนี้)
// คิดจากก้อนล่าสุดเพราะเป็นสิ่งที่คนดูรายการอยากรู้ ("ห้องนี้ตอบช้าไหม/ค้างอยู่ไหม")
// ไม่ใช่ค่าเฉลี่ยตลอดอายุห้อง
function responseTiming(messages) {
  let i = messages.length - 1;
  // ชุดท้ายที่เป็นของเพจ — เก็บ "ตัวแรกสุดของชุด" ไว้เป็นเวลาที่ตอบ (ตอบครั้งแรกหลังลูกค้าถาม)
  let replyAt = null;
  while (i >= 0 && messages[i].isFromPage) {
    replyAt = messages[i].createdTime;
    i--;
  }
  // ถัดขึ้นไปคือก้อนข้อความลูกค้า — เอาตัวแรกสุดของก้อน (ถามติดกันหลายที นับจากทีแรก)
  let askAt = null;
  while (i >= 0 && !messages[i].isFromPage) {
    askAt = messages[i].createdTime;
    i--;
  }
  const ask = askAt ? new Date(askAt).getTime() : NaN;
  if (!isFinite(ask)) return { replyMs: null, waitingMs: null }; // ไม่มีข้อความลูกค้าติดท้าย
  if (replyAt) {
    const rep = new Date(replyAt).getTime();
    return { replyMs: isFinite(rep) && rep >= ask ? rep - ask : null, waitingMs: null };
  }
  return { replyMs: null, waitingMs: Date.now() - ask };
}

// ย่อ conversation ให้เหลือเฉพาะข้อมูลที่ "รายการห้องแชท" ต้องใช้ — ตัด messages ทั้งก้อนออก
// (ข้อความเต็มโหลดทีหลังผ่าน /api/conversations/:id/thread เมื่อผู้ใช้เปิดห้อง)
function toSummary(c) {
  const messages = c.messages || [];
  const last = messages[messages.length - 1];
  return {
    id: c.id,
    pageId: c.pageId,
    pageName: c.pageName,
    customerId: c.customerId,
    customerName: c.customerName,
    customerPic: c.customerPic || '',
    updatedTime: c.updatedTime,
    unreadCount: c.unreadCount || 0,
    messageCount: messages.length,
    preview: last ? { text: last.text || '', isFromPage: !!last.isFromPage } : null,
    lastCustomerText: lastCustomerText(messages),
    ...responseTiming(messages),
  };
}

// กรองด้วยคำค้น (ชื่อลูกค้า หรือข้อความในห้อง)
function matchesQuery(c, needle) {
  return (
    c.customerName.toLowerCase().includes(needle) ||
    c.messages.some((m) => (m.text || '').toLowerCase().includes(needle))
  );
}

// ---------- Auth (Wazzup identity) ----------
// proxy ไป Wazzup เพื่อเลี่ยง CORS + ให้ base URL เป็น config ฝั่ง server


// ด่านตรวจ token สำหรับทุก /api/* ยกเว้น login/config — ไม่มี/หมดอายุ/พัง = 401
// requireAuth ย้ายไป apps/api/src/middleware/require-auth.ts แล้ว
// (ตัวเดียวกัน แต่รู้จัก /api/v1/* ด้วย — เช็คแค่ exp ของ JWT ไม่ verify ลายเซ็น ตามเดิม)
const { requireAuth } = require('./apps/api/dist/app.js');
app.use(requireAuth);

// ---------- API v1 (เฟส 2 ของการ refactor) ----------
// route ที่ย้ายไป apps/api/src/routes/v1 แล้ว ถูก mount ที่นี่ — ครอบทั้ง /api/v1/* และ /api/*
// ต้องอยู่ "ก่อน" route เดิมด้านล่าง เพื่อให้ตัวใหม่ทำงานแทน
// ดู docs/REFACTOR-PLAN.md
app.use(require('./apps/api/dist/app.js').createApiRouter());

// login: แลก username/password → session (มี access_token + expiration)

// profile: ส่งต่อ Bearer ไปดึงโปรไฟล์เต็ม + roles จาก Wazzup

// รายชื่อพนักงานทั้งบริษัท (สำหรับ team picker หน้า Admin)
// proxy EmployeeAll แล้ว "ตัดข้อมูลอ่อนไหวทิ้ง" ก่อนส่งให้หน้าเว็บ:
//   - birthdayDate = รหัสผ่าน login ของแต่ละคน → ห้ามส่งออกเด็ดขาด
//   - email / aspNetUsers* = PII ที่ picker ไม่ต้องใช้
// cache รวม 10 นาที (รายชื่อไม่ค่อยเปลี่ยน + ไม่ต้องยิง Wazzup ทุกครั้ง) — requireAuth กันเส้นนี้อยู่แล้ว

// การตั้งค่าที่หน้าเว็บต้องรู้ (ไม่เปิดเผยค่า secret)

// ---------- Projects (กลุ่มเพจ) ----------

// คืน Set ของ pageId ในโปรเจกต์ (null = ไม่ระบุโปรเจกต์ = ทุกเพจ)
async function projectPageIds(projectId) {
  if (!projectId) return null;
  const p = (await store.getProjects()).find((x) => x.id === projectId);
  return new Set(p ? p.pageIds : []);
}





// ---------- Admin: ตั้งค่ารายเพจ (แพ็กเกจ/วันเริ่มดูแล/ทีม) ----------




















// ---------- Pages ----------






// ---------- Sync (ดึง inbox) ----------













// ---------- Unified inbox ----------

// รายการห้องแชท (สรุป ไม่รวมข้อความเต็ม) — แบ่งหน้าทีละ limit ห้อง
// query: pageId, q (ค้นหา), date (YYYY-MM-DD กรองตามวัน), limit (default 50), offset, tz
// ตอบ: { items, total, hasMore } — items เป็นสรุปห้องที่ตัด messages ออกแล้ว payload จึงเล็กมาก
app.get('/api/conversations', async (req, res) => {
  const { pageId, q, date } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const dayKey = dayKeyFactory(parseInt(req.query.tz, 10));

  // ดึงเฉพาะเพจที่เลือก (ใช้ index ใน Postgres) — เร็วกว่าดึงทุกเพจมา filter ทีหลังมาก
  let convs = pageId ? await store.getConversationsForPage(pageId) : await store.getAllConversations();
  const inProjectC = await projectPageIds(req.query.project);
  if (inProjectC) convs = convs.filter((c) => inProjectC.has(c.pageId));
  if (q) {
    const needle = String(q).toLowerCase();
    convs = convs.filter((c) => matchesQuery(c, needle));
  }
  if (date) {
    convs = convs.filter((c) => c.messages.some((m) => dayKey(m.createdTime) === date));
  }

  const [tagsMap, remarksMap, statusMap, forwardsMap] = await Promise.all([
    store.getTags(), store.getRemarks(), store.getStatuses(), store.getForwards(),
  ]);

  // แท็บ "ข้อความที่ส่งต่อ" — เฉพาะห้องที่มีการส่งต่อเคสภายใน
  if (req.query.forwarded) {
    convs = convs.filter((c) => (forwardsMap[c.id] || []).length > 0);
  }
  convs.sort((a, b) => new Date(b.updatedTime) - new Date(a.updatedTime));

  const total = convs.length;
  const pageItems = convs.slice(offset, offset + limit);

  const items = pageItems.map((c) => {
    const s = toSummary(c);
    s.tags = tagsMap[c.id] || [];
    s.remark = remarksMap[c.id] || '';
    s.statusOverride = statusMap[c.id] || '';
    s.forwardCount = (forwardsMap[c.id] || []).length;
    return s;
  });
  res.json({ items, total, hasMore: offset + items.length < total });
});

// จำนวนห้องที่มีข้อความในแต่ละวัน (สำหรับปฏิทิน) — คิดจากห้องทั้งหมดที่ผ่านตัวกรอง pageId/q
// (แยกจากรายการแบ่งหน้า เพราะปฏิทินต้องนับทุกห้อง ไม่ใช่แค่ 50 ห้องแรก)
app.get('/api/calendar', async (req, res) => {
  const { pageId, q } = req.query;
  const dayKey = dayKeyFactory(parseInt(req.query.tz, 10));
  let convs = pageId ? await store.getConversationsForPage(pageId) : await store.getAllConversations();
  const inProjectCal = await projectPageIds(req.query.project);
  if (inProjectCal) convs = convs.filter((c) => inProjectCal.has(c.pageId));
  if (q) {
    const needle = String(q).toLowerCase();
    convs = convs.filter((c) => matchesQuery(c, needle));
  }
  const map = {}; // day -> Set(conversationId)
  for (const c of convs) {
    for (const day of new Set(c.messages.map((m) => dayKey(m.createdTime)))) {
      (map[day] = map[day] || new Set()).add(c.id);
    }
  }
  res.json(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.size])));
});

// ข้อความเต็มของห้องเดียว — โหลดตอนผู้ใช้เปิดห้อง
// แนบ botTexts (ข้อความเพจที่ซ้ำ ≥3 ครั้งทั้งเพจ = ข้อความอัตโนมัติ) ให้ฝั่งหน้าเว็บใช้แยกสถิติ bot/คน
app.get('/api/conversations/:id/thread', async (req, res) => {
  const conv = await store.getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'ไม่พบการสนทนานี้' });

  const [tagsMap, remarksMap, statusMap, forwardsMap, pageConvs] = await Promise.all([
    store.getTags(), store.getRemarks(), store.getStatuses(), store.getForwards(),
    store.getConversationsForPage(conv.pageId),
  ]);

  const counts = {};
  for (const c of pageConvs) {
    for (const m of c.messages) {
      if (m.isFromPage && m.text) counts[m.text] = (counts[m.text] || 0) + 1;
    }
  }
  const botTexts = Object.entries(counts).filter(([, n]) => n >= 3).map(([t]) => t);

  res.json({
    ...conv,
    tags: tagsMap[conv.id] || [],
    remark: remarksMap[conv.id] || '',
    statusOverride: statusMap[conv.id] || '',
    forwards: forwardsMap[conv.id] || [], // การส่งต่อเคสภายใน (แสดงแทรกในแชท — ไม่ใช่ข้อความถึงลูกค้า)
    botTexts,
    keywords: keywords.roomKeywords(conv.messages), // คำสำคัญของห้องนี้ (จากข้อความลูกค้า)
  });
});

// ส่งต่อเคสภายในทีม — เก็บแยกจาก messages โดยสิ้นเชิง "ไม่มีทาง" ถูกส่งถึงลูกค้า
// (เส้นทางส่งถึงลูกค้ามีเส้นเดียวคือ /api/conversations/:convId/reply ซึ่งอ่านจาก messages เท่านั้น)
app.post('/api/conversations/:id/forward', async (req, res) => {
  const conv = await store.getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'ไม่พบการสนทนานี้' });
  const b = req.body || {};
  const text = String(b.text || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'กรุณาพิมพ์รายละเอียดที่ส่งต่อ' });
  const toNames = Array.isArray(b.toNames)
    ? b.toNames.map((s) => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 20)
    : [];
  const entry = {
    id: 'fw_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    fromName: String(b.fromName || 'ทีมงาน').trim().slice(0, 60) || 'ทีมงาน',
    toNames,
    text,
    createdTime: new Date().toISOString(),
  };
  await store.addForward(conv.id, entry);
  res.json({ ok: true, forward: entry });
});

// ---------- Analytics ----------
// สรุป performance ของ inbox — ภาพรวมทุกเพจ หรือรายเพจด้วย ?pageId=
// ?tz = offset นาทีจาก UTC · ?from=YYYY-MM-DD&to=YYYY-MM-DD = ช่วงเวลา (default: เดือนนี้)
app.get('/api/analytics', async (req, res) => {
  const { pageId } = req.query;
  const tzMin = parseInt(req.query.tz, 10);
  const offsetMs = (Number.isFinite(tzMin) ? tzMin : 0) * 60000;
  const dayKey = dayKeyFactory(tzMin);
  const now = Date.now();
  const todayKey = dayKey(now);
  const HOUR = 3600e3;
  const DAY = 86400e3;

  // ช่วงเวลาที่เลือก (เทียบด้วย day key ตามเวลาท้องถิ่นผู้ใช้)
  const reDate = /^\d{4}-\d{2}-\d{2}$/;
  const kTime = (k) => Date.parse(k + 'T00:00:00Z');
  const kOf = (t) => new Date(t).toISOString().slice(0, 10);
  let toKey = reDate.test(req.query.to) ? req.query.to : todayKey;
  let fromKey = reDate.test(req.query.from) ? req.query.from : todayKey.slice(0, 8) + '01'; // default: วันที่ 1 เดือนนี้
  if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
  if ((kTime(toKey) - kTime(fromKey)) / DAY > 365) fromKey = kOf(kTime(toKey) - 365 * DAY); // จำกัด 1 ปี
  const nDays = Math.round((kTime(toKey) - kTime(fromKey)) / DAY) + 1;
  const prevFromKey = kOf(kTime(fromKey) - nDays * DAY);
  const prevToKey = kOf(kTime(fromKey) - DAY);
  const inPeriod = (k) => k >= fromKey && k <= toKey;
  const inPrev = (k) => k >= prevFromKey && k <= prevToKey;

  // pageId รับได้หลายเพจคั่นด้วยคอมมา (เหมือน /api/pages) — ระบบภายนอกที่ผูกแบรนด์
  // เข้ากับหลายเพจจะขอสรุปรวมได้ในครั้งเดียว ไม่ต้องยิงทีละเพจแล้วมาถัวเฉลี่ยเอง
  const pageIds = String(pageId || '').split(',').map((x) => x.trim()).filter(Boolean);
  let convs = pageIds.length
    ? (await Promise.all(pageIds.map((id) => store.getConversationsForPage(id)))).flat()
    : await store.getAllConversations();
  const inProjectA = await projectPageIds(req.query.project);
  if (inProjectA) convs = convs.filter((c) => inProjectA.has(c.pageId));
  const statusMap = await store.getStatuses();

  // ข้อความเพจที่ซ้ำ ≥3 ครั้งในเพจเดียวกัน = ข้อความอัตโนมัติ (bot)
  const textCount = {};
  for (const c of convs) {
    const m = (textCount[c.pageId] = textCount[c.pageId] || {});
    for (const msg of c.messages) {
      if (msg.isFromPage && msg.text) m[msg.text] = (m[msg.text] || 0) + 1;
    }
  }
  const isBot = (pid, text) => !!text && (textCount[pid] ? textCount[pid][text] || 0 : 0) >= 3;

  const daily = {};                 // day -> { in, out } (เฉพาะช่วงที่เลือก)
  const hourly = Array(24).fill(0); // ข้อความเข้า แยกรายชั่วโมง (เฉพาะช่วงที่เลือก)
  const wordRoomCounts = new Map(); // คำ -> จำนวนห้องที่พูดถึง (word cloud)
  let periodIn = 0, prevIn = 0;
  const humanDeltas = [], botDeltas = [];
  const waiting = [];               // ห้องที่ข้อความล่าสุดของลูกค้าอยู่ในช่วงที่เลือก และยังไม่ได้ตอบ
  const answeredRooms = [];         // ห้องที่ตอบแล้ว พร้อมความเร็วของคู่ถาม-ตอบล่าสุดในช่วง
  const urgencyCount = { red: 0, yellow: 0, green: 0 };
  let activeRooms = 0, answered = 0, botOnlyRooms = 0, roomsWithReply = 0;
  const perPage = {};               // pageId -> ตัวเลขต่อเพจ (โหมดภาพรวม)

  // ---- ภาพรวมแชท (chat overview): นับรายวันทั้งช่วงปัจจุบันและก่อนหน้า สำหรับ sparkline ----
  const recvDay = {}, sentDay = {};       // จำนวนข้อความเข้า/ออก ต่อวัน (ครอบคลุมทั้ง 2 ช่วง)
  const chatDaySet = {};                  // วัน -> Set(convId) ที่ลูกค้ามีข้อความ (นับแชทรายวัน)
  const sla12Day = {}, sla10Day = {};     // วัน -> { hit, tot } อัตราตอบใน 12 ชม. / 10 นาที
  let sentPeriod = 0, sentPrev = 0;
  let sla12hit = 0, sla12tot = 0, sla10hit = 0, sla10tot = 0;         // ช่วงปัจจุบัน
  let sla12hitPrev = 0, sla12totPrev = 0, sla10hitPrev = 0, sla10totPrev = 0; // ช่วงก่อนหน้า
  let newChats = 0, returningChats = 0, activePrevRooms = 0;
  const MIN10 = 10 * 60 * 1000;

  for (const c of convs) {
    const pp = (perPage[c.pageId] = perPage[c.pageId] || {
      pageId: c.pageId, pageName: c.pageName,
      periodIn: 0, waiting: 0, over24h: 0, red: 0, humanDeltas: [],
    });
    let pending = null, hasHumanP = false, hasBotP = false, lastCust = null, activeInPeriod = false, activeInPrev = false;
    let lastPairDelta = null, lastPairAt = null; // คู่ถาม-ตอบล่าสุดที่การตอบอยู่ในช่วงที่เลือก
    const roomTokens = new Set();   // คำสำคัญของห้องนี้ (ข้อความลูกค้าในช่วงที่เลือก)
    const lastMsg = c.messages[c.messages.length - 1];

    for (const m of c.messages) {
      const t = new Date(m.createdTime).getTime();
      const k = dayKey(t);
      if (inPeriod(k)) activeInPeriod = true;
      else if (inPrev(k)) activeInPrev = true;
      if (!m.isFromPage) {
        lastCust = m;
        if (inPeriod(k)) {
          (daily[k] = daily[k] || { in: 0, out: 0 }).in++;
          hourly[new Date(t + offsetMs).getUTCHours()]++;
          periodIn++;
          pp.periodIn++;
          if (m.text) for (const tok of keywords.extractTokens(m.text)) roomTokens.add(tok);
        } else if (inPrev(k)) {
          prevIn++;
        }
        if (inPeriod(k) || inPrev(k)) {
          recvDay[k] = (recvDay[k] || 0) + 1;
          (chatDaySet[k] = chatDaySet[k] || new Set()).add(c.id);
        }
        if (pending === null) pending = t;
      } else {
        if (inPeriod(k)) (daily[k] = daily[k] || { in: 0, out: 0 }).out++;
        if (inPeriod(k) || inPrev(k)) sentDay[k] = (sentDay[k] || 0) + 1;
        if (inPeriod(k)) sentPeriod++; else if (inPrev(k)) sentPrev++;
        const bot = isBot(c.pageId, m.text);
        if (inPeriod(k)) { if (bot) hasBotP = true; else hasHumanP = true; }
        if (pending !== null) {
          const d = t - pending;
          if (inPeriod(k)) {
            if (bot) botDeltas.push(d);
            else { humanDeltas.push(d); pp.humanDeltas.push(d); }
            lastPairDelta = d;
            lastPairAt = t;
          }
          // อัตราตอบ (นับเฉพาะการตอบด้วยคน) — สำหรับการ์ดภาพรวมแชท
          if (!bot) {
            const s12 = (sla12Day[k] = sla12Day[k] || { hit: 0, tot: 0 });
            const s10 = (sla10Day[k] = sla10Day[k] || { hit: 0, tot: 0 });
            if (inPeriod(k) || inPrev(k)) {
              s12.tot++; if (d <= 12 * HOUR) s12.hit++;
              s10.tot++; if (d <= MIN10) s10.hit++;
            }
            if (inPeriod(k)) { sla12tot++; if (d <= 12 * HOUR) sla12hit++; sla10tot++; if (d <= MIN10) sla10hit++; }
            else if (inPrev(k)) { sla12totPrev++; if (d <= 12 * HOUR) sla12hitPrev++; sla10totPrev++; if (d <= MIN10) sla10hitPrev++; }
          }
          pending = null;
        }
      }
    }

    if (activeInPrev) activePrevRooms++;

    // ตัวชี้วัดระดับห้อง: นับเฉพาะห้องที่มีความเคลื่อนไหวในช่วงที่เลือก
    if (!activeInPeriod) continue;
    activeRooms++;
    // แชทใหม่ = ห้องที่เริ่มคุยครั้งแรกในช่วงนี้ · แชทเก่า = เคยคุยมาก่อนแล้วกลับมาคุยอีก
    const firstK = c.messages.length ? dayKey(new Date(c.messages[0].createdTime).getTime()) : toKey;
    if (inPeriod(firstK)) newChats++; else returningChats++;
    for (const tok of roomTokens) wordRoomCounts.set(tok, (wordRoomCounts.get(tok) || 0) + 1);

    const level = statusMap[c.id] || urgency.classify(lastCust ? lastCust.text : '');
    urgencyCount[level]++;
    if (level === 'red') pp.red++;

    // รอตอบ = ข้อความล่าสุดของห้องเป็นของลูกค้า และอยู่ในช่วงที่เลือก
    const lastMsgKey = lastMsg ? dayKey(new Date(lastMsg.createdTime).getTime()) : null;
    if (lastMsg && !lastMsg.isFromPage && inPeriod(lastMsgKey)) {
      const waitedMs = now - new Date(lastMsg.createdTime).getTime();
      waiting.push({
        id: c.id, customerName: c.customerName, pageName: c.pageName,
        customerId: c.customerId, customerPic: c.customerPic || '',
        waitedMs, level, lastText: (lastMsg.text || '📎 ไฟล์แนบ').slice(0, 90),
      });
      pp.waiting++;
      if (waitedMs > 24 * HOUR) pp.over24h++;
    } else {
      answered++;
      if (lastPairDelta != null && lastMsg) {
        answeredRooms.push({
          id: c.id, customerName: c.customerName, pageName: c.pageName,
          customerId: c.customerId, customerPic: c.customerPic || '',
          level, lastText: (lastMsg.text || '📎 ไฟล์แนบ').slice(0, 90),
          replyDelta: lastPairDelta, repliedAt: new Date(lastPairAt).toISOString(),
        });
      }
    }
    if (hasBotP || hasHumanP) { roomsWithReply++; if (hasBotP && !hasHumanP) botOnlyRooms++; }
  }

  // ไทม์ไลน์ครบทุกวันในช่วงที่เลือก (เติมวันว่างด้วย 0)
  const days = [];
  for (let i = 0; i < nDays; i++) {
    const k = kOf(kTime(fromKey) + i * DAY);
    days.push({ date: k, in: (daily[k] || {}).in || 0, out: (daily[k] || {}).out || 0 });
  }

  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const bucketsDef = [
    ['ต่ำกว่า 1 ชม.', (w) => w <= HOUR],
    ['1–6 ชม.', (w) => w > HOUR && w <= 6 * HOUR],
    ['6–24 ชม.', (w) => w > 6 * HOUR && w <= 24 * HOUR],
    ['เกิน 24 ชม. ⛔', (w) => w > 24 * HOUR],
  ];
  const agingBuckets = bucketsDef.map(([label, fn]) => ({ label, count: waiting.filter((w) => fn(w.waitedMs)).length }));

  // ห้องที่ตอบแล้ว แบ่งตามความเร็วในการตอบ (ช่วงเดียวกับ aging)
  const answeredBucketsDef = [
    ['ตอบใน 1 ชม.', (d) => d <= HOUR],
    ['1–6 ชม.', (d) => d > HOUR && d <= 6 * HOUR],
    ['6–24 ชม.', (d) => d > 6 * HOUR && d <= 24 * HOUR],
    ['เกิน 24 ชม.', (d) => d > 24 * HOUR],
  ];
  const answeredBuckets = answeredBucketsDef.map(([label, fn]) => ({ label, count: answeredRooms.filter((w) => fn(w.replyDelta)).length }));
  answeredRooms.sort((a, b) => new Date(b.repliedAt) - new Date(a.repliedAt));

  // word cloud: คำที่ถูกพูดถึงในหลายห้องที่สุด (ห้อง ≥2 ถ้ามีพอ, สูงสุด 40 คำ)
  let cloud = [...wordRoomCounts.entries()].sort((a, b) => b[1] - a[1]);
  const cloudFiltered = cloud.filter(([, n]) => n >= 2);
  cloud = (cloudFiltered.length >= 5 ? cloudFiltered : cloud)
    .slice(0, 40)
    .map(([word, count]) => ({ word, count }));

  // ห้องเสี่ยงที่ต้องรีบจัดการ: แดงก่อน แล้วไล่ตามเวลารอนานสุด
  const rank = { red: 0, yellow: 1, green: 2 };
  const sortedWaiting = [...waiting].sort((a, b) => rank[a.level] - rank[b.level] || b.waitedMs - a.waitedMs);
  const alerts = sortedWaiting.slice(0, 10);

  // ---- สร้าง series รายวันสำหรับ sparkline (ช่วงปัจจุบัน + ช่วงก่อนหน้า อยู่กันคนละเส้น ความยาวเท่ากัน) ----
  const countSeries = (map, startKey) => Array.from({ length: nDays }, (_, i) => map[kOf(kTime(startKey) + i * DAY)] || 0);
  const pctSeries = (map, startKey) => Array.from({ length: nDays }, (_, i) => {
    const e = map[kOf(kTime(startKey) + i * DAY)];
    return e && e.tot ? Math.round((e.hit / e.tot) * 100) : 0;
  });
  const chatCntDay = {};
  for (const k of Object.keys(chatDaySet)) chatCntDay[k] = chatDaySet[k].size;
  const pct = (h, t) => (t ? h / t : null);
  const delta = (cur, prev) => (prev ? (cur - prev) / prev : null); // สัดส่วนเปลี่ยนแปลง

  const chatOverview = {
    newVsReturning: { newChats, returningChats },
    customerChats: {
      value: activeRooms, prev: activePrevRooms, delta: delta(activeRooms, activePrevRooms),
      cur: countSeries(chatCntDay, fromKey), prevSeries: countSeries(chatCntDay, prevFromKey),
    },
    sla12h: {
      value: pct(sla12hit, sla12tot), prev: pct(sla12hitPrev, sla12totPrev),
      delta: (pct(sla12hit, sla12tot) != null && pct(sla12hitPrev, sla12totPrev) != null)
        ? pct(sla12hit, sla12tot) - pct(sla12hitPrev, sla12totPrev) : null,
      cur: pctSeries(sla12Day, fromKey), prevSeries: pctSeries(sla12Day, prevFromKey),
    },
    sla10min: {
      value: pct(sla10hit, sla10tot), prev: pct(sla10hitPrev, sla10totPrev),
      delta: (pct(sla10hit, sla10tot) != null && pct(sla10hitPrev, sla10totPrev) != null)
        ? pct(sla10hit, sla10tot) - pct(sla10hitPrev, sla10totPrev) : null,
      cur: pctSeries(sla10Day, fromKey), prevSeries: pctSeries(sla10Day, prevFromKey),
    },
    messagesReceived: {
      value: periodIn, prev: prevIn, delta: delta(periodIn, prevIn),
      cur: countSeries(recvDay, fromKey), prevSeries: countSeries(recvDay, prevFromKey),
    },
    messagesSent: {
      value: sentPeriod, prev: sentPrev, delta: delta(sentPeriod, sentPrev),
      cur: countSeries(sentDay, fromKey), prevSeries: countSeries(sentDay, prevFromKey),
    },
  };

  res.json({
    generatedAt: new Date(now).toISOString(),
    scope: pageId || 'all',
    period: { from: fromKey, to: toKey, days: nDays },
    totals: {
      conversations: convs.length,
      activeRooms,
      periodIn,
      prevIn,
      answeredPct: activeRooms ? answered / activeRooms : null,
    },
    response: {
      avgHumanMs: avg(humanDeltas),
      minHumanMs: humanDeltas.length ? Math.min(...humanDeltas) : null,
      humanCount: humanDeltas.length,
      avgBotMs: avg(botDeltas),
      botCount: botDeltas.length,
      sla1hPct: humanDeltas.length ? humanDeltas.filter((d) => d <= HOUR).length / humanDeltas.length : null,
      botOnlyRooms,
      roomsWithReply,
    },
    waiting: {
      total: waiting.length,
      agingBuckets,
      over24h: agingBuckets[3].count,
      rooms: sortedWaiting.slice(0, 300), // รายการเต็มสำหรับ panel ตอบแชท (จำกัด 300)
    },
    answeredList: {
      total: answered,
      buckets: answeredBuckets,
      rooms: answeredRooms.slice(0, 300),
    },
    urgency: urgencyCount,
    keywords: cloud,
    chatOverview,
    days,
    hourly,
    alerts,
    // ขอเพจเดียว = ไม่ต้องแยกรายเพจ แต่ถ้าขอหลายเพจรวมกัน ต้องได้รายเพจด้วย
    perPage: pageIds.length === 1 ? [] : Object.values(perPage).map((p) => ({
      pageId: p.pageId, pageName: p.pageName,
      periodIn: p.periodIn, waiting: p.waiting, over24h: p.over24h, red: p.red,
      avgHumanMs: avg(p.humanDeltas),
    })).sort((a, b) => b.periodIn - a.periodIn),
  });
});

// ห้องที่พูดถึงคำที่เลือก (จาก word cloud) — เงื่อนไขช่วงเวลา/เพจ เดียวกับ analytics
app.get('/api/keyword-rooms', async (req, res) => {
  const { pageId } = req.query;
  const word = String(req.query.word || '').trim().toLowerCase();
  if (!word) return res.status(400).json({ error: 'ต้องระบุ word' });

  const tzMin = parseInt(req.query.tz, 10);
  const dayKey = dayKeyFactory(tzMin);
  const DAY = 86400e3;
  const reDate = /^\d{4}-\d{2}-\d{2}$/;
  const kTime = (k) => Date.parse(k + 'T00:00:00Z');
  const kOf = (t) => new Date(t).toISOString().slice(0, 10);
  const todayKey = dayKey(Date.now());
  let toKey = reDate.test(req.query.to) ? req.query.to : todayKey;
  let fromKey = reDate.test(req.query.from) ? req.query.from : todayKey.slice(0, 8) + '01';
  if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
  if ((kTime(toKey) - kTime(fromKey)) / DAY > 365) fromKey = kOf(kTime(toKey) - 365 * DAY);
  const inPeriod = (k) => k >= fromKey && k <= toKey;

  const convs = pageId ? await store.getConversationsForPage(pageId) : await store.getAllConversations();
  const statusMap = await store.getStatuses();
  const rooms = [];
  for (const c of convs) {
    let hit = false, lastCust = null;
    for (const m of c.messages) {
      if (!m.isFromPage) lastCust = m;
      if (hit || m.isFromPage || !m.text) continue;
      if (!inPeriod(dayKey(new Date(m.createdTime).getTime()))) continue;
      // กรองหยาบด้วย substring ก่อน ค่อยตัดคำจริง (เร็วกว่ามาก)
      if (!m.text.toLowerCase().includes(word)) continue;
      if (keywords.extractTokens(m.text).includes(word)) hit = true;
    }
    if (!hit) continue;
    const lastMsg = c.messages[c.messages.length - 1];
    rooms.push({
      id: c.id, customerName: c.customerName, pageName: c.pageName,
      customerId: c.customerId, customerPic: c.customerPic || '',
      level: statusMap[c.id] || urgency.classify(lastCust ? lastCust.text : ''),
      lastText: ((lastMsg && (lastMsg.text || '📎 ไฟล์แนบ')) || '').slice(0, 90),
      updatedTime: c.updatedTime,
    });
  }
  rooms.sort((a, b) => new Date(b.updatedTime) - new Date(a.updatedTime));
  res.json({ word, total: rooms.length, rooms: rooms.slice(0, 300) });
});

// ---------- Comments (คอมเมนต์ใต้โพสต์) ----------
// ดึงสดจาก Graph API ทุกครั้ง (ไม่เก็บลง storage)

async function pageOr404(pageId, res) {
  const page = (await store.getPages()).find((p) => p.id === pageId);
  if (!page) res.status(404).json({ error: 'ไม่พบเพจนี้ในระบบ' });
  return page;
}

// โพสต์ล่าสุดของเพจ
app.get('/api/pages/:pageId/posts', async (req, res) => {
  const page = await pageOr404(req.params.pageId, res);
  if (!page) return;
  try {
    res.json(await fb.getPosts(page.id, page.accessToken));
  } catch (err) {
    res.status(400).json({ error: `ดึงโพสต์ไม่สำเร็จ: ${err.message}` });
  }
});

// คอมเมนต์ใต้โพสต์
app.get('/api/posts/:postId/comments', async (req, res) => {
  const page = await pageOr404(String(req.query.pageId || ''), res);
  if (!page) return;
  try {
    res.json(await fb.getComments(req.params.postId, page.accessToken));
  } catch (err) {
    res.status(400).json({ error: `ดึงคอมเมนต์ไม่สำเร็จ: ${err.message}` });
  }
});

// ---------- Report (export CSV ย้อนหลัง) ----------
function sinceUnixFromMonths(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - (parseInt(months, 10) || 1));
  return Math.floor(d.getTime() / 1000);
}

// ช่วงเวลาของรายงาน: มี from/to (unix วินาที) = ช่วงกำหนดเอง, ไม่งั้นย้อนหลังตาม months
function reportRange(q) {
  const from = parseInt(q.from, 10);
  const to = parseInt(q.to, 10);
  if (from > 0 && to > 0 && from < to) return { since: from, until: to };
  return { since: sinceUnixFromMonths(q.months), until: undefined };
}

// รายงานโพสต์ย้อนหลัง (สำหรับ content analysis)
app.get('/api/pages/:pageId/report/posts', async (req, res) => {
  const page = await pageOr404(req.params.pageId, res);
  if (!page) return;
  try {
    const { since, until } = reportRange(req.query);
    const posts = await fb.getPostsSince(page.id, page.accessToken, since, until);
    res.json({ pageName: page.name, posts });
  } catch (err) {
    res.status(400).json({ error: `ดึงโพสต์ไม่สำเร็จ: ${err.message}` });
  }
});

// รายงานคอมเมนต์ย้อนหลัง — ดึงคอมเมนต์ของทุกโพสต์ในช่วง (จำกัดจำนวนโพสต์กันหนักเกินไป)
app.get('/api/pages/:pageId/report/comments', async (req, res) => {
  const page = await pageOr404(req.params.pageId, res);
  if (!page) return;
  const MAX_POSTS = 200; // เพดานโพสต์ที่ดึงคอมเมนต์ (กัน API หนัก/timeout)
  try {
    const { since, until } = reportRange(req.query);
    const allPosts = await fb.getPostsSince(page.id, page.accessToken, since, until);
    const posts = allPosts.slice(0, MAX_POSTS);
    const rows = [];
    // ดึงคอมเมนต์ทีละ 4 โพสต์พร้อมกัน
    const queue = [...posts];
    async function worker() {
      while (queue.length) {
        const p = queue.shift();
        let comments = [];
        try { comments = await fb.getComments(p.id, page.accessToken); } catch { comments = []; }
        for (const c of comments) {
          rows.push({ post: p, level: 'คอมเมนต์', c, parent: '' });
          for (const r of (c.replies || [])) rows.push({ post: p, level: 'ตอบกลับ', c: r, parent: c.fromName });
        }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    res.json({
      pageName: page.name,
      rows,
      meta: { postsTotal: allPosts.length, postsProcessed: posts.length, truncated: allPosts.length > MAX_POSTS },
    });
  } catch (err) {
    res.status(400).json({ error: `ดึงคอมเมนต์ไม่สำเร็จ: ${err.message}` });
  }
});

// รายงาน Inbox (ห้องแชท) พร้อมสถานะแดง/เหลือง/เขียว — อ่านจากข้อมูลที่ sync ไว้ (ไม่ยิง FB)
app.get('/api/pages/:pageId/report/inbox', async (req, res) => {
  const page = await pageOr404(req.params.pageId, res);
  if (!page) return;
  try {
    const { since, until } = reportRange(req.query);
    const sinceMs = since * 1000;
    const untilMs = until ? until * 1000 : Date.now();
    const LEVEL_TH = { red: 'แดง', yellow: 'เหลือง', green: 'เขียว' };
    const [convs, statusMap] = await Promise.all([
      store.getConversationsForPage(page.id),
      store.getStatuses(),
    ]);
    const rows = [];
    for (const c of convs) {
      const upd = new Date(c.updatedTime).getTime();
      if (!(upd >= sinceMs && upd <= untilMs)) continue; // เฉพาะห้องที่มีความเคลื่อนไหวในช่วงที่เลือก
      let lastCust = null, custCount = 0;
      for (const m of c.messages) if (!m.isFromPage) { lastCust = m; custCount++; }
      const level = statusMap[c.id] || urgency.classify(lastCust ? lastCust.text : '');
      const lastMsg = c.messages[c.messages.length - 1];
      rows.push({
        updatedTime: c.updatedTime,
        customerName: c.customerName,
        status: LEVEL_TH[level] || level,
        statusSource: statusMap[c.id] ? 'ตั้งเอง' : 'อัตโนมัติ',
        lastCustomerText: lastCust ? (lastCust.text || '') : '',
        lastText: lastMsg ? (lastMsg.text || '') : '',
        lastFrom: lastMsg ? (lastMsg.isFromPage ? 'เพจ' : 'ลูกค้า') : '',
        msgCount: c.messages.length,
        custCount,
        unread: c.unreadCount || 0,
        firstTime: c.messages[0] ? c.messages[0].createdTime : c.updatedTime,
      });
    }
    rows.sort((a, b) => new Date(b.updatedTime) - new Date(a.updatedTime));
    res.json({ pageName: page.name, rows });
  } catch (err) {
    res.status(400).json({ error: `ดึงข้อมูล inbox ไม่สำเร็จ: ${err.message}` });
  }
});

// สถิติเชิงลึกของโพสต์ (reach / impressions / clicks)
app.get('/api/posts/:postId/insights', async (req, res) => {
  const page = await pageOr404(String(req.query.pageId || ''), res);
  if (!page) return;
  res.json(await fb.getPostInsights(req.params.postId, page.accessToken));
});

// ตอบกลับคอมเมนต์ในนามเพจ
app.post('/api/comments/:commentId/reply', async (req, res) => {
  const { pageId, message } = req.body || {};
  const clean = String(message || '').trim().slice(0, 2000);
  if (!clean) return res.status(400).json({ error: 'กรุณาพิมพ์ข้อความ' });
  const page = await pageOr404(String(pageId || ''), res);
  if (!page) return;
  try {
    const sent = await fb.replyComment(req.params.commentId, clean, page.accessToken);
    res.json({ ok: true, id: sent.id, message: clean, pageName: page.name });
  } catch (err) {
    const hint = /permission|OAuth/i.test(err.message)
      ? ' — token ต้องมีสิทธิ์ pages_manage_engagement (เพิ่มตอน Generate token แล้วเชื่อมเพจใหม่)'
      : '';
    res.status(400).json({ error: `ตอบคอมเมนต์ไม่สำเร็จ: ${err.message}${hint}` });
  }
});

// ---------- Saved replies (คำตอบสำเร็จรูป แยกตามเพจ) ----------




// แก้ไขคำตอบ/แท็กหมวดหมู่


// ตั้งสถานะสี (override) — ส่ง '' หรือ null เพื่อกลับไปใช้ค่าอัตโนมัติ

// บันทึกโน้ต (remark) ของการสนทนา

// ตั้งแท็กของการสนทนา (ส่งรายการเต็มมาแทนที่ของเดิม)

// ---------- Reply (ตอบกลับ inbox) ----------

// แปลง error จาก Send API เป็นข้อความไทยที่เข้าใจง่าย
function sendErrorMessage(err) {
  if (err.subcode === 2018278 || /outside of allowed window/i.test(err.message)) {
    return 'ส่งไม่ได้: เกินช่วงเวลา 24 ชั่วโมงหลังลูกค้าทักมาล่าสุด (กฎของ Facebook) — ต้องรอลูกค้าทักมาใหม่ก่อน';
  }
  if (err.code === 10 || /permission/i.test(err.message)) {
    return `ส่งไม่ได้: แอปยังไม่มีสิทธิ์ส่งข้อความถึงผู้ใช้รายนี้ — ${err.message}`;
  }
  return `ส่งไม่ได้: ${err.message}`;
}

app.post('/api/conversations/:convId/reply', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'กรุณาพิมพ์ข้อความ' });
  }
  const conv = (await store.getAllConversations()).find((c) => c.id === req.params.convId);
  if (!conv) return res.status(404).json({ error: 'ไม่พบการสนทนานี้' });
  const page = (await store.getPages()).find((p) => p.id === conv.pageId);
  if (!page) return res.status(404).json({ error: 'ไม่พบเพจของการสนทนานี้' });
  if (!conv.customerId) return res.status(400).json({ error: 'ไม่ทราบตัวตนลูกค้าในการสนทนานี้' });

  try {
    let messageId;
    if (page.platform === 'line') {
      await line.pushMessage(page.accessToken, conv.customerId, String(text).trim());
      messageId = 'line_out_' + Date.now(); // LINE push ไม่คืน message id
    } else {
      const sent = await fb.sendMessage(conv.customerId, String(text).trim(), page.accessToken);
      messageId = sent.message_id;
    }

    // บันทึกข้อความลง local ทันที ไม่ต้องรอ sync รอบใหม่
    const message = {
      id: messageId,
      text: String(text).trim(),
      fromId: page.id,
      fromName: page.name,
      isFromPage: true,
      createdTime: new Date().toISOString(),
      attachments: [],
    };
    const convs = await store.getConversationsForPage(page.id);
    const target = convs.find((c) => c.id === conv.id);
    if (target) {
      target.messages.push(message);
      target.updatedTime = message.createdTime;
      await store.saveConversation(target);
    }
    res.json({ ok: true, message });
  } catch (err) {
    res.status(400).json({ error: sendErrorMessage(err) });
  }
});

// ข้อความทั้งหมดจากทุกเพจ (flat) เรียงใหม่ล่าสุดก่อน
app.get('/api/messages', async (req, res) => {
  const { pageId, limit = 200 } = req.query;
  let convs = await store.getAllConversations();
  if (pageId) convs = convs.filter((c) => c.pageId === pageId);
  const messages = convs
    .flatMap((c) =>
      c.messages.map((m) => ({
        ...m,
        conversationId: c.id,
        pageId: c.pageId,
        pageName: c.pageName,
        customerName: c.customerName,
      }))
    )
    .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime))
    .slice(0, Number(limit));
  res.json(messages);
});

// ---------- ตัวจับ error ตัวสุดท้าย (ต้องอยู่หลัง route ทั้งหมด) ----------
// แปลง AppError → { error } ตามรูปแบบเดิม, error ที่ไม่คาดคิด → 500 + log stack
app.use(require('./apps/api/dist/app.js').errorHandler);

store.init()
  .then(() => {
    // ตัวจับเวลาดึงอัตโนมัติ ย้ายไป apps/api/src/services/sync.service.ts แล้ว
    require('./apps/api/dist/app.js').scheduleAutoRefresh();
    app.listen(PORT, () => {
      const backend = process.env.DATABASE_URL ? 'PostgreSQL' : 'JSON files (data/)';
      console.log(`Facebook Inbox Center running at http://localhost:${PORT} [storage: ${backend}]`);
    });
  })
  .catch((err) => {
    console.error('Storage init failed:', err.message);
    process.exit(1);
  });
