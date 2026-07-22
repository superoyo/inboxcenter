const express = require('express');
const path = require('path');
const fb = require('./lib/facebook');
const store = require('./lib/store');
const urgency = require('./lib/urgency');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
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
  };
}

// กรองด้วยคำค้น (ชื่อลูกค้า หรือข้อความในห้อง)
function matchesQuery(c, needle) {
  return (
    c.customerName.toLowerCase().includes(needle) ||
    c.messages.some((m) => (m.text || '').toLowerCase().includes(needle))
  );
}

// การตั้งค่าที่หน้าเว็บต้องรู้ (ไม่เปิดเผยค่า secret)
app.get('/api/config', (req, res) => {
  res.json({
    longLivedTokens: !!(process.env.FB_APP_ID && process.env.FB_APP_SECRET),
  });
});

// ---------- Pages ----------

// รายชื่อเพจที่เชื่อมต่อแล้ว (ไม่ส่ง token กลับไปหน้าเว็บ)
// พร้อมจำนวนข้อความใหม่จากลูกค้า "วันนี้" ต่อเพจ — ?tz=นาที offset จาก UTC ของฝั่งผู้ใช้ (ไทย = 420)
app.get('/api/pages', async (req, res) => {
  const pages = (await store.getPages()).map(({ accessToken, ...p }) => p);

  const localDayKey = dayKeyFactory(parseInt(req.query.tz, 10));
  const todayKey = localDayKey(Date.now());

  const counts = {};
  for (const c of await store.getAllConversations()) {
    for (const m of c.messages) {
      if (!m.isFromPage && localDayKey(m.createdTime) === todayKey) {
        counts[c.pageId] = (counts[c.pageId] || 0) + 1;
      }
    }
  }
  res.json(pages.map((p) => ({ ...p, todayNewMessages: counts[p.id] || 0 })));
});

// เพิ่มเพจใหม่ — รองรับทั้ง User token และ Page token
// - User token: ตอบรายชื่อเพจทั้งหมดกลับไปให้เลือกก่อน (needsSelection)
// - Page token: เชื่อมต่อทันที
// แลก token เป็น long-lived ก่อนใช้เสมอ (ถ้าตั้ง FB_APP_ID/FB_APP_SECRET ไว้)
// → Page token ที่ดึงต่อจาก user token แบบ long-lived จะไม่มีวันหมดอายุ
async function toLongLived(token) {
  try {
    const ll = await fb.exchangeLongLivedToken(token);
    return ll || token;
  } catch {
    return token; // แลกไม่สำเร็จ (เช่น token ประเภทที่แลกไม่ได้) — ใช้ตัวเดิม
  }
}

app.post('/api/pages', async (req, res) => {
  const { accessToken } = req.body || {};
  if (!accessToken || typeof accessToken !== 'string') {
    return res.status(400).json({ error: 'กรุณาใส่ Access Token' });
  }
  const token = await toLongLived(accessToken.trim());

  // ลองแบบ User token ก่อน: ถ้ามีเพจใน /me/accounts แสดงว่าเป็น user token
  try {
    const userPages = await fb.getUserPages(token);
    if (userPages.length > 0) {
      const connectedIds = new Set((await store.getPages()).map((p) => p.id));
      return res.json({
        needsSelection: true,
        pages: userPages.map((p) => ({
          id: p.id,
          name: p.name,
          pictureUrl: p.picture?.data?.url || '',
          alreadyConnected: connectedIds.has(p.id),
        })),
      });
    }
  } catch {
    // ไม่ใช่ user token — ลองแบบ page token ต่อ
  }

  // Page token: ตรวจกับ /me โดยตรง
  try {
    const info = await fb.getPageInfo(token);
    const page = await store.savePage({
      id: info.id,
      name: info.name,
      pictureUrl: info.picture?.data?.url || '',
      accessToken: token,
      connectedAt: new Date().toISOString(),
      lastSyncAt: null,
    });
    const { accessToken: _, ...safe } = page;
    res.json(safe);
  } catch (err) {
    res.status(400).json({
      error: `เชื่อมต่อไม่สำเร็จ: ${err.message} — ถ้าเป็น User token ต้องติ๊กเลือกเพจตอนขอสิทธิ์ หรือถ้าเป็น Page token ต้องมีสิทธิ์ pages_read_engagement`,
    });
  }
});

