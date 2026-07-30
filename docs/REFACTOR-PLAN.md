# แผน Refactor → Vite + React + TypeScript + Tailwind + shadcn/ui

> เอกสารวางแผน **ยังไม่เขียนโค้ด** — ระบุโครงโฟลเดอร์ที่แนะนำ + ไฟล์เดิมทุกไฟล์ย้ายไปไหน
> สถานะโค้ดตั้งต้น: frontend 6,435 บรรทัด (11 HTML + 3 JS + 1 CSS) · backend 3,177 บรรทัด
> (`server.js` 1,658 + `lib/` 8 ไฟล์) · **53 API endpoints** · 12 ไฟล์ข้อมูลใน `data/`

---

## 0. ข้อจำกัดที่ต้องออกแบบรอบมัน (อ่านก่อน)

ระบบนี้ถูก **Agency Intelligence** reverse proxy แล้วฝังด้วย iframe
(ดู [INBOX-CENTER-INTEGRATION.md](INBOX-CENTER-INTEGRATION.md)) — การ refactor เป็น SPA
จะพัง 3 จุดถ้าไม่จัดการ:

| # | จุดที่พัง | สาเหตุ | ทางแก้ในแผนนี้ |
|---|---|---|---|
| 1 | **asset โหลดไม่ได้** | Vite ผลิต `<script src="/assets/x.js">` (absolute) แต่ฝั่งนั้น proxy แค่ `/inbox/*` และ `/api/*` → `/assets/*` ไม่ถูก proxy | ตั้ง `base: './'` ใน `vite.config.ts` → กลายเป็น `./assets/x.js` ซึ่งเบราว์เซอร์แปลงเป็น `/inbox/assets/x.js` → proxy ผ่าน |
| 2 | **URL เดิมหาย** | เขาฝัง `/inbox/index.html?embed=1&page=xxx` แต่ SPA จะใช้ route `/inbox` | ทำ **legacy URL layer**: Express ตอบ `index.html` ให้ทุก `*.html` เดิม + React Router map `/comments.html` → หน้า Content (รายละเอียดข้อ 4) |
| 3 | **iframe ขึ้นหน้าว่าง** | ถ้าใส่ `helmet()` ตามสูตรมาตรฐาน มันเติม `X-Frame-Options: SAMEORIGIN` ให้เอง | ใช้ `helmet({ frameguard: false, contentSecurityPolicy: false })` — **ห้าม** ปล่อย default |

เพิ่มเติมที่ต้องคงไว้:
- **prefix `/api` ห้ามย้าย** — API versioning ทำเป็น `/api/v1/*` ได้ (ยังอยู่ใต้ `/api`) แต่ต้อง
  คง `/api/*` เดิมไว้ระหว่างเปลี่ยนผ่าน และ**แจ้งฝั่ง Agency Intelligence ก่อน** ตัดของเก่า
- **query params ทั้งหมดต้องทำงานเหมือนเดิม**: `?embed=1` `?page=` (รับหลายค่าคั่น comma)
  `?project=` `?sel=` `?only=thread`
- `<span data-global-menu>` + `<script src="https://agencyitelligence.../global-menu.js">`
  ต้องคงอยู่ใน shell ของ React
- `data/*.json` ต้องอยู่ที่เดิมเชิงตรรกะ (ไม่ทำ migration ข้อมูล)

---

## 1. โครงโฟลเดอร์ที่แนะนำ (monorepo, npm workspaces)

