import type { Request, Response } from 'express';
import * as iam from '../integrations/iam';
import * as wazzup from '../integrations/wazzup/client';
import { listEmployees } from '../services/employees.service';
import { sessionFromToken, ssoConfig } from '../services/sso.service';
import { AppError } from '../utils/app-error';

export async function login(req: Request, res: Response): Promise<void> {
  const { authenticationName, authenticationPassword } = (req.body ?? {}) as Record<
    string,
    string | undefined
  >;
  if (!authenticationName || !authenticationPassword) {
    throw AppError.badRequest('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  }
  res.json(await wazzup.login({ authenticationName, authenticationPassword }));
}

export async function profile(req: Request, res: Response): Promise<void> {
  res.json(await wazzup.getProfile(req.headers.authorization || ''));
}

export async function employees(req: Request, res: Response): Promise<void> {
  res.json(await listEmployees(req.headers.authorization || ''));
}

// ---------- IAMService / SSO ----------

/** ค่าที่หน้าเว็บต้องรู้เพื่อเริ่ม flow SSO (เส้นนี้เข้าได้โดยไม่ต้อง login) */
export function ssoStatus(_req: Request, res: Response): void {
  res.json(ssoConfig());
}

/**
 * แลก token ที่ได้จาก fragment ของ SSO เป็นข้อมูลผู้ใช้ + roles
 * ยิงต่อไป IAM จากฝั่ง server จึงไม่ต้องพึ่ง CORS allow-list ของ IAM
 * (requireAuth ตรวจ token ให้แล้ว — ถึงตรงนี้ได้แปลว่า token ยังไม่หมดอายุ)
 */
export async function ssoSession(req: Request, res: Response): Promise<void> {
  const token = req.authToken;
  if (!token) throw AppError.unauthorized();
  res.json(await sessionFromToken(token));
}

/**
 * Operation 1 ของ IAM — login ตรงด้วย userName/password
 * เปิดไว้ให้ย้ายฟอร์มมาใช้ IAM ได้ในอนาคต ตอนนี้ฟอร์มหลักยังยิง /auth/login (Wazzup)
 */
export async function iamLogin(req: Request, res: Response): Promise<void> {
  const { userName, password } = (req.body ?? {}) as Record<string, string | undefined>;
  if (!userName || !password) throw AppError.badRequest('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  res.json(await iam.login({ userName, password }));
}
