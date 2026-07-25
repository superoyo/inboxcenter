# ฝังหน้า Inbox Center ในเว็บ/ระบบอื่น

## ทางลัด: ฝังตรงจากเว็บอื่น (ไม่ต้องตั้งค่าเซิร์ฟเวอร์อะไรเลย)

เว็บไหนก็ได้วางโค้ดนี้ได้ทันที — เซิร์ฟเวอร์ Inbox Center ไม่ได้ส่ง X-Frame-Options จึงฝังข้ามโดเมนได้:

```html
<iframe
  src="https://inboxcenter.datafirst.id/index.html?embed=1&project=prj_xxx"
  style="width:100%; height:100vh; border:0;"
  title="Inbox Center"></iframe>
```

- `?embed=1` ซ่อน navbar ของ Inbox Center · `&project=...` เลือกโปรเจกต์ (เอา id จาก URL ตอนเปิดโปรเจกต์) · ไม่ใส่ = เห็นทุกเพจ
- เปลี่ยนเป็น `comments.html` / `analytics.html` / `report.html` / `admin.html` ได้ทุกหน้า
- ครั้งแรกผู้ใช้จะเจอหน้า login ใน iframe — login บัญชี Wazzup ครั้งเดียวต่อเบราว์เซอร์
- ข้อจำกัด: เบราว์เซอร์ยุคใหม่แยก storage ของ iframe ข้ามโดเมน (partitioning) → อาจต้อง login แยกต่อเว็บที่ไปฝัง ถ้าอยากเนียนกว่านั้นใช้แบบ reverse proxy ด้านล่าง

---

# แบบ Reverse Proxy + โหมด embed (same-origin — เนียนสุด)

หลักการ: เว็บเซิร์ฟเวอร์ของ **ระบบปลายทาง** proxy 2 path ไปที่ Inbox Center
แล้วเปิดหน้าโดยเติม `?embed=1` — โหมด embed จะซ่อน navbar ของ Inbox Center ให้อัตโนมัติ

| path ฝั่งระบบปลายทาง | ปลายทาง | หมายเหตุ |
|---|---|---|
| `/inbox/*` | `https://inboxcenter.datafirst.id/*` | หน้าเว็บ (ตัด prefix `/inbox` ออก) |
| `/api/*` | `https://inboxcenter.datafirst.id/api/*` | frontend เรียก `/api` แบบ absolute path |

URL ที่ใช้ฝั่งระบบปลายทาง เช่น `https://โดเมนเขา/inbox/index.html?embed=1&project=prj_xxx`

> ⚠️ ถ้าระบบปลายทางมี `/api` ของตัวเองอยู่แล้วจะชนกัน — ให้ใช้ **subdomain แทน**
> (เช่น `inbox.company.com` proxy ทั้งโดเมนไปที่ Inbox Center ก็จบ ไม่ต้องยุ่งกับ path เลย)

## ลองในเครื่อง (demo นี้)

```bash
# เทอร์มินัล 1: รัน Inbox Center
node server.js                              # → http://localhost:3000

# เทอร์มินัล 2: รัน "ระบบปลายทาง" จำลอง
node examples/embed-host-demo/server.js     # → http://localhost:4000
```

เปิด `http://localhost:4000` → ลองได้ 2 แบบ:
- **เต็มหน้า**: เมนู "กล่องข้อความ (เต็มหน้า)" → Inbox แทนที่ทั้งหน้า ใต้โดเมนของ host
- **หน้าในหน้า** (`/crm`): topbar + sidebar ของ host อยู่ครบ แล้ว Inbox แสดงในพื้นที่เนื้อหา

## แบบ "หน้าในหน้า" ทำอย่างไร

ใช้ **iframe ธรรมดาชี้ path ที่ proxy ไว้** — จุดสำคัญคือพอ reverse proxy ทำให้เป็น
**same-origin** แล้ว ปัญหาคลาสสิกของ iframe หายหมด (third-party cookie ไม่โดนบล็อกเพราะ
ไม่ใช่ third-party แล้ว, ไม่ติด X-Frame-Options, ไม่มี CORS) + โหมด `?embed=1` ซ่อน navbar ให้:

```html
<div class="content" style="display:flex; flex-direction:column;">
  <iframe src="/inbox/index.html?embed=1&project=prj_xxx"
          style="flex:1; width:100%; border:0;"></iframe>
</div>
```

> ถ้าต้องการ "หน้าในหน้า" แบบ**ไม่มี iframe เลยจริงๆ** ต้องแปลงฝั่ง Inbox Center
> เป็น Web Component / widget bundle (แยก CSS ด้วย Shadow DOM + refactor โค้ดหน้าเว็บ
> ให้ mount ลง DOM ของ host ได้) — เป็นงาน refactor ก้อนใหญ่ ต่างจากวิธีนี้ที่ใช้ได้ทันที

## Config จริงตามชนิดเว็บเซิร์ฟเวอร์

### nginx

```nginx
location /inbox/ {
    proxy_pass https://inboxcenter.datafirst.id/;
    proxy_set_header Host inboxcenter.datafirst.id;
    proxy_ssl_server_name on;
}
location /api/ {
    proxy_pass https://inboxcenter.datafirst.id/api/;
    proxy_set_header Host inboxcenter.datafirst.id;
    proxy_ssl_server_name on;
}
```

### Apache (เปิด mod_proxy, mod_proxy_http, mod_ssl)

```apache
SSLProxyEngine on
ProxyPreserveHost off
ProxyPass        /inbox/ https://inboxcenter.datafirst.id/
ProxyPassReverse /inbox/ https://inboxcenter.datafirst.id/
ProxyPass        /api/   https://inboxcenter.datafirst.id/api/
ProxyPassReverse /api/   https://inboxcenter.datafirst.id/api/
```

### Caddy

```caddy
handle_path /inbox/* {
    reverse_proxy https://inboxcenter.datafirst.id {
        header_up Host inboxcenter.datafirst.id
    }
}
handle /api/* {
    reverse_proxy https://inboxcenter.datafirst.id {
        header_up Host inboxcenter.datafirst.id
    }
}
```

### Cloudflare Worker (กรณีระบบปลายทางอยู่หลัง Cloudflare)

```js
export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/inbox/')) {
      url.hostname = 'inboxcenter.datafirst.id';
      url.pathname = url.pathname.replace(/^\/inbox/, '');
      return fetch(new Request(url, req));
    }
    if (url.pathname.startsWith('/api/')) {
      url.hostname = 'inboxcenter.datafirst.id';
      return fetch(new Request(url, req));
    }
    return fetch(req); // ที่เหลือเข้าระบบเดิม
  }
};
```

## เรื่อง login

token เก็บใน localStorage **แยกตามโดเมน** — ผู้ใช้ต้อง login ครั้งแรกใต้โดเมนของระบบปลายทาง
(หน้า login ถูก proxy ไปด้วย จึงเปิด `/inbox/login.html` login ด้วยบัญชี Wazzup ได้ตามปกติ)
หลังจากนั้นใช้งานต่อเนื่องได้จนกว่า token หมดอายุ
