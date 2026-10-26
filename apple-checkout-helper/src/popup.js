const $ = (id) => document.getElementById(id);

function setState(text) { $('state').textContent = text; }

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  let host = '';
  try { host = new URL(tab && tab.url).hostname; } catch (e) { /* chrome:// 等页面 */ }
  if (!/(^|\.)apple\.com(\.cn)?$/.test(host)) {
    setState('当前不是 Apple 页面');
    document.querySelectorAll('.body button').forEach((b) => (b.disabled = true));
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'AF_STATUS' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      setState('页面未注入脚本，刷新一下 Apple 页面');
      return;
    }
    setState('检测到 ' + res.fields + ' 个输入框 · ' + (res.mode === 'pickup' ? '取货模式' : '配送模式'));
  });
});

function send(mode) {
  chrome.runtime.sendMessage({ type: 'AF_RUN_ACTIVE', mode }, (res) => {
    if (!res || !res.ok) setState('触发失败，请刷新页面重试');
    else window.close();
  });
}

$('go').onclick = () => send('fillNext');
$('fill').onclick = () => send('fill');
$('auto').onclick = () => send('auto');
$('opt').onclick = () => chrome.runtime.openOptionsPage();
$('opt2').onclick = () => chrome.runtime.openOptionsPage();