// เชื่อมต่อเพจที่เลือกจาก User token — ระบบดึง Page token ของแต่ละเพจให้เอง
app.post('/api/pages/from-user-token', async (req, res) => {
  const { accessToken, pageIds } = req.body || {};
  if (!accessToken || !Array.isArray(pageIds) || pageIds.length === 0) {
    return res.status(400).json({ error: 'ต้องระบุ accessToken และ pageIds' });
  }
  try {
    const userPages = await fb.getUserPages(await toLongLived(accessToken.trim()));
    const wanted = new Set(pageIds);
    const connected = [];
    for (const p of userPages) {
      if (!wanted.has(p.id) || !p.access_token) continue;
      await store.savePage({
        id: p.id,
        name: p.name,
        pictureUrl: p.picture?.data?.url || '',
        accessToken: p.access_token,
        connectedAt: new Date().toISOString(),
        lastSyncAt: null,
      });
      connected.push({ id: p.id, name: p.name });
    }
    res.json({ ok: true, connected });
  } catch (err) {
    res.status(400).json({ error: `เชื่อมต่อไม่สำเร็จ: ${err.message}` });
  }
});

app.delete('/api/pages/:id', async (req, res) => {
  await store.deletePage(req.params.id);
  res.json({ ok: true });
});

// ---------- Sync (ดึง inbox) ----------

// รูปโปรไฟล์ที่ cache ไว้เกิน 7 วันถือว่าเก่า (URL ของ Facebook มีวันหมดอายุ)
// ส่วนคนที่ดึงรูปไม่สำเร็จ (url ว่าง) ให้ลองใหม่ทุก 24 ชม. — เผื่อแอปเพิ่งถูกสลับเป็น Live mode
const PIC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PIC_RETRY_MS = 24 * 60 * 60 * 1000;

// เผื่อเวลาซ้อนกัน 15 นาที กันข้อความหล่นหายช่วงรอยต่อของการ sync
const SYNC_OVERLAP_MS = 15 * 60 * 1000;

async function syncPage(page) {
  // เพจที่เคย sync แล้ว → ดึงเฉพาะห้องที่ขยับหลังรอบก่อน (incremental)
  const isFullSync = !page.lastSyncAt;
  const since = isFullSync
    ? null
    : new Date(new Date(page.lastSyncAt).getTime() - SYNC_OVERLAP_MS).toISOString();

  const raw = await fb.getConversations(page.id, page.accessToken, { since });
  const conversations = raw.map((c) => fb.normalizeConversation(c, page));

  // ดึงรูปโปรไฟล์ลูกค้า — เฉพาะคนที่ยังไม่มีใน cache หรือ cache เก่าแล้ว
  const cache = await store.getPicCache();
  const now = Date.now();
  const needFetch = [...new Set(conversations.map((c) => c.customerId).filter(Boolean))]
    .filter((id) => {
      const entry = cache[id];
      if (!entry) return true;
      const age = now - new Date(entry.fetchedAt).getTime();
      return age > (entry.url ? PIC_MAX_AGE_MS : PIC_RETRY_MS);
    });
  if (needFetch.length) {
    const pics = await fb.fetchProfilePics(needFetch, page.accessToken);
    const fetchedAt = new Date().toISOString();
    const updates = {};
    for (const [id, url] of Object.entries(pics)) {
      updates[id] = { url, fetchedAt };
      cache[id] = updates[id];
    }
    await store.savePics(updates);
  }
  for (const c of conversations) c.customerPic = cache[c.customerId]?.url || '';

  if (isFullSync) await store.saveConversations(page.id, conversations);
  else await store.upsertConversations(page.id, conversations);
  await store.savePage({ ...page, lastSyncAt: new Date().toISOString() });
  return conversations.length;
}

// ---------- Auto refresh ทุก 1 ชั่วโมง ----------
const AUTO_REFRESH_MS = 60 * 60 * 1000;
const syncStatus = { lastRefreshAt: null, lastResults: [], running: false };
let nextRefreshAt = Date.now() + AUTO_REFRESH_MS;

