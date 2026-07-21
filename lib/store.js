// เลือก storage backend อัตโนมัติ:
// - มี DATABASE_URL (เช่นบน Railway ที่ผูก PostgreSQL ไว้) → ใช้ Postgres
// - ไม่มี (รันในเครื่อง) → ใช้ไฟล์ JSON ใน data/
module.exports = process.env.DATABASE_URL ? require('./store-pg') : require('./store-file');
