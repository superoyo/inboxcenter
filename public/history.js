// โมดูลป็อปอัป "ประวัติการดึงข้อมูล" ใช้ร่วมได้ทุกหน้า — โหลดหลัง auth.js
// เรียกใช้: SyncHistory.open()  หรือใส่ปุ่มที่มี data-sync-history แล้วมันจะผูก onclick ให้เอง
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let built = false;
  function build() {
    if (built) return;
    built = true;
    const css = `
      .sh-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: none; align-items: center; justify-content: center; z-index: 300; padding: 20px; }
      .sh-bg.open { display: flex; }
      .sh-modal { background: var(--card); border-radius: 14px; width: 560px; max-width: 100%; max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; }
      .sh-head { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .sh-head h2 { font-size: 17px; }
      .sh-head .last { color: var(--muted); font-size: 12px; margin-top: 2px; }
      .sh-body { padding: 14px 18px; overflow-y: auto; }
      .sh-run { border: 1px solid var(--border); border-radius: 10px; margin-bottom: 8px; cursor: pointer; }
      .sh-run:hover { background: var(--bg); }
      .sh-run-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; font-size: 13px; }
      .sh-run-head .t { font-weight: 700; font-variant-numeric: tabular-nums; }
      .sh-run-head .sum { margin-left: auto; color: var(--muted); }
      .sh-run-det { display: none; padding: 0 12px 10px; font-size: 12.5px; line-height: 1.7; color: var(--muted); }
      .sh-run.exp .sh-run-det { display: block; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const bg = document.createElement('div');
    bg.className = 'sh-bg';
    bg.id = 'shBg';
    bg.innerHTML = `
      <div class="sh-modal" onclick="event.stopPropagation()">
        <div class="sh-head">
          <div>
            <h2>📜 ประวัติการดึงข้อมูล</h2>
            <div class="last" id="shLast">กำลังโหลด...</div>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button class="btn small" id="shSyncBtn">🔄 ดึงตอนนี้</button>
            <button class="btn small secondary" id="shClose">✕</button>
          </div>
        </div>
        <div class="sh-body" id="shBody"><div class="muted">กำลังโหลด...</div></div>
      </div>`;
    bg.addEventListener('click', close);
    document.body.appendChild(bg);
    document.getElementById('shClose').addEventListener('click', close);
    document.getElementById('shSyncBtn').addEventListener('click', syncNow);
  }

  function close() { const bg = document.getElementById('shBg'); if (bg) bg.classList.remove('open'); }

  async function load() {
    try {
      const s = await fetch('/api/sync-status').then((r) => r.json());
      const fmt = (iso) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
      document.getElementById('shLast').textContent = s.running
        ? '⏳ กำลังดึงข้อมูล...'
        : (s.lastRefreshAt
            ? `ดึงล่าสุด ${fmt(s.lastRefreshAt)} น. · รอบถัดไป ${fmt(s.nextRefreshAt)} น.`
            : `ยังไม่เคยดึง · รอบถัดไป ${fmt(s.nextRefreshAt)} น.`);
    } catch { document.getElementById('shLast').textContent = ''; }
    const runs = await fetch('/api/sync-history').then((r) => r.json()).catch(() => []);
    render(runs);
  }

  function render(runs) {
    const body = document.getElementById('shBody');
    body.innerHTML = runs.length ? runs.map((r) => {
      const ok = r.results.filter((x) => x.ok);
      const fail = r.results.filter((x) => !x.ok);
      const updated = r.results.reduce((s, x) => s + (x.conversations || 0), 0);
      const t = new Date(r.startedAt);
      return `
        <div class="sh-run" onclick="this.classList.toggle('exp')">
          <div class="sh-run-head">
            <span class="t">${t.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} ${t.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</span>
            <span>${r.trigger === 'auto' ? '🤖 อัตโนมัติ' : '👆 กดเอง'}</span>
            <span class="sum">${ok.length}/${r.results.length} เพจ · ${updated} ห้อง ${fail.length ? `· ⚠ ${fail.length}` : '· ✓'}</span>
          </div>
          <div class="sh-run-det">
            ${r.results.map((x) => x.ok
              ? `✓ ${esc(x.pageName)} — ${x.conversations} ห้องที่ขยับ`
              : `<span style="color:var(--red);">✗ ${esc(x.pageName)} — ${esc(x.error || '')}</span>`).join('<br>')}
          </div>
        </div>`;
    }).join('') : '<div class="muted" style="padding: 12px;">ยังไม่มีประวัติการดึง</div>';
  }

  async function syncNow() {
    const btn = document.getElementById('shSyncBtn');
    btn.disabled = true; btn.textContent = '⏳ กำลังดึง...';
    try {
      await fetch('/api/sync-all', { method: 'POST' }).then((r) => r.json());
    } catch { /* เงียบ */ }
    btn.disabled = false; btn.textContent = '🔄 ดึงตอนนี้';
    load();
    if (typeof window.onSyncHistoryDone === 'function') window.onSyncHistoryDone();
  }

  function open() {
    build();
    document.getElementById('shBg').classList.add('open');
    load();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-sync-history]').forEach((el) => el.addEventListener('click', open));
  });

  window.SyncHistory = { open };
})();
