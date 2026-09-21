/**
 * 设置界面的浏览器实测（需要本机装有 Chrome / Edge）。
 *
 * 用无头浏览器真的把页面渲染一遍、跑完 JS，再通过 DevTools Protocol
 * 读回每个下拉框的选项数 —— 检查它们是否真的有内容。
 *
 * 起因：界面里「同时监控的门店」的城市/门店两个 <select> 忘了初始化。
 * 它们在原始 HTML 里本来就是空的（选项是 JS 运行时填的），
 * 所以只读源码或只抓 HTML 都发现不了，必须真的渲染一次。
 *
 * 运行： node test/ui.mjs
 */
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { startWebUi } from '../src/webui.js';

const UI_PORT = 8899;   // 故意避开 8787，免得和用户正开着的设置窗口打架
const CDP_PORT = 9333;

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const browser = BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!browser) {
  console.log('⚠️  没找到 Chrome / Edge，跳过界面渲染测试');
  process.exit(0);
}
assert.ok(typeof WebSocket === 'function', '需要 Node 22+（内置 WebSocket）来驱动浏览器');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cfg = loadConfig();
const logs = [];
const ui = await startWebUi(
  {
    getCfg: () => ({ ...cfg, uiPort: UI_PORT }),
    reload: () => {},
    status: () => ({ lastCheckAt: null, lastError: null, results: [] }),
    runsMonitor: false,
    version: 'test',
    runCheckNow: async () => [],
    sendTestMail: async () => {},
  },
  (m) => logs.push(m),
);
assert.ok(ui.server, `设置界面没起来：${logs.join(' | ')}`);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-ui-'));
const chrome = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `http://127.0.0.1:${UI_PORT}/`,
  ],
  { stdio: 'ignore', windowsHide: true },
);

let ws;
const cleanup = () => {
  try { ws?.close(); } catch { /* */ }
  try { chrome.kill(); } catch { /* */ }
  try { ui.server.close(); } catch { /* */ }
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* */ }
};
process.on('exit', cleanup);

/** 找到页面 target 的调试地址 */
async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* 还没起来 */ }
    await sleep(500);
  }
  throw new Error('浏览器没有暴露调试端口');
}

const target = await findTarget();
ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')), { once: true });
});

let msgId = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  let m;
  try { m = JSON.parse(ev.data); } catch { return; }
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
function cdp(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`${method} 超时`)); } }, 20000);
  });
}

async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
}

// 等页面把下拉框都填好（bootstrap 是异步的）
const PROBE = `JSON.stringify((function(){
  var ids = ['p-city','p-store','w-city','w-store','m-family','m-cap','m-color'];
  var out = {};
  ids.forEach(function(id){
    var s = document.getElementById(id);
    out[id] = s ? { n: s.options.length, groups: s.querySelectorAll('optgroup').length,
                    disabled: s.disabled, first: s.options[0] ? s.options[0].textContent : '' } : null;
  });
  out.__ready = !!(document.getElementById('s-text') && document.getElementById('s-text').textContent !== '加载中…');
  return out;
})())`;

let snapshot = null;
for (let i = 0; i < 40; i++) {
  const raw = await evaluate(PROBE);
  const s = raw ? JSON.parse(raw) : null;
  if (s && s.__ready && s['w-city'] && s['w-city'].n > 0 && s['w-store'] && s['w-store'].n > 0) {
    snapshot = s;
    break;
  }
  snapshot = s;
  await sleep(500);
}
assert.ok(snapshot, '没能从页面里读到下拉框状态');

console.log('=== 各下拉框的实际渲染结果 ===');
const EXPECTED = ['p-city', 'p-store', 'w-city', 'w-store', 'm-family', 'm-cap', 'm-color'];
for (const id of EXPECTED) {
  const s = snapshot[id];
  if (!s) { console.log(`  ${id.padEnd(10)} ❌ 页面上找不到这个 <select>`); continue; }
  console.log(`  ${id.padEnd(10)} 选项=${String(s.n).padEnd(4)} 分组=${String(s.groups).padEnd(3)} ${s.disabled ? 'DISABLED' : '可用'}   首项="${s.first}"`);
}

console.log('\n=== 断言 ===');
for (const id of EXPECTED) {
  assert.ok(snapshot[id], `页面里应当有 #${id}`);
  assert.ok(snapshot[id].n > 0, `#${id} 是空下拉框（0 个选项）—— 点开将什么都不显示`);
}
console.log('  ✓ 7 个下拉框全部有内容（不会出现「点开是空的」）');

// 这次的回归重点
assert.ok(snapshot['w-city'].n > 1, '#w-city（同时监控的城市）应当列出多个城市');
assert.ok(snapshot['w-store'].n > 0, '#w-store（同时监控的门店）应当列出该城市的门店');
console.log('  ✓ 「同时监控的门店」的城市 / 门店下拉框已正确填充');

assert.ok(snapshot['w-city'].groups >= 2, '#w-city 应当按 中国大陆 / 香港 / 澳门 分组');
console.log('  ✓ 城市下拉按地区分组');

assert.ok(snapshot['m-family'].n >= 5, '机型下拉应当有多个机型可选');
assert.ok(snapshot['m-color'].n > 0, '颜色下拉应当有选项');
console.log('  ✓ 机型 / 容量 / 颜色 三级下拉已填充');

// 切一个城市，门店下拉应当跟着变（级联是否真的生效）
const cityKeys = await evaluate(`JSON.stringify(Array.prototype.map.call(document.getElementById('w-city').options, function(o){return o.value;}))`);
const keys = JSON.parse(cityKeys);
const beijing = keys.find((k) => k === 'CN:北京');
assert.ok(beijing, '城市列表里应当有 北京');
await evaluate(`(function(){var s=document.getElementById('w-city');s.value=${JSON.stringify(beijing)};s.dispatchEvent(new Event('change'));return 1;})()`);
await sleep(300);
const after = JSON.parse(await evaluate(PROBE));
assert.ok(after['w-store'].n >= 6, `切到北京后门店下拉应有 6 家，实际 ${after['w-store'].n}`);
console.log(`  ✓ 级联生效：切到「北京」→ 门店下拉变成 ${after['w-store'].n} 家，首项 "${after['w-store'].first}"`);

// 澳门不可查询 → 门店下拉应被禁用
const macau = keys.find((k) => k === 'MO:澳門');
assert.ok(macau, '城市列表里应当有 澳門');
await evaluate(`(function(){var s=document.getElementById('w-city');s.value=${JSON.stringify(macau)};s.dispatchEvent(new Event('change'));return 1;})()`);
await sleep(300);
const mo = JSON.parse(await evaluate(PROBE));
assert.equal(mo['w-store'].disabled, true, '澳门没有网上商店，门店下拉应当被禁用');
console.log('  ✓ 选到澳门时门店下拉被正确禁用');

console.log('\n✅ 界面渲染测试通过');
cleanup();
