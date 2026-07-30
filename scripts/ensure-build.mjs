#!/usr/bin/env node
// กันพลาดตอน deploy: ระหว่างเปลี่ยนผ่าน server.js เรียกโค้ดที่คอมไพล์แล้วใน apps/api/dist
// ผ่าน shim ใน lib/ — ถ้า dist หายไป (build phase ไม่ทำงาน) เซิร์ฟเวอร์จะ crash
// สคริปต์นี้รันเป็น prestart: มี dist แล้วก็ผ่านเลย ไม่มีก็ build ให้ และถ้า build ไม่ได้
// จะแจ้งสาเหตุชัดเจนแทนที่จะเป็น MODULE_NOT_FOUND
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// ไฟล์ตัวแทน — ถ้ามีอันนี้ถือว่า build แล้ว
const MARKER = path.join(ROOT, 'apps/api/dist/services/urgency.service.js');

if (fs.existsSync(MARKER)) process.exit(0);

console.log('[prestart] ไม่พบ apps/api/dist — กำลัง build...');
try {
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
} catch {
  console.error(
    '\n[prestart] build ไม่สำเร็จ — น่าจะเพราะ devDependencies (typescript) ไม่ได้ถูกติดตั้ง\n' +
      '  แก้ได้โดยรัน `npm run build` ตอน build phase (Railway/nixpacks ทำให้อยู่แล้ว)\n' +
      '  หรือติดตั้ง devDependencies ก่อน start\n',
  );
  process.exit(1);
}

if (!fs.existsSync(MARKER)) {
  console.error('[prestart] build ผ่านแต่ยังไม่พบไฟล์ที่คาดไว้:', MARKER);
  process.exit(1);
}
console.log('[prestart] build เรียบร้อย');
