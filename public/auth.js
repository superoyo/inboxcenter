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

  // ---- วาดชื่อผู้ใช้ + ปุ่มออกจากระบบ ลงบน navbar ----
  function renderChip() {
    const nav = document.querySelector('.navbar');
    if (!nav || document.getElementById('authChip')) return;
    const u = window.Auth.user || {};
    const name = u.nickName || u.empThaiName || u.empEngName || u.email || 'ผู้ใช้';
    const wrap = document.createElement('div');
    wrap.id = 'authChip';
    wrap.className = 'auth-chip';
    wrap.innerHTML =
      '<span class="auth-name" title="' + esc(u.empThaiName || u.empEngName || name) + '">👤 ' + esc(name) + '</span>' +
      '<button class="btn small secondary" id="authLogout" type="button">ออกจากระบบ</button>';
    nav.appendChild(wrap);
    document.getElementById('authLogout').addEventListener('click', () => window.Auth.logout());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderChip);
  else renderChip();
})();
