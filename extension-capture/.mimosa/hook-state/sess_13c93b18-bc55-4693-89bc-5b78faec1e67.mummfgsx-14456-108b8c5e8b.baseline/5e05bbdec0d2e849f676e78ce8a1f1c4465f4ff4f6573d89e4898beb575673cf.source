// Relay: cầu nối giữa trang (MAIN world) và service worker.
'use strict';

function reportHello() {
  try {
    const injected = document.documentElement.dataset.flowCapture === '1';
    chrome.runtime.sendMessage({ type: 'hello', mainInjected: injected }).catch(() => {});
  } catch { /* bỏ qua */ }
}

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const d = e.data;
  if (d && d.__flow_capture) {
    try { chrome.runtime.sendMessage({ type: 'record', record: d.__flow_capture }).catch(() => {}); }
    catch { /* bỏ qua */ }
  }
  if (d && d.__flow_capture_event) {
    try { chrome.runtime.sendMessage({ type: 'page-event', event: d.__flow_capture_event }).catch(() => {}); }
    catch { /* bỏ qua */ }
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'mint-now') {
    try { window.postMessage({ __flow_mint: true }, '*'); } catch { /* bỏ qua */ }
  }
});

reportHello();
setTimeout(reportHello, 3000);