```
inboxcenter/
├── package.json                     # workspaces + สคริปต์รวม (dev / build / start)
├── tsconfig.base.json               # path aliases ที่ใช้ร่วมกัน
├── .env.example
├── .eslintrc.cjs  .prettierrc  .editorconfig
├── data/                            # ⚠️ คงที่เดิม — storage ไฟล์ JSON (ไม่ย้าย)
├── docs/                            # คงที่เดิม
├── examples/                        # คงที่เดิม
│
├── packages/
│   └── shared/                      # type ที่ api ↔ web ใช้ร่วมกัน (source of truth)
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── conversation.ts      # Conversation, Message, Forward
│           ├── page.ts              # Page (fb + line), PageConfig, Team
│           ├── project.ts
│           ├── competitor.ts        # Competitor, CompetitorPost, SyncRun
│           ├── analytics.ts
│           └── api.ts               # envelope: ApiResponse<T>, ApiError
│
├── apps/
│   ├── api/                         # ===== Express (MVC) =====
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── server.ts            # bootstrap เท่านั้น (listen, graceful shutdown)
│   │       ├── app.ts               # ประกอบ express app (middleware order สำคัญ)
│   │       │
│   │       ├── config/
│   │       │   ├── env.ts           # อ่าน+validate env ด้วย zod, export typed config
│   │       │   ├── logger.ts        # pino (+ pino-http)
│   │       │   ├── storage.ts       # เลือก backend: DATABASE_URL ? pg : file
│   │       │   └── constants.ts     # SYNC_OVERLAP_MS, DEFAULT_SYNC_MINUTES, RANGES
│   │       │
│   │       ├── routes/
│   │       │   ├── index.ts         # mount /api/v1 + legacy alias /api
│   │       │   ├── legacy.routes.ts # ⚠️ alias /api/* → v1 (ช่วงเปลี่ยนผ่าน)
│   │       │   ├── spa.routes.ts    # ⚠️ ตอบ index.html ให้ *.html เดิม + SPA fallback
│   │       │   └── v1/
│   │       │       ├── index.ts
│   │       │       ├── auth.routes.ts
│   │       │       ├── employees.routes.ts
│   │       │       ├── config.routes.ts
│   │       │       ├── pages.routes.ts
│   │       │       ├── page-config.routes.ts
│   │       │       ├── projects.routes.ts
│   │       │       ├── conversations.routes.ts
│   │       │       ├── saved-replies.routes.ts
│   │       │       ├── sync.routes.ts
│   │       │       ├── analytics.routes.ts
│   │       │       ├── reports.routes.ts
│   │       │       ├── posts.routes.ts
│   │       │       ├── comments.routes.ts
│   │       │       ├── competitors.routes.ts
│   │       │       ├── connections.routes.ts
│   │       │       └── webhooks.routes.ts   # LINE webhook (ไม่ผ่าน requireAuth)
│   │       │
│   │       ├── controllers/         # อ่าน req → เรียก service → ส่ง res (ไม่มี business logic)
│   │       │   ├── auth.controller.ts
│   │       │   ├── pages.controller.ts
│   │       │   ├── page-config.controller.ts
│   │       │   ├── projects.controller.ts
│   │       │   ├── conversations.controller.ts
│   │       │   ├── saved-replies.controller.ts
│   │       │   ├── sync.controller.ts
│   │       │   ├── analytics.controller.ts
│   │       │   ├── reports.controller.ts
│   │       │   ├── posts.controller.ts
│   │       │   ├── comments.controller.ts
│   │       │   ├── competitors.controller.ts
│   │       │   ├── connections.controller.ts
│   │       │   └── webhooks.controller.ts
│   │       │
│   │       ├── services/            # business logic ทั้งหมดอยู่ที่นี่
│   │       │   ├── auth.service.ts
│   │       │   ├── employees.service.ts      # + cache 10 นาที
│   │       │   ├── pages.service.ts
│   │       │   ├── page-config.service.ts
│   │       │   ├── projects.service.ts       # projectPageIds()
│   │       │   ├── conversations.service.ts  # toSummary, matchesQuery, filter
│   │       │   ├── forwards.service.ts       # ⚠️ แยกจาก messages เด็ดขาด
│   │       │   ├── reply.service.ts          # route fb vs line
│   │       │   ├── sync.service.ts           # syncPage, syncAllPages, scheduler
│   │       │   ├── analytics.service.ts
│   │       │   ├── reports.service.ts
│   │       │   ├── competitors.service.ts    # missingRanges (ดึงเฉพาะส่วนเพิ่ม)
│   │       │   ├── line.service.ts           # handleLineEvent, profile cache
│   │       │   ├── urgency.service.ts
│   │       │   └── keywords.service.ts
│   │       │
│   │       ├── repositories/        # ชั้นเข้าถึงข้อมูล — interface เดียว 2 implementation
│   │       │   ├── index.ts         # factory ตาม config/storage.ts
│   │       │   ├── types.ts         # StorageRepository interface (สัญญาที่ 2 ฝั่งต้องตรงกัน)
│   │       │   ├── file/
│   │       │   │   ├── index.ts
│   │       │   │   ├── json-file.ts          # readJson/writeJson
│   │       │   │   ├── pages.repository.ts
│   │       │   │   ├── conversations.repository.ts
│   │       │   │   ├── projects.repository.ts
│   │       │   │   ├── page-config.repository.ts
│   │       │   │   ├── forwards.repository.ts
│   │       │   │   ├── competitors.repository.ts
│   │       │   │   ├── saved-replies.repository.ts
│   │       │   │   ├── annotations.repository.ts  # tags/remarks/statuses
│   │       │   │   ├── sync-history.repository.ts
│   │       │   │   ├── settings.repository.ts
│   │       │   │   └── profile-pics.repository.ts
│   │       │   └── postgres/
│   │       │       ├── index.ts
│   │       │       ├── pool.ts
│   │       │       ├── migrations/            # แยก DDL ออกจาก init()
│   │       │       │   └── 001_init.sql
│   │       │       └── *.repository.ts        # ไฟล์ชุดเดียวกับ file/
│   │       │
│   │       ├── integrations/        # เรียกระบบภายนอก (I/O เท่านั้น ไม่มี business logic)
│   │       │   ├── facebook/
│   │       │   │   ├── client.ts    # graphFetch + error mapping
│   │       │   │   ├── pages.ts     # getPageInfo, getUserPages, exchangeLongLivedToken
│   │       │   │   ├── conversations.ts  # getConversations, normalizeConversation, sendMessage
│   │       │   │   ├── posts.ts     # getPosts, getPostsSince, getPostInsights, mapPost
│   │       │   │   ├── comments.ts  # getComments, replyComment
│   │       │   │   └── profile-pics.ts
│   │       │   ├── line/
│   │       │   │   ├── client.ts
│   │       │   │   ├── messaging.ts # getBotInfo, getProfile, pushMessage
│   │       │   │   └── signature.ts # verifySignature (HMAC)
│   │       │   ├── apify/
│   │       │   │   ├── client.ts    # run actor + poll + dataset
│   │       │   │   ├── facebook-posts.ts  # fetchPagePosts
│   │       │   │   └── normalize.ts  # normalizePost, firstImage (media array/object)
│   │       │   └── wazzup/
│   │       │       └── client.ts    # login, profile, EmployeeAll
│   │       │
│   │       ├── middleware/
│   │       │   ├── require-auth.ts  # JWT exp check + exempt paths
│   │       │   ├── validate.ts      # zod → 400 พร้อมรายละเอียด
│   │       │   ├── error-handler.ts # ตัวสุดท้าย — แปลง AppError → response
│   │       │   ├── not-found.ts
│   │       │   ├── request-logger.ts
│   │       │   └── raw-body.ts      # เก็บ rawBody เฉพาะ LINE webhook
│   │       │
│   │       ├── validators/          # zod schema ต่อ endpoint
│   │       │   ├── pages.schema.ts
│   │       │   ├── conversations.schema.ts
│   │       │   ├── projects.schema.ts
│   │       │   ├── page-config.schema.ts
│   │       │   ├── competitors.schema.ts
│   │       │   ├── connections.schema.ts
│   │       │   └── common.schema.ts # pagination, tz, dateRange, project/pageId
│   │       │
│   │       ├── utils/
│   │       │   ├── app-error.ts     # AppError(status, message, code)
│   │       │   ├── async-handler.ts # ครอบ async controller ส่ง error เข้า next()
│   │       │   ├── date.ts          # dayKeyFactory, monthStart/End, addDays
│   │       │   └── jwt.ts           # decodeJwtExp
│   │       │
│   │       └── types/
│   │           └── express.d.ts     # req.rawBody, req.user
│   │
│   └── web/                         # ===== Vite + React + TS =====
│       ├── package.json
│       ├── vite.config.ts           # ⚠️ base: './' + proxy /api → :3000
│       ├── tsconfig.json            # path aliases
│       ├── tailwind.config.ts
│       ├── postcss.config.js
│       ├── components.json          # shadcn/ui config
│       ├── index.html               # shell (มี data-global-menu + global-menu.js)
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── vite-env.d.ts
│           │
│           ├── app/                 # การต่อสายระดับแอป
│           │   ├── providers.tsx    # Redux + QueryClient + Router + Toaster
│           │   ├── store.ts         # Redux Toolkit configureStore
│           │   └── slices/
│           │       ├── auth.slice.ts       # session, user (global)
│           │       └── scope.slice.ts      # project/page/embed/only (global)
│           │
│           ├── router/
│           │   ├── index.tsx        # createBrowserRouter + basename แบบ dynamic
│           │   ├── routes.tsx       # route tree
│           │   ├── legacy-routes.tsx # ⚠️ map /comments.html → /content ฯลฯ
│           │   └── guards.tsx       # RequireAuth
│           │
│           ├── features/            # feature-based (แต่ละ feature อยู่ครบในตัว)
│           │   ├── auth/
│           │   │   ├── api/auth.api.ts
│           │   │   ├── hooks/useLogin.ts
│           │   │   ├── pages/LoginPage.tsx
│           │   │   └── components/UserMenu.tsx
│           │   ├── projects/
│           │   │   ├── api/  hooks/  types.ts
│           │   │   ├── pages/ProjectsPage.tsx
│           │   │   └── components/{ProjectCard,ProjectDialog,PageDnd,PageGroupList}.tsx
│           │   ├── inbox/
│           │   │   ├── api/  hooks/  stores/  types.ts
│           │   │   ├── pages/InboxPage.tsx
│           │   │   └── components/{PageSidebar,InboxCalendar,ConversationList,
│           │   │       ConversationRow,ThreadPanel,MessageBubble,ForwardBubble,
│           │   │       ReplyBar,CustomerStatsPanel,StatusPicker,TagEditor,
│           │   │       SavedRepliesPanel,ForwardPanel,ListTabs}.tsx
│           │   ├── content/
│           │   │   ├── api/  hooks/  types.ts
│           │   │   ├── pages/ContentPage.tsx
│           │   │   └── components/{PostCalendar,PostCell,PostDetailPanel,
│           │   │       CommentList,CommentItem,InsightsGrid,ExportCsvButton}.tsx
│           │   ├── analytics/
│           │   │   ├── api/  hooks/  types.ts
│           │   │   ├── pages/AnalyticsPage.tsx
│           │   │   └── components/{ScopePicker,DateRangePicker,KpiCards,Sparkline,
│           │   │       PerPageTable,WaitingPanel,KeywordCloud}.tsx
│           │   ├── report/
│           │   │   ├── api/  hooks/  types.ts
│           │   │   ├── pages/ReportPage.tsx
│           │   │   └── components/{ReportCard,ExportButtons,RangePresets}.tsx
│           │   ├── admin/
│           │   │   ├── api/  hooks/  types.ts
│           │   │   ├── pages/AdminPage.tsx
│           │   │   └── components/{PageConfigCard,PackageImageUpload,TeamPicker,
│           │   │       EmployeeSearch,CharacterField,CompetitorRows}.tsx
│           │   ├── competitor/
│           │   │   ├── api/  hooks/  types.ts
│           │   │   ├── pages/{CompetitorListPage,CompetitorDetailPage}.tsx
│           │   │   └── components/{CompetitorRow,AddCompetitorForm,
│           │   │       ContentCalendar,PostDetail,SyncRangeSelect,SyncHistoryDialog}.tsx
│           │   ├── connect/
│           │   │   ├── api/  hooks/  types.ts
│           │   │   ├── pages/ConnectPage.tsx
│           │   │   └── components/{ChannelTabs,FacebookConnect,PageSelectList,
│           │   │       LineConnect,LineConnectionList,ComingSoonPanel}.tsx
│           │   └── sync/            # ใช้ร่วมหลายหน้า
│           │       ├── api/  hooks/
│           │       └── components/{SyncHistoryDialog,SyncStatusLabel,SyncNowButton}.tsx
│           │
│           ├── components/
│           │   ├── ui/              # shadcn/ui (button, dialog, select, input, ...)
│           │   └── layout/
│           │       ├── AppShell.tsx        # navbar + subnav + outlet
│           │       ├── Navbar.tsx          # logo, Competitor, Connect, UserMenu
│           │       ├── Subnav.tsx          # Inbox/Content/Analytics/Report/Admin
│           │       ├── GlobalMenuSlot.tsx  # <span data-global-menu>
│           │       └── ProjectChip.tsx
│           │
│           ├── hooks/
│           │   ├── useAppScope.ts    # อ่าน/เขียน project·page·embed·only·sel
│           │   ├── useScopedLink.ts  # สร้าง href ที่พา param ไปด้วย
│           │   ├── useToast.ts
│           │   └── useDebounce.ts
│           │
│           ├── lib/
│           │   ├── api-client.ts     # axios instance + interceptors (Bearer, 401, scope)
│           │   ├── query-client.ts   # TanStack Query defaults
│           │   ├── query-keys.ts
│           │   ├── csv.ts            # export CSV + BOM
│           │   ├── date.ts           # dayKey, fmtTime, fmtDur (th-TH)
│           │   ├── avatar.ts         # avatarColor, initials
│           │   ├── platform.ts       # platformIcon (fb/line)
│           │   └── utils.ts          # cn()
│           │
│           ├── stores/               # zustand — UI state ชั่วคราวที่ไม่ต้อง global
│           │   ├── useThreadStore.ts
│           │   ├── usePanelStore.ts  # panel ไหนเปิดอยู่
│           │   └── useCalendarStore.ts
│           │
│           ├── types/
│           │   └── index.ts          # re-export จาก @inboxcenter/shared
│           │
│           └── styles/
│               └── globals.css       # @tailwind + CSS variables (theme tokens)
```

