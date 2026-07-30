#!/usr/bin/env node
// tsc คอมไพล์แต่ไฟล์ .ts — ไฟล์ประกอบอย่าง .sql ไม่ถูก copy ไป dist ให้
// ถ้าไม่ copy repository ฝั่ง Postgres จะอ่าน migration ไม่เจอตอน init() บน production
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(API_ROOT, 'src');
const DIST = path.join(API_ROOT, 'dist');
const EXTENSIONS = ['.sql'];

let copied = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!EXTENSIONS.includes(path.extname(entry.name))) continue;
    const target = path.join(DIST, path.relative(SRC, full));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(full, target);
    copied++;
  }
}

walk(SRC);
console.log(`[copy-assets] คัดลอกไฟล์ประกอบ ${copied} ไฟล์ (${EXTENSIONS.join(', ')}) → dist`);
