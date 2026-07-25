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

    // พาพารามิเตอร์ไปกับลิงก์เมนูภายใน (ไม่รวม Connect/โปรเจกต์ = ระดับบนสุด)
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('.navbar a.nav-link').forEach((a) => {
        let href = a.getAttribute('href') || '';
        if (!/^(index|comments|analytics|report|admin)\.html/.test(href)) return;
        const add = (k, v) => {
          if (!href.includes(k + '=')) href += (href.includes('?') ? '&' : '?') + k + '=' + encodeURIComponent(v);
        };
        if (pid) add('project', pid);
        if (lockedPage) add('page', lockedPage);
        if (isEmbed) add('embed', '1');
        a.setAttribute('href', href);
      });
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
