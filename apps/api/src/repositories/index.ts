// เลือก storage backend อัตโนมัติ:
// - มี DATABASE_URL (เช่นบน Railway ที่ผูก PostgreSQL ไว้) → ใช้ Postgres
// - ไม่มี (รันในเครื่อง) → ใช้ไฟล์ JSON ใน data/
//
// ทั้งสอง implementation ถูกบังคับให้มี interface ตรงกันด้วย StorageRepository
import { fileRepository } from './file';
import { postgresRepository } from './postgres';
import type { StorageRepository } from './types';

export const usePostgres = (): boolean => Boolean(process.env.DATABASE_URL);

/** ชื่อ backend ที่ใช้อยู่ — ใช้ log ตอนบูต */
export const storageBackendName = (): string =>
  usePostgres() ? 'PostgreSQL' : 'JSON files (data/)';

export const repository: StorageRepository = usePostgres() ? postgresRepository : fileRepository;

export type { StorageRepository } from './types';
export * from './types';
export default repository;
