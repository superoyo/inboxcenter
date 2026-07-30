// ตั้งค่ารายเพจในเมนู Admin — แพ็กเกจ / วันเริ่มดูแล / ทีม / character / คู่แข่ง
import type { PageConfig, TeamMember } from '@inboxcenter/shared';
import { repository } from '../repositories';
import type { PageConfigMapStored } from '../repositories';

const LIMITS = {
  packageImage: 4_000_000, // data URL ของรูป (จำกัด ~4MB)
  startDate: 20,
  character: 3_000,
  memberName: 60,
  empCode: 30,
  teamSize: 30,
  competitorName: 100,
  competitorUrl: 300,
  competitors: 30,
} as const;

/** สมาชิกทีมเก็บเป็น { empCode, name } — รองรับข้อมูลเก่าที่เป็น string (แปลงให้เลย) */
function cleanTeam(arr: unknown): TeamMember[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((m): TeamMember | null => {
      if (typeof m === 'string') {
        const name = m.trim().slice(0, LIMITS.memberName);
        return name ? { empCode: '', name } : null;
      }
      if (m && typeof m === 'object') {
        const rec = m as Record<string, unknown>;
        const name = String(rec.name || '')
          .trim()
          .slice(0, LIMITS.memberName);
        const empCode = String(rec.empCode || '')
          .trim()
          .slice(0, LIMITS.empCode);
        return name ? { empCode, name } : null;
      }
      return null;
    })
    .filter((m): m is TeamMember => m !== null)
    .slice(0, LIMITS.teamSize);
}

/** คู่แข่ง: เก็บเฉพาะแถวที่มีชื่อหรือ URL อย่างใดอย่างหนึ่ง */
function cleanCompetitors(arr: unknown): PageConfig['competitors'] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      if (!x || typeof x !== 'object') return null;
      const rec = x as Record<string, unknown>;
      const name = String(rec.name || '')
        .trim()
        .slice(0, LIMITS.competitorName);
      const url = String(rec.url || '')
        .trim()
        .slice(0, LIMITS.competitorUrl);
      return name || url ? { name, url } : null;
    })
    .filter((x): x is { name: string; url: string } => x !== null)
    .slice(0, LIMITS.competitors);
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** ทำความสะอาด input ที่ส่งมาจากหน้า Admin ให้อยู่ในรูปแบบและขนาดที่ยอมรับ */
export function sanitizePageConfig(body: unknown): PageConfig {
  const b = (body ?? {}) as Record<string, unknown>;
  const teams = (b.teams ?? {}) as Record<string, unknown>;
  return {
    packageImage: str(b.packageImage, LIMITS.packageImage),
    startDate: str(b.startDate, LIMITS.startDate),
    character: typeof b.character === 'string' ? b.character.trim().slice(0, LIMITS.character) : '',
    competitors: cleanCompetitors(b.competitors),
    teams: {
      content: cleanTeam(teams.content),
      graphic: cleanTeam(teams.graphic),
      chatInbox: cleanTeam(teams.chatInbox),
      am: cleanTeam(teams.am),
    },
  };
}

export async function listPageConfigs(): Promise<PageConfigMapStored> {
  return repository.getPageConfigs();
}

export async function setPageConfig(pageId: string, body: unknown): Promise<PageConfig> {
  const config = sanitizePageConfig(body);
  await repository.setPageConfig(pageId, config);
  return config;
}
