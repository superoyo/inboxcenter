// LINE Messaging API — เชื่อมต่อ LINE Official Account
// ต่างจาก Facebook: เป็น webhook (LINE ส่ง event เข้ามา) ดึงประวัติย้อนหลังไม่ได้
// รับข้อความสด + ตอบกลับผ่าน push message
const crypto = require('crypto');

const LINE_API = 'https://api.line.me';

async function lineFetch(path, token, init = {}) {
  const res = await fetch(`${LINE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data.message || data.error_description || `LINE API ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.details = data.details;
    throw err;
  }
  return data;
}

// ตรวจ token + ดึงข้อมูลบอท (ชื่อ, รูป, basicId) — ใช้ยืนยันตอนเชื่อมต่อ
async function getBotInfo(token) {
  // GET /v2/bot/info → { userId, basicId, displayName, pictureUrl, ... }
  return lineFetch('/v2/bot/info', token);
}

// โปรไฟล์ผู้ใช้ที่ทักเข้ามา (ต้องเป็น follower ของ OA)
async function getProfile(token, userId) {
  return lineFetch(`/v2/bot/profile/${encodeURIComponent(userId)}`, token);
}

// ส่งข้อความหาผู้ใช้ (push) — reply token มีอายุสั้น จึงใช้ push เพื่อความชัวร์
async function pushMessage(token, to, text) {
  return lineFetch('/v2/bot/message/push', token, {
    method: 'POST',
    body: JSON.stringify({ to, messages: [{ type: 'text', text: String(text).slice(0, 5000) }] }),
  });
}

// ตรวจลายเซ็น webhook: base64(HMAC-SHA256(channelSecret, rawBody)) === X-Line-Signature
function verifySignature(channelSecret, rawBody, signature) {
  if (!channelSecret || !rawBody || !signature) return false;
  const expected = crypto.createHmac('SHA256', channelSecret).update(rawBody).digest('base64');
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// แปลง event → ข้อความในรูปแบบเดียวกับ inbox (ข้อความที่ไม่ใช่ text เก็บเป็น placeholder)
function messageTextFromEvent(ev) {
  const m = ev.message || {};
  switch (m.type) {
    case 'text': return m.text || '';
    case 'image': return '📷 [รูปภาพ]';
    case 'video': return '🎬 [วิดีโอ]';
    case 'audio': return '🎧 [เสียง]';
    case 'file': return `📎 [ไฟล์: ${m.fileName || 'ไฟล์'}]`;
    case 'location': return `📍 [ตำแหน่ง: ${m.title || m.address || ''}]`;
    case 'sticker': return '🌟 [สติกเกอร์]';
    default: return `[${m.type || 'ข้อความ'}]`;
  }
}

module.exports = {
  getBotInfo, getProfile, pushMessage, verifySignature, messageTextFromEvent,
};
