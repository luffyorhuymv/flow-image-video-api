#!/usr/bin/env node
/**
 * Flow Image Proxy — API cục bộ (OpenAI-compatible) để tạo ảnh qua Google Flow.
 *
 * Cơ chế (reverse-engineered từ web app flow.google.com):
 *   1. Cookie `__Secure-next-auth.session-token` (từ trình duyệt đã đăng nhập Flow)
 *      -> GET https://labs.google/fx/api/auth/session  =>  access_token (Bearer, hết hạn ~1h)
 *   2. POST https://aisandbox-pa.googleapis.com/v1/projects/{projectId}/flowMedia:batchGenerateImages
 *      (tool "PINHOLE", model NARWHAL / GEM_PIX_2 / IMAGEN_3_5)
 *   3. Ảnh trả về dạng URL ký tên hoặc base64 -> proxy tải về, lưu vào ./output và trả JSON.
 *
 * Backend dự phòng "imagefx": POST /v1:runImageFx (labs.google, IMAGEN_3_1, không đụng vào project).
 *
 * Zero dependency — chỉ cần Node.js >= 18.  Chạy: node server.js
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const { URL } = require('node:url');

/* ---------------------------------------------------------------------------
 * Cấu hình: env > config.json > mặc định
 * ------------------------------------------------------------------------- */

const DEFAULT_PROJECT_ID = '87c609bb-6931-4a76-8d8b-99a28f854873';
const ROOT = __dirname;

const str = (v, d) => (v === undefined || v === null || String(v).trim() === '' ? d : String(v).trim());
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

/** Chuẩn hoá và giới hạn đường dẫn trong thư mục gốc (chặn path traversal qua ../). */
function safeJoin(root, input) {
  const target = path.resolve(root, String(input));
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Đường dẫn "${input}" nằm ngoài thư mục cho phép: ${root}`);
  }
  return target;
}

/** Đọc cookies.txt: hỗ trợ cả JSON export (EditThisCookie/Cookie-Editor) lẫn chuỗi header "a=1; b=2". */
function readCookieJar(cookiesFile) {
  let f;
  try { f = safeJoin(ROOT, cookiesFile); }
  catch (e) { console.error('[config]', e.message); return ''; }
  if (!fs.existsSync(f)) return '';
  const raw = fs.readFileSync(f, 'utf8').trim();
  if (!raw) return '';
  const pairs = new Map();
  const mergeHeader = (s) => {
    for (const part of String(s).split(';')) {
      const i = part.indexOf('=');
      if (i > 0) {
        const name = part.slice(0, i).trim();
        const value = part.slice(i + 1).trim();
        if (name && value && !/[\r\n]/.test(name + value)) pairs.set(name, value);
      }
    }
  };
  // Định dạng 1: JSON export của extension
  try {
    const j = JSON.parse(raw);
    const arr = Array.isArray(j) ? j : Array.isArray(j.cookies) ? j.cookies : [];
    for (const c of arr) if (c && c.name && typeof c.value === 'string' && c.value) mergeHeader(`${c.name}=${c.value}`);
  } catch { /* không phải JSON — coi như chuỗi header */ }
  // Định dạng 2: các dòng "name=value; ..." — cho phép chèn thêm cookie thủ công vào cuối file
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#') || l.startsWith('{') || l.startsWith('[')) continue;
    mergeHeader(l);
  }
  return [...pairs].map(([n, v]) => `${n}=${v}`).join('; ');
}

function loadCookies(cfg) {
  if (cfg.cookies) { directCookies = cfg.cookies; return cfg.cookies; }
  return readCookieJar(cfg.cookiesFile);
}

/** Nạp lại cookies.txt nếu file thay đổi — thêm/sửa cookie không cần restart server. */
let directCookies = '';
let cookieFileMtime = -1;
function reloadCookiesIfNeeded() {
  if (directCookies) return;
  try {
    const f = safeJoin(ROOT, cfg.cookiesFile);
    const mtime = fs.existsSync(f) ? fs.statSync(f).mtimeMs : -1;
    if (mtime === cookieFileMtime) return;
    cookieFileMtime = mtime;
    const prev = cfg.cookies ? cookieHash() : '';
    cfg.cookies = readCookieJar(cfg.cookiesFile);
    if (cfg.cookies && prev && cookieHash() !== prev) {
      tokenState.at = null;
      tokenState.expires = 0;
      log('Đã nạp lại cookies.txt (phát hiện thay đổi)');
    }
  } catch { /* bỏ qua */ }
}

function loadConfig() {
  let fc = {};
  const cfgPath = path.join(ROOT, 'config.json');
  if (fs.existsSync(cfgPath)) {
    try { fc = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); }
    catch (e) { console.error('[config] Lỗi đọc config.json:', e.message); }
  }
  const cfg = {
    port: num(process.env.PORT ?? fc.port, 8811),
    apiKey: str(process.env.FLOW_API_KEY ?? fc.apiKey, ''),
    projectId: str(process.env.FLOW_PROJECT_ID ?? fc.projectId, DEFAULT_PROJECT_ID),
    backend: str(process.env.FLOW_BACKEND ?? fc.backend, 'flow'), // 'flow' | 'imagefx'
    model: str(process.env.FLOW_MODEL ?? fc.model, 'nano-banana'),
    aspectRatio: str(process.env.FLOW_ASPECT ?? fc.aspectRatio, '16:9'),
    cookies: str(process.env.FLOW_COOKIES ?? fc.cookies, ''),
    cookiesFile: str(process.env.FLOW_COOKIES_FILE ?? fc.cookiesFile, 'cookies.txt'),
    recaptchaToken: str(process.env.FLOW_RECAPTCHA_TOKEN ?? fc.recaptchaToken, ''),
    outputDir: str(process.env.FLOW_OUTPUT_DIR ?? fc.outputDir, 'output'),
    timeoutMs: num(process.env.FLOW_TIMEOUT_MS ?? fc.timeoutMs, 300000),
    userAgent: str(process.env.FLOW_USER_AGENT ?? fc.userAgent, ''),
    browserValidation: str(process.env.FLOW_BROWSER_VALIDATION ?? fc.browserValidation, ''),
  };
  cfg.cookies = loadCookies(cfg);
  // outputDir bắt buộc nằm trong thư mục proxy: resolve rồi kiểm tra biên, chặn ../ và đường dẫn tuyệt đối
  const outDir = path.resolve(ROOT, cfg.outputDir);
  if (outDir === ROOT || outDir.startsWith(ROOT + path.sep)) {
    cfg.outputDir = outDir;
  } else {
    console.error(`[config] outputDir "${cfg.outputDir}" nằm ngoài thư mục proxy — dùng ./output mặc định`);
    cfg.outputDir = path.join(ROOT, 'output');
  }
  return cfg;
}

const cfg = loadConfig();

/* ---------------------------------------------------------------------------
 * Hằng số upstream + ánh xạ model / tỷ lệ khung hình
 * ------------------------------------------------------------------------- */

const AISANDBOX_V1 = 'https://aisandbox-pa.googleapis.com/v1';
const LABS_SESSION_URL = 'https://labs.google/fx/api/auth/session';
const FLOW_ORIGIN = 'https://flow.google.com';
const UA =
  cfg.userAgent ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

const IMAGE_MODELS = {
  'nano-banana':            { upstream: 'NARWHAL',    label: 'Flow Image - Gemini Flash (NARWHAL)',  aspects: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
  'nano-banana-pro':        { upstream: 'GEM_PIX_2',  label: 'Flow Image - Gemini Pro (GEM_PIX_2)',  aspects: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
  'imagen-4':               { upstream: 'IMAGEN_3_5', label: 'Imagen 4 (IMAGEN_3_5)',                aspects: ['16:9', '9:16'] },
  // bí danh
  'gemini-3.1-flash-image': { upstream: 'NARWHAL',    label: 'Flow Image - Gemini Flash (NARWHAL)',  aspects: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
  'gemini-3.0-pro-image':   { upstream: 'GEM_PIX_2',  label: 'Flow Image - Gemini Pro (GEM_PIX_2)',  aspects: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
  'imagen-4.0':             { upstream: 'IMAGEN_3_5', label: 'Imagen 4 (IMAGEN_3_5)',                aspects: ['16:9', '9:16'] },
};

const ASPECT_MAP = {
  '16:9': 'IMAGE_ASPECT_RATIO_LANDSCAPE',
  landscape: 'IMAGE_ASPECT_RATIO_LANDSCAPE',
  '9:16': 'IMAGE_ASPECT_RATIO_PORTRAIT',
  portrait: 'IMAGE_ASPECT_RATIO_PORTRAIT',
  '1:1': 'IMAGE_ASPECT_RATIO_SQUARE',
  square: 'IMAGE_ASPECT_RATIO_SQUARE',
  '4:3': 'IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE',
  '3:4': 'IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR',
};

// ImageFX chỉ hỗ trợ 3 tỷ lệ cơ bản
const ASPECT_MAP_IMAGEFX = {
  IMAGE_ASPECT_RATIO_LANDSCAPE: 'IMAGE_ASPECT_RATIO_LANDSCAPE',
  IMAGE_ASPECT_RATIO_PORTRAIT: 'IMAGE_ASPECT_RATIO_PORTRAIT',
  IMAGE_ASPECT_RATIO_SQUARE: 'IMAGE_ASPECT_RATIO_SQUARE',
  IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE: 'IMAGE_ASPECT_RATIO_LANDSCAPE',
  IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR: 'IMAGE_ASPECT_RATIO_PORTRAIT',
};

const GOOGLE_HOST_ALLOW = [
  'google.com', 'googleapis.com', 'googleusercontent.com', 'gstatic.com',
  'labs.google', 'flow.google.com', 'recaptcha.net', 'google',
];

function hostAllowed(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return GOOGLE_HOST_ALLOW.some((s) => h === s || h.endsWith('.' + s));
}

/* ---------------------------------------------------------------------------
 * Lỗi HTTP + SSRF guard (chỉ http/https, chặn localhost/private/reserved IP)
 * ------------------------------------------------------------------------- */

class HttpError extends Error {
  constructor(status, message, type = 'proxy_error') {
    super(message);
    this.status = status;
    this.type = type;
  }
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;                     // this-host, private, loopback
    if (a === 169 && b === 254) return true;                               // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;                      // private
    if (a === 192 && b === 168) return true;                               // private
    if (a === 100 && b >= 64 && b <= 127) return true;                     // CGNAT
    if (a === 192 && b === 0) return true;                                 // reserved
    if (a === 198 && (b === 18 || b === 19)) return true;                  // benchmark
    if (a >= 224) return true;                                             // multicast + reserved
    return false;
  }
  const low = ip.toLowerCase();
  if (low === '::' || low === '::1') return true;
  if (low.startsWith('fc') || low.startsWith('fd')) return true;           // ULA fc00::/7
  if (low.startsWith('fe8') || low.startsWith('fe9') || low.startsWith('fea') || low.startsWith('feb')) return true; // link-local
  const m = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);                    // IPv4-mapped
  if (m) return isPrivateIp(m[1]);
  return false;
}

async function assertSafeUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { throw new HttpError(400, 'URL không hợp lệ'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new HttpError(400, `Chỉ cho phép http/https, nhận được: ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new HttpError(400, `Host bị chặn: ${host}`);
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new HttpError(400, `IP riêng/được bảo lưu bị chặn: ${host}`);
    return u;
  }
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); }
  catch { throw new HttpError(400, `Không phân giải được host: ${host}`); }
  if (!addrs.length) throw new HttpError(400, `Không phân giải được host: ${host}`);
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new HttpError(400, `Host ${host} trỏ tới IP riêng/được bảo lưu (${a.address})`);
  }
  return u;
}