### Path aliases (`tsconfig.base.json`)

```
@/*          → apps/web/src/*
@features/*  → apps/web/src/features/*
@components/*→ apps/web/src/components/*
@lib/*       → apps/web/src/lib/*
@hooks/*     → apps/web/src/hooks/*
@app/*       → apps/web/src/app/*
@shared/*    → packages/shared/src/*
```
ฝั่ง api: `@config/* @routes/* @controllers/* @services/* @repositories/* @integrations/* @middleware/* @utils/*`

---

## 2. ไฟล์เดิมทุกไฟล์ → ย้ายไปไหน

### 2.1 Frontend (14 ไฟล์ · 6,435 บรรทัด)

| ไฟล์เดิม | บรรทัด | ย้ายไปเป็น | หมายเหตุ |
|---|---|---|---|
| `public/index.html` | 1,451 | `features/inbox/**` → `pages/InboxPage.tsx` + ~13 component | ไฟล์ใหญ่สุด: รายการห้อง, thread, สถิติลูกค้า, forward, saved replies, sync panel, ปฏิทิน, แท็บ all/forwarded |
| `public/analytics.html` | 1,067 | `features/analytics/**` | KPI, sparkline, ตารางรายเพจ, waiting panel, keyword |
| `public/style.css` | 974 | `styles/globals.css` (CSS variables) + `tailwind.config.ts` (theme) + `components/ui/*` | คลาสส่วนใหญ่ถูกแทนด้วย Tailwind/shadcn — คง CSS var เดิมเป็น token |
| `public/comments.html` | 599 | `features/content/**` | ปฏิทินโพสต์ + คอมเมนต์ + insights + CSV |
| `public/connect.html` | 476 | `features/connect/**` | 6 แท็บช่องทาง + FB token flow + LINE + ประวัติดึง |
| `public/admin.html` | 383 | `features/admin/**` | ตั้งค่ารายเพจ: แพ็กเกจ/วันเริ่ม/ทีม/character/คู่แข่ง |
| `public/projects.html` | 310 | `features/projects/**` | การ์ดโปรเจกต์ + modal drag&drop + กระดิ่ง |
| `public/report.html` | 281 | `features/report/**` | 3 การ์ด + export + ช่วงเวลากำหนดเอง |
| `public/competitor.html` | 279 | `features/competitor/pages/CompetitorDetailPage.tsx` + components | ปฏิทินคอนเทนต์คู่แข่ง |
| `public/competitors.html` | 140 | `features/competitor/pages/CompetitorListPage.tsx` | รายการ + เพิ่มด้วย URL |
| `public/login.html` | 133 | `features/auth/pages/LoginPage.tsx` | |
| `public/project.js` | 117 | `app/slices/scope.slice.ts` + `hooks/useAppScope.ts` + `hooks/useScopedLink.ts` + interceptor ใน `lib/api-client.ts` | **แกนสำคัญ** — ปัจจุบันทำงานด้วยการ monkey-patch `window.fetch`; ต้องย้ายมาเป็น axios interceptor ที่เติม `project`/`pageId` และ Router ที่พา param ไปกับลิงก์ |
| `public/history.js` | 116 | `features/sync/components/SyncHistoryDialog.tsx` | เดิม inject DOM+CSS เอง → เป็น shadcn `Dialog` |
| `public/auth.js` | 109 | `app/slices/auth.slice.ts` + `lib/api-client.ts` (Bearer + 401) + `router/guards.tsx` + `components/layout/UserMenu.tsx` + `html.embed` → `useAppScope` | เดิมเป็น gate ก่อน render + wrap fetch |

