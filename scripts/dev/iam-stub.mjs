// IAMService ปลอมสำหรับทดสอบ flow SSO ในเครื่อง — ไม่ยิงไปที่ระบบจริง
// ทำเฉพาะสิ่งที่ skill iam-authentication ระบุ: authorize / logout / User/Profile / User/Login
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

const PORT = Number(process.env.STUB_PORT || 4099);
const SECRET = process.env.STUB_SECRET || 'stub_shared_secret';
const ISSUER = 'stub-iam';
const AUDIENCE = 'inboxcenter';
// origin ที่ "ลงทะเบียนเป็น System" ไว้ — เลียนแบบ allow-list ของจริง
const REGISTERED = (process.env.STUB_SYSTEMS || 'http://localhost:3092').split(',');

let sessionAlive = process.env.STUB_SESSION === '1'; // เลียนแบบ SSO cookie ที่ยังไม่หมด

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function mintToken({ expiresInSec = 3600, roles = ['InboxUser', 'Admin'] } = {}) {
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64({
    sub: 'guid-0001',
    name: '100481',
    empCode: 'E100481',
    role: roles,
    iss: ISSUER,
    aud: [AUDIENCE],
    jti: 'jti-1',
    nbf: now,
    exp: now + expiresInSec,
  });
  const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const PROFILE = {
  id: 'guid-0001',
  empCode: 'E100481',
  hrPassword: '',
  empThaiName: 'ทดสอบ ระบบ',
  empEngName: 'Test User',
  nickName: 'เทส',
  positionCode: 'P1',
  positionName: 'Engineer',
  departmentCode: 'D1',
  departmentName: 'IT',
  profileURL: 'https://example.invalid/photo.jpg',
  email: 'test@example.invalid',
  aspNetUsersId: 'guid-0001',
  aspNetUsersEmail: 'test@example.invalid',
  birthdayDate: '01011990',
  wazzupPhotoName: null,
  subdepartmentCode: 0,
  subdepartmentName: null,
  companyId: null,
};

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === '/api/sso/authorize') {
    const returnUrl = url.searchParams.get('returnUrl') || '';
    const state = url.searchParams.get('state') || '';
    let origin;
    try {
      origin = new URL(returnUrl).origin;
    } catch {
      return json(res, 400, { status: 400, message: 'returnUrl is not a registered system.' });
    }
    if (!REGISTERED.includes(origin)) {
      return json(res, 400, { status: 400, message: 'returnUrl is not a registered system.' });
    }
    if (!sessionAlive) {
      // เลียนแบบหน้า login ของ IAM — กดปุ่มแล้วถือว่า login สำเร็จ (ตั้ง cookie)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(
        `<h1>STUB IAM login</h1><form method="POST" action="/stub/login">` +
          `<input type="hidden" name="returnUrl" value="${returnUrl}">` +
          `<input type="hidden" name="state" value="${state}">` +
          `<button id="stubLogin" type="submit">ลงชื่อเข้าใช้</button></form>`,
      );
    }
    const sep = returnUrl.includes('#') ? '&' : '#';
    const loc = `${returnUrl}${sep}access_token=${mintToken()}&token_type=Bearer&state=${encodeURIComponent(state)}`;
    res.writeHead(302, { Location: loc });
    return res.end();
  }

  if (p === '/stub/login' && req.method === 'POST') {
    let raw = '';
    req.on('data', (d) => (raw += d));
    return req.on('end', () => {
      const form = new URLSearchParams(raw);
      sessionAlive = true; // ตั้ง "cookie" — ครั้งถัดไปเข้าได้เลย = single sign-on
      const returnUrl = form.get('returnUrl') || '';
      const state = form.get('state') || '';
      const loc = `${returnUrl}#access_token=${mintToken()}&token_type=Bearer&state=${encodeURIComponent(state)}`;
      res.writeHead(302, { Location: loc });
      res.end();
    });
  }

  if (p === '/api/sso/logout') {
    sessionAlive = false;
    const returnUrl = url.searchParams.get('returnUrl') || '';
    let origin = null;
    try {
      origin = new URL(returnUrl).origin;
    } catch { /* ไม่มี returnUrl */ }
    res.writeHead(302, { Location: origin && REGISTERED.includes(origin) ? returnUrl : '/stub/bye' });
    return res.end();
  }

  if (p === '/api/User/Profile') {
    const auth = req.headers.authorization || '';
    const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
    if (!token) return json(res, 401, { message: 'Unauthorized' });
    // เลียนแบบของจริง: IAM ตรวจลายเซ็นของตัวเองเข้ม
    const [h, b, s] = token.split('.');
    if (!h || !b || !s) return json(res, 401, { message: 'Unauthorized' });
    if (createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url') !== s) {
      return json(res, 401, { message: 'Unauthorized' });
    }
    return json(res, 200, { profile: PROFILE, userRole: ['InboxUser', 'Admin'] });
  }

  if (p === '/api/User/Login' && req.method === 'POST') {
    let raw = '';
    req.on('data', (d) => (raw += d));
    return req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch { /* ว่าง */ }
      if (!body.userName || !body.password) return json(res, 400, { message: 'missing' });
      if (body.userName === 'resigned') {
        return json(res, 401, { message: 'This account is no longer active.' });
      }
      if (body.password !== 'correct') return json(res, 401, { message: 'Invalid credentials' });
      return json(res, 200, {
        profile: { ...PROFILE, access_token: mintToken(), expiration: new Date(Date.now() + 3.6e6).toISOString() },
        userRole: ['InboxUser', 'Admin'],
      });
    });
  }

  // ช่องทางให้เทสสั่งเปิด/ปิด session ของ IAM ได้
  if (p === '/stub/session') {
    sessionAlive = url.searchParams.get('alive') === '1';
    return json(res, 200, { sessionAlive });
  }
  if (p === '/stub/mint') {
    return json(res, 200, {
      valid: mintToken(),
      expired: mintToken({ expiresInSec: -60 }),
      wrongSig: mintToken().replace(/.$/, 'X'),
    });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('stub 404');
}).listen(PORT, () => console.log(`[stub-iam] http://localhost:${PORT}`));
