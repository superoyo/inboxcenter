const express = require('express');
const path = require('path');
const fb = require('./lib/facebook');
const store = require('./lib/store');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Pages ----------

// รายชื่อเพจที่เชื่อมต่อแล้ว (ไม่ส่ง token กลับไปหน้าเว็บ)
// พร้อมจำนวนข้อความใหม่จากลูกค้า "วันนี้" ต่อเพจ — ?tz=นาที offset จาก UTC ของฝั่งผู้ใช้ (ไทย = 420)
app.get('/api/pages', async (req, res) => {
  const pages = (await store.getPages()).map(({ accessToken, ...p }) => p);

  const tzMin = parseInt(req.query.tz, 10);
  const offsetMs = (Number.isFinite(tzMin) ? tzMin : 0) * 60000;
  const localDayKey = (time) => new Date(new Date(time).getTime() + offsetMs).toISOString().slice(0, 10);
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
app.post('/api/pages', async (req, res) => {
  const { accessToken } = req.body || {};
  if (!accessToken || typeof accessToken !== 'string') {
    return res.status(400).json({ error: 'กรุณาใส่ Access Token' });
  }
  const token = accessToken.trim();

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
    const userPages = await fb.getUserPages(accessToken.trim());
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

// รายการ conversation จากทุกเพจ เรียงตามเวลาอัปเดตล่าสุด
app.get('/api/conversations', async (req, res) => {
  const { pageId, q } = req.query;
  let convs = await store.getAllConversations();
  if (pageId) convs = convs.filter((c) => c.pageId === pageId);
  if (q) {
    const needle = String(q).toLowerCase();
    convs = convs.filter(
      (c) =>
        c.customerName.toLowerCase().includes(needle) ||
        c.messages.some((m) => m.text.toLowerCase().includes(needle))
    );
  }
  const [tagsMap, remarksMap, statusMap] = await Promise.all([
    store.getTags(), store.getRemarks(), store.getStatuses(),
  ]);
  for (const c of convs) {
    c.tags = tagsMap[c.id] || [];
    c.remark = remarksMap[c.id] || '';
    c.statusOverride = statusMap[c.id] || '';
  }
  convs.sort((a, b) => new Date(b.updatedTime) - new Date(a.updatedTime));
  res.json(convs);
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