### 2.2 Backend — `server.js` (1,658 บรรทัด · 53 endpoints) แตกเป็น

| กลุ่ม endpoint | routes | controller | service |
|---|---|---|---|
| `POST /api/auth/login`, `GET /api/auth/profile` | `auth.routes.ts` | `auth.controller` | `auth.service` + `integrations/wazzup` |
| `GET /api/employees` | `employees.routes.ts` | `auth.controller` | `employees.service` (cache 10 นาที) |
| `GET /api/config` | `config.routes.ts` | — | `config/env.ts` |
| `GET/POST /api/pages`, `from-user-token`, `DELETE /api/pages/:id` | `pages.routes.ts` | `pages.controller` | `pages.service` + `integrations/facebook/pages` |
| `GET /api/page-config`, `PUT /api/pages/:id/config` | `page-config.routes.ts` | `page-config.controller` | `page-config.service` |
| `GET/POST/PUT/DELETE /api/projects` | `projects.routes.ts` | `projects.controller` | `projects.service` |
| `GET /api/conversations`, `/calendar`, `/:id/thread`, `/messages` | `conversations.routes.ts` | `conversations.controller` | `conversations.service` |
| `PUT /:convId/{status,remark,tags}`, `POST /:convId/reply`, `POST /:convId/forward` | `conversations.routes.ts` | `conversations.controller` | `reply.service`, `forwards.service` |
| `GET/POST/PUT/DELETE /api/pages/:pageId/saved-replies` | `saved-replies.routes.ts` | `saved-replies.controller` | `saved-replies.service` |
| `GET /api/sync-status`, `/sync-history`, `settings/sync-interval`, `POST /api/pages/:id/sync`, `/api/sync-all` | `sync.routes.ts` | `sync.controller` | `sync.service` (+ scheduler) |
| `GET /api/analytics`, `/api/keyword-rooms` | `analytics.routes.ts` | `analytics.controller` | `analytics.service` + `keywords.service` + `urgency.service` |
| `GET /api/pages/:pageId/report/{posts,comments,inbox}` | `reports.routes.ts` | `reports.controller` | `reports.service` |
| `GET /api/pages/:pageId/posts`, `/api/posts/:postId/insights` | `posts.routes.ts` | `posts.controller` | `integrations/facebook/posts` |
| `GET /api/posts/:postId/comments`, `POST /api/comments/:commentId/reply` | `comments.routes.ts` | `comments.controller` | `integrations/facebook/comments` |
| `GET/POST/DELETE /api/competitors*`, `/sync`, `/sync-history` | `competitors.routes.ts` | `competitors.controller` | `competitors.service` + `integrations/apify` |
| `GET/POST/DELETE /api/connections/line` | `connections.routes.ts` | `connections.controller` | `line.service` |
| `POST /api/line/webhook/:channelId` | `webhooks.routes.ts` | `webhooks.controller` | `line.service` (⚠️ ยกเว้น auth, ต้องมี rawBody) |
| `GET /` | `spa.routes.ts` | — | ตอบ SPA |

