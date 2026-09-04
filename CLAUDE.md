# FB Inbox Center

ระบบจัดการ Inbox/คอมเมนต์/รายงานของ Facebook Page + LINE OA
(Node/Express + vanilla JS ใน `public/`, storage เลือกอัตโนมัติ: มี `DATABASE_URL` → Postgres (`lib/store-pg.js`) ไม่มี → ไฟล์ JSON ใน `data/` (`lib/store-file.js`) — สอง backend ต้องมี interface ตรงกันเสมอ)
Deploy บน Railway → https://inboxcenter.datafirst.id (push `main` แล้ว deploy อัตโนมัติ)

## ⚠️ ระบบนี้ถูกฝังโดยระบบอื่น — ข้อห้ามที่ทำให้การฝังพัง

**Agency Intelligence** reverse proxy ระบบนี้ไปแสดงในเมนู Message ของเขา
(`/inbox/*` → หน้าเว็บเรา, `/api/*` → API เรา) แล้วฝังด้วย iframe `?embed=1`
รายละเอียดเต็ม: [docs/INBOX-CENTER-INTEGRATION.md](docs/INBOX-CENTER-INTEGRATION.md)

ก่อนแก้โค้ด ต้องไม่ละเมิดข้อใดต่อไปนี้:

1. **ลิงก์ภายใน/asset ต้องเป็น relative path เท่านั้น** (`projects.html`, `style.css`)
   — ห้ามเขียนเป็น `https://inboxcenter.datafirst.id/...`
2. **redirect ฝั่ง server ให้ใช้ path เท่านั้น** เช่น `Location: /index.html` — ห้าม absolute host
3. **ห้ามเพิ่ม `X-Frame-Options` หรือ CSP `frame-ancestors`** (ปัจจุบันไม่มี — ต้องคงไว้แบบนี้)
4. **ห้ามใส่ frame-buster script** (`if (window.top !== window.self) ...`)
5. **ห้ามย้าย prefix `/api`** — ฝั่งโน้น proxy `/api/*` ทั้งก้อนมาหาเรา ถ้าจะย้ายต้องแจ้งก่อน
6. **โหมด embed (`?embed=1`)** ใน `auth.js` + CSS `html.embed` ต้องคงทำงาน (ซ่อน navbar, เต็ม 100vh)
7. **โหมดล็อกเพจเดียว (`?page=PAGE_ID`)** ใน `project.js` ต้องคงทำงาน — Agency Intelligence
   ฝังรายแบรนด์ด้วย `?embed=1&page=xxx` (แนบ `pageId` ให้ทุก API + `/api/pages` กรองเพจเดียว)

frontend เรียก API แบบ absolute path `/api/...` — ฝั่ง Agency Intelligence ยก `/api` ให้เราแล้ว
(ย้ายของเขาไป `/app-api/*`) จึงเพิ่ม endpoint ใหม่ใต้ `/api/` ได้อิสระ แต่ห้ามเปลี่ยน prefix

## เกร็ดที่ต้องรู้

- Auth: เข้าได้ 2 ทาง — ฟอร์มรหัสผ่านผ่าน Wazzup, และ SSO ผ่าน IAMService
  (ปิดไว้จนตั้ง `IAM_SSO_ENABLED=1` + ต้องให้ admin IAM ลงทะเบียน origin เป็น System ก่อน)
  token JWT เก็บใน localStorage (`wz_session`) — ไม่ใช้ cookie · รายละเอียด: [docs/IAM-SSO.md](docs/IAM-SSO.md)
  `requireAuth` เช็คแค่ exp ของ JWT (ไม่ verify ลายเซ็น) — ตั้ง `IAM_JWT_SECRET` แล้วจะ verify ลายเซ็น+iss+aud ด้วย
  โหมด embed จงใจไม่พาไปหน้า login ของ IAM เอง (อยู่ใน iframe ระบบอื่น อาจถูกกันด้วย X-Frame-Options)
- ทดสอบ local: `/api/employees` proxy ไป Wazzup ด้วย token จริงเท่านั้น → token ปลอมจะ 401
  แล้ว auth.js เด้งกลับ login (พฤติกรรมปกติ ไม่ใช่บั๊ก)
- LINE OA = "เพจ" ที่ `platform: 'line'` (id ขึ้นต้น `line_`) รับข้อความผ่าน webhook
  `/api/line/webhook/:channelId` (ยืนยันลายเซ็น HMAC ไม่ผ่าน requireAuth) — sync ข้ามเพจ LINE เสมอ
- หน้า Content: dropdown เพจ + คู่แข่ง อ่านจาก Product Group ของ Agency Intelligence
  (`/api/product-groups` → proxy ไป `/app-api/v1/report-feed/*` ด้วย `REPORT_SERVICE_KEY`
  ⚠️ คีย์อยู่ฝั่ง server เท่านั้น) · ไม่ตั้ง `AGENCY_BASE_URL`+`REPORT_SERVICE_KEY` หรือ feed ล่ม
  → ถอยไปใช้ `/api/pages` + คู่แข่งที่กรอกในเมนู Admin แบบเดิมโดยอัตโนมัติ
- ข้อความส่งต่อภายใน (forward) เก็บแยกจาก messages โดยสิ้นเชิง — ห้าม merge เข้า messages
  เพราะเส้นทางตอบลูกค้า (`/reply`) อ่านจาก messages เท่านั้น
