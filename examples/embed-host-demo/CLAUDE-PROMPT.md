# พรอมต์สำหรับวางใน Claude Code ของโปรเจกต์ปลายทาง

คัดลอกข้อความใต้เส้นนี้ทั้งหมด ไปวางใน Claude Code ของเว็บที่ต้องการฝัง Inbox Center

---

เพิ่มเมนู "Message" ในเว็บนี้ ที่แสดงระบบ Inbox Center (https://inboxcenter.datafirst.id) เป็นหน้าหนึ่งของแอป แบบ same-origin ผ่าน reverse proxy — ห้ามแก้อะไรฝั่ง inboxcenter.datafirst.id ทุกอย่างทำในโปรเจกต์นี้เท่านั้น

## ขั้นตอน

1. สำรวจโปรเจกต์นี้ก่อนลงมือ:
   - เว็บนี้ใช้ stack อะไร (nginx / Express / Next.js / Vite / อื่นๆ) และ deploy อย่างไร
   - **มี route `/api` ของตัวเองหรือไม่** — ถ้ามี จะชนกับ proxy ที่ต้องทำ ให้หยุดแล้วแจ้งฉันพร้อมเสนอทางเลือก (เช่น ใช้ subdomain แยก proxy ทั้งโดเมนไปที่ inboxcenter แทน) ห้ามเปลี่ยน prefix `/api` เอง เพราะ frontend ของ Inbox Center hardcode เรียก `/api` แบบ absolute path

2. ตั้ง reverse proxy 2 เส้นทาง ไปที่ Inbox Center (เลือกวิธีตาม stack ที่พบ):
   - `/inbox/*` → `https://inboxcenter.datafirst.id/*` (ตัด prefix `/inbox` ออกก่อนส่งต่อ)
   - `/api/*` → `https://inboxcenter.datafirst.id/api/*`
   - ต้องส่ง Host header เป็น `inboxcenter.datafirst.id` และรองรับ HTTPS upstream (SNI)

   ตัวอย่างต่อ stack:

   **nginx**
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

   **Express** (http-proxy-middleware)
   ```js
   const { createProxyMiddleware } = require('http-proxy-middleware');
   app.use('/inbox', createProxyMiddleware({
     target: 'https://inboxcenter.datafirst.id', changeOrigin: true,
     pathRewrite: { '^/inbox': '' },
   }));
   app.use('/api', createProxyMiddleware({
     target: 'https://inboxcenter.datafirst.id', changeOrigin: true,
   }));
   ```

   **Next.js** (next.config.js — ระวังชนกับ /api ของ Next เอง)
   ```js
   async rewrites() {
     return [
       { source: '/inbox/:path*', destination: 'https://inboxcenter.datafirst.id/:path*' },
       { source: '/api/:path*',  destination: 'https://inboxcenter.datafirst.id/api/:path*' },
     ];
   }
   ```

   **Vite (เฉพาะ dev)** — production ต้องตั้งที่เว็บเซิร์ฟเวอร์จริงด้วย
   ```js
   server: {
     proxy: {
       '/inbox': { target: 'https://inboxcenter.datafirst.id', changeOrigin: true, rewrite: (p) => p.replace(/^\/inbox/, '') },
       '/api':   { target: 'https://inboxcenter.datafirst.id', changeOrigin: true },
     },
   }
   ```

3. เพิ่มเมนู **"Message"** ใน navigation ของเว็บนี้ (สไตล์/ตำแหน่งให้กลืนกับเมนูเดิม) พาไปหน้าใหม่ภายในแอป ที่เนื้อหาเป็น iframe เต็มพื้นที่ content:

   ```html
   <iframe src="/inbox/index.html?embed=1"
           style="width:100%; height:100%; border:0;"
           title="Inbox Center"></iframe>
   ```

   - `?embed=1` ทำให้ Inbox Center ซ่อน navbar ของตัวเอง (ฝั่งโน้นรองรับอยู่แล้ว)
   - ถ้าจะ scope เฉพาะโปรเจกต์ เติม `&project=prj_xxx` — ถามฉันก่อนว่าใช้โปรเจกต์ไหน หรือทำเป็นค่า config
   - จัด layout ให้ iframe สูงเต็มพื้นที่ที่เหลือของหน้า (flex column + flex:1) ไม่ให้เกิด scroll ซ้อน

4. ทดสอบก่อนสรุปงาน:
   - `curl` เช็คว่า `/inbox/style.css` และ `/api/config` ตอบ 200 ผ่านโดเมน/พอร์ตของเว็บนี้
   - เปิดเมนู Message ในเบราว์เซอร์ → ต้องเห็นหน้า login หรือกล่องข้อความของ Inbox Center ใน layout ของเว็บนี้ (ครั้งแรกผู้ใช้ต้อง login บัญชี Wazzup ใน iframe หนึ่งครั้ง — เป็นพฤติกรรมปกติ)
   - เช็คว่า route และ API เดิมของเว็บนี้ยังทำงานครบ
