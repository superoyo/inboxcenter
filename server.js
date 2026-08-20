const express = require('express');
const path = require('path');
const fb = require('./lib/facebook');
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

/**
 * ห้องนี้ถูกทีมกด "ปิดเคส" หรือ "รอคำตอบ" ไว้หลังข้อความลูกค้าล่าสุดหรือยัง
 * true = ถือว่าจัดการแล้ว ไม่นับเป็นห้องค้างตอบ
 * (ตรรกะเดียวกับ caseStateOf ใน apps/api/src/services/case-events.service.ts —
 *  ที่นี่คำนวณเองเพราะ analytics ยังไม่ได้ย้ายเข้า MVC)
 */
function caseHandled(events, messages) {
  if (!events || !events.length) return false;
  const latest = events.reduce((a, b) =>
    new Date(b.createdTime).getTime() > new Date(a.createdTime).getTime() ? b : a);
  if (latest.type === 'reopened') return false; // ยกเลิกแล้ว กลับมานับค้างตอบ
  let lastCustAt = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!messages[i].isFromPage) { lastCustAt = new Date(messages[i].createdTime).getTime(); break; }
  }
  return new Date(latest.createdTime).getTime() >= lastCustAt;
}

// คืน Set ของ pageId ในโปรเจกต์ (null = ไม่ระบุโปรเจกต์ = ทุกเพจ)
// (ตัวเดียวกับ services/projects.service.ts — เหลือไว้ให้ analytics ที่ยังไม่ย้าย)
async function projectPageIds(projectId) {
  if (!projectId) return null;
  const p = (await store.getProjects()).find((x) => x.id === projectId);
  return new Set(p ? p.pageIds : []);
}

// ---------- Auth ----------
// ด่านตรวจ token สำหรับทุก /api/* ยกเว้น login/config — ไม่มี/หมดอายุ/พัง = 401
// อยู่ที่ apps/api/src/middleware/require-auth.ts (เช็คแค่ exp ของ JWT ไม่ verify ลายเซ็น ตามเดิม)
const { requireAuth } = require('./apps/api/dist/app.js');
app.use(requireAuth);

// ---------- API v1 (เฟส 2 ของการ refactor) ----------
// route ที่ย้ายเข้า MVC แล้ว mount ที่นี่ — ครอบทั้ง /api/v1/* และ /api/* (alias ช่วงเปลี่ยนผ่าน)
// ต้องอยู่ "ก่อน" route เดิมด้านล่าง เพื่อให้ตัวใหม่ทำงานแทน · ดู docs/REFACTOR-PLAN.md
//
// ย้ายแล้ว: config · auth/employees · projects · page-config · pages · sync · saved-replies
//           annotations · conversations/calendar/thread/forward/reply/messages
//           competitors · connections · LINE webhook
// ยังเหลือด้านล่าง: analytics · keyword-rooms · posts/comments/insights · report
app.use(require('./apps/api/dist/app.js').createApiRouter());

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
  // ห้องที่ทีมกด "ปิดเคส" หรือ "รอคำตอบ" ถือว่าจัดการแล้ว ไม่นับเป็นห้องค้างตอบ
  const caseMap = await store.getCaseEvents();

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
    // ยกเว้นห้องที่ทีมกดปิดเคส/รอคำตอบไว้ "หลัง" ข้อความลูกค้าล่าสุด ถือว่าจัดการแล้ว
    // (ถ้าลูกค้าทักมาใหม่หลังกด สถานะจะหมดผลเอง แล้วกลับมานับค้างตามปกติ)
    const lastMsgKey = lastMsg ? dayKey(new Date(lastMsg.createdTime).getTime()) : null;
    const handled = caseHandled(caseMap[c.id], c.messages);
    if (lastMsg && !lastMsg.isFromPage && inPeriod(lastMsgKey) && !handled) {
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

// แก้ไขคำตอบ/แท็กหมวดหมู่

// ตั้งสถานะสี (override) — ส่ง '' หรือ null เพื่อกลับไปใช้ค่าอัตโนมัติ

// บันทึกโน้ต (remark) ของการสนทนา

// ตั้งแท็กของการสนทนา (ส่งรายการเต็มมาแทนที่ของเดิม)

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
