// Logging กลาง — pino (JSON บน production, อ่านง่ายตอน dev)
import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  // JSON ล้วนทุก environment — Railway อ่าน JSON ได้เลย และไม่ต้องพึ่ง transport เพิ่ม
  // (transport อย่าง pino-pretty เป็น dependency ที่พังได้ตอน deploy จึงไม่ใช้)
  redact: {
    // กัน token/secret หลุดลง log เด็ดขาด
    paths: [
      'req.headers.authorization',
      'req.headers["x-line-signature"]',
      'accessToken',
      'channelSecret',
      '*.accessToken',
      '*.channelSecret',
    ],
    censor: '[ซ่อนไว้]',
  },
});

export type Logger = typeof logger;
