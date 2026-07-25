# วิธีเชื่อม Agency Intelligence ↔ Inbox Center

> เอกสารนี้สำหรับส่งให้ทีม/ผู้ดูแลโปรเจกต์ **Inbox Center** (`inboxcenter.datafirst.id`)
> เพื่อให้ทราบว่าถูกเชื่อมเข้ากับ Agency Intelligence ด้วยวิธีใด และมีอะไรที่ต้องไม่แก้
>
> **ฝั่ง Inbox Center ไม่ต้องแก้อะไรเลย** — งานทั้งหมดทำในฝั่ง Agency Intelligence

## กลไกการเชื่อม

Agency Intelligence (Express, deploy บน Railway) ตั้ง **reverse proxy** ให้ Inbox Center
กลายเป็น "หน้าหนึ่ง" ของแอปแบบ **same-origin** แล้วฝังด้วย **iframe**

เพราะเป็น same-origin ทั้งหมด จึง **ไม่มีเรื่อง CORS**, ไม่มี cookie ข้ามโดเมน
และไม่ต้องแลก token กันระหว่างสองระบบ

## เส้นทาง proxy 2 เส้น

ตั้งที่ฝั่ง Agency Intelligence ทั้งหมด:

| เรียกที่ Agency Intelligence | ส่งต่อไปที่ Inbox Center |
|---|---|
| `/inbox/*` | `https://inboxcenter.datafirst.id/*` (ตัด prefix `/inbox` ออกก่อนส่ง) |
| `/api/*` | `https://inboxcenter.datafirst.id/api/*` (คงพาธเดิม) |

ตั้งค่าประกอบ:

- ส่ง `Host: inboxcenter.datafirst.id` (รองรับ SNI ของ HTTPS upstream)
- rewrite domain ของ `Set-Cookie` มาเป็นโดเมน Agency Intelligence
  เพื่อให้ session login ค้างอยู่ใน iframe ได้

โค้ดจริงที่ใช้ (ใน `server.js` ของ Agency Intelligence):

```js
const inboxProxyBase = {
  target: "https://inboxcenter.datafirst.id",
  changeOrigin: true,      // ส่ง Host + SNI ให้ upstream HTTPS
  cookieDomainRewrite: "", // cookie ของ upstream ใช้กับโดเมนเราได้
  xfwd: true,
  ws: true,
};

// /inbox/* → upstream ราก (ตัด prefix)
app.use(createProxyMiddleware({
  ...inboxProxyBase,
  pathFilter: (p) => p === "/inbox" || p.startsWith("/inbox/"),
  pathRewrite: (p) => p.replace(/^\/inbox/, "") || "/",
}));

// /api/* → upstream /api/*
app.use(createProxyMiddleware({
  ...inboxProxyBase,
  pathFilter: (p) => p === "/api" || p.startsWith("/api/"),
}));
```

## การฝังหน้า

เมนู **Message** ในหน้าแบรนด์ของ Agency Intelligence render iframe ชี้ไปที่:

```html
<iframe src="/inbox/index.html?embed=1" title="Inbox Center"></iframe>
```

- `embed=1` ทำให้ Inbox Center ซ่อน navbar ของตัวเอง (ฝั่งนั้นรองรับอยู่แล้ว)
- ผู้ใช้ต้อง login บัญชี Wazzup ใน iframe ครั้งแรกครั้งเดียว — เป็นพฤติกรรมปกติ

## สิ่งที่ Agency Intelligence ยอมปรับให้

frontend ของ Inbox Center เรียก `/api/...` แบบ **absolute path** (hardcode ไว้)
ซึ่งเปลี่ยนไม่ได้ Agency Intelligence จึง**ยก `/api` ให้ Inbox Center ทั้งหมด**
และย้าย API ของตัวเองไปอยู่ใต้ **`/app-api/*`** แทน

## ⚠️ ข้อควรระวัง — สิ่งที่ฝั่ง Inbox Center ต้องไม่ทำ

ถ้าทำข้อใดข้อหนึ่งต่อไปนี้ การฝังจะพังทันที:

1. **อย่าเปลี่ยนลิงก์ภายในเป็น absolute URL ที่มีชื่อโฮสต์**
   ปัจจุบันลิงก์เป็น relative ทั้งหมด (`projects.html`, `style.css`, `auth.js`)
   จึงวิ่งอยู่ใต้ `/inbox/` ได้ถูกต้อง — ถ้าเปลี่ยนเป็น
   `https://inboxcenter.datafirst.id/...` ผู้ใช้จะหลุดออกจาก iframe ไปโดเมนตรง

2. **อย่า redirect ด้วย `Location:` ที่เป็น absolute host ของตัวเอง**
   เหตุผลเดียวกับข้อ 1 — ให้ใช้ path เท่านั้น เช่น `Location: /index.html`

