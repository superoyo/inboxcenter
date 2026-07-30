// อ่าน req → เรียก service → ส่ง res (ไม่มี business logic ในไฟล์นี้)
import type { Request, Response } from 'express';
import * as projects from '../services/projects.service';

export async function list(_req: Request, res: Response): Promise<void> {
  res.json(await projects.listProjects());
}

export async function create(req: Request, res: Response): Promise<void> {
  res.json(await projects.createProject(req.body ?? {}));
}

export async function update(req: Request, res: Response): Promise<void> {
  res.json(await projects.updateProject(String(req.params.id), req.body ?? {}));
}

export async function remove(req: Request, res: Response): Promise<void> {
  await projects.deleteProject(String(req.params.id));
  res.json({ ok: true });
}
