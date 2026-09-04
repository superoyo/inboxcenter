import { Router } from 'express';
import { env } from '../../config/env';
import { ssoConfig } from '../../services/sso.service';

export const configRouter = Router();

/** ค่าที่หน้าเว็บต้องรู้ — ไม่เปิดเผย secret (เส้นนี้เข้าได้โดยไม่ต้อง login) */
configRouter.get('/config', (_req, res) => {
  res.json({
    longLivedTokens: env.longLivedTokens,
    fdaVerify: env.fdaReady,
    // หน้า Content ใช้ตัดสินว่าจะอ่านเพจ/คู่แข่งจาก Product Group หรือจากเพจที่เชื่อมไว้
    agencyFeed: env.agencyFeedReady,
    sso: ssoConfig(),
  });
});
