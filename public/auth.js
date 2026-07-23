// ตัวคุมการเข้าสู่ระบบฝั่งหน้าเว็บ — โหลดเป็นสคริปต์ "ตัวแรก" ในทุกหน้าที่ต้องล็อกอิน
// หน้าที่: (1) gate ก่อน render (2) แนบ Bearer ให้ทุก fetch /api อัตโนมัติ (3) จับ 401 (4) logout + return-url
(function () {
  'use strict';
  const SKEY = 'wz_session';  // { access_token, expiration, user }
  const RKEY = 'wz_return';   // หน้าที่ตั้งใจเข้าก่อนโดนเด้ง login

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch { return null; }
  }
  function clearSession() { localStorage.removeItem(SKEY); }
  function isExpired(s) {
    return !s || !s.expiration || new Date(s.expiration).getTime() <= Date.now();
  }
  function gotoLogin() {
    // จำหน้าปัจจุบันไว้ พากลับหลัง login สำเร็จ (return-url)
    const here = location.pathname.split('/').pop() + location.search;
    if (here && !/^login\.html/.test(here)) sessionStorage.setItem(RKEY, here);
    location.replace('login.html');
  }

  const session = readSession();
  if (isExpired(session)) { clearSession(); gotoLogin(); return; } // หยุดก่อน render

  const token = session.access_token;

  // ---- แนบ Bearer ให้ทุก request /api (ยกเว้น login) + จับ 401 รวมศูนย์ ----
  const _fetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    init = init || {};
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const isApi = url.startsWith('/api/') || url.startsWith(location.origin + '/api/');
    const isLogin = url.includes('/api/auth/login');
    if (isApi && !isLogin) {
      const h = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
      if (!h.has('Authorization')) h.set('Authorization', 'Bearer ' + token);
      init = Object.assign({}, init, { headers: h });
    }
    const res = await _fetch(input, init);
    if (res.status === 401 && isApi && !isLogin) { clearSession(); gotoLogin(); }
    return res;
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---- global สำหรับหน้าอื่นเรียกใช้ ----
  window.Auth = {
    user: session.user || {},
    token,
    logout() {
      clearSession();
      sessionStorage.removeItem(RKEY);
      location.replace('login.html');
    },
  };

  // ---- วาดรูปโปรไฟล์วงกลม + dropdown (ชื่อ-นามสกุล + ออกจากระบบ) บน navbar ----
  function renderChip() {
    const nav = document.querySelector('.navbar');
    if (!nav || document.getElementById('authMenu')) return;
    const u = window.Auth.user || {};
    const full = (u.empThaiName || u.empEngName || u.nickName || u.email || 'ผู้ใช้').trim();
    const sub = [u.positionName, u.departmentName].filter(Boolean).join(' · ') || u.email || '';
    const initial = full[0] || '?';
    const av = () => u.photo ? '<img src="' + esc(u.photo) + '" alt="">' : '<span>' + esc(initial) + '</span>';

    const wrap = document.createElement('div');
    wrap.className = 'auth-menu';
    wrap.id = 'authMenu';
    wrap.innerHTML =
      '<button class="auth-avatar" id="authAvatarBtn" type="button" aria-label="โปรไฟล์">' + av() + '</button>' +
      '<div class="auth-dropdown" id="authDropdown">' +
        '<div class="auth-dd-head">' +
          '<div class="auth-avatar lg">' + av() + '</div>' +
          '<div class="auth-dd-info">' +
            '<div class="auth-dd-name">' + esc(full) + '</div>' +
            (sub ? '<div class="auth-dd-sub">' + esc(sub) + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<button class="auth-dd-item" id="authLogout" type="button">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
          '<span>ออกจากระบบ</span>' +
        '</button>' +
      '</div>';
    nav.appendChild(wrap);

    const btn = document.getElementById('authAvatarBtn');
    const dd = document.getElementById('authDropdown');
    btn.addEventListener('click', (e) => { e.stopPropagation(); dd.classList.toggle('open'); });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) dd.classList.remove('open'); });
    document.getElementById('authLogout').addEventListener('click', () => window.Auth.logout());
    // รูปโหลดไม่ขึ้น → fallback เป็นอักษรย่อ
    wrap.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => {
      const s = document.createElement('span'); s.textContent = initial; img.replaceWith(s);
    }));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderChip);
  else renderChip();
})();
