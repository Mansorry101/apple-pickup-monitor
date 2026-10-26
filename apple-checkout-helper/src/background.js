/* background.js —— service worker */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.get(['afConfig'], (r) => {
      if (!r || !r.afConfig) {
        chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html?welcome=1') });
      }
    });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'fill-now') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'AF_RUN', mode: 'fillNext' });
  } catch (e) {
    // 页面没注入 content script 时，忽略
  }
});

// 向本机监控程序（定制版）领取交接信息。只连 127.0.0.1，令牌一次性
const HANDOFF_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function claimHandoff(id, port) {
  const p = Number(port);
  if (!HANDOFF_ID_RE.test(String(id || '')) || !Number.isInteger(p) || p < 1024 || p > 65535) {
    return { ok: false, error: '交接参数不对' };
  }
  try {
    const res = await fetch('http://127.0.0.1:' + p + '/api/handoff/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) return { ok: false, error: body.error || ('HTTP ' + res.status) };
    return { ok: true, handoff: body.handoff };
  } catch (e) {
    return { ok: false, error: '连不上监控程序（127.0.0.1:' + p + '），确认它还在运行' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'AF_HANDOFF_CLAIM') {
    // 只接受 Apple 大陆官网页面里的 content script
    const from = (sender && sender.url) || '';
    if (!/^https:\/\/([a-z0-9-]+\.)*apple\.com\.cn\//i.test(from)) { sendResponse({ ok: false, error: 'bad-sender' }); return; }
    claimHandoff(msg.id, msg.port).then(sendResponse);
    return true;
  }
  if (msg.type === 'AF_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  } else if (msg.type === 'AF_RUN_ACTIVE') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) { sendResponse({ ok: false, error: 'no-tab' }); return; }
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'AF_RUN', mode: msg.mode || 'fillNext' });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: 'not-injected' });
      }
    });
    return true;
  }
});
