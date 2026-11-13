// Service worker: lưu record, đẩy token reCAPTCHA + cookie tươi về proxy local (127.0.0.1:8787).
'use strict';

const MAX_RECORDS = 400;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;
const MAX_BODY = 300 * 1024;
const PROXY_BASE = 'http://127.0.0.1:8811';

async function getRecords() {
  const d = await chrome.storage.session.get('records');
  return Array.isArray(d.records) ? d.records : [];
}

function updateBadge(n) {
  try { chrome.action.setBadgeText({ text: n ? String(n) : '' }); } catch { /* bỏ qua */ }
}

async function addRecord(rec) {
  const records = await getRecords();
  records.push(rec);
  while (records.length > MAX_RECORDS || JSON.stringify(records).length > MAX_TOTAL_BYTES) {
    if (records.length <= 1) break;
    records.shift();
  }
  await chrome.storage.session.set({ records });
  updateBadge(records.length);
}

/* -------------------- đẩy token reCAPTCHA về proxy -------------------- */

// hàng đợi retry: token đẩy lỗi (proxy tắt) sẽ thử lại khi proxy sống lại
async function queueToken(token, action, source) {
  const d = await chrome.storage.session.get('tokenQueue');
  const q = Array.isArray(d.tokenQueue) ? d.tokenQueue : [];
  q.push({ token, action, source, ts: Date.now() });
  while (q.length > 3) q.shift();
  await chrome.storage.session.set({ tokenQueue: q });
}

async function flushTokenQueue() {
  const d = await chrome.storage.session.get('tokenQueue');
  const q = Array.isArray(d.tokenQueue) ? d.tokenQueue : [];
  if (!q.length) return;
  const remaining = [];
  for (const item of q) {
    // token quá 100 giây là hết hạn — bỏ
    if (Date.now() - item.ts > 100_000) continue;
    try {
      const res = await fetch(`${PROXY_BASE}/internal/recaptcha-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: item.token, action: item.action, source: item.source }),
      });
      if (!res.ok) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  await chrome.storage.session.set({ tokenQueue: remaining });
}

async function pushToken(token, action, source) {
  const state = { ts: Date.now(), ok: false, detail: '' };
  try {
    const res = await fetch(`${PROXY_BASE}/internal/recaptcha-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action, source }),
    });
    state.ok = res.ok;
    state.detail = `HTTP ${res.status}`;
    if (res.ok) {
      const d = await chrome.storage.session.get('stats');
      const stats = d.stats || {};
      stats.tokens = (stats.tokens || 0) + 1;
      await chrome.storage.session.set({ stats });
    } else {
      await queueToken(token, action, source);
    }
  } catch (e) {
    state.detail = e.message || String(e);
    await queueToken(token, action, source);
  }
  await chrome.storage.session.set({ tokenPush: state });
  updateBadge((await getRecords()).length);
}

/* -------------------- đẩy at + f.sid + bl (phiên app) về proxy -------------------- */

async function pushSession(at, fsid, bl) {
  const body = {};
  if (at) body.at = at;
  if (fsid) body.fsid = fsid;
  if (bl) body.bl = bl;
  if (!Object.keys(body).length) return;
  try {
    const res = await fetch(`${PROXY_BASE}/internal/browser-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await chrome.storage.session.set({ atPush: { ts: Date.now(), ok: res.ok, detail: `HTTP ${res.status}` } });
  } catch (e) {
    await chrome.storage.session.set({ atPush: { ts: Date.now(), ok: false, detail: e.message || String(e) } });
  }
}

async function pushAt(at) {
  return pushSession(at, '', '');
}

/* -------------------- đẩy cookie tươi về proxy -------------------- */

let latestCookie = '';
let lastCookiePush = 0;
let cookiePushInFlight = false;

async function pushCookieIfDue(force = false) {
  if (!latestCookie || cookiePushInFlight) return;
  const now = Date.now();
  if (!force && now - lastCookiePush < 5 * 60_000) return;
  cookiePushInFlight = true;
  try {
    const res = await fetch(`${PROXY_BASE}/internal/browser-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: latestCookie }),
    });
    if (res.ok) lastCookiePush = now;
    await chrome.storage.session.set({ cookiePush: { ts: now, ok: res.ok, detail: `HTTP ${res.status}` } });
  } catch (e) {
    await chrome.storage.session.set({ cookiePush: { ts: now, ok: false, detail: e.message || String(e) } });
  } finally {
    cookiePushInFlight = false;
  }
}

