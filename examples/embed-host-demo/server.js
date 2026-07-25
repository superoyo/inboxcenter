// ตัวอย่าง "ระบบปลายทาง" (host) ที่ฝังหน้า Inbox Center ด้วย reverse proxy — ไม่ใช้ iframe
//
// วิธีลอง:
//   1) รัน Inbox Center ปกติ (node server.js → http://localhost:3000)
//   2) node examples/embed-host-demo/server.js  → http://localhost:4000
//   3) เปิด http://localhost:4000 แล้วกดเมนู "กล่องข้อความ"
//
// หลักการเดียวกับ production: เว็บเซิร์ฟเวอร์ของระบบปลายทาง (nginx/Apache/Caddy)
// proxy 2 path นี้ไปที่ inboxcenter.datafirst.id — ดู README.md ข้างกันสำหรับ config จริง
//   /inbox/*  → หน้าเว็บ (ตัด prefix /inbox ออก)
//   /api/*    → API (frontend เรียก /api แบบ absolute path)
const http = require('http');

const INBOX_ORIGIN = process.env.INBOX_ORIGIN || 'http://localhost:3000';
const PORT = process.env.PORT || 4000;

function proxy(req, res, targetPath) {
  const url = new URL(targetPath, INBOX_ORIGIN);
  const preq = http.request(
    url,
    { method: req.method, headers: { ...req.headers, host: url.host } },
    (pres) => {
      res.writeHead(pres.statusCode, pres.headers);
      pres.pipe(res);
    }
  );
  preq.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('proxy error: ' + e.message + '\n(Inbox Center รันอยู่ที่ ' + INBOX_ORIGIN + ' หรือยัง?)');
  });
  req.pipe(preq);
}

// หน้า home ของ "ระบบปลายทาง" — มีเมนูพาไปหน้า Inbox ที่ถูก proxy เข้ามาในโดเมนตัวเอง
const HOST_PAGE = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>Acme CRM — ระบบตัวอย่าง</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,'Noto Sans Thai',sans-serif; background:#f4f5f7; min-height:100vh; }
  .topbar { background:#1e2a3a; color:#fff; padding:0 24px; height:56px; display:flex; align-items:center; gap:24px; }
  .topbar .logo { font-weight:700; font-size:17px; }
  .topbar a { color:#c7d2e0; text-decoration:none; font-size:14px; padding:6px 12px; border-radius:8px; }
  .topbar a:hover, .topbar a.active { background:rgba(255,255,255,.12); color:#fff; }
  .wrap { max-width:860px; margin:48px auto; padding:0 24px; }
  .card { background:#fff; border-radius:14px; padding:28px; box-shadow:0 2px 10px rgba(0,0,0,.06); }
  h1 { font-size:22px; margin-bottom:8px; }
  p { color:#5a6472; line-height:1.8; font-size:14.5px; }
  .cta { display:inline-block; margin-top:18px; background:#2563eb; color:#fff; text-decoration:none; padding:11px 20px; border-radius:10px; font-weight:600; }
  code { background:#eef1f5; border-radius:6px; padding:2px 7px; font-size:13px; }
</style>
</head>
<body>
  <div class="topbar">
    <span class="logo">🏢 Acme CRM</span>
    <a href="/">Dashboard</a>
    <a href="/">ลูกค้า</a>
    <a class="active" href="/inbox/index.html?embed=1">กล่องข้อความ</a>
    <a href="/">รายงาน</a>
  </div>
  <div class="wrap">
    <div class="card">
      <h1>ระบบตัวอย่าง (host) ที่ฝัง Inbox Center แบบไม่ใช้ iframe</h1>
      <p>
        หน้านี้คือ "อีกระบบหนึ่ง" ที่รันอยู่คนละที่กับ Inbox Center —
        เมนู <b>กล่องข้อความ</b> ด้านบนจะพาไปหน้า Inbox ที่ถูก reverse proxy
        เข้ามาอยู่ใต้โดเมนนี้ (<code>/inbox/index.html?embed=1</code>)
        โดยโหมด embed จะซ่อน navbar ของ Inbox Center ให้อัตโนมัติ
      </p>
      <p style="margin-top:10px;">
        ครั้งแรกจะเจอหน้า login ของ Inbox Center ก่อน (token เก็บแยกตามโดเมน) —
        login ครั้งเดียวแล้วใช้ได้ต่อเนื่อง
      </p>
      <a class="cta" href="/inbox/index.html?embed=1">เปิดกล่องข้อความ →</a>
    </div>
  </div>
</body>
</html>`;

http.createServer((req, res) => {
  if (req.url.startsWith('/inbox/')) return proxy(req, res, req.url.slice('/inbox'.length));
  if (req.url.startsWith('/api/')) return proxy(req, res, req.url);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HOST_PAGE);
}).listen(PORT, () => {
  console.log(`[demo-host] ระบบตัวอย่างเปิดที่ http://localhost:${PORT} (proxy → ${INBOX_ORIGIN})`);
});