async function syncAllPages() {
  if (syncStatus.running) return syncStatus.lastResults;
  syncStatus.running = true;
  try {
    const pages = await store.getPages();
    const results = await Promise.all(
      pages.map(async (page) => {
        try {
          const count = await syncPage(page);
          return { pageId: page.id, pageName: page.name, ok: true, conversations: count };
        } catch (err) {
          return { pageId: page.id, pageName: page.name, ok: false, error: err.message };
        }
      })
    );
    syncStatus.lastRefreshAt = new Date().toISOString();
    syncStatus.lastResults = results;
    return results;
  } finally {
    syncStatus.running = false;
  }
}

setInterval(() => {
  nextRefreshAt = Date.now() + AUTO_REFRESH_MS;
  syncAllPages()
    .then((r) => console.log(`[auto-refresh] sync ${r.filter((x) => x.ok).length}/${r.length} เพจ, ห้องที่อัปเดต ${r.reduce((s, x) => s + (x.conversations || 0), 0)}`))
    .catch((err) => console.error('[auto-refresh] failed:', err.message));
}, AUTO_REFRESH_MS);

// สถานะการ sync — เวลาอัปเดตล่าสุด + รอบถัดไป
app.get('/api/sync-status', async (req, res) => {
  // fallback หลัง restart: ใช้ lastSyncAt ล่าสุดของเพจ (เก็บถาวรใน storage)
  const pages = await store.getPages();
  const lastPageSync = pages.map((p) => p.lastSyncAt).filter(Boolean).sort().pop() || null;
  res.json({
    lastRefreshAt: syncStatus.lastRefreshAt || lastPageSync,
    nextRefreshAt: new Date(nextRefreshAt).toISOString(),
    running: syncStatus.running,
    autoRefreshMinutes: AUTO_REFRESH_MS / 60000,
    lastResults: syncStatus.lastResults,
  });
});

// ดึง inbox ของเพจเดียว
app.post('/api/pages/:id/sync', async (req, res) => {
  const page = (await store.getPages()).find((p) => p.id === req.params.id);
  if (!page) return res.status(404).json({ error: 'ไม่พบเพจนี้ในระบบ' });
  try {
    const count = await syncPage(page);
    res.json({ ok: true, pageId: page.id, conversations: count });
  } catch (err) {
    res.status(400).json({ error: `ดึง inbox ไม่สำเร็จ: ${err.message}` });
  }
});

// ดึง inbox ทุกเพจพร้อมกัน (manual refresh — ใช้ตัวเดียวกับ auto-refresh)
app.post('/api/sync-all', async (req, res) => {
  const results = await syncAllPages();
  res.json({ results, lastRefreshAt: syncStatus.lastRefreshAt });
});

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
  if (q) {
    const needle = String(q).toLowerCase();
    convs = convs.filter((c) => matchesQuery(c, needle));
  }
  if (date) {
    convs = convs.filter((c) => c.messages.some((m) => dayKey(m.createdTime) === date));
  }
  convs.sort((a, b) => new Date(b.updatedTime) - new Date(a.updatedTime));

  const total = convs.length;
  const pageItems = convs.slice(offset, offset + limit);

  const [tagsMap, remarksMap, statusMap] = await Promise.all([
    store.getTags(), store.getRemarks(), store.getStatuses(),
  ]);
  const items = pageItems.map((c) => {
    const s = toSummary(c);
    s.tags = tagsMap[c.id] || [];
    s.remark = remarksMap[c.id] || '';
    s.statusOverride = statusMap[c.id] || '';
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

  const [tagsMap, remarksMap, statusMap, pageConvs] = await Promise.all([
    store.getTags(), store.getRemarks(), store.getStatuses(),
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
    botTexts,
  });
});

