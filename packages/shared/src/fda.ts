// ผลตรวจข้อความโฆษณาอาหารกับระบบ อย. (fdavalidation)
// อ้างอิงประกาศ อย. เรื่อง หลักเกณฑ์การโฆษณาอาหาร พ.ศ. 2569

/** ผลสรุป 4 ระดับที่ระบบ อย. ตอบกลับ */
export type FdaVerdict =
  'no_issue_found' | 'allowed_with_conditions' | 'requires_approval' | 'not_allowed';

export type FdaSeverity = 'critical' | 'high' | 'medium' | 'low';

/** ข้อความที่ขัดต่อข้อห้าม — แก้ไขเท่านั้น ขออนุญาตไม่ได้ */
export interface FdaViolation {
  ruleId: string;
  clause: string;
  title: string;
  severity: FdaSeverity;
  /** คำที่ตรวจพบในข้อความ */
  matched: string[];
  why: string;
  fix: string;
}

/** ข้อความที่ต้องยื่นขออนุญาตโฆษณาก่อนจึงจะใช้ได้ */
export interface FdaApprovalItem {
  clause: string;
  topic: string;
  matched: string[];
  evidence: string;
  condition: string;
}

/** ข้อความที่ใช้ได้ถ้าเข้าเงื่อนไข (ไม่ต้องขออนุญาต) */
export interface FdaConditionalItem {
  type: string;
  clause: string;
  topic: string;
  matched: string[];
  condition: string;
}

export interface FdaRecommendation {
  priority: number;
  title: string;
  detail: string;
}

/** ประเด็นที่ระบบตรวจจากข้อความอย่างเดียวไม่ได้ ต้องคนดูเอง */
export interface FdaManualCheck {
  clause: string;
  title: string;
  note: string;
}

export interface FdaCheckResult {
  verdict: FdaVerdict;
  /** ข้อความสรุปภาษาไทยจากระบบ อย. เช่น "ไม่พบข้อความที่ขัดต่อข้อห้ามที่ตรวจจับได้" */
  verdictLabel: string;
  riskLevel: FdaSeverity;
  /** 0–100 */
  riskScore: number;
  violations: FdaViolation[];
  approvalsRequired: FdaApprovalItem[];
  conditionalItems: FdaConditionalItem[];
  requiredWarnings: string[];
  recommendations: FdaRecommendation[];
  manualChecks: FdaManualCheck[];
  /** ข้อความเดิมที่ครอบส่วนที่ต้องตัดด้วย 【ตัดออก: …】 */
  markedText: string;
  /** ชื่อประกาศที่ใช้ตรวจ (ไว้อ้างอิงท้ายผล) */
  regulationTitle: string;
  checkedAt: string;
}
