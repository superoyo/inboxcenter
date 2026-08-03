# เข้าสู่ระบบผ่าน IAMService (Single Sign-On)

ระบบนี้รองรับการเข้าใช้งาน 2 ทาง — ใช้ร่วมกันได้ ไม่ต้องเลือกอย่างใดอย่างหนึ่ง

| ทาง | ปลายทาง | สถานะ |
|---|---|---|
| ฟอร์มรหัสผ่าน (เดิม) | Wazzup `POST /api/User/Authentication` | ใช้งานอยู่ ไม่เปลี่ยน |
| Single Sign-On | IAMService `/api/sso/authorize` | **ปิดไว้** จนกว่าจะตั้ง `IAM_SSO_ENABLED=1` |

อ้างอิงสัญญา HTTP: skill `iam-authentication` (Operation 1–5)
Base URL เริ่มต้น: `https://iam.fareastfamelineddb.com`

---

## ⚠️ ต้องทำก่อนเปิดใช้ — สองอย่างนี้ผมทำแทนไม่ได้

SSO จะไม่ทำงานเลยจนกว่า **admin ของ IAMService** จะทำ 2 ข้อนี้ให้ก่อน

### 1. ลงทะเบียน origin ของเราเป็น "System"

จำเป็นเพราะ IAM ยอม redirect กลับเฉพาะ origin ที่อยู่ใน allow-list
ถ้าไม่ลงทะเบียน ผู้ใช้ที่กดปุ่ม SSO จะเจอหน้า
`400 {"message":"returnUrl is not a registered system."}` **และกลับเข้าระบบเราไม่ได้เลย**

origin ที่ต้องลงทะเบียน (ตรงเป๊ะทั้ง scheme + host + port ไม่มี `/` ปิดท้าย):

```
https://inboxcenter.datafirst.id
```

ถ้าจะทดสอบจากเครื่อง dev ต้องลงทะเบียน origin ของ dev แยกอีกอันด้วย เช่น `http://localhost:3000`

**สำคัญสำหรับกรณีถูกฝัง (embed):** Agency Intelligence ฝังเราด้วย reverse proxy
เวลาอยู่ใน iframe `location.origin` จะเป็น **โดเมนของ Agency Intelligence ไม่ใช่ของเรา**
ถ้าต้องการให้ SSO ใช้ได้ในโหมด embed ด้วย ต้องลงทะเบียน origin ของ Agency Intelligence เพิ่ม

### 2. (ไม่บังคับ) ผูก role gate

ผูก role กับ System ได้ถ้าต้องการจำกัดคนเข้า — ไม่ผูก = พนักงานที่ยังทำงานอยู่เข้าได้ทุกคน
ผูกแล้ว user ที่ไม่มี role จะเห็นหน้า access-denied ของ IAM และ **ไม่ได้ token**

### CORS — เราไม่ต้องขอ

skill ระบุว่า CORS เป็น allow-list แยกจาก Systems และจำเป็นเฉพาะการเรียก IAM
**ตรงจาก browser** ระบบนี้ให้ server ของเราเป็นตัวเรียก IAM ทั้งหมด (ดู `integrations/iam/client.ts`)
การเรียกแบบ server-to-server ไม่ติด CORS — จึงไม่ต้องขอเพิ่มรายการนี้

---

## ตั้งค่า environment

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `IAM_SSO_ENABLED` | (ว่าง = ปิด) | `1` = เปิดปุ่ม SSO + พาเข้าเองเมื่อ IAM ยังมี session |
| `IAM_BASE_URL` | `https://iam.fareastfamelineddb.com` | เปลี่ยนได้เวลาทดสอบกับ stub |
| `IAM_JWT_SECRET` | (ว่าง) | ตั้งเมื่อได้ shared secret → เริ่ม verify ลายเซ็น token |
| `IAM_JWT_ISSUER` | (ว่าง) | ตรวจ `iss` เพิ่ม (ต้องตั้ง `IAM_JWT_SECRET` ก่อน) |
| `IAM_JWT_AUDIENCE` | (ว่าง) | ตรวจ `aud` เพิ่ม (ต้องตั้ง `IAM_JWT_SECRET` ก่อน) |

