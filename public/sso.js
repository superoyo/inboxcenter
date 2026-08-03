// เข้าสู่ระบบด้วย Single Sign-On ของ IAMService (skill iam-authentication, Operation 3–4)
//
// token เดินทางกลับมาใน "URL fragment" (#access_token=...) ซึ่งเบราว์เซอร์ไม่ส่งไปถึง server
// จึงต้องอ่านและเก็บที่ฝั่งนี้ แล้วลบออกจาก address bar ทันที
//
// ข้อควรระวังที่ยึดจาก checklist ของ skill:
//   1. state ใช้ครั้งเดียว — ลบก่อนตรวจ เพื่อให้ callback ที่ถูกเล่นซ้ำไม่ผ่าน
//   2. ลบ fragment ก่อนตรวจอะไรทั้งนั้น — token ต้องไม่ค้างใน history ทุกเส้นทาง
//   3. ห้าม auto-retry เมื่อ callback พลาด — จะวนไม่จบถ้า error ถาวร
//   4. กัน callback ถูกประมวลผลสองครั้ง
//   6. เช็ค exp ก่อนเก็บ
//   8. ออกจากระบบ: ล้าง session ของเราก่อน แล้วค่อยไปล้างของ IAM
window.SSO = (function () {
  'use strict';
  var SKEY = 'wz_session'; // ใช้ key เดียวกับ login แบบรหัสผ่าน — หน้าอื่นไม่ต้องรู้ว่ามาทางไหน
  var STATE_KEY = 'iam_sso_state';
  var TRIED_KEY = 'iam_sso_tried'; // กันวน: ลองเข้าแบบ SSO อัตโนมัติได้ครั้งเดียวต่อแท็บ
  var consumed = false; // checklist 4 — กัน init ซ้ำ

  var isEmbed = new URLSearchParams(location.search).get('embed') === '1';

  function randomState() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'st_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  }

  /** URL ที่ IAM จะพากลับมา — คงทั้ง path และ query เดิมไว้ (embed=1 / page=xxx ต้องไม่หาย) */
  function returnUrl() {
    return location.origin + location.pathname + location.search;
  }

  function decodePayload(token) {
    try {
      var body = token.split('.')[1];
      if (!body) return null;
      var json = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(decodeURIComponent(escape(json)));
    } catch (e) {
      try {
        return JSON.parse(atob(token.split('.')[1]));
      } catch (e2) {
        return null;
      }
    }
  }

  /** ลบ fragment ออกจาก address bar โดยไม่ทำให้หน้าโหลดใหม่ */
  function clearFragment() {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
      location.hash = '';
    }
  }

  // ---- สถานะการเปิดใช้ (ถามเซิร์ฟเวอร์ ไม่ hardcode URL ของ IAM ไว้ในหน้าเว็บ) ----
  var statusPromise = null;
  function status() {
    if (!statusPromise) {
      statusPromise = fetch('/api/auth/sso/status')
        .then(function (r) {
          return r.ok ? r.json() : { enabled: false };
        })
        .catch(function () {
          return { enabled: false };
        });
    }
    return statusPromise;
  }

  /** เริ่ม flow: พาเบราว์เซอร์ไป IAM (full-page redirect ไม่ใช่ fetch) */
  function begin() {
    return status().then(function (cfg) {
      if (!cfg.enabled || !cfg.authorizeUrl) return false;
      var state = randomState();
      sessionStorage.setItem(STATE_KEY, state);
      sessionStorage.setItem(TRIED_KEY, '1');
      var url =
        cfg.authorizeUrl +
        '?returnUrl=' +
        encodeURIComponent(returnUrl()) +
        '&state=' +
        encodeURIComponent(state);
      location.assign(url);
      return true;
    });
  }

  /**
   * อ่าน fragment ที่ IAM ส่งกลับมา
   * คืน null ถ้าไม่ใช่ callback · { error } ถ้าเป็น callback แต่ใช้ไม่ได้
   */
  function readCallback() {
    if (consumed) return null;
    var hash = location.hash || '';
    if (hash.indexOf('access_token=') < 0) return null;
    consumed = true;

    var params = new URLSearchParams(hash.replace(/^#/, ''));
    // checklist 1 — state ใช้ครั้งเดียว: อ่านแล้วลบทิ้งก่อนเทียบ
    var expected = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    // checklist 2 — ลบ token ออกจาก address bar ก่อนตรวจอะไรทั้งสิ้น
    clearFragment();

    var token = params.get('access_token');
    var state = params.get('state');
    if (!token) return { error: 'ไม่ได้รับ token จาก SSO' };
    if (!expected || state !== expected) {
      return { error: 'การเข้าสู่ระบบไม่ตรงกับคำขอเดิม (state ไม่ตรง) กรุณาเริ่มใหม่' };
    }

    // checklist 6 — เช็ค exp ก่อนเก็บ (ลายเซ็นตรวจที่ฝั่งเซิร์ฟเวอร์ ไม่ใช่ที่นี่)
    var payload = decodePayload(token);
    var expMs = payload && typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
    if (!expMs || expMs <= Date.now()) return { error: 'token ที่ได้รับหมดอายุแล้ว' };

    return { token: token, expiration: new Date(expMs).toISOString() };
  }

  /**
   * เก็บ session จาก token ที่ผ่านการตรวจแล้ว
   * fragment ให้มาแค่ตัวตน — โปรไฟล์ (ชื่อ/แผนก/รูป) ต้องขอจาก API ของเราอีกที
   * checklist 7 — โปรไฟล์โหลดไม่ได้ก็ยังเข้าใช้งานได้ (session แบบมีแต่ claim)
   */
  function saveSession(cb) {
    var session = { access_token: cb.token, expiration: cb.expiration, idp: 'iam', user: {} };
    localStorage.setItem(SKEY, JSON.stringify(session));

    return fetch('/api/auth/sso/session', { headers: { Authorization: 'Bearer ' + cb.token } })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      })
      .then(function (info) {
        if (info && info.user) {
          session.user = info.user;
          localStorage.setItem(SKEY, JSON.stringify(session));
        }
        return session;
      });
  }

  /** เคยลองเข้าแบบ SSO อัตโนมัติในแท็บนี้แล้วหรือยัง (checklist 3 — ห้ามวน) */
  function alreadyTried() {
    return sessionStorage.getItem(TRIED_KEY) === '1';
  }

  function resetTried() {
    sessionStorage.removeItem(TRIED_KEY);
  }

  /**
   * ออกจากระบบ: ล้างของเราก่อน แล้วค่อยไปล้าง session ของ IAM (checklist 8)
   * ถ้าล้างแค่ฝั่งเรา การกด SSO ครั้งถัดไปจะเข้าได้เองทันทีเพราะ cookie ของ IAM ยังอยู่
   */
  function logout(fallbackUrl) {
    localStorage.removeItem(SKEY);
    sessionStorage.removeItem(STATE_KEY);
    // ตั้งธงไว้ ไม่ใช่ล้าง — กดออกจากระบบแล้วต้องไม่ถูกพาเข้า SSO เองทันที
    sessionStorage.setItem(TRIED_KEY, '1');
    return status().then(function (cfg) {
      if (cfg.enabled && cfg.logoutUrl) {
        location.assign(cfg.logoutUrl + '?returnUrl=' + encodeURIComponent(returnUrl()));
      } else {
        location.replace(fallbackUrl || 'login.html');
      }
      return true;
    });
  }

  return {
    status: status,
    begin: begin,
    readCallback: readCallback,
    saveSession: saveSession,
    alreadyTried: alreadyTried,
    resetTried: resetTried,
    logout: logout,
    isEmbed: isEmbed,
  };
})();
