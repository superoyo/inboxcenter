// สคริปต์บริบทโปรเจกต์/เพจ — โหลดหลัง auth.js ในหน้า Inbox/Content/Analytics/Report/Admin
// (1) อ่าน project id (?project=) และเพจที่ล็อก (?page=) จาก URL
// (2) auto-append ?project / ?pageId ให้ทุก fetch /api อัตโนมัติ
// (3) พาพารามิเตอร์ (project/page/embed) ไปกับลิงก์เมนู
// (4) แสดงชื่อโปรเจกต์ + ปุ่มกลับหน้าโปรเจกต์บน navbar
//
// โหมดล็อกเพจเดียว (?page=PAGE_ID): ใช้ตอนระบบอื่นฝังแบบ "เชื่อมทีละเพจ" เช่น
// /index.html?embed=1&page=123456 → ทุก API ถูก scope เป็นเพจนั้นเพจเดียว
// (/api/pages ก็คืนเพจเดียว → รายการเพจ/dropdown ทุกหน้าเหลือเพจเดียวโดยอัตโนมัติ)
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const pid = params.get('project') || '';
  const lockedPage = params.get('page') || '';
  const isEmbed = params.get('embed') === '1';
  window.ActiveProjectId = pid;
  window.LockedPageId = lockedPage;

  // ---------- เพจที่เลือกอยู่ (ใช้ร่วมกันทุกแท็บ) ----------
  // เดิมแต่ละหน้าเก็บเพจที่เลือกไว้ในตัวเอง สลับแท็บแล้วต้องเลือกใหม่ทุกครั้ง
  // (Content/Report เด้งไปเพจแรก, Inbox/Analytics เด้งกลับ "ทุกเพจ")
  // จึงเก็บไว้ที่เดียวต่อโปรเจกต์ แล้วพาไปกับลิงก์แท็บด้วย (?sel=) เพื่อให้ก๊อป URL ส่งต่อได้
  const SEL_KEY = 'ic_sel_page:' + (pid || 'all');
  const readSel = () => {
    try { return sessionStorage.getItem(SEL_KEY) || ''; } catch (e) { return ''; }
  };
  const selParam = params.get('sel') || '';
  if (selParam) {
    try { sessionStorage.setItem(SEL_KEY, selParam); } catch (e) { /* โหมดส่วนตัว */ }
  }
  // ล็อกเพจเดียวอยู่แล้ว = เพจนั้นคือเพจที่เลือก ไม่ต้องจำอะไรเพิ่ม
  window.SelectedPageId = lockedPage && !lockedPage.includes(',')
    ? lockedPage
    : (selParam || readSel());

  window.setSelectedPageId = function (id) {
    window.SelectedPageId = id || '';
    try {
      if (id) sessionStorage.setItem(SEL_KEY, id);
      else sessionStorage.removeItem(SEL_KEY);
    } catch (e) { /* โหมดส่วนตัว */ }
    decorateNavLinks();
  };

  const INTERNAL = /^(index|comments|analytics|report|admin)\.html/;

  // พาพารามิเตอร์ไปกับลิงก์แท็บภายใน (ไม่รวม Connect/โปรเจกต์ = ระดับบนสุด)
  // เขียน href ใหม่ทุกครั้งจากค่าล่าสุด ไม่ต่อท้ายทับซ้อน
  function decorateNavLinks() {
    document.querySelectorAll('.navbar a.nav-link').forEach((a) => {
      const base = (a.dataset.base || a.getAttribute('href') || '').split('?')[0];
      if (!INTERNAL.test(base)) return;
      a.dataset.base = base;
      const q = new URLSearchParams();
      if (pid) q.set('project', pid);
      if (lockedPage) q.set('page', lockedPage);
      if (isEmbed) q.set('embed', '1');
      if (window.SelectedPageId && !lockedPage) q.set('sel', window.SelectedPageId);
      const qs = q.toString();
      a.setAttribute('href', qs ? base + '?' + qs : base);
    });
  }
  window.refreshNavLinks = decorateNavLinks;
  document.addEventListener('DOMContentLoaded', decorateNavLinks);

  // ล็อกเพจ "เดียว" เท่านั้นที่ซ่อน UI เลือกเพจ (รายการเพจเหลือเพจเดียว ไม่มีประโยชน์)
  // ถ้าล็อกหลายเพจ (?page=123,456) ต้องคงรายการเพจไว้ให้สลับ/ดูรวมได้
  if (lockedPage && !lockedPage.includes(','))
    document.documentElement.classList.add('locked-page');

  // endpoint ที่ไม่ผูกกับโปรเจกต์/เพจ
  const GLOBAL_API = /\/api\/(projects|auth|config|employees)(\/|$|\?)/;

  if (pid || lockedPage) {
    const _fetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      let url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/api/') && !GLOBAL_API.test(url)) {
        if (pid && !/[?&]project=/.test(url)) {
          url += (url.includes('?') ? '&' : '?') + 'project=' + encodeURIComponent(pid);
        }
        if (lockedPage && !/[?&]pageId=/.test(url)) {
          url += (url.includes('?') ? '&' : '?') + 'pageId=' + encodeURIComponent(lockedPage);
        }
        if (typeof input === 'string') input = url;
        else input = new Request(url, input);
      }
      return _fetch(input, init);
    };

    document.addEventListener('DOMContentLoaded', () => {
      if (pid) renderProjectChip();
    });
  }

  async function renderProjectChip() {
    const logo = document.querySelector('.navbar .logo');
    if (!logo || !pid) return;
    let name = '';
    try {
      const list = await fetch('/api/projects').then((r) => r.json());
      const p = (list || []).find((x) => x.id === pid);
      name = p ? p.name : '';
    } catch { /* เงียบไว้ */ }
    // ปุ่มกลับหน้าโปรเจกต์ + ชื่อโปรเจกต์ ต่อจากโลโก้
    const back = document.createElement('a');
    back.href = 'projects.html';
    back.className = 'proj-back';
    back.innerHTML = '&larr; โปรเจกต์' + (name ? ' <b>· ' + name.replace(/[&<>]/g, '') + '</b>' : '');
    logo.insertAdjacentElement('afterend', back);
  }
})();
