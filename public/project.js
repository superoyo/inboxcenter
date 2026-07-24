// สคริปต์บริบทโปรเจกต์ — โหลดหลัง auth.js ในหน้า Inbox/Content/Analytics/Report
// (1) อ่าน project id จาก URL, (2) auto-append ?project ให้ทุก fetch /api GET,
// (3) พา project id ไปกับลิงก์เมนู, (4) แสดงชื่อโปรเจกต์ + ปุ่มกลับหน้าโปรเจกต์บน navbar
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const pid = params.get('project') || '';
  window.ActiveProjectId = pid;

  // endpoint ที่ไม่ผูกกับโปรเจกต์
  const GLOBAL_API = /\/api\/(projects|auth|config)(\/|$|\?)/;

  if (pid) {
    const _fetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const isApi = url.includes('/api/');
      if (isApi && !GLOBAL_API.test(url) && !/[?&]project=/.test(url)) {
        const sep = url.includes('?') ? '&' : '?';
        const newUrl = url + sep + 'project=' + encodeURIComponent(pid);
        if (typeof input === 'string') input = newUrl;
        else input = new Request(newUrl, input);
      }
      return _fetch(input, init);
    };

    // พา project id ไปกับลิงก์เมนูภายในโปรเจกต์ (ไม่รวม Setting = ระดับบนสุด)
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('.navbar a.nav-link').forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (/^(index|comments|analytics|report|admin)\.html/.test(href) && !href.includes('project=')) {
          a.setAttribute('href', href + (href.includes('?') ? '&' : '?') + 'project=' + encodeURIComponent(pid));
        }
      });
      renderProjectChip();
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
