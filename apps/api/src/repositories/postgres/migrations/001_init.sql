    CREATE TABLE IF NOT EXISTS pages (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL DEFAULT '',
      picture_url   TEXT NOT NULL DEFAULT '',
      access_token  TEXT NOT NULL,
      connected_at  TIMESTAMPTZ,
      last_sync_at  TIMESTAMPTZ
    );
    -- ฟิลด์เสริมสำหรับช่องทางอื่น (LINE ฯลฯ): platform, channelId, channelSecret, basicId
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}';

    CREATE TABLE IF NOT EXISTS conversations (
      id           TEXT PRIMARY KEY,
      page_id      TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      updated_time TIMESTAMPTZ,
      data         JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_page ON conversations(page_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_time DESC);

    CREATE TABLE IF NOT EXISTS profile_pics (
      customer_id TEXT PRIMARY KEY,
      url         TEXT NOT NULL DEFAULT '',
      fetched_at  TIMESTAMPTZ NOT NULL
    );

    -- แท็กเก็บแยกจาก conversations เพราะตารางนั้นถูกลบ-เขียนใหม่ทุกครั้งที่ sync
    CREATE TABLE IF NOT EXISTS conversation_tags (
      conversation_id TEXT PRIMARY KEY,
      tags            JSONB NOT NULL DEFAULT '[]'
    );

    -- โน้ตประจำลูกค้า เก็บแยกเช่นเดียวกับแท็ก
    CREATE TABLE IF NOT EXISTS conversation_remarks (
      conversation_id TEXT PRIMARY KEY,
      remark          TEXT NOT NULL DEFAULT ''
    );

    -- สถานะสี (แดง/เหลือง/เขียว) ที่ผู้ใช้กำหนดเองทับค่าอัตโนมัติ
    CREATE TABLE IF NOT EXISTS conversation_status (
      conversation_id TEXT PRIMARY KEY,
      status          TEXT NOT NULL
    );

    -- ประวัติการดึง inbox รายครั้ง
    CREATE TABLE IF NOT EXISTS sync_runs (
      id         TEXT PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL,
      data       JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_runs_time ON sync_runs(started_at DESC);

    -- การตั้งค่าระบบ (เช่น รอบเวลาดึงอัตโนมัติ)
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );

    -- คำตอบสำเร็จรูป แยกตามเพจ
    CREATE TABLE IF NOT EXISTS saved_replies (
      id         TEXT PRIMARY KEY,
      page_id    TEXT NOT NULL,
      text       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_replies_page ON saved_replies(page_id);
    ALTER TABLE saved_replies ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE saved_replies ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';

    -- โปรเจกต์: กลุ่มเพจ
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      page_ids    JSONB NOT NULL DEFAULT '[]',
      created_at  TIMESTAMPTZ NOT NULL
    );

    -- ตั้งค่ารายเพจ (Admin): แพ็กเกจ/วันเริ่มดูแล/ทีม
    CREATE TABLE IF NOT EXISTS page_config (
      page_id TEXT PRIMARY KEY,
      config  JSONB NOT NULL DEFAULT '{}'
    );

    -- ส่งต่อเคสภายในทีม (เก็บแยกจาก messages — ไม่มีทางส่งถึงลูกค้า)
    CREATE TABLE IF NOT EXISTS conversation_forwards (
      conversation_id TEXT PRIMARY KEY,
      forwards        JSONB NOT NULL DEFAULT '[]'
    );

    -- สถานะเคสที่ทีมกดเอง: ปิดเคส / รอคำตอบ (แยกจาก messages — ลูกค้าไม่เห็น)
    CREATE TABLE IF NOT EXISTS conversation_case_events (
      conversation_id TEXT PRIMARY KEY,
      events          JSONB NOT NULL DEFAULT '[]'
    );

    -- ไฟล์แนบที่ส่งให้ลูกค้า — เก็บตัวไฟล์เองเพราะ Facebook/LINE ต้องได้ URL สาธารณะ
    CREATE TABLE IF NOT EXISTS attachments (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      name            TEXT NOT NULL DEFAULT '',
      mime_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
      size            INTEGER NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      data            BYTEA NOT NULL
    );

    -- เพจคู่แข่ง (ดึงโพสต์ผ่าน Apify)
    CREATE TABLE IF NOT EXISTS competitors (
      id           TEXT PRIMARY KEY,
      url          TEXT NOT NULL,
      handle       TEXT NOT NULL DEFAULT '',
      name         TEXT NOT NULL DEFAULT '',
      picture_url  TEXT NOT NULL DEFAULT '',
      added_at     TIMESTAMPTZ,
      last_sync_at TIMESTAMPTZ,
      covered_from TEXT,
      covered_to   TEXT
    );

    -- โพสต์ของคู่แข่ง — PK คู่ (competitor_id, id) กัน insert ซ้ำ ดึงรอบใหม่จึงเติมเฉพาะที่ยังไม่มี
    CREATE TABLE IF NOT EXISTS competitor_posts (
      competitor_id TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
      id            TEXT NOT NULL,
      post_time     TIMESTAMPTZ,
      data          JSONB NOT NULL,
      PRIMARY KEY (competitor_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_competitor_posts_time ON competitor_posts(competitor_id, post_time DESC);

    -- ประวัติการดึงข้อมูลของคู่แข่ง
    CREATE TABLE IF NOT EXISTS competitor_sync_runs (
      id            TEXT PRIMARY KEY,
      competitor_id TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
      started_at    TIMESTAMPTZ,
      data          JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_competitor_runs ON competitor_sync_runs(competitor_id, started_at DESC);
