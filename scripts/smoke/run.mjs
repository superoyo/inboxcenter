#!/usr/bin/env node
// Smoke test: ยิงทุก endpoint แล้วเทียบผลกับ baseline ที่บันทึกไว้
// เป้าหมาย: การ refactor ทีละเฟสต้องไม่เปลี่ยนพฤติกรรมของ API
//
//   npm run smoke          → เทียบกับ baseline (ต่างแม้จุดเดียว = fail)
//   npm run smoke:update   → บันทึก baseline ใหม่ (ใช้เฉพาะตอนตั้งใจเปลี่ยน)
//
// ทำงานโดยสลับ data/ เป็น fixture ชั่วคราวแล้วคืนของจริงกลับเสมอ (มี finally)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixtures } from './fixtures.mjs';
import { requests } from './requests.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DATA = path.join(ROOT, 'data');
const STASH = path.join(ROOT, '.data-smoke-stash');
const BASELINE = path.join(HERE, 'baseline.json');
const PORT = Number(process.env.SMOKE_PORT || 3210);
const BASE = `http://127.0.0.1:${PORT}`;
const UPDATE = process.argv.includes('--update');

// token ปลอมที่มี exp ในอนาคต — requireAuth เช็คแค่ exp (ไม่ verify ลายเซ็น)
const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ exp: 4102444800, sub: 'smoke' })}.sig`;

// ฟิลด์ที่คำนวณจาก "เวลาปัจจุบัน" จึงเปลี่ยนทุกครั้งที่รัน — เทียบค่าไม่ได้ ต้องแทนด้วย placeholder
const VOLATILE_KEYS = new Set([
  'waitedMs',
  'waitingMs',
  'waitedSeconds',
  'waitingSeconds',
  'ageMs',
  'elapsedMs',
]);

/** แทนค่าที่เปลี่ยนทุกครั้ง (เวลา/id ที่สุ่ม/พอร์ต) ด้วย placeholder เพื่อให้เทียบได้ */
function normalize(value, key = '') {
  if (VOLATILE_KEYS.has(key) && typeof value === 'number') return '<DURATION>';
  if (Array.isArray(value)) return value.map((v) => normalize(v, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = normalize(value[k], k);
    return out;
  }
  if (typeof value === 'number') {
    // epoch ms ที่โผล่มาในผลลัพธ์
    if (value > 1e12) return '<EPOCH_MS>';
    return value;
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<ISO>')
    // id ที่ generate จาก Date.now() ทุกชนิด: sr_/fw_/crun_/prj_/line_out_ (ต้องมีเลข ≥10 หลัก
    // เพื่อไม่ให้ชนกับ id จริงอย่าง t_smoke_1 หรือ cmp_smokebrand)
    .replace(/\b([a-z][a-z_]*)_\d{10,}(?:_[a-z0-9]+)?\b/g, '$1_<GEN>')
    .replace(/127\.0\.0\.1:\d+/g, '<HOST>')
    .replace(/localhost:\d+/g, '<HOST>')
    // ข้อความจากปลายทางภายนอก (Facebook / LINE / อย.) ขึ้นกับว่าตอนนั้นต่อเน็ตได้ไหม
    // เคยเจอผลสลับระหว่าง "Authentication failed..." กับ "fetch failed" ทำให้เทสไม่นิ่ง
    // ส่วนที่เราคุมคือ "คำนำหน้า + สถานะ" จึงเก็บไว้ แล้วแทนรายละเอียดของปลายทางด้วย placeholder
    .replace(
      /^(เชื่อมต่อ[^:]*ไม่สำเร็จ|ส่งไม่ได้|ดึง[^:]*ไม่สำเร็จ|เข้าสู่ระบบไม่สำเร็จ|โหลด[^:]*ไม่สำเร็จ): .+$/,
      '$1: <UPSTREAM>',
    );
}

async function waitReady(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/config`);
      if (r.ok) return;
    } catch {
      /* ยังไม่ขึ้น */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('เซิร์ฟเวอร์ไม่พร้อมภายในเวลาที่กำหนด');
}

function seedFixtures() {
  if (fs.existsSync(STASH)) fs.rmSync(STASH, { recursive: true, force: true });
  if (fs.existsSync(DATA)) fs.renameSync(DATA, STASH);
  fs.mkdirSync(DATA, { recursive: true });
  for (const [file, content] of Object.entries(fixtures)) {
    fs.writeFileSync(path.join(DATA, file), JSON.stringify(content, null, 2), 'utf8');
  }
}

function restoreData() {
  if (!fs.existsSync(STASH)) return;
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.renameSync(STASH, DATA);
}

