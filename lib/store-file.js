// SHIM ระหว่างเปลี่ยนผ่าน — โค้ดจริงย้ายไป TypeScript แล้วที่
//   apps/api/src/repositories/file/
// ไฟล์นี้คงไว้เพื่อให้ server.js (CommonJS) เรียกได้เหมือนเดิม จะลบตอนเฟส 2
// ดู docs/REFACTOR-PLAN.md
module.exports = require('../apps/api/dist/repositories/file/index.js').fileRepository;