ส่วนที่ไม่ใช่ endpoint ใน `server.js`:

| โค้ดเดิม | ย้ายไป |
|---|---|
| `requireAuth`, `AUTH_PUBLIC_PATHS`, `decodeJwtExp` | `middleware/require-auth.ts` + `utils/jwt.ts` |
| `express.json({ verify })` เก็บ rawBody | `middleware/raw-body.ts` |
| `toSummary`, `matchesQuery`, `lastCustomerText` | `services/conversations.service.ts` |
| `dayKeyFactory`, `localDayKey`, `monthStartKey/monthEndKey` | `utils/date.ts` |
| `projectPageIds` | `services/projects.service.ts` |
| `syncPage`, `syncAllPages`, `syncStatus`, `scheduleAutoRefresh` | `services/sync.service.ts` |
| `missingRanges`, `RANGES`, `competitorSyncing`, `competitorHandle` | `services/competitors.service.ts` |
| `handleLineEvent`, `lineProfile` cache, `linePageId`, `lineWebhookUrl`, `baseUrl` | `services/line.service.ts` |
| `sendErrorMessage` | `integrations/facebook/client.ts` (error mapping) |
| `isBot`/bot detection | `services/analytics.service.ts` |

### 2.3 Backend — `lib/` (8 ไฟล์ · 1,519 บรรทัด)