3. **อย่าเพิ่ม `X-Frame-Options: DENY/SAMEORIGIN` หรือ CSP `frame-ancestors 'none'`**
   ตอนนี้ไม่มี header เหล่านี้จึงฝังได้ ถ้าเพิ่มเข้ามาหน้าจะขึ้นว่างเปล่าทันที

4. **อย่าใส่ frame-buster script** เช่น
   `if (window.top !== window.self) top.location = ...` (ตอนนี้ไม่มี)

5. **อย่าย้าย prefix `/api`** — ถ้าย้าย ฝั่ง Agency Intelligence ต้องแก้ proxy ตามด้วย
   แจ้งกันก่อนทุกครั้ง

6. **cookie** ให้ตั้งแบบไม่ fix `Domain=` เป็นโฮสต์ตัวเอง (ปัจจุบันทำงานได้ดี)
   ถ้าเปลี่ยนไปใช้ `SameSite=None` ต้องมี `Secure` ด้วย

## ผลทดสอบบน production

ทดสอบผ่านโดเมน `agencyitelligence-production.up.railway.app` แล้วทั้งหมด:

| รายการ | ผล |
|---|---|
| `/inbox/index.html`, `admin.html`, `analytics.html`, `comments.html`, `connect.html`, `projects.html`, `report.html` | 200 ทุกหน้า |
| `/inbox/style.css`, `/inbox/auth.js`, `/inbox/project.js` | 200 |
| `/api/config` | 200 |
| `/api/projects` (ยังไม่ login) | 401 ตามปกติ |
| หน้า login ของ Inbox Center ใน iframe | แสดงในเลย์เอาต์ Agency Intelligence ได้ ไม่มี scrollbar ซ้อน |
| route/API เดิมของ Agency Intelligence | ทำงานครบ (ย้ายไป `/app-api/*` แล้ว) |

## การ scope การเชื่อม — เชื่อมทีละเพจด้วย `&page=` (คำตอบเรื่องที่ค้าง)

> อัปเดตโดยฝั่ง Inbox Center: เพิ่มโหมด **ล็อกเพจเดียว** แล้ว เหมาะกับการผูกรายแบรนด์
> มากกว่า `&project=` (ที่เป็นการจัดกลุ่มหลายเพจ)

```html
<iframe src="/inbox/index.html?embed=1&page=PAGE_ID"></iframe>
```

- `PAGE_ID` = id ของเพจ Facebook (หรือ LINE OA ที่ขึ้นต้น `line_`) — ดูได้จากหน้า Connect
  ของ Inbox Center (แสดง "ID: xxxx" ใต้ชื่อเพจ) หรือ `GET /api/pages` (ต้อง login)
- ผลคือทุกอย่างในหน้าถูก scope เป็นเพจนั้นเพจเดียว: รายการเพจ/ห้องแชท/ปฏิทิน/สถิติ
- ใช้ได้ทุกหน้า: `index.html`, `comments.html`, `analytics.html`, `report.html`, `admin.html`
- ใช้ `&project=prj_xxx` ร่วมด้วยได้ แต่ถ้าผูกรายแบรนด์แนะนำ `&page=` ตัวเดียวพอ
- ฝั่ง Agency Intelligence: เปลี่ยน config จาก `INBOX_PROJECT_ID` เป็นเก็บ **page id ต่อแบรนด์**
  แล้ว render iframe ด้วย `&page=<pageId ของแบรนด์นั้น>`

ตัวอย่าง: แบรนด์ KireiKirei → `/inbox/index.html?embed=1&page=<id เพจ KireiKirei>`

## ข้อมูลเทคนิคเพิ่มเติม (สำหรับคนตั้ง proxy)

- ต้องลงทะเบียน proxy **ก่อน** `express.json()` — ไม่งั้น body parser จะกิน request body
  ทำให้ POST ส่งผ่าน proxy ไม่ได้
- ต้องใช้ `pathFilter` แบบ mount ที่ root **ไม่ใช่** `app.use("/api", proxy)` เพราะ Express
  จะตัด mount path ออกจาก `req.url` ทำให้ upstream ได้พาธผิด (`/api/config` → `/config`)
- ใช้ `http-proxy-middleware` **v3** (CommonJS) — v4 เป็น ESM-only และต้องใช้ Node ≥ 22.15
  ขณะที่ Railway รัน Node v18 จะ crash ด้วย `ERR_REQUIRE_ESM`
- เปลี่ยน upstream ได้ผ่าน env `INBOX_TARGET`
- ตรวจสถานะได้ที่ `/app-api/health` (คืน `node` version และ `inboxTarget` ที่ใช้อยู่)
