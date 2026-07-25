# ฝังหน้า Inbox Center ในระบบอื่นแบบไม่ใช้ iframe (Reverse Proxy + โหมด embed)

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

เปิด `http://localhost:4000` → กดเมนู **กล่องข้อความ** → เห็นหน้า Inbox อยู่ใต้โดเมน 4000 โดยไม่มี navbar

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
