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
app.get('/api/pages', (req, res) => {
  const pages = store.getPages().map(({ accessToken, ...p }) => p);
  res.json(pages);
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
      const connectedIds = new Set(store.getPages().map((p) => p.id));
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
    const page = store.savePage({
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
      store.savePage({
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

app.delete('/api/pages/:id', (req, res) => {
  store.deletePage(req.params.id);
  res.json({ ok: true });
});

// ---------- Sync (ดึง inbox) ----------

// รูปโปรไฟล์ที่ cache ไว้เกิน 7 วันถือว่าเก่า (URL ของ Facebook มีวันหมดอายุ)
// ส่วนคนที่ดึงรูปไม่สำเร็จ (url ว่าง) ให้ลองใหม่ทุก 24 ชม. — เผื่อแอปเพิ่งถูกสลับเป็น Live mode
const PIC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PIC_RETRY_MS = 24 * 60 * 60 * 1000;

async function syncPage(page) {
  const raw = await fb.getConversations(page.id, page.accessToken);
  const conversations = raw.map((c) => fb.normalizeConversation(c, page));

  // ดึงรูปโปรไฟล์ลูกค้า — เฉพาะคนที่ยังไม่มีใน cache หรือ cache เก่าแล้ว
  const cache = store.getPicCache();
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
    for (const [id, url] of Object.entries(pics)) cache[id] = { url, fetchedAt };
    store.savePicCache(cache);
  }
  for (const c of conversations) c.customerPic = cache[c.customerId]?.url || '';

  store.saveConversations(page.id, conversations);
  store.savePage({ ...page, lastSyncAt: new Date().toISOString() });
  return conversations.length;
}

// ดึง inbox ของเพจเดียว
app.post('/api/pages/:id/sync', async (req, res) => {
  const page = store.getPages().find((p) => p.id === req.params.id);
  if (!page) return res.status(404).json({ error: 'ไม่พบเพจนี้ในระบบ' });
  try {
    const count = await syncPage(page);
    res.json({ ok: true, pageId: page.id, conversations: count });
  } catch (err) {
    res.status(400).json({ error: `ดึง inbox ไม่สำเร็จ: ${err.message}` });
  }
});

// ดึง inbox ทุกเพจพร้อมกัน
app.post('/api/sync-all', async (req, res) => {
  const pages = store.getPages();
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
  res.json({ results });
});

// ---------- Unified inbox ----------

// รายการ conversation จากทุกเพจ เรียงตามเวลาอัปเดตล่าสุด
app.get('/api/conversations', (req, res) => {
  const { pageId, q } = req.query;
  let convs = store.getAllConversations();
  if (pageId) convs = convs.filter((c) => c.pageId === pageId);
  if (q) {
    const needle = String(q).toLowerCase();
    convs = convs.filter(
      (c) =>
        c.customerName.toLowerCase().includes(needle) ||
        c.messages.some((m) => m.text.toLowerCase().includes(needle))
    );
  }
  convs.sort((a, b) => new Date(b.updatedTime) - new Date(a.updatedTime));
  res.json(convs);
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
  const conv = store.getAllConversations().find((c) => c.id === req.params.convId);
  if (!conv) return res.status(404).json({ error: 'ไม่พบการสนทนานี้' });
  const page = store.getPages().find((p) => p.id === conv.pageId);
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
    const convs = store.getConversationsForPage(page.id);
    const target = convs.find((c) => c.id === conv.id);
    if (target) {
      target.messages.push(message);
      target.updatedTime = message.createdTime;
      store.saveConversations(page.id, convs);
    }
    res.json({ ok: true, message });
  } catch (err) {
    res.status(400).json({ error: sendErrorMessage(err) });
  }
});

// ข้อความทั้งหมดจากทุกเพจ (flat) เรียงใหม่ล่าสุดก่อน
app.get('/api/messages', (req, res) => {
  const { pageId, limit = 200 } = req.query;
  let convs = store.getAllConversations();
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

app.listen(PORT, () => {
  console.log(`Facebook Inbox Center running at http://localhost:${PORT}`);
});