เปิดใช้บน Railway = ตั้ง `IAM_SSO_ENABLED=1` แล้ว redeploy

### เรื่องการตรวจ token — ทำไมยังไม่เปิดโดยอัตโนมัติ

`requireAuth` เดิม **เช็คแค่ `exp` ไม่ verify ลายเซ็น** เพราะฝั่งนี้ไม่มี shared secret
Operation 5 ของ skill บอกให้ verify ลายเซ็น + `iss` + `aud` + `exp` ที่ฝั่ง relying app
ผมทำไว้ให้พร้อมแล้ว แต่ **เปิดเมื่อตั้ง `IAM_JWT_SECRET` เท่านั้น**

เหตุผล: ถ้าเปิดทันทีโดยที่ยังไม่รู้ว่า secret/issuer ตรงกันจริงไหม token ของทุกคนที่ล็อกอินอยู่
จะถูกปฏิเสธหมดพร้อมกัน — ไม่ตั้งค่า = พฤติกรรมเดิมเป๊ะ ตั้งค่าแล้วค่อยเข้มขึ้น
(ยืนยันแล้วว่า token ที่ลายเซ็นผิด / secret ผิด / `alg=none` / `iss` ผิด / หมดอายุ ได้ 401 ทั้งหมด
ส่วนเซิร์ฟเวอร์ที่ไม่ตั้ง secret ยังรับ token แบบเดิม)

---

## flow ที่ทำจริงในโค้ด

```
เปิดหน้าใดก็ตาม (ไม่มี session)
  auth.js → เด้งไป login.html (จำหน้าเดิมไว้ใน wz_return)

login.html — ลำดับการตัดสินใจใน boot()
  1. มี #access_token ใน URL?  → เก็บ session แล้วไปหน้าที่ตั้งใจเข้า
  2. มี session ที่ยังไม่หมด?   → ไปหน้าที่ตั้งใจเข้า
  3. เปิด SSO + ยังไม่เคยลองในแท็บนี้ + ไม่ใช่โหมด embed
                                → redirect ไป IAM เอง
                                  ถ้าเคย SSO ที่ระบบอื่นไว้ IAM จะพากลับมาพร้อม token
                                  โดยไม่ถามรหัสอีก  ← "ระบบอื่น SSO มาแล้ว เข้าต่อได้เลย"
  4. นอกนั้น                    → แสดงฟอร์มรหัสผ่าน (+ ปุ่ม SSO ถ้าเปิดใช้)
```

ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | หน้าที่ |
|---|---|
| `public/sso.js` | flow ฝั่ง browser — state, อ่าน fragment, เก็บ session, logout |
| `public/login.html` | ลำดับการตัดสินใจตอนเปิดหน้า + ปุ่ม SSO |
| `public/auth.js` | ออกจากระบบ (ล้างของเราก่อน แล้วค่อยล้างของ IAM) |
| `apps/api/src/services/sso.service.ts` | สร้าง URL + แปลง token เป็นโปรไฟล์ |
| `apps/api/src/integrations/iam/client.ts` | เรียก IAM (Operation 1 + 2) + ตัดฟิลด์อ่อนไหว |
| `apps/api/src/utils/jwt.ts` | อ่าน claim + verify ตาม Operation 5 |

endpoint ที่เพิ่ม (อยู่ใต้ `/api` ตามเดิม ไม่ย้าย prefix)

| endpoint | ต้อง login | ใช้ทำอะไร |
|---|---|---|
| `GET /api/auth/sso/status` | ไม่ | หน้า login ถามว่าเปิด SSO ไว้ไหม + URL ปลายทาง |
| `GET /api/auth/sso/session` | ใช่ | แลก token จาก fragment เป็นโปรไฟล์ + roles |
| `POST /api/auth/iam/login` | ไม่ | Operation 1 ของ IAM — เตรียมไว้ ยังไม่ได้ใช้เป็นทางเข้าหลัก |