/** fetch + kiểm tra SSRF + tự đi theo redirect (mỗi hop đều được kiểm tra lại). */
async function fetchGuarded(urlStr, opts = {}, { allowHost = hostAllowed, maxRedirects = 5 } = {}) {
  let current = String(urlStr);
  for (let i = 0; i <= maxRedirects; i++) {
    const u = await assertSafeUrl(current);
    if (!allowHost(u.hostname)) throw new HttpError(400, `Host không nằm trong danh sách cho phép: ${u.hostname}`);
    const res = await fetch(u, { ...opts, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      current = new URL(loc, u).href;
      continue;
    }
    return res;
  }
  throw new HttpError(502, 'Quá nhiều redirect');
}

/* ---------------------------------------------------------------------------
 * Token manager: cookie session-token -> access_token (cache + tự refresh)
 * ------------------------------------------------------------------------- */

const tokenState = { at: null, expires: 0, cookieHash: '' };
const TOKEN_CACHE_FILE = path.join(ROOT, '.token-cache.json');
const cookieHash = () => crypto.createHash('sha256').update(cfg.cookies).digest('hex').slice(0, 12);

function extractSessionToken(jar) {
  const part = jar
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.toLowerCase().startsWith('__secure-next-auth.session-token='));
  if (!part) return '';
  try { return decodeURIComponent(part.slice(part.indexOf('=') + 1)); } catch { return part.slice(part.indexOf('=') + 1); }
}

function loadTokenCache() {
  try {
    const c = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf8'));
    if (c.cookieHash === cookieHash() && c.access_token && Date.parse(c.expires) > Date.now() + 60_000) {
      tokenState.at = c.access_token;
      tokenState.expires = Date.parse(c.expires);
      tokenState.cookieHash = c.cookieHash;
      log(`Token cache hợp lệ, hết hạn ${c.expires}`);
    }
  } catch { /* chưa có cache */ }
}