async function runAll() {
  const results = {};
  for (const req of requests) {
    const method = req.method || 'GET';
    const headers = { ...(req.headers || {}) };
    if (req.auth !== false) headers.Authorization = `Bearer ${TOKEN}`;
    let body;
    if (req.raw !== undefined) {
      body = req.raw;
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    } else if (req.body !== undefined) {
      body = JSON.stringify(req.body);
      headers['Content-Type'] = 'application/json';
    }
    try {
      const res = await fetch(`${BASE}${req.path}`, { method, headers, body });
      const text = await res.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = `<non-json len=${text.length}>`;
      }
      results[req.name] = { status: res.status, body: normalize(parsed) };
    } catch (err) {
      results[req.name] = { status: 'FETCH_ERROR', body: String(err.message) };
    }
  }
  return results;
}

/**
 * ตรวจ "ผลข้างเคียง" ที่ response ไม่ได้บอก — เช่น LINE webhook ตอบ 200 ทันที
 * แล้วค่อยสร้างห้องแชทเบื้องหลัง ถ้าไม่เช็คตรงนี้ การพังจะไม่ถูกจับ
 */
async function collectSideEffects() {
  await new Promise((r) => setTimeout(r, 1200)); // รอ event ของ webhook ประมวลผลเสร็จ
  const read = (f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
    } catch {
      return null;
    }
  };
  const convs = read('conversations.json') || {};
  const lineRooms = convs['line_smokechan'] || [];
  const fwRoom = (convs['100000000000001'] || []).find((c) => c.id === 't_smoke_1');
  const forwards = (read('forwards.json') || {}).t_smoke_1 || [];

  return {
    'ผลข้างเคียง: webhook สร้างห้องแชท': normalize({
      rooms: lineRooms.length,
      customerId: lineRooms[0]?.customerId ?? null,
      // ข้อความที่ webhook เขียนลงห้อง (พิสูจน์ว่า handleEvent ทำงาน ไม่ใช่แค่ตอบ 200)
      text: lineRooms[0]?.messages?.at(-1)?.text ?? null,
      isFromPage: lineRooms[0]?.messages?.at(-1)?.isFromPage ?? null,
    }),
    'ผลข้างเคียง: ส่งต่อเคสไม่ปนกับข้อความลูกค้า': normalize({
      forwardCount: forwards.length,
      // ข้อความส่งต่อต้องไม่โผล่ใน messages เด็ดขาด (เส้นทางตอบลูกค้าอ่านจาก messages)
      forwardTextLeakedIntoMessages: (fwRoom?.messages ?? []).some((m) =>
        String(m.text || '').includes('ส่งต่อจาก smoke'),
      ),
    }),
  };
}

/** เทียบ 2 object แบบ deep แล้วคืน path ที่ต่างกัน */
function diff(a, b, at = '', out = []) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja === jb) return out;
  const isObj = (v) => v && typeof v === 'object';
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    out.push({ at, expected: a, actual: b });
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    diff(a?.[k], b?.[k], at ? `${at}.${k}` : k, out);
  }
  return out;
}

let server;
try {
  seedFixtures();
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', APIFY_TOKEN: '', APIFY_API_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  server.on('exit', (code) => {
    if (code !== null && code !== 0) console.error('[smoke] เซิร์ฟเวอร์ปิดด้วย code', code, '\n', serverLog);
  });

  await waitReady();
  const actual = { ...(await runAll()), ...(await collectSideEffects()) };

  if (UPDATE || !fs.existsSync(BASELINE)) {
    fs.writeFileSync(BASELINE, JSON.stringify(actual, null, 2) + '\n', 'utf8');
    console.log(`[smoke] บันทึก baseline ${Object.keys(actual).length} รายการ → scripts/smoke/baseline.json`);
  } else {
    const expected = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const names = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const problems = [];
    for (const name of names) {
      const d = diff(expected[name], actual[name]);
      if (d.length) problems.push({ name, d });
    }
    if (problems.length) {
      console.error(`\n❌ ต่างจาก baseline ${problems.length}/${names.size} รายการ:\n`);
      for (const p of problems) {
        console.error(`  ▸ ${p.name}`);
        for (const x of p.d.slice(0, 6)) {
          console.error(
            `      ${x.at || '(root)'}\n        baseline: ${JSON.stringify(x.expected)}\n        ปัจจุบัน : ${JSON.stringify(x.actual)}`,
          );
        }
      }
      process.exitCode = 1;
    } else {
      console.log(`[smoke] ✅ ผ่านทั้งหมด ${names.size} รายการ — พฤติกรรม API ไม่เปลี่ยน`);
    }
  }
} catch (err) {
  console.error('[smoke] ล้มเหลว:', err.message);
  process.exitCode = 1;
} finally {
  if (server) server.kill('SIGTERM');
  restoreData();
}
