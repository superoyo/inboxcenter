// SHIM ระหว่างเปลี่ยนผ่าน — การเลือก backend ย้ายไปที่
//   apps/api/src/repositories/index.ts (บังคับ interface ตรงกันด้วย StorageRepository)
// ไฟล์นี้คงไว้เพื่อให้ server.js (CommonJS) เรียกได้เหมือนเดิม จะลบตอนเฟส 2
module.exports = require('../apps/api/dist/repositories/index.js').repository;
