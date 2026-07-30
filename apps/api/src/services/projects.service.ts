// โปรเจกต์ = กลุ่มเพจ ใช้ scope ทุกหน้าในแอป
import type { Project } from '@inboxcenter/shared';
import { repository } from '../repositories';
import { AppError } from '../utils/app-error';

export interface ProjectInput {
  name?: string;
  description?: string;
  pageIds?: string[];
}

const NAME_MAX = 80;
const DESC_MAX = 300;

const uniqueIds = (ids: string[]): string[] => [...new Set(ids.map(String))];

export async function listProjects(): Promise<Project[]> {
  return repository.getProjects();
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const name = String(input.name || '').trim();
  if (!name) throw AppError.badRequest('กรุณาตั้งชื่อโปรเจกต์');
  const project: Project = {
    id: `prj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.slice(0, NAME_MAX),
    description: String(input.description || '')
      .trim()
      .slice(0, DESC_MAX),
    pageIds: Array.isArray(input.pageIds) ? uniqueIds(input.pageIds) : [],
    createdAt: new Date().toISOString(),
  };
  await repository.saveProject(project);
  return project;
}

export async function updateProject(id: string, input: ProjectInput): Promise<Project> {
  const existing = (await repository.getProjects()).find((p) => p.id === id);
  if (!existing) throw AppError.notFound('ไม่พบโปรเจกต์');
  const updated: Project = {
    ...existing,
    name: input.name != null ? String(input.name).trim().slice(0, NAME_MAX) : existing.name,
    description:
      input.description != null
        ? String(input.description).trim().slice(0, DESC_MAX)
        : existing.description,
    pageIds: Array.isArray(input.pageIds) ? uniqueIds(input.pageIds) : existing.pageIds,
  };
  await repository.saveProject(updated);
  return updated;
}

export async function deleteProject(id: string): Promise<void> {
  await repository.deleteProject(id);
}

/**
 * คืน Set ของ pageId ในโปรเจกต์ — null = ไม่ระบุโปรเจกต์ = ทุกเพจ
 * ใช้ scope ผลลัพธ์ของ endpoint ที่รับ ?project=
 */
export async function projectPageIds(projectId?: string | null): Promise<Set<string> | null> {
  if (!projectId) return null;
  const p = (await repository.getProjects()).find((x) => x.id === projectId);
  return new Set(p ? p.pageIds : []);
}