function saveTokenCache() {
  try { fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify({ cookieHash: tokenState.cookieHash, access_token: tokenState.at, expires: new Date(tokenState.expires).toISOString() })); }
  catch { /* bỏ qua */ }
}

async function getAccessToken(force = false) {
  const cookies = currentCookieJar();
  if (!cookies) {
    throw new HttpError(400,
      'Chưa cấu hình cookies. Copy chuỗi "cookie: ..." từ DevTools (F12) trên flow.google.com rồi lưu vào cookies.txt hoặc biến môi trường FLOW_COOKIES.',
      'missing_cookies');
  }
  const now = Date.now();
  if (!force && tokenState.at && tokenState.cookieHash === cookieHash() && tokenState.expires - now > 5 * 60_000) {
    return tokenState.at;
  }
  const st = extractSessionToken(cookies);
  const cookieHeader = st ? `__Secure-next-auth.session-token=${st}` : cookies;
  log(`Lấy access_token từ labs.google (session-token ${st ? 'OK' : 'KHÔNG tìm thấy trong jar'})...`);
  let res, text;
  try {
    res = await fetchGuarded(LABS_SESSION_URL, {
      headers: { Cookie: cookieHeader, 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    }, { allowHost: () => true });
    text = await res.text();
  } catch (e) {
    throw new HttpError(502, `Không gọi được labs.google/fx/api/auth/session: ${e.message}`);
  }
  let data = null;
  try { data = JSON.parse(text); } catch { /* không phải JSON */ }
  if (!res.ok || !data || !data.access_token) {
    throw new HttpError(401,
      `Không lấy được access_token (HTTP ${res.status}). Cookie có thể đã hết hạn — hãy đăng nhập lại flow.google.com và copy cookies mới. Chi tiết: ${text.slice(0, 300)}`,
      'auth_failed');
  }
  tokenState.at = data.access_token;
  const exp = Date.parse(data.expires);
  tokenState.expires = Number.isFinite(exp) && exp > now ? exp : now + 50 * 60_000;
  tokenState.cookieHash = cookieHash();
  saveTokenCache();
  log(`Đã có access_token, hết hạn: ${new Date(tokenState.expires).toISOString()}`);
  return tokenState.at;
}

/* ---------------------------------------------------------------------------
 * Trạng thái trình duyệt: cookie tươi + token reCAPTCHA do extension đẩy về
 * ------------------------------------------------------------------------- */

const browserState = { cookie: '', cookieTs: 0, tokens: [], at: '', atTs: 0, fsid: '', bl: '', sessionTs: 0 };

function currentCookieJar() {
  // cookie từ extension là mới nhất (Google xoay vòng __Secure-1PSIDTS liên tục)
  if (browserState.cookie && Date.now() - browserState.cookieTs < 30 * 60_000) return browserState.cookie;
  return cfg.cookies;
}

async function getRecaptchaToken(waitMs = 0, prefer = '') {
  const deadline = Date.now() + waitMs;
  do {
    const now = Date.now();
    while (browserState.tokens.length && now - browserState.tokens[0].ts > 110_000) browserState.tokens.shift();
    // khi có prefer: CHỈ nhận đúng loại đó (token auto điểm thấp chính là thứ gây UNUSUAL_ACTIVITY)
    const idx = prefer
      ? browserState.tokens.findIndex((t) => t.source === prefer)
      : (browserState.tokens.length ? 0 : -1);
    if (idx >= 0) {
      const t = browserState.tokens.splice(idx, 1)[0];
      log(`[recaptcha] dùng token ${t.token.length} ký tự, action="${t.action || '(trống)'}", nguồn=${t.source || '?'}, tuổi ${((now - t.ts) / 1000).toFixed(0)}s`);
      return t.token;
    }
    if (cfg.recaptchaToken) {
      log('[recaptcha] pool rỗng — dùng token từ config');
      return cfg.recaptchaToken;
    }
    if (Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000));
  } while (Date.now() < deadline);
  log('[recaptcha] hết thời gian chờ token — bỏ qua reCAPTCHA token');
  return '';
}

async function handleInternal(req, res, kind) {
  const body = await parseJsonBody(req);
  if (kind === 'token') {
    const token = str(body.token, '');
    if (token.length < 40) throw new HttpError(400, 'Token reCAPTCHA thiếu/hỏng');
    browserState.tokens.push({ token, ts: Date.now(), action: str(body.action, ''), source: str(body.source, 'auto') });
    while (browserState.tokens.length > 5) browserState.tokens.shift();
    log(`Nhận token reCAPTCHA từ extension (nguồn=${str(body.source, 'auto')}, pool: ${browserState.tokens.length})`);
    return json(res, 200, { ok: true, pool: browserState.tokens.length });
  }
  const cookie = str(body.cookie, '');
  if (cookie && cookie.length > 500 && /(^|;)\s*SID=/.test(cookie)) {
    browserState.cookie = cookie;
    browserState.cookieTs = Date.now();
    log(`Nhận cookie tươi từ extension (${cookie.length} ký tự)`);
  } else if (cookie) {
    log(`Bỏ qua cookie quá nhỏ từ extension (${cookie.length} ký tự)`);
  }
  const at = str(body.at, '');
  if (at && /^[A-Za-z0-9_-]+:\d{8,}$/.test(at)) {
    if (at !== browserState.at) log(`Nhận token at (XSRF) từ extension: ${at.slice(0, 24)}...`);
    browserState.at = at;
    browserState.atTs = Date.now();
    browserState.sessionTs = Date.now();
  }
  const fsid = str(body.fsid, '');
  if (fsid && /^-?\d{10,}$/.test(fsid)) {
    if (fsid !== browserState.fsid) log(`Nhận f.sid từ phiên app: ${fsid}`);
    browserState.fsid = fsid;
    browserState.sessionTs = Date.now();
  }
  const bl = str(body.bl, '');
  if (bl && /^boq_[A-Za-z0-9_.-]+$/.test(bl)) {
    if (bl !== browserState.bl) log(`Nhận bl từ phiên app: ${bl.slice(0, 40)}`);
    browserState.bl = bl;
    browserState.sessionTs = Date.now();
  }
  return json(res, 200, { ok: true });
}

/* ---------------------------------------------------------------------------
 * Relay: giao request cho chính trang Flow trong browser thực hiện (fetch cùng
 * nguồn gốc => TLS/cookie/headers của Chrome thật, không thể bị phân biệt)
 * ------------------------------------------------------------------------- */

const relayJobs = new Map(); // id -> {url, headers, body, status, statusCode, responseText, created, claimed}
let relayLastPoll = 0;

function relayAlive() {
  return Date.now() - relayLastPoll < 30_000;
}

