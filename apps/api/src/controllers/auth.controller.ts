import type { Request, Response } from 'express';
import * as wazzup from '../integrations/wazzup/client';
import { listEmployees } from '../services/employees.service';
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
