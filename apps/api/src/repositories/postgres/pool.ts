// Connection pool ของ PostgreSQL — สร้างครั้งเดียวแบบ lazy
import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // การเชื่อมต่อภายใน Railway (postgres.railway.internal) ไม่ใช้ SSL
      // ถ้าต่อผ่าน public proxy จากนอก Railway ให้ตั้ง DATABASE_SSL=true
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

/** ปิด pool (ใช้ตอน graceful shutdown / เทสต์) */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