// ---------- Analytics ----------
// สรุป performance ของ inbox — ภาพรวมทุกเพจ หรือรายเพจด้วย ?pageId=
// ?tz = offset นาทีจาก UTC ของผู้ใช้ (ไทย = 420)
app.get('/api/analytics', async (req, res) => {
  const { pageId } = req.query;
  const tzMin = parseInt(req.query.tz, 10);
  const offsetMs = (Number.isFinite(tzMin) ? tzMin : 0) * 60000;
  const dayKey = dayKeyFactory(tzMin);
  const now = Date.now();
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(now - 86400e3);
  const cutoff14 = now - 14 * 86400e3;
  const cutoff30 = now - 30 * 86400e3;
  const HOUR = 3600e3;

  let convs = pageId
    ? await store.getConversationsForPage(pageId)
    : await store.getAllConversations();
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

  const daily = {};                 // day -> { in, out }
  const hourly = Array(24).fill(0); // ข้อความเข้า แยกรายชั่วโมง (30 วันล่าสุด)
  let todayIn = 0, yesterdayIn = 0;
  const humanDeltas = [], botDeltas = [];
  const waiting = [];               // ห้องที่ข้อความล่าสุดเป็นของลูกค้า (ยังไม่ได้ตอบ)
  const urgencyCount = { red: 0, yellow: 0, green: 0 };
  let answered = 0, botOnlyRooms = 0, roomsWithReply = 0;
  const perPage = {};               // pageId -> ตัวเลขต่อเพจ (โหมดภาพรวม)

  for (const c of convs) {
    const pp = (perPage[c.pageId] = perPage[c.pageId] || {
      pageId: c.pageId, pageName: c.pageName,
      todayIn: 0, waiting: 0, over24h: 0, red: 0, humanDeltas: [],
    });
    let pending = null, hasHuman = false, hasBot = false, lastCust = null;
    const lastMsg = c.messages[c.messages.length - 1];

    for (const m of c.messages) {
      const t = new Date(m.createdTime).getTime();
      if (!m.isFromPage) {
        lastCust = m;
        if (t >= cutoff14) { const k = dayKey(t); (daily[k] = daily[k] || { in: 0, out: 0 }).in++; }
        if (t >= cutoff30) hourly[new Date(t + offsetMs).getUTCHours()]++;
        const k = dayKey(t);
        if (k === todayKey) { todayIn++; pp.todayIn++; }
        else if (k === yesterdayKey) yesterdayIn++;
        if (pending === null) pending = t;
      } else {
        if (t >= cutoff14) { const k = dayKey(t); (daily[k] = daily[k] || { in: 0, out: 0 }).out++; }
        const bot = isBot(c.pageId, m.text);
        if (bot) hasBot = true; else hasHuman = true;
        if (pending !== null) {
          const d = t - pending;
          if (bot) botDeltas.push(d);
          else { humanDeltas.push(d); pp.humanDeltas.push(d); }
          pending = null;
        }
      }
    }

    const level = statusMap[c.id] || urgency.classify(lastCust ? lastCust.text : '');
    urgencyCount[level]++;
    if (level === 'red') pp.red++;

    if (lastMsg && !lastMsg.isFromPage) {
      const waitedMs = now - new Date(lastMsg.createdTime).getTime();
      waiting.push({
        id: c.id, customerName: c.customerName, pageName: c.pageName,
        waitedMs, level, lastText: (lastMsg.text || '📎 ไฟล์แนบ').slice(0, 90),
      });
      pp.waiting++;
      if (waitedMs > 24 * HOUR) pp.over24h++;
    } else if (lastMsg) {
      answered++;
    }
    if (hasBot || hasHuman) { roomsWithReply++; if (hasBot && !hasHuman) botOnlyRooms++; }
  }

  // ไทม์ไลน์ 14 วันเต็ม (เติมวันว่างด้วย 0)
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const k = dayKey(now - i * 86400e3);
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

  // ห้องเสี่ยงที่ต้องรีบจัดการ: แดงก่อน แล้วไล่ตามเวลารอนานสุด
  const rank = { red: 0, yellow: 1, green: 2 };
  const alerts = [...waiting]
    .sort((a, b) => rank[a.level] - rank[b.level] || b.waitedMs - a.waitedMs)
    .slice(0, 10);

  res.json({
    generatedAt: new Date(now).toISOString(),
    scope: pageId || 'all',
    totals: {
      conversations: convs.length,
      todayIn,
      yesterdayIn,
      answeredPct: convs.length ? answered / convs.length : null,
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
    waiting: { total: waiting.length, agingBuckets, over24h: agingBuckets[3].count },
    urgency: urgencyCount,
    days,
    hourly,
    alerts,
    perPage: pageId ? [] : Object.values(perPage).map((p) => ({
      pageId: p.pageId, pageName: p.pageName,
      todayIn: p.todayIn, waiting: p.waiting, over24h: p.over24h, red: p.red,
      avgHumanMs: avg(p.humanDeltas),
    })).sort((a, b) => b.todayIn - a.todayIn),
  });
});

// ---------- Saved replies (คำตอบสำเร็จรูป แยกตามเพจ) ----------

app.get('/api/pages/:pageId/saved-replies', async (req, res) => {
  res.json(await store.getSavedReplies(req.params.pageId));
});

// แท็กหมวดหมู่: สูงสุด 5 แท็กต่อคำตอบ แท็กละไม่เกิน 20 ตัวอักษร
function cleanReplyTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => String(t).trim().slice(0, 20)).filter(Boolean))].slice(0, 5);
}