---

## ข้อควรระวังที่ยึดจาก checklist ของ skill

| ข้อ | ทำที่ไหน |
|---|---|
| 1. `state` ใช้ครั้งเดียว — ลบก่อนเทียบ | `sso.js` `readCallback()` |
| 2. ลบ fragment ก่อนตรวจอะไรทั้งสิ้น | `sso.js` `clearFragment()` เรียกก่อน validate |
| 3. ห้าม auto-retry เมื่อ callback พลาด | แสดงเหตุผล + ให้กดปุ่มเอง (ธง `iam_sso_tried`) |
| 4. กัน callback ถูกประมวลผลสองครั้ง | ตัวแปร `consumed` |
| 5. อ่าน role claim ได้ทุกรูป | `rolesFromClaims()` — `role` / `roles` / MS-namespaced, string หรือ array |
| 6. เช็ค `exp` ก่อนเก็บ | `readCallback()` |
| 7. fragment ให้มาแค่ตัวตน | โปรไฟล์ดึงจาก `/api/auth/sso/session` และ degrade ได้ถ้าพลาด |
| 8. ออกจากระบบ: ล้างของเราก่อน แล้วค่อย IAM | `auth.js` `doLogout()` |

เพิ่มเติมจากที่ skill ระบุ:

- **กด "ออกจากระบบ" แล้วต้องไม่ถูกพาเข้า SSO เองทันที** — ตอนแรกทำแล้วเจอปัญหานี้จริง
  (ล้าง session → หน้า login พาเข้า IAM ต่อ → ผู้ใช้เลือกฟอร์มรหัสผ่านไม่ได้)
  แก้โดยตั้งธง `iam_sso_tried` ตอน logout ไม่ใช่ล้างมัน
- **โหมด embed ไม่พาไปหน้า IAM เอง** — เราอยู่ใน iframe ของระบบอื่น หน้า login ของ IAM
  อาจถูกกันไม่ให้แสดงใน iframe (`X-Frame-Options`) ซึ่งจะทำให้ผู้ใช้ค้างหน้าว่าง
  ในโหมดนี้จึงให้กดปุ่มเองเท่านั้น และตอน logout ก็ไม่ไปแตะ session ของ IAM
- **ตัดฟิลด์อ่อนไหวก่อนส่งออก** — `hrPassword`, `birthdayDate` (= รหัสผ่านเข้าระบบของพนักงาน),
  `aspNetUsersId`, `aspNetUsersEmail` ถูกลบใน `stripSensitive()` ทุกเส้นทางที่คืนโปรไฟล์

---

## ทดสอบในเครื่องโดยไม่ยิงไปที่ IAM จริง

มี stub ที่ทำ `/api/sso/authorize`, `/api/sso/logout`, `/api/User/Profile`, `/api/User/Login`
ตามสัญญาของ skill (รวมทั้งการปฏิเสธ origin ที่ไม่ได้ลงทะเบียน)

```bash
node scripts/dev/iam-stub.mjs
```

แล้วสตาร์ตระบบชี้ไปที่ stub

```bash
PORT=3092 IAM_SSO_ENABLED=1 IAM_BASE_URL=http://localhost:4099 \
  IAM_JWT_SECRET=stub_shared_secret IAM_JWT_ISSUER=stub-iam IAM_JWT_AUDIENCE=inboxcenter \
  npm start
```

- `GET http://localhost:4099/stub/session?alive=1` = เลียนแบบว่า "SSO ที่ระบบอื่นไว้แล้ว"
- `GET http://localhost:4099/stub/session?alive=0` = ยังไม่เคย login → stub แสดงหน้า login
- `GET http://localhost:4099/stub/mint` = ขอ token แบบถูกต้อง / หมดอายุ / ลายเซ็นผิด มาทดสอบ 401