| ไฟล์เดิม | บรรทัด | ย้ายไป |
|---|---|---|
| `lib/store-pg.js` | 552 | `repositories/postgres/*.repository.ts` + `migrations/001_init.sql` (แยก DDL ออกจาก `init()`) |
| `lib/facebook.js` | 314 | `integrations/facebook/{client,pages,conversations,posts,comments,profile-pics}.ts` |
| `lib/store-file.js` | 309 | `repositories/file/*.repository.ts` + `json-file.ts` |
| `lib/apify.js` | 177 | `integrations/apify/{client,facebook-posts,normalize}.ts` |
| `lib/line.js` | 79 | `integrations/line/{client,messaging,signature}.ts` |
| `lib/keywords.js` | 59 | `services/keywords.service.ts` |
| `lib/urgency.js` | 25 | `services/urgency.service.ts` |
| `lib/store.js` | 4 | `repositories/index.ts` (factory) + `config/storage.ts` |

> ⚠️ `store-file` กับ `store-pg` ต้องมี interface ตรงกันเสมอ — TypeScript จะบังคับให้เองผ่าน
> `repositories/types.ts` (ข้อดีที่ได้ฟรีจากการ refactor นี้: เดิมต้องเทียบ export ด้วยมือ)

### 2.4 ไฟล์/โฟลเดอร์ที่ **ไม่ย้าย**