app.post('/api/pages/:pageId/saved-replies', async (req, res) => {
  const { text, tags } = req.body || {};
  const clean = String(text || '').trim().slice(0, 1000);
  if (!clean) return res.status(400).json({ error: 'กรุณาใส่ข้อความคำตอบ' });

  // กันบันทึกข้อความเดิมซ้ำ
  const existing = await store.getSavedReplies(req.params.pageId);
  const dup = existing.find((r) => r.text === clean);
  if (dup) return res.json({ ...dup, duplicated: true });

  const entry = {
    id: 'sr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    text: clean,
    tags: cleanReplyTags(tags),
    createdAt: new Date().toISOString(),
  };
  await store.addSavedReply(req.params.pageId, entry);
  res.json(entry);
});

// แก้ไขคำตอบ/แท็กหมวดหมู่
app.put('/api/pages/:pageId/saved-replies/:replyId', async (req, res) => {
  const fields = {};
  if (req.body && req.body.tags !== undefined) fields.tags = cleanReplyTags(req.body.tags);
  if (req.body && req.body.text !== undefined) {
    const t = String(req.body.text).trim().slice(0, 1000);
    if (!t) return res.status(400).json({ error: 'ข้อความคำตอบห้ามว่าง' });
    fields.text = t;
  }
  const updated = await store.updateSavedReply(req.params.pageId, req.params.replyId, fields);
  if (!updated) return res.status(404).json({ error: 'ไม่พบคำตอบนี้' });
  res.json(updated);
});

app.delete('/api/pages/:pageId/saved-replies/:replyId', async (req, res) => {
  await store.deleteSavedReply(req.params.pageId, req.params.replyId);
  res.json({ ok: true });
});

// ตั้งสถานะสี (override) — ส่ง '' หรือ null เพื่อกลับไปใช้ค่าอัตโนมัติ
app.put('/api/conversations/:convId/status', async (req, res) => {
  const { status } = req.body || {};
  if (status && !['red', 'yellow', 'green'].includes(status)) {
    return res.status(400).json({ error: 'status ต้องเป็น red / yellow / green หรือค่าว่าง' });
  }
  await store.setStatus(req.params.convId, status || null);
  res.json({ ok: true, status: status || '' });
});

// บันทึกโน้ต (remark) ของการสนทนา
app.put('/api/conversations/:convId/remark', async (req, res) => {
  const { remark } = req.body || {};
  if (typeof remark !== 'string') return res.status(400).json({ error: 'remark ต้องเป็นข้อความ' });
  const clean = remark.trim().slice(0, 2000);
  await store.setRemark(req.params.convId, clean);
  res.json({ ok: true, remark: clean });
});

// ตั้งแท็กของการสนทนา (ส่งรายการเต็มมาแทนที่ของเดิม)
app.put('/api/conversations/:convId/tags', async (req, res) => {
  const { tags } = req.body || {};
  if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags ต้องเป็น array' });
  const clean = [...new Set(tags.map((t) => String(t).trim().slice(0, 30)).filter(Boolean))].slice(0, 10);
  await store.setTags(req.params.convId, clean);
  res.json({ ok: true, tags: clean });
});

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
    const sent = await fb.sendMessage(conv.customerId, String(text).trim(), page.accessToken);

    // บันทึกข้อความลง local ทันที ไม่ต้องรอ sync รอบใหม่
    const message = {
      id: sent.message_id,
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

store.init()
  .then(() => {
    app.listen(PORT, () => {
      const backend = process.env.DATABASE_URL ? 'PostgreSQL' : 'JSON files (data/)';
      console.log(`Facebook Inbox Center running at http://localhost:${PORT} [storage: ${backend}]`);
    });
  })
  .catch((err) => {
    console.error('Storage init failed:', err.message);
    process.exit(1);
  });