async function relayRequest(url, headers, body) {
  const id = crypto.randomUUID();
  const cleanHeaders = { ...headers };
  delete cleanHeaders.Cookie; // browser tự gắn cookie thật của trang
  delete cleanHeaders['Accept-Encoding'];
  relayJobs.set(id, { url, headers: cleanHeaders, body, status: 'pending', created: Date.now(), claimed: 0 });
  const deadline = Date.now() + cfg.timeoutMs;
  while (Date.now() < deadline) {
    const job = relayJobs.get(id);
    if (job && job.status !== 'pending') {
      relayJobs.delete(id);
      return { status: job.statusCode || 599, text: job.responseText || '' };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  relayJobs.delete(id);
  throw new HttpError(504, 'Relay qua trang Flow không phản hồi — tab Flow có đang mở?');
}

async function handleRelayNext(res) {
  relayLastPoll = Date.now();
  const now = Date.now();
  // dọn job cũ
  for (const [id, j] of relayJobs) if (now - j.created > cfg.timeoutMs) relayJobs.delete(id);
  const job = [...relayJobs.values()].find((j) => j.status === 'pending' && now - j.claimed > 15_000);
  if (job) job.claimed = now;
  return json(res, 200, { job: job ? { id: [...relayJobs.entries()].find(([, v]) => v === job)[0], url: job.url, method: 'POST', headers: job.headers, body: job.body } : null });
}

async function handleRelayResult(req, res) {
  const body = await parseJsonBody(req);
  const id = str(body.id, '');
  const job = relayJobs.get(id);
  if (!job) return json(res, 404, { ok: false });
  job.status = 'done';
  job.statusCode = Number(body.status) || 0;
  job.responseText = String(body.text || '').slice(0, 4 * 1024 * 1024);
  return json(res, 200, { ok: true });
}

/* ---------------------------------------------------------------------------
 * Header dựng cho các call lên aisandbox (giả lập request của web app)
 * ------------------------------------------------------------------------- */

function flowHeaders(at, projectId) {
  return {
    Authorization: `Bearer ${at}`,
    'Content-Type': 'application/json',
    Cookie: currentCookieJar(),
    Origin: FLOW_ORIGIN,
    Referer: `${FLOW_ORIGIN}/project/${projectId}`,
    'User-Agent': UA,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
  };
}

function upstreamError(status, text) {
  let msg = text.slice(0, 2000);
  let hint = '';
  if (/recaptcha|captcha/i.test(text)) {
    hint = ' Google yêu cầu reCAPTCHA — điền FLOW_RECAPTCHA_TOKEN (token lấy từ request thật trong trình duyệt) hoặc thử backend "imagefx".';
  }
  if (status === 401 || status === 403) hint += ' Kiểm tra lại cookies/access_token.';
  return new HttpError(502, `Google Flow trả lỗi HTTP ${status}: ${msg}${hint}`, 'upstream_error');
}

/* ---------------------------------------------------------------------------
 * Gọi Flow: batchGenerateImages (đồng bộ) + media + upsample
 * ------------------------------------------------------------------------- */

function buildClientContext(projectId) {
  const cc = { sessionId: `${Date.now()}`, tool: 'PINHOLE' };
  if (projectId) cc.projectId = projectId;
  if (cfg.recaptchaToken) {
    cc.recaptchaContext = { token: cfg.recaptchaToken, applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB' };
  }
  return cc;
}

async function flowGenerateImage({ prompt, n, aspect, model, seed }) {
  const at = await getAccessToken();
  const baseSeed = seed ?? crypto.randomInt(1, 999_999);
  const requests = [];
  for (let i = 0; i < n; i++) {
    requests.push({
      seed: (baseSeed + i) % 999_999,
      imageModelName: model,
      imageAspectRatio: aspect,
      structuredPrompt: { parts: [{ text: prompt }] },
      imageInputs: [],
    });
  }
  const body = {
    clientContext: buildClientContext(cfg.projectId),
    mediaGenerationContext: { batchId: crypto.randomUUID() },
    useNewMedia: true,
    requests,
  };
  const url = `${AISANDBOX_V1}/projects/${encodeURIComponent(cfg.projectId)}/flowMedia:batchGenerateImages`;
  log(`POST flowMedia:batchGenerateImages (model=${model}, aspect=${aspect}, n=${n})`);
  const res = await fetchGuarded(url, {
    method: 'POST', headers: flowHeaders(at, cfg.projectId),
    body: JSON.stringify(body), signal: AbortSignal.timeout(cfg.timeoutMs),
  }, { allowHost: () => true });
  const text = await res.text();
  if (!res.ok) throw upstreamError(res.status, text);
  let data;
  try { data = JSON.parse(text); } catch { throw new HttpError(502, 'Upstream trả về nội dung không phải JSON'); }
  return { data, baseSeed };
}

async function fetchMediaB64(mediaName) {
  const at = await getAccessToken();
  const enc = String(mediaName).split('/').map(encodeURIComponent).join('/');
  const url = `${AISANDBOX_V1}/media/${enc}`;
  const res = await fetchGuarded(url, { headers: flowHeaders(at, cfg.projectId), signal: AbortSignal.timeout(120_000) }, { allowHost: () => true });
  const text = await res.text();
  if (!res.ok) throw upstreamError(res.status, text);
  const data = JSON.parse(text);
  const b64 = data?.image?.encodedImage || data?.image?.generatedImage?.encodedImage || '';
  return typeof b64 === 'string' ? b64.replace(/^data:[^,]+,/, '') : '';
}

async function flowUpsample({ mediaId, size }) {
  const at = await getAccessToken();
  const body = {
    mediaId,
    targetResolution: size === '4k' ? 'UPSAMPLE_IMAGE_RESOLUTION_4K' : 'UPSAMPLE_IMAGE_RESOLUTION_2K',
    clientContext: buildClientContext(cfg.projectId),
  };
  const url = `${AISANDBOX_V1}/flow/upsampleImage`;
  log(`POST flow/upsampleImage (${size}, media=${mediaId})`);
  const res = await fetchGuarded(url, {
    method: 'POST', headers: flowHeaders(at, cfg.projectId),
    body: JSON.stringify(body), signal: AbortSignal.timeout(cfg.timeoutMs),
  }, { allowHost: () => true });
  const text = await res.text();
  if (!res.ok) throw upstreamError(res.status, text);
  const data = JSON.parse(text);
  const b64 = data?.encodedImage || data?.image?.encodedImage || '';
  return typeof b64 === 'string' ? b64.replace(/^data:[^,]+,/, '') : '';
}

/* ---------------------------------------------------------------------------
 * Backend dự phòng: runImageFx (labs.google, IMAGEN_3_1)
 * ------------------------------------------------------------------------- */

async function imagefxGenerate({ prompt, n, aspect, seed }) {
  const at = await getAccessToken();
  const body = {
    userInput: {
      candidatesCount: n,
      prompts: [prompt],
      isExpandedPrompt: false,
      seed: seed ?? crypto.randomInt(1, 999_999),
    },
    clientContext: { sessionId: `;${Date.now()}`, tool: 'IMAGE_FX' },
    aspectRatio: ASPECT_MAP_IMAGEFX[aspect] || 'IMAGE_ASPECT_RATIO_LANDSCAPE',
    modelInput: { modelNameType: 'IMAGEN_3_1' },
  };
  const res = await fetchGuarded('https://aisandbox-pa.googleapis.com/v1:runImageFx', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${at}`,
      'Content-Type': 'application/json',
      Cookie: cfg.cookies,
      Origin: 'https://labs.google',
      Referer: 'https://labs.google/',
      'User-Agent': UA,
      Accept: '*/*',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'cross-site',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  }, { allowHost: () => true });
  const text = await res.text();
  if (!res.ok) throw upstreamError(res.status, text);
  const data = JSON.parse(text);
  const items = [];
  for (const panel of data?.imagePanels || []) {
    for (const img of panel?.generatedImages || []) {
      if (typeof img.encodedImage === 'string' && img.encodedImage.length > 100) {
        items.push({ b64: img.encodedImage.replace(/^data:[^,]+,/, ''), seed: img.seed });
      }
    }
  }
  return items;
}

/* ---------------------------------------------------------------------------
 * Backend "frontend": batchexecute ogiZ0b của chính web app flow.google.com
 * (chỉ cần cookie Google SID/OSID — không cần access_token)
 * ------------------------------------------------------------------------- */

const FRONTEND_ASPECT_INT = {
  IMAGE_ASPECT_RATIO_SQUARE: 1,
  IMAGE_ASPECT_RATIO_PORTRAIT: 2,
  IMAGE_ASPECT_RATIO_LANDSCAPE: 3,
  IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE: 4,
  IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR: 5,
};

const bootstrapCache = { bl: '', fsid: '', at: 0 };

async function loadFrontendBootstrap(projectId) {
  if (bootstrapCache.bl && Date.now() - bootstrapCache.at < 30 * 60_000) return bootstrapCache;
  const pageUrl = `${FLOW_ORIGIN}/project/${encodeURIComponent(projectId)}`;
  const res = await fetchGuarded(pageUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Cookie: currentCookieJar(),
      Referer: `${FLOW_ORIGIN}/`,
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(60_000),
  }, { allowHost: () => true });
  const text = await res.text();
  if (!res.ok) throw new HttpError(502, `Không tải được trang Flow (HTTP ${res.status}) — cookies có thể đã hết phiên đăng nhập.`);
  const bl = (text.match(/boq_labs-ai-sandbox-frontend_[A-Za-z0-9_.-]+/) || [])[0];
  const fsid = (text.match(/"FdrFJe":"(-?[0-9]+)"/) || [])[1];
  if (!bl || !fsid) throw new HttpError(502, 'Không đọc được metadata bootstrap của Flow — hãy đăng nhập lại flow.google.com và cập nhật cookies.txt.');
  bootstrapCache.bl = bl;
  bootstrapCache.fsid = fsid;
  bootstrapCache.at = Date.now();
  log(`Frontend bootstrap OK: bl=${bl.slice(0, 44)}... f.sid=${fsid}`);
  return bootstrapCache;
}

function frontendProjectContext(projectId, recaptchaToken) {
  return [null, 22, null, null, null, projectId, null, null, null, null, [recaptchaToken || '', 1]];
}

function parseBatchexecuteFrames(text) {
  const frames = [];
  for (const line of String(text).split(/\r?\n/)) {
    const l = line.trim();
    if (!l.startsWith('[')) continue;
    try { const f = JSON.parse(l); if (Array.isArray(f)) frames.push(f); } catch { /* dòng rác */ }
  }
  return frames;
}

function extractBatchexecutePayload(frames, rpcId) {
  for (const frame of frames) {
    for (const item of frame) {
      if (Array.isArray(item) && item.length >= 3 && item[0] === 'wrb.fr' && item[1] === rpcId) {
        try { return JSON.parse(item[2]); } catch { return null; }
      }
    }
  }
  return null;
}

function raiseBatchexecuteError(frames, rpcId) {
  const errCode = (v) => {
    if (typeof v === 'string') return /^(PUBLIC_ERROR_|ERROR_)/.test(v) ? v : '';
    if (Array.isArray(v)) { for (const x of v) { const c = errCode(x); if (c) return c; } }
    return '';
  };
  for (const frame of frames) {
    for (const item of frame) {
      if (!Array.isArray(item) || item.length < 3) continue;
      if (item[0] === 'er') {
        // frame er: item[5] chứa mã trạng thái (vd 401), item[6] có thể null
        const code = (item.length > 5 && item[5] != null) ? item[5] : (item.length > 6 ? item[6] : 'unknown');
        const hint = code === 401 || code === '401'
          ? ' — thường do thiếu token reCAPTCHA: mở tab Flow để extension đúc token (bấm "Đúc token" trong popup), hoặc bấm tạo ảnh 1 lần trong Flow.'
          : '';
        throw new HttpError(502, `Flow frontend từ chối yêu cầu: rpc=${rpcId}, code=${code}${hint}`);
      }
      if (item[0] !== 'wrb.fr' || item[1] !== rpcId) continue;
      const detail = item.length > 5 ? item[5] : null;
      const code = errCode(detail);
      if (code) throw new HttpError(502, `Flow frontend từ chối yêu cầu: rpc=${rpcId}, error=${code}`);
      if (item[2] === null && detail !== null) {
        throw new HttpError(502, `Flow frontend từ chối yêu cầu: rpc=${rpcId}, code=${JSON.stringify(detail).slice(0, 300)}`);
      }
    }
  }
}

async function postFrontendRpc(rpcId, argument, projectId) {
  // ưu tiên NGUYÊN BỘ (at + f.sid + bl) của phiên app do extension đẩy về — giúp request
  // trông giống hệt request của trang thật (f.sid khớp với at đã giảm bị chấm UNUSUAL_ACTIVITY)
  const sessionFresh = browserState.at && browserState.fsid && browserState.bl
    && Date.now() - browserState.sessionTs < 2 * 3600_000;
  const boot = sessionFresh
    ? { bl: browserState.bl, fsid: browserState.fsid }
    : await loadFrontendBootstrap(projectId);
  const sourcePath = projectId ? `/project/${projectId}` : '/projects';
  const headers = {
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    Cookie: currentCookieJar(),
    Origin: FLOW_ORIGIN,
    Referer: `${FLOW_ORIGIN}/`,
    'User-Agent': UA,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'X-Same-Domain': '1',
    // các header Chrome tự thêm cho domain Google (thiếu -> server từ chối)
    'X-Browser-Channel': 'stable',
    'X-Browser-Copyright': 'Copyright 2026 Google LLC. All Rights Reserved.',
    'X-Browser-Year': '2026',
    'X-Browser-Validation': cfg.browserValidation || '6sWHb8G4ZxDIKZivt/PCtKQKFEk=',
    'X-Client-Data': 'CKmdygEIkqHLAQiFoM0BCJbnlDAI1uiUMBio3pQwGNHklDA=',
    'sec-ch-ua': '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };
  const freq = JSON.stringify([[[rpcId, JSON.stringify(argument), null, 'generic']]]);
  const encodedFreq = encodeURIComponent(freq);
  // browser luôn gửi at=... làm param đầu tiên của body (bắt buộc)
  const buildBody = (at) => (at ? `at=${at}&f.req=${encodedFreq}` : `f.req=${encodedFreq}`);
  const buildUrl = (at) => `${FLOW_ORIGIN}/_/AiSandboxAngularFrontend/data/batchexecute`
    + `?rpcids=${encodeURIComponent(rpcId)}&source-path=${encodeURIComponent(sourcePath)}`
    + `&bl=${encodeURIComponent(boot.bl)}&f.sid=${boot.fsid}&hl=en`
    + `&_reqid=${crypto.randomInt(10_000, 90_000)}&rt=c`;
  const post = async (at) => {
    const url = buildUrl(at);
    const body = buildBody(at);
    if (relayAlive()) {
      return relayRequest(url, headers, body); // trang Flow thực hiện — fingerprint Chrome thật
    }
    const res = await fetchGuarded(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(cfg.timeoutMs) }, { allowHost: () => true });
    return { status: res.status, text: await res.text() };
  };

  // thử lần lượt: at của phiên app (nếu có) -> không at (nếu server trả xsrf offer thì dùng luôn)
  const candidates = [];
  if (browserState.at && Date.now() - browserState.atTs < 2 * 3600_000) candidates.push(browserState.at);
  candidates.push('');
  let r = null;
  for (const at of candidates) {
    r = await post(at);
    if (r.status < 400) break;
  }
  let text = r.text;
  const xsrf = text.match(/\["xsrf","([^"]+)"/);
  if (xsrf) {
    browserState.at = xsrf[1];
    browserState.atTs = Date.now();
    log('Nhận được at (XSRF) mới — retry...');
    r = await post(xsrf[1]);
    text = r.text;
  }
  const frames = parseBatchexecuteFrames(text);
  try {
    raiseBatchexecuteError(frames, rpcId);
  } catch (e) {
    if (e instanceof HttpError) log(`Chi tiết phản hồi upstream: ${JSON.stringify(text.slice(0, 800))}`);
    throw e;
  }
  const payload = extractBatchexecutePayload(frames, rpcId);
  if (payload === null) throw new HttpError(502, `Flow frontend không trả payload: rpc=${rpcId}`);
  return payload;
}

async function frontendGenerateImage({ prompt, n, aspect, model, seed }) {
  const sessionUuid = crypto.randomUUID().toUpperCase();
  const baseSeed = seed ?? crypto.randomInt(1, 2_147_483_647);
  const aspectInt = FRONTEND_ASPECT_INT[aspect] ?? 3;
  const recaptchaToken = await getRecaptchaToken(120_000, 'piggyback'); // chờ token đúc kèm click thật (tối đa 120s)
  const clientContext = frontendProjectContext(cfg.projectId, recaptchaToken);
  const requests = [];
  for (let i = 0; i < n; i++) {
    // 14 phần tử, đúng thứ tự app Flow gửi (đối chiếu với capture 2026-09-27)
    requests.push([
      null, null, null,
      (baseSeed + i) % 2_147_483_647,
      aspectInt,
      model,
      null,
      clientContext,
      [[[prompt]]],
      null, null, null,
      crypto.randomUUID().toUpperCase(),
      crypto.randomUUID().toUpperCase(),
    ]);
  }
  const argument = [null, requests, 1, clientContext, [sessionUuid]];
  log(`POST batchexecute ogiZ0b (model=${model}, n=${n}, project=${cfg.projectId})`);
  const payload = await postFrontendRpc('ogiZ0b', argument, cfg.projectId);
  const findImageUrl = (v) => {
    if (typeof v === 'string') return v.startsWith('https://') && v.includes('/image/') ? v : '';
    if (Array.isArray(v)) { for (const x of v) { const u = findImageUrl(x); if (u) return u; } return ''; }
    if (v && typeof v === 'object') { for (const x of Object.values(v)) { const u = findImageUrl(x); if (u) return u; } return ''; }
    return '';
  };
  const mediaItems = Array.isArray(payload) && Array.isArray(payload[0]) ? payload[0] : [];
  const items = [];
  for (const item of mediaItems) {
    if (!Array.isArray(item) || !item.length) continue;
    const url = findImageUrl(item);
    if (url) items.push({ url, mediaId: String(item[0] || ''), seed: baseSeed });
  }
  if (!items.length) {
    throw new HttpError(502, `Flow frontend trả phản hồi nhưng không thấy ảnh: ${JSON.stringify(payload).slice(0, 400)}`);
  }
  return { items, mediaIds: items.map((i) => i.mediaId).filter(Boolean) };
}

/* ---------------------------------------------------------------------------
 * Trích xuất kết quả ảnh từ JSON phản hồi (đệ quy, chịu được thay đổi schema)
 * ------------------------------------------------------------------------- */

const B64_KEYS = new Set(['encodedImage', 'imageBytes', 'rawImageBytes', 'encodedThumbnail']);
const URL_KEYS = new Set(['fifeUrl', 'presignedMediaUrl', 'imageUrl', 'imageUri', 'downloadUrl']);

function extractImages(node, out = { urls: [], b64s: [], mediaIds: [] }, depth = 0) {
  if (node == null || depth > 14) return out;
  if (Array.isArray(node)) {
    for (const v of node) extractImages(v, out, depth + 1);
    return out;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v !== 'string') { extractImages(v, out, depth + 1); continue; }
      if (B64_KEYS.has(k) && v.length > 200) { out.b64s.push(v.replace(/^data:[^,]+,/, '')); continue; }
      if (URL_KEYS.has(k) && v.startsWith('https://')) { out.urls.push(v); continue; }
      if (
        (typeof node.image === 'object' || typeof node.video === 'object') && k === 'name' && v
      ) { out.mediaIds.push(v); continue; }
      if (k === 'mediaGenerationId') {
        if (typeof v === 'string' && v) out.mediaIds.push(v);
        else if (v && typeof v === 'object' && typeof v.mediaGenerationId === 'string') out.mediaIds.push(v.mediaGenerationId);
        continue;
      }
      // URL ảnh "mồ côi" (không kèm key quen thuộc)
      if (v.startsWith('https://') && /\/image\/|lh3\.googleusercontent\.com|storage\.googleapis\.com|\/AI_.+\/image/.test(v)) {
        out.urls.push(v);
      }
    }
    return out;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Tải ảnh về + lưu file
 * ------------------------------------------------------------------------- */

function sniffExt(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e) return 'png';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.length > 3 && buf.slice(0, 3).toString('latin1') === 'GIF') return 'gif';
  return 'png';
}

async function downloadImage(urlStr) {
  const res = await fetchGuarded(urlStr, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new HttpError(502, `Tải ảnh lỗi HTTP ${res.status}: ${urlStr.slice(0, 120)}`);
  const ct = (res.headers.get('content-type') || '').split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 60 * 1024 * 1024) throw new HttpError(502, 'Ảnh vượt quá 60MB');
  return { buf, ct };
}

function saveImage(buf) {
  fs.mkdirSync(cfg.outputDir, { recursive: true });
  const name = `gen-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomInt(1000, 9999)}.${sniffExt(buf)}`;
  const p = path.join(cfg.outputDir, name);
  fs.writeFileSync(p, buf);
  return { name, path: p };
}

/* ---------------------------------------------------------------------------
 * HTTP server + routing
 * ------------------------------------------------------------------------- */

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function requireAuth(req) {
  if (!cfg.apiKey) return true;
  const h = req.headers['authorization'] || '';
  const k = req.headers['x-api-key'] || '';
  return h === `Bearer ${cfg.apiKey}` || k === cfg.apiKey;
}

function readBody(req, limit = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Body quá lớn')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); }
  catch { throw new HttpError(400, 'Body không phải JSON hợp lệ'); }
}

function resolveModel(name) {
  const key = str(name, cfg.model).toLowerCase();
  const m = IMAGE_MODELS[key];
  if (!m) {
    throw new HttpError(400, `Model không hỗ trợ: "${key}". Các model khả dụng: ${Object.keys(IMAGE_MODELS).join(', ')}`);
  }
  return { key, ...m };
}

function resolveAspect(raw, model) {
  const key = str(raw, cfg.aspectRatio).toLowerCase();
  const aspect = ASPECT_MAP[key];
  if (!aspect) throw new HttpError(400, `aspect_ratio không hỗ trợ: "${raw}". Hỗ trợ: ${Object.keys(ASPECT_MAP).filter((k) => k.includes(':')).join(', ')}`);
  if (!model.aspects.includes(key)) {
    log(`Cảnh báo: model ${model.key} không hỗ trợ ${key}, chuyển về ${model.aspects[0]}`);
    return ASPECT_MAP[model.aspects[0]];
  }
  return aspect;
}

/** Chọn backend: 'flow' cần session-token; thiếu thì tự rơi về 'frontend' (batchexecute). */
function resolveBackend() {
  if (cfg.backend === 'imagefx') return 'imagefx';
  if (cfg.backend === 'frontend') return 'frontend';
  if (!extractSessionToken(cfg.cookies)) return 'frontend';
  return 'flow';
}

/** Sinh ảnh + chuẩn hoá kết quả thành [{b64?, url?, seed?}] */
async function generateRaw(params) {
  const backend = resolveBackend();
  if (backend === 'imagefx') {
    return { items: await imagefxGenerate(params), batchId: crypto.randomUUID(), mediaIds: [] };
  }
  if (backend === 'frontend') {
    const r = await frontendGenerateImage(params);
    return { items: r.items, batchId: r.mediaIds[0] || '', mediaIds: r.mediaIds };
  }
  const { data, baseSeed } = await flowGenerateImage(params);
  const ex = extractImages(data);
  const items = [];
  // ưu tiên URL ký tên, sau đó base64 nhúng trong phản hồi
  for (const u of [...new Set(ex.urls)]) items.push({ url: u });
  for (const b of ex.b64s) items.push({ b64: b });
  // fallback: chỉ có media id -> GET /v1/media/{id} để lấy base64
  for (const mid of [...new Set(ex.mediaIds)]) {
    if (items.length >= params.n) break;
    try {
      const b64 = await fetchMediaB64(mid);
      if (b64) items.push({ b64, mediaId: mid });
      else items.push({ mediaId: mid });
    } catch (e) {
      log(`Lấy media ${mid} lỗi: ${e.message}`);
      items.push({ mediaId: mid });
    }
  }
  items.forEach((it, i) => { it.seed = it.seed ?? baseSeed + i; });
  return { items, batchId: data?.mediaGenerationContext?.batchId || '', mediaIds: ex.mediaIds };
}

async function handleGenerate(req, res) {
  const body = await parseJsonBody(req);
  const prompt = str(body.prompt ?? body.message, '');
  if (!prompt) throw new HttpError(400, 'Thiếu "prompt"');
  const n = Math.min(Math.max(Number(body.n) || 1, 1), 4);
  const model = resolveModel(body.model);
  const aspect = resolveAspect(body.aspect_ratio ?? body.size, model);
  const seed = Number.isFinite(Number(body.seed)) && body.seed !== '' ? Number(body.seed) : undefined;
  const responseFormat = str(body.response_format, 'b64_json');
  const size = str(body.size_2k_4k ?? body.quality, '').toLowerCase(); // '2k' | '4k' (upscale sau khi sinh)

  const t0 = Date.now();
  let { items, mediaIds } = await generateRaw({ prompt, n, aspect, model: model.upstream, seed });
  if (!items.length) throw new HttpError(502, 'Không trích xuất được ảnh nào từ phản hồi của Google');

  // upscale (chỉ backend flow, cần media id)
  if (size === '2k' || size === '4k') {
    const target = mediaIds[0] || items.find((i) => i.mediaId)?.mediaId;
    if (target) {
      const b64 = await flowUpsample({ mediaId: target, size });
      if (b64) items[0] = { b64, seed: items[0].seed };
      else log('Upsample không trả về encodedImage');
    } else log('Bỏ qua upscale: không có media id');
  }

  const data = [];
  for (const [i, item] of items.entries()) {
    let buf;
    if (item.b64) {
      buf = Buffer.from(item.b64, 'base64');
    } else if (item.url) {
      log(`Tải ảnh ${i + 1}/${items.length}: ${item.url.slice(0, 100)}...`);
      buf = (await downloadImage(item.url)).buf;
    } else {
      continue;
    }
    const saved = saveImage(buf);
    const entry = { seed: item.seed };
    if (responseFormat === 'url') entry.url = `http://127.0.0.1:${cfg.port}/files/${saved.name}`;
    else entry.b64_json = buf.toString('base64');
    entry.saved_path = saved.path;
    data.push(entry);
    log(`Đã lưu ${saved.path} (${(buf.length / 1024).toFixed(0)} KB)`);
  }
  log(`Hoàn tất ${data.length}/${n} ảnh sau ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  json(res, 200, {
    created: Math.floor(Date.now() / 1000),
    model: model.key,
    backend: resolveBackend(),
    batch_id: mediaIds[0] || undefined,
    data,
  });
}

async function handleUpscale(req, res) {
  const body = await parseJsonBody(req);
  const mediaId = str(body.media_id ?? body.mediaId, '');
  const size = str(body.size, '2k').toLowerCase();
  if (!mediaId) throw new HttpError(400, 'Thiếu "media_id" (lấy từ trường batch_id của /v1/images/generations)');
  if (!['2k', '4k'].includes(size)) throw new HttpError(400, '"size" phải là 2k hoặc 4k');
  const b64 = await flowUpsample({ mediaId, size });
  if (!b64) throw new HttpError(502, 'Upstream không trả về encodedImage');
  const buf = Buffer.from(b64, 'base64');
  const saved = saveImage(buf);
  json(res, 200, {
    created: Math.floor(Date.now() / 1000),
    data: [{ b64_json: buf.toString('base64'), saved_path: saved.path }],
  });
}

async function handleHealth(res) {
  const out = {
    ok: true,
    backend: cfg.backend,
    effective_backend: resolveBackend(),
    project_id: cfg.projectId,
    has_cookies: Boolean(currentCookieJar()),
    cookie_source: browserState.cookie && Date.now() - browserState.cookieTs < 30 * 60_000 ? 'extension (tươi)' : 'cookies.txt',
    has_session_token: Boolean(extractSessionToken(currentCookieJar())),
    recaptcha_pool: browserState.tokens.length,
    has_recaptcha_token: Boolean(cfg.recaptchaToken),
    relay: relayAlive() ? 'trang Flow đã kết nối ✅' : 'chưa — F5 tab Flow sau khi reload extension',
    has_session_from_app: Boolean(browserState.at && browserState.fsid),
    output_dir: cfg.outputDir,
  };
  if (tokenState.at && tokenState.expires > Date.now()) {
    out.token_expires = new Date(tokenState.expires).toISOString();
  }
  json(res, 200, out);
}

function handleModels(res) {
  json(res, 200, {
    object: 'list',
    data: Object.entries(IMAGE_MODELS).map(([id, m]) => ({
      id,
      object: 'model',
      owned_by: 'google-flow',
      upstream_model: m.upstream,
      supported_aspect_ratios: m.aspects,
      label: m.label,
    })),
  });
}

/* ------------------------- Trang chủ mini để test ------------------------- */

const HOME_HTML = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Flow Image Proxy</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;background:#0f1117;color:#e6e6e6}
 input,select,textarea,button{width:100%;box-sizing:border-box;padding:.6rem;margin:.3rem 0;border-radius:8px;border:1px solid #333;background:#1a1d27;color:inherit;font-size:1rem}
 button{background:#4f6ef7;cursor:pointer;border:0;font-weight:600}
 img{max-width:100%;border-radius:8px;margin-top:.5rem}
 .row{display:flex;gap:.5rem}.row>*{flex:1}
 #status{color:#9aa0b4;font-size:.9rem;white-space:pre-wrap}
</style></head><body>
<h2>Flow Image Proxy</h2>
<p>Project: <code>${cfg.projectId}</code> · backend: <code>${cfg.backend}</code></p>
<textarea id="prompt" rows="3" placeholder="Mô tả ảnh cần tạo..."></textarea>
<div class="row">
 <select id="model">${Object.keys(IMAGE_MODELS).map((k) => `<option>${k}</option>`).join('')}</select>
 <select id="ar"><option>16:9</option><option>9:16</option><option>1:1</option><option>4:3</option><option>3:4</option></select>
 <input id="n" type="number" min="1" max="4" value="1">
</div>
<button onclick="gen()">Tạo ảnh</button>
<div id="status"></div>
<div id="out"></div>
<script>
async function gen(){
 const s=document.getElementById('status'),o=document.getElementById('out');
 s.textContent='Đang tạo ảnh...';o.innerHTML='';
 try{
  const r=await fetch('/v1/images/generations',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({prompt:document.getElementById('prompt').value,model:document.getElementById('model').value,
    aspect_ratio:document.getElementById('ar').value,n:+document.getElementById('n').value,response_format:'url'})});
  const j=await r.json();
  if(j.error){s.textContent='Lỗi: '+j.error.message;return}
  s.textContent='Xong. Đã lưu: '+j.data.map(d=>d.saved_path).join(', ');
  for(const d of j.data){const im=document.createElement('img');im.src=d.url;o.appendChild(im)}
 }catch(e){s.textContent='Lỗi: '+e.message}
}
</script></body></html>`;

/* ----------------------------- Router chính ------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${cfg.port}`);
  const p = url.pathname;
  try {
    reloadCookiesIfNeeded();
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }); return res.end(); }

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(HOME_HTML);
    }

    // endpoint nội bộ cho extension (chỉ lắng nghe trên 127.0.0.1, không cần API key)
    if (req.method === 'POST' && p === '/internal/recaptcha-token') return await handleInternal(req, res, 'token');
    if (req.method === 'POST' && p === '/internal/browser-state') return await handleInternal(req, res, 'state');
    if (req.method === 'GET' && p === '/internal/relay/next') return await handleRelayNext(res);
    if (req.method === 'POST' && p === '/internal/relay/result') return await handleRelayResult(req, res);

    if (!requireAuth(req)) return json(res, 401, { error: { message: 'API key không đúng (Authorization: Bearer <FLOW_API_KEY>)', type: 'auth' } });

    if (req.method === 'GET' && p === '/health') return await handleHealth(res);
    if (req.method === 'GET' && p === '/v1/models') return handleModels(res);
    if (req.method === 'POST' && (p === '/v1/images/generations' || p === '/generate' || p === '/v1/generate')) return await handleGenerate(req, res);
    if (req.method === 'POST' && p === '/v1/images/upscale') return await handleUpscale(req, res);

    if (req.method === 'GET' && p.startsWith('/files/')) {
      // chỉ phục vụ file trong outputDir: basename chống ../, resolve + kiểm tra biên chống tràn thư mục
      const name = path.basename(decodeURIComponent(p.slice('/files/'.length)));
      const file = path.resolve(cfg.outputDir, name);
      if ((file !== cfg.outputDir && !file.startsWith(cfg.outputDir + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return json(res, 404, { error: { message: 'Không tìm thấy file' } });
      }
      const buf = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': `image/${sniffExt(buf)}`, 'Access-Control-Allow-Origin': '*' });
      return res.end(buf);
    }

    json(res, 404, { error: { message: `Không tìm thấy route ${req.method} ${p}` } });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const type = e instanceof HttpError ? e.type : 'internal_error';
    log(`Lỗi ${status} [${p}]:`, e.message);
    if (!res.headersSent) json(res, status, { error: { message: e.message, type } });
    else res.end();
  }
});

loadTokenCache();
server.listen(cfg.port, '127.0.0.1', () => {
  log(`Flow Image Proxy đang chạy tại http://127.0.0.1:${cfg.port} (chỉ lắng nghe localhost)`);
  log(`Project: ${cfg.projectId} | backend: ${cfg.backend} | cookies: ${cfg.cookies ? 'OK' : 'CHƯA CÓ (lưu vào cookies.txt)'}`);
  log(`Endpoints: GET /v1/models · POST /v1/images/generations · POST /v1/images/upscale · GET /health`);
  log(`Nội bộ (cho extension): POST /internal/recaptcha-token · POST /internal/browser-state`);
});