| รายการ | เหตุผล |
|---|---|
| `data/*.json` (12 ไฟล์) | ข้อมูลจริงที่ใช้งานอยู่ — path อ่านจาก `config/env.ts` (`DATA_DIR`) |
| `docs/**` | เอกสาร (รวมสัญญาการฝัง) |
| `examples/embed-host-demo/**` | ตัวอย่าง proxy ยังใช้ได้เหมือนเดิม |
| `CLAUDE.md` | ต้องอัปเดตเนื้อหาให้ตรงโครงใหม่ แต่อยู่ที่เดิม |
| `.gitignore` | เพิ่ม `dist/`, `node_modules/`, `.env` |

---

## 3. Legacy URL compatibility (จุดที่ทำให้ migration ปลอดภัย)

`routes/spa.routes.ts` ต้องตอบ `index.html` ให้ path เดิมทั้งหมด:

| URL เดิม (ต้องใช้ได้ต่อ) | route ใหม่ใน React Router |
|---|---|
| `/` , `/index.html` | `/` → InboxPage (ถ้าไม่มี project → redirect `/projects`) |
| `/projects.html` | `/projects` |
| `/comments.html` | `/content` |
| `/analytics.html` | `/analytics` |
| `/report.html` | `/report` |
| `/admin.html` | `/admin` |
| `/competitors.html` | `/competitors` |
| `/competitor.html?id=X` | `/competitors/:id` |
| `/connect.html` | `/connect` |
| `/login.html` | `/login` |