/* ------------------------------ messages ------------------------------ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'record' && msg.record) {
    addRecord(msg.record).catch(() => {});
    return;
  }
  if (msg.type === 'page-event' && msg.event) {
    const ev = msg.event;
    if (ev.kind === 'token' && ev.token) {
      pushToken(ev.token, ev.action, ev.source).catch(() => {});
    } else if (ev.kind === 'at' && ev.at) {
      pushAt(ev.at).catch(() => {});
    } else if (ev.kind === 'session' && (ev.at || ev.fsid)) {
      pushSession(ev.at, ev.fsid, ev.bl).catch(() => {});
    } else if (ev.kind === 'hooked') {
      chrome.storage.session.set({ hookStatus: { hooked: true, ts: Date.now() } }).catch(() => {});
    } else if (ev.kind === 'action' && ev.action) {
      chrome.storage.session.set({ lastAction: ev.action }).catch(() => {});
    } else if (ev.kind === 'mint-failed') {
      chrome.storage.session.set({ mintFail: { reason: ev.reason, ts: Date.now() } }).catch(() => {});
    }
    return;
  }
  if (msg.type === 'hello') {
    chrome.storage.session.set({ hello: { mainInjected: !!msg.mainInjected, ts: Date.now() } }).catch(() => {});
    return;
  }
  if (msg.type === 'mint-now') {
    (async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0] && tabs[0].id) {
        try { await chrome.tabs.sendMessage(tabs[0].id, { type: 'mint-now' }); } catch { /* không phải tab Flow */ }
      }
    })();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'get') {
    Promise.all([getRecords(), chrome.storage.session.get(['hello', 'tokenPush', 'cookiePush', 'hookStatus', 'stats', 'lastAction', 'mintFail'])])
      .then(([records, s]) => sendResponse({ records, ...s }))
      .catch(() => sendResponse({ records: [] }));
    return true;
  }
  if (msg.type === 'clear') {
    chrome.storage.session.set({ records: [] }).then(() => { updateBadge(0); sendResponse({ ok: true }); });
    return true;
  }
});

/* --------- Mạng lưới 2: webRequest (thấy cả request từ Worker) --------- */

const pending = new Map(); // requestId -> { body, headers }

function bodyFromWebRequest(requestBody) {
  if (!requestBody) return '';
  try {
    if (requestBody.formData) {
      const parts = [];
      for (const [k, v] of Object.entries(requestBody.formData)) {
        const val = Array.isArray(v) ? v[0] : v;
        const s = typeof val === 'string' ? val : '<bytes>';
        parts.push(`${k}=${s.length > MAX_BODY ? s.slice(0, MAX_BODY) + '...[TRUNCATED]' : s}`);
      }
      return parts.join('&');
    }
    if (Array.isArray(requestBody.raw) && requestBody.raw.length) {
      const buf = typeof requestBody.raw[0] === 'string'
        ? requestBody.raw[0]
        : new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(requestBody.raw[0]));
      return buf.length > MAX_BODY ? buf.slice(0, MAX_BODY) + '...[TRUNCATED]' : buf;
    }
  } catch { /* bỏ qua */ }
  return '';
}

const WR_FILTER = { urls: ['<all_urls>'], types: ['xmlhttprequest'] };

chrome.webRequest.onBeforeRequest.addListener((d) => {
  pending.set(d.requestId, { body: bodyFromWebRequest(d.requestBody), headers: pending.get(d.requestId)?.headers || {} });
}, WR_FILTER, ['requestBody']);

chrome.webRequest.onSendHeaders.addListener((d) => {
  const entry = pending.get(d.requestId) || { body: '', headers: {} };
  const headers = {};
  for (const h of d.requestHeaders || []) headers[h.name] = h.value;
  pending.set(d.requestId, { body: entry.body, headers });
  // chỉ lấy cookie từ các request chính (batchexecute/aisandbox) — jar phải đầy đủ
  if (headers.Cookie && (d.url.includes('batchexecute') || d.url.includes('aisandbox')) && headers.Cookie.length > 1000) {
    if (headers.Cookie !== latestCookie) {
      latestCookie = headers.Cookie;
      pushCookieIfDue(true).catch(() => {});
    }
  }
}, WR_FILTER, ['requestHeaders', 'extraHeaders']);

chrome.webRequest.onCompleted.addListener((d) => {
  const entry = pending.get(d.requestId) || { body: '', headers: {} };
  pending.delete(d.requestId);
  try {
    const initiator = String(d.initiator || '');
    const fromFlow = initiator.startsWith('https://flow.google.com') || d.url.includes('flow.google.com');
    if (!fromFlow) return;
    if (d.method === 'GET' && !/token|oauth|auth|aisandbox|batchexecute/i.test(d.url)) return;
    addRecord({
      kind: 'webRequest',
      ts: Date.now(),
      method: d.method,
      url: d.url,
      reqHeaders: entry.headers,
      reqBody: entry.body,
      status: d.statusCode,
      resBody: '(webRequest không đọc được body phản hồi — bản "fetch"/"xhr" có nếu hook trang gắn được)',
    }).catch(() => {});
  } catch { /* bỏ qua */ }
}, WR_FILTER);

chrome.webRequest.onErrorOccurred.addListener((d) => {
  pending.delete(d.requestId);
}, WR_FILTER);

// định kỳ đẩy cookie nếu có thay đổi chưa gửi + xả hàng đợi token
setInterval(() => { pushCookieIfDue().catch(() => {}); flushTokenQueue().catch(() => {}); }, 60_000);
setTimeout(() => flushTokenQueue().catch(() => {}), 10_000);
