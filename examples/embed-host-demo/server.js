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
    <a class="active" href="/inbox/index.html?embed=1">กล่องข้อความ (เต็มหน้า)</a>
    <a href="/crm">กล่องข้อความ (หน้าในหน้า)</a>
    <a href="/">รายงาน</a>
  </div>
  <div class="wrap">
    <div class="card">
      <h1>ระบบตัวอย่าง (host) ที่ฝัง Inbox Center</h1>
      <p>
        หน้านี้คือ "อีกระบบหนึ่ง" ที่รันอยู่คนละที่กับ Inbox Center — ลองได้ 2 แบบ:
      </p>
      <p style="margin-top:10px;">
        <b>1. เต็มหน้า</b> — เมนูพาไปหน้า Inbox ที่ถูก reverse proxy เข้ามาใต้โดเมนนี้
        (<code>/inbox/index.html?embed=1</code>)<br>
        <b>2. หน้าในหน้า</b> — หัวเว็บ + เมนูของระบบนี้ยังอยู่ครบ แล้ว Inbox แสดงในพื้นที่เนื้อหา
        (same-origin iframe บน reverse proxy — ดูหน้า <code>/crm</code>)
      </p>
      <p style="margin-top:10px;">
        ครั้งแรกจะเจอหน้า login ของ Inbox Center ก่อน (token เก็บแยกตามโดเมน) —
        login ครั้งเดียวแล้วใช้ได้ต่อเนื่อง
      </p>
      <a class="cta" href="/crm">ลองแบบหน้าในหน้า →</a>
    </div>
  </div>
</body>
</html>`;

// หน้า "หน้าในหน้า" — โครงของระบบปลายทาง (topbar + sidebar) คงอยู่ แล้ว Inbox อยู่ในพื้นที่เนื้อหา
// ใช้ same-origin iframe: เพราะถูก reverse proxy มาอยู่โดเมนเดียวกัน ปัญหา iframe แบบเดิม
// (third-party cookie โดนบล็อก, X-Frame-Options, ปรับขนาดยาก) จึงหายไปหมด + โหมด embed ซ่อน navbar ให้
const NESTED_PAGE = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>Acme CRM — กล่องข้อความ</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,'Noto Sans Thai',sans-serif; background:#f4f5f7; height:100vh; display:flex; flex-direction:column; }
  .topbar { background:#1e2a3a; color:#fff; padding:0 24px; height:56px; display:flex; align-items:center; gap:24px; flex-shrink:0; }
  .topbar .logo { font-weight:700; font-size:17px; }
  .topbar a { color:#c7d2e0; text-decoration:none; font-size:14px; padding:6px 12px; border-radius:8px; }
  .topbar a:hover, .topbar a.active { background:rgba(255,255,255,.12); color:#fff; }
  .main { flex:1; display:flex; min-height:0; }
  .sidebar { width:200px; background:#fff; border-right:1px solid #e3e6ea; padding:16px 10px; flex-shrink:0; }
  .sidebar a { display:block; padding:9px 12px; border-radius:8px; color:#3c4552; text-decoration:none; font-size:14px; margin-bottom:2px; }
  .sidebar a:hover { background:#f0f2f5; }
  .sidebar a.active { background:#e8effd; color:#2563eb; font-weight:600; }
  .content { flex:1; min-width:0; display:flex; flex-direction:column; }
  .content .crumb { padding:10px 18px; font-size:13px; color:#5a6472; background:#fff; border-bottom:1px solid #e3e6ea; flex-shrink:0; }
  .content iframe { flex:1; width:100%; border:0; }
</style>
</head>
<body>
  <div class="topbar">
    <span class="logo">🏢 Acme CRM</span>
    <a href="/">Dashboard</a>
    <a href="/">ลูกค้า</a>
    <a class="active" href="/crm">กล่องข้อความ</a>
    <a href="/">รายงาน</a>
  </div>
  <div class="main">
    <div class="sidebar">
      <a href="/">🏠 ภาพรวม</a>
      <a class="active" href="/crm">💬 กล่องข้อความ</a>
      <a href="/">📇 รายชื่อลูกค้า</a>
      <a href="/">🧾 ใบเสนอราคา</a>
      <a href="/">⚙️ ตั้งค่า</a>
    </div>
    <div class="content">
      <div class="crumb">Acme CRM › กล่องข้อความ <span style="color:#9aa4b0;">(Inbox Center ฝังแบบหน้าในหน้า — โครงระบบนี้อยู่ครบ)</span></div>
      <iframe src="/inbox/index.html?embed=1" title="Inbox Center"></iframe>
    </div>
  </div>
</body>
</html>`;

http.createServer((req, res) => {
  if (req.url.startsWith('/inbox/')) return proxy(req, res, req.url.slice('/inbox'.length));
  if (req.url.startsWith('/api/')) return proxy(req, res, req.url);
  if (req.url.startsWith('/crm')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(NESTED_PAGE);
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HOST_PAGE);
}).listen(PORT, () => {
  console.log(`[demo-host] ระบบตัวอย่างเปิดที่ http://localhost:${PORT} (proxy → ${INBOX_ORIGIN})`);
});
