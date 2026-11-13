'use strict';

async function refresh() {
  const { records, hello, tokenPush, cookiePush, hookStatus, stats, lastAction, mintFail } = await chrome.runtime.sendMessage({ type: 'get' });
  const list = document.getElementById('list');
  const count = document.getElementById('count');
  const status = document.getElementById('status');
  const info = document.getElementById('info');
  count.textContent = records.length;

  const fresh = hello && Date.now() - hello.ts < 10 * 60_000;
  status.textContent = !fresh
    ? '⚠️ Chưa thấy trang Flow — hãy F5 lại trang flow.google.com (SAU khi reload extension)'
    : hello.mainInjected
      ? '✅ Đã gắn vào trang Flow'
      : '⚠️ webRequest OK nhưng hook trang chưa chạy — F5 lại trang';
  status.className = fresh && hello.mainInjected ? 'ok' : 'warn';

  const lines = [];
  if (hookStatus && hookStatus.hooked) lines.push(`🔐 reCAPTCHA hook: OK${lastAction ? ` · action: ${lastAction}` : ''}`);
  if (mintFail && Date.now() - mintFail.ts < 5 * 60_000) lines.push(`❌ Lần đúc gần nhất lỗi: ${mintFail.reason}`);
  if (!hookStatus?.hooked && !(mintFail && Date.now() - mintFail.ts < 5 * 60_000)) {
    lines.push('🔐 reCAPTCHA hook: đang chờ — F5 lại trang Flow nếu kéo dài quá 1 phút');
  }
  if (tokenPush) lines.push(`📤 Token đẩy về proxy: ${tokenPush.ok ? '✅' : '❌'} ${tokenPush.detail} (${new Date(tokenPush.ts).toLocaleTimeString()})`);
  if (cookiePush) lines.push(`🍪 Cookie đẩy về proxy: ${cookiePush.ok ? '✅' : '❌'} ${cookiePush.detail} (${new Date(cookiePush.ts).toLocaleTimeString()})`);
  if (stats && stats.tokens) lines.push(`Tổng token đã đẩy: ${stats.tokens}`);
  info.textContent = lines.join('\n');

  list.innerHTML = '';
  for (const r of records.slice(-30).reverse()) {
    const li = document.createElement('li');
    let u = {};
    try { u = new URL(r.url, 'https://flow.google.com'); } catch { /* giữ trống */ }
    li.innerHTML = `<b>${r.status || '…'}</b> [${r.kind}] ${r.method} ${u.host}${u.pathname}${u.search.slice(0, 50)}`;
    li.title = `[${r.kind}] ${r.method} ${r.url}\nreqHeaders: ${JSON.stringify(r.reqHeaders || {}).slice(0, 300)}\nreqBody: ${(r.reqBody || '').slice(0, 300)}`;
    list.appendChild(li);
  }
}

document.getElementById('save').addEventListener('click', async () => {
  const { records } = await chrome.runtime.sendMessage({ type: 'get' });
  const payload = JSON.stringify({ capturedAt: new Date().toISOString(), userAgent: navigator.userAgent, records });
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `capture-flow-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

document.getElementById('mint').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'mint-now' });
  setTimeout(refresh, 2000);
});

document.getElementById('clear').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'clear' });
  refresh();
});

refresh();
setInterval(refresh, 1500);