วิธี: React Router มี route คู่ (path เดิม + path ใหม่) โดย path เดิมเป็น component เดียวกัน
(ไม่ใช้ redirect เพื่อคง query string และไม่ให้ iframe เปลี่ยน URL) — ตัด path เดิมออกได้
เมื่อฝั่ง Agency Intelligence ยืนยันว่าเปลี่ยนไปใช้ path ใหม่แล้ว

---

## 4. แผนทำแบบ incremental (แต่ละเฟสจบแล้ว deploy ได้ ระบบไม่ล่ม)

| เฟส | ทำอะไร | ผลลัพธ์ที่ตรวจได้ |
|---|---|---|
| **0** | ตั้ง workspace, TS, ESLint/Prettier, `packages/shared` types, CI lint — **ยังไม่แตะโค้ดเดิม** | `npm run lint` ผ่าน, ระบบเดิมยังรันปกติ |
| **1** | Backend: ย้าย `lib/` → `integrations/` + `repositories/` (แปลงเป็น TS) โดย `server.js` ยัง import ตัวเดิมผ่าน shim | 53 endpoints ตอบเหมือนเดิมทุกตัว (มี smoke test) |
| **2** | Backend: แตก `server.js` → app/routes/controllers/services + middleware + error/logging/validation + `/api/v1` (คง `/api/*` alias) | ทดสอบ endpoint คู่ `/api/x` กับ `/api/v1/x` ให้ผลตรงกัน |
| **3** | Frontend: ตั้ง Vite+React+Tailwind+shadcn, AppShell (navbar/subnav), auth + scope + api-client, legacy URL layer | หน้า login + shell ใช้ได้, ยังเสิร์ฟหน้า HTML เดิมสำหรับหน้าที่ไม่ได้ย้าย |
| **4** | ย้ายหน้าเล็กก่อน: `login` → `projects` → `competitors`/`competitor` → `connect` → `admin` | แต่ละหน้าเทียบพฤติกรรมกับของเดิมทีละหน้า |
| **5** | ย้ายหน้าหนัก: `report` → `content` → `analytics` → `inbox` (ใหญ่สุด ทำท้ายสุด) | ครบทุกหน้า → ลบ `public/*.html` เดิม |
| **6** | เก็บกวาด: ลบ shim, ลบ `/api/*` alias (หลังแจ้ง Agency Intelligence), อัปเดต `CLAUDE.md` + docs | เหลือโครงใหม่ล้วน |

**ทดสอบทุกเฟส** (กันของเดิมพัง): เข้า `?embed=1&page=<id>` ในโหมด iframe, ตอบลูกค้า FB + LINE,
LINE webhook ลายเซ็นถูก/ผิด, ส่งต่อเคสแล้วต้องไม่ถึงลูกค้า, ดึงข้อมูลคู่แข่งแบบ incremental

---

## 5. ข้อควรระวังเฉพาะจุด (จากโค้ดจริง)

1. **`requireAuth` ไม่ verify ลายเซ็น JWT** — เช็คแค่ `exp` ตั้งใจไว้แบบนั้น (login ผ่าน Wazzup)
   อย่าเปลี่ยนพฤติกรรมตอน refactor ถ้าไม่ได้ตกลงกันก่อน
2. **LINE webhook ต้องอยู่ก่อน body parser** ในลำดับ middleware และต้องมี `rawBody` สำหรับ HMAC
3. **`express.json({ limit: '6mb' })`** — จำเป็นเพราะรูปแพ็กเกจส่งเป็น data URL
4. **forwards ต้องไม่ merge เข้า messages** — เส้นทางตอบลูกค้าอ่านจาก messages เท่านั้น
5. **`?page=` รับหลายค่าคั่น comma** และซ่อน UI เลือกเพจเฉพาะกรณีค่าเดียว
6. **Facebook/LINE/Apify token ต้องไม่รั่วออก API** — `/api/pages` ตัด `accessToken`,
   `channelSecret` ออก ต้องคงไว้ (ทำเป็น mapper ใน service ชั้นเดียว)
7. **scheduler `setInterval` ของ auto-sync** ต้องรันครั้งเดียว — ระวัง import ซ้ำตอนแยกไฟล์
