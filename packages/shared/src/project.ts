/** โปรเจกต์ = กลุ่มเพจ ใช้ scope ทุกหน้าในแอป (?project=) */
export interface Project {
  id: string;
  name: string;
  description: string;
  pageIds: string[];
  createdAt: string;
}

export interface ProjectInput {
  name: string;
  description?: string;
  pageIds?: string[];
}

/**
 * บริบทที่ทุกหน้าใช้ร่วมกัน — เดิมอยู่ใน public/project.js
 * มาจาก query string: ?project= &page= &embed=1 &only=thread &sel=
 */
export interface AppScope {
  /** id โปรเจกต์ที่เปิดอยู่ ('' = ไม่ระบุ = ทุกเพจ) */
  projectId: string;
  /** เพจที่ถูกล็อกจากภายนอก — รับหลายค่าคั่น comma; ค่าเดียว = ซ่อน UI เลือกเพจ */
  lockedPageIds: string[];
  /** ?embed=1 — ซ่อน navbar/subnav ใช้พื้นที่เต็มจอ (ระบบอื่นฝัง iframe) */
  embed: boolean;
  /** ?only=thread — แสดงแต่หน้าต่างแชท */
  onlyThread: boolean;
  /** ?sel= — เพจที่ผู้ใช้เลือกอยู่ จำไว้ข้ามแท็บ */
  selectedPageId: string;
}
