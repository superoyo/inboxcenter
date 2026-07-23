const express = require('express');
const path = require('path');
const fb = require('./lib/facebook');
const store = require('./lib/store');
const urgency = require('./lib/urgency');
const keywords = require('./lib/keywords');

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

// ---------- Auto refresh (ตั้งรอบเวลาได้ ค่าเริ่มต้น 1 ชั่วโมง) ----------
const DEFAULT_SYNC_MINUTES = 60;
const syncStatus = { lastRefreshAt: null, lastResults: [], running: false };
let currentIntervalMinutes = DEFAULT_SYNC_MINUTES;
let nextRefreshAt = Date.now() + DEFAULT_SYNC_MINUTES * 60000;
let refreshTimer = null;

async function syncAllPages(trigger = 'manual') {
  if (syncStatus.running) return syncStatus.lastResults;
  syncStatus.running = true;
  const startedAt = new Date().toISOString();
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
    // บันทึกประวัติการดึงรายครั้ง
    await store.addSyncRun({
      id: 'run_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      trigger, // 'auto' | 'manual'
      startedAt,
      finishedAt: syncStatus.lastRefreshAt,
      results,
    }).catch(() => {});
    return results;
  } finally {
    syncStatus.running = false;
  }
}

// ตั้งเวลารอบถัดไปตามค่าที่ผู้ใช้กำหนด (setting: syncIntervalMinutes)
async function scheduleAutoRefresh() {
  clearTimeout(refreshTimer);
  const saved = parseInt(await store.getSetting('syncIntervalMinutes', DEFAULT_SYNC_MINUTES), 10);
  currentIntervalMinutes = Number.isFinite(saved) && saved >= 15 ? saved : DEFAULT_SYNC_MINUTES;
  nextRefreshAt = Date.now() + currentIntervalMinutes * 60000;
  refreshTimer = setTimeout(async () => {
    try {
      const r = await syncAllPages('auto');
      console.log(`[auto-refresh] sync ${r.filter((x) => x.ok).length}/${r.length} เพจ, ห้องที่อัปเดต ${r.reduce((s, x) => s + (x.conversations || 0), 0)}`);
    } catch (err) {
      console.error('[auto-refresh] failed:', err.message);
    }
    scheduleAutoRefresh();
  }, currentIntervalMinutes * 60000);
}

// สถานะการ sync — เวลาอัปเดตล่าสุด + รอบถัดไป
app.get('/api/sync-status', async (req, res) => {
  // fallback หลัง restart: ใช้ lastSyncAt ล่าสุดของเพจ (เก็บถาวรใน storage)
  const pages = await store.getPages();
  const lastPageSync = pages.map((p) => p.lastSyncAt).filter(Boolean).sort().pop() || null;
  res.json({
    lastRefreshAt: syncStatus.lastRefreshAt || lastPageSync,
    nextRefreshAt: new Date(nextRefreshAt).toISOString(),
    running: syncStatus.running,
    autoRefreshMinutes: currentIntervalMinutes,
    lastResults: syncStatus.lastResults,
  });
});

// ประวัติการดึง inbox รายครั้ง
app.get('/api/sync-history', async (req, res) => {
  res.json(await store.getSyncRuns(50));
});

// อ่าน/ตั้งค่ารอบเวลาดึงอัตโนมัติ (นาที, 15–1440)
app.get('/api/settings/sync-interval', async (req, res) => {
  res.json({ minutes: currentIntervalMinutes });
});

app.put('/api/settings/sync-interval', async (req, res) => {
  const minutes = parseInt(req.body && req.body.minutes, 10);
  if (!Number.isFinite(minutes) || minutes < 15 || minutes > 1440) {
    return res.status(400).json({ error: 'รอบเวลาต้องอยู่ระหว่าง 15 นาที ถึง 24 ชั่วโมง' });
  }
  await store.setSetting('syncIntervalMinutes', minutes);
  await scheduleAutoRefresh(); // รีเซ็ตตัวจับเวลาด้วยค่าใหม่ทันที
  res.json({ ok: true, minutes, nextRefreshAt: new Date(nextRefreshAt).toISOString() });
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
  const results = await syncAllPages('manual');
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
    keywords: keywords.roomKeywords(conv.messages), // คำสำคัญของห้องนี้ (จากข้อความลูกค้า)
  });
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
    perPage: pageId ? [] : Object.values(perPage).map((p) => ({
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
    scheduleAutoRefresh(); // เริ่มตัวจับเวลาดึงอัตโนมัติตามค่าที่ตั้งไว้
    app.listen(PORT, () => {
      const backend = process.env.DATABASE_URL ? 'PostgreSQL' : 'JSON files (data/)';
      console.log(`Facebook Inbox Center running at http://localhost:${PORT} [storage: ${backend}]`);
    });
  })
  .catch((err) => {
    console.error('Storage init failed:', err.message);
    process.exit(1);
  });
