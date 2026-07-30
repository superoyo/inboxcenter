import { Router } from 'express';
import { env } from '../../config/env';

export const configRouter = Router();

/** ค่าที่หน้าเว็บต้องรู้ — ไม่เปิดเผย secret (เส้นนี้เข้าได้โดยไม่ต้อง login) */
configRouter.get('/config', (_req, res) => {
  res.json({ longLivedTokens: env.longLivedTokens });
});
