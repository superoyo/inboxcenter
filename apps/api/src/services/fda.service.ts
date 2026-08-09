// ตรวจข้อความโฆษณากับระบบ อย. แล้วย่อผลให้เหลือเฉพาะที่หน้าเว็บใช้
// (ผลดิบจาก อย. ราว 8 KB ต่อครั้ง — ตัด regulation/input ที่ซ้ำกับข้อความเดิมออก)
import type {
  FdaApprovalItem,
  FdaCheckResult,
  FdaConditionalItem,
  FdaManualCheck,
  FdaRecommendation,
  FdaSeverity,
  FdaVerdict,
  FdaViolation,
} from '@inboxcenter/shared';
import * as fda from '../integrations/fda/client';
import { AppError } from '../utils/app-error';

const VERDICTS: readonly string[] = [
  'no_issue_found',
  'allowed_with_conditions',
  'requires_approval',
  'not_allowed',
];
const SEVERITIES: readonly string[] = ['critical', 'high', 'medium', 'low'];

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[])
    : [];

const severity = (v: unknown): FdaSeverity =>
  SEVERITIES.includes(str(v)) ? (str(v) as FdaSeverity) : 'low';

export interface CheckTextInput {
  text: unknown;
  productCategory?: string | string[];
  mediaType?: 'print' | 'audio' | 'audiovisual';
  weightControlApproved?: boolean;
}

export async function checkText(input: CheckTextInput): Promise<FdaCheckResult> {
  const text = String(input.text ?? '').trim();
  if (!text) throw AppError.badRequest('ไม่มีข้อความให้ตรวจ');

  const raw = await fda.check({ ...input, text });

  // verdict ที่ไม่รู้จัก → ถือเป็น "ไม่ผ่าน" ไว้ก่อน ปลอดภัยกว่าเดาว่าผ่าน
  const verdict: FdaVerdict = VERDICTS.includes(str(raw.verdict))
    ? (str(raw.verdict) as FdaVerdict)
    : 'not_allowed';

  const violations: FdaViolation[] = rows(raw.violations).map((v) => ({
    ruleId: str(v.ruleId),
    clause: str(v.clause),
    title: str(v.title),
    severity: severity(v.severity),
    matched: strArray(v.matched),
    why: str(v.why),
    fix: str(v.fix),
  }));

  const approvalsRequired: FdaApprovalItem[] = rows(raw.approvalsRequired).map((a) => ({
    clause: str(a.clause),
    topic: str(a.topic),
    matched: strArray(a.matched),
    evidence: str(a.evidence),
    condition: str(a.condition),
  }));

  const conditionalItems: FdaConditionalItem[] = rows(raw.conditionalItems).map((c) => ({
    type: str(c.type),
    clause: str(c.clause),
    topic: str(c.topic),
    matched: strArray(c.matched),
    condition: str(c.condition),
  }));

  const recommendations: FdaRecommendation[] = rows(raw.recommendations).map((r) => ({
    priority: typeof r.priority === 'number' ? r.priority : 9,
    title: str(r.title),
    detail: str(r.detail),
  }));

  const manualChecks: FdaManualCheck[] = rows(raw.manualChecks).map((m) => ({
    clause: str(m.clause),
    title: str(m.title),
    note: str(m.note),
  }));

  return {
    verdict,
    verdictLabel: str(raw.verdictLabel) || 'ตรวจไม่สำเร็จ',
    riskLevel: severity(raw.riskLevel),
    riskScore: typeof raw.riskScore === 'number' ? raw.riskScore : 0,
    violations,
    approvalsRequired,
    conditionalItems,
    requiredWarnings: strArray(raw.requiredWarnings),
    recommendations,
    manualChecks,
    markedText: str(raw.suggestedRewrite?.markedText),
    regulationTitle: str(raw.regulation?.title),
    checkedAt: str(raw.checkedAt) || new Date().toISOString(),
  };
}
