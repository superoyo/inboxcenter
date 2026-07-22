# Facebook Inbox Center

ระบบดึงและรวม inbox จาก Facebook Pages หลายเพจ ไว้ในหน้าเดียว ผ่าน Facebook Graph API

## ฟีเจอร์

- **เชื่อมต่อเพจ** (`/connect.html`) — ใส่ Page Access Token ระบบจะตรวจสอบกับ Graph API แล้วเชื่อมต่อเพจให้อัตโนมัติ พร้อมดึง inbox ครั้งแรกทันที
- **กล่องข้อความรวม** (`/index.html`) — รวมการสนทนาจาก**ทุกเพจ**ในหน้าเดียว เรียงตามข้อความล่าสุด กรองตามเพจ / ค้นหาชื่อลูกค้าหรือข้อความได้ และรีเฟรชอัตโนมัติทุก 60 วินาที
- ปุ่ม **ดึง inbox ทุกเพจ** — sync ทุกเพจพร้อมกันในคลิกเดียว

## วิธีใช้งาน

```bash
npm install
npm start
```

แล้วเปิด http://localhost:3000

### ดูตัวอย่าง UI ด้วยข้อมูลจำลอง (ไม่ต้องมี token)

```bash
node seed-demo.js
```

## วิธีหา Page Access Token

1. เข้า [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
2. เลือกแอปของคุณ → **Get Page Access Token**
3. เพิ่มสิทธิ์: `pages_messaging`, `pages_read_engagement`, `pages_show_list`
4. เลือกเพจ แล้วคัดลอก token มาวางในหน้า "เชื่อมต่อเพจ"

> แนะนำให้แปลงเป็น **long-lived token** (อายุ ~60 วัน) ก่อนใช้งานจริง:
> `GET /oauth/access_token?grant_type=fb_exchange_token&client_id={app-id}&client_secret={app-secret}&fb_exchange_token={short-token}`

## API Endpoints

| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/api/pages` | รายชื่อเพจที่เชื่อมต่อ (ไม่ส่ง token กลับ) |
| POST | `/api/pages` | เพิ่มเพจ `{ "accessToken": "..." }` |
| DELETE | `/api/pages/:id` | ลบเพจและข้อความของเพจนั้น |
| POST | `/api/pages/:id/sync` | ดึง inbox ของเพจเดียว |
| POST | `/api/sync-all` | ดึง inbox ทุกเพจ |
| GET | `/api/conversations?pageId=&q=` | การสนทนาทุกเพจ (กรอง/ค้นหาได้) |
| GET | `/api/messages?pageId=&limit=` | ข้อความทั้งหมดแบบ flat เรียงใหม่ล่าสุดก่อน |

## การเก็บข้อมูล

ระบบเลือก storage backend อัตโนมัติจาก environment:

| สภาพแวดล้อม | Backend |
|---|---|
| มี `DATABASE_URL` (เช่นบน Railway) | **PostgreSQL** — ตาราง `pages`, `conversations` (JSONB), `profile_pics` สร้างให้อัตโนมัติตอน start |
| ไม่มี (รันในเครื่อง) | ไฟล์ JSON ใน `data/` (**อย่า commit ขึ้น git** — มี access token) |

ตัวแปรเสริม: `DATABASE_SSL=true` ถ้าเชื่อม Postgres ผ่าน public proxy จากนอก Railway

## Deploy บน Railway

1. เข้า [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → เลือก repo นี้
2. ในโปรเจกต์เดียวกัน กด **+ New** → **Database** → **Add PostgreSQL**
3. ที่ service ของแอป → แท็บ **Variables** → **Add Variable Reference** → เลือก `DATABASE_URL` จาก Postgres (ค่าจะเป็น `${{Postgres.DATABASE_URL}}`)
4. แท็บ **Settings** → **Networking** → **Generate Domain** เพื่อรับ URL สาธารณะ
5. เปิด URL → ไปหน้า "เชื่อมต่อเพจ" → วาง token ได้เลย (ข้อมูลเก็บใน Postgres ไม่หายเมื่อ redeploy)

## ข้อจำกัด

- Facebook อนุญาตให้อ่าน inbox ได้เฉพาะเพจที่คุณเป็นแอดมิน และแอปต้องได้รับสิทธิ์ `pages_messaging`
- ระบบดึงสูงสุด ~250 การสนทนาต่อเพจต่อครั้ง (25 ต่อหน้า × 10 หน้า) และ 25 ข้อความล่าสุดต่อการสนทนา ปรับได้ใน `lib/facebook.js`

## test edit