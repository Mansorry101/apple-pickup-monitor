import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBarkInput, buildPush, sendPush, BAG_URL, maskKey } from '../src/push.js';
import { deliverAlerts } from '../src/notifications.js';
import { updateEnvText } from '../src/push-setup.js';
import { STORE_BY_ID } from '../src/stores.js';

const KEY = 'AbCdEfGh12345678';
const URL_CN = 'https://www.apple.com.cn/shop/buy-iphone/iphone-18-pro/test';
const product = { key: 'P', name: '测试机', parts: { CN: 'TEST1CH/A' }, buyUrls: { CN: URL_CN } };
const cfg = {
  products: [product], watchRegions: ['CN'], watchStores: ['R484', 'R761'],
  priorityStore: 'R484', priorityStoreRegion: 'CN', priorityStoreInfo: STORE_BY_ID.R484,
  priorityStoreFor: { CN: 'R484' }, priorityOnly: false, soldOutNotify: true, repeatAlertMinutes: 0,
  push: { keys: [KEY], server: 'https://api.day.app', critical: false, open: 'product' },
};
const row = (stores, more = {}) => ({ key: 'P', product, parts: product.parts, stores,
  atPriority: stores.includes('R484'), ok: true, complete: true, priorityKnown: true, ...more });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** 替换 fetch，记录请求；handler 返回 [status, json] */
function mockFetch(handler) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const [status, json] = await handler(body, calls.length);
    return new Response(JSON.stringify(json), { status });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test('Bark 输入：整条示例地址、只有 key、多台设备、自建服务器、无效内容', () => {
  assert.deepEqual(parseBarkInput(`https://api.day.app/${KEY}/推送内容`), { server: 'https://api.day.app', keys: [KEY] });
  assert.deepEqual(parseBarkInput(KEY).keys, [KEY]);
  assert.deepEqual(parseBarkInput(`${KEY}，ZzYyXxWw87654321, ${KEY}`).keys, [KEY, 'ZzYyXxWw87654321'], '中文逗号分隔、去重');
  assert.equal(parseBarkInput(`https://bark.example.com:8080/${KEY}/x`).server, 'https://bark.example.com:8080');
  assert.deepEqual(parseBarkInput('你好 abc https://api.day.app/push').keys, []);
  assert.equal(maskKey(KEY), 'AbCd****');
});

test('优先门店推送：时效性通知 + 循环响铃，点开商品页；重要警告 / 购物袋 / 仍有货提醒', () => {
  const m = buildPush('priority', [row(['R484'])], cfg);
  assert.match(m.title, /有货/);
  assert.match(m.body, /测试机：.*益田/);
  assert.equal(m.level, 'timeSensitive');
  assert.equal(m.call, '1');
  assert.equal(m.url, URL_CN);

  const crit = buildPush('priority', [row(['R484'])], { ...cfg, push: { ...cfg.push, critical: true, open: 'bag' } });
  assert.equal(crit.level, 'critical');
  assert.equal(crit.url, BAG_URL.CN);

  const again = buildPush('priority', [row(['R484'])], cfg, { reminder: true });
  assert.match(again.title, /仍有货/);
  assert.equal(again.call, undefined, '定时提醒只响一声');
});

test('备选 / 售罄推送：级别更低，不循环响铃', () => {
  const other = buildPush('other', [row(['R761'])], cfg);
  assert.equal(other.level, 'timeSensitive');
  assert.equal(other.call, undefined);
  assert.match(other.subtitle, /暂无库存/);
  const gone = buildPush('soldOut', [row([])], cfg);
  assert.equal(gone.level, 'passive');
  assert.match(gone.body, /不可门市取货/);
});

test('sendPush：请求体带 device_key；5xx / 网络错误重试一次，4xx 不重试', async () => {
  let m = mockFetch(() => [200, { code: 200, message: 'success' }]);
  try {
    const r = await sendPush(cfg.push, { title: 't', body: 'b' });
    assert.equal(r.sent, 1);
    assert.equal(m.calls[0].url, 'https://api.day.app/push');
    assert.equal(m.calls[0].body.device_key, KEY);
    assert.equal(m.calls[0].body.isArchive, '1');
  } finally { m.restore(); }

  m = mockFetch((b, n) => (n === 1 ? [500, { code: 500, message: 'busy' }] : [200, { code: 200 }]));
  try {
    await sendPush(cfg.push, { title: 't' });
    assert.equal(m.calls.length, 2);
  } finally { m.restore(); }

  m = mockFetch(() => [400, { code: 400, message: 'failed to get device token' }]);
  try {
    await assert.rejects(sendPush(cfg.push, { title: 't' }), /400.*device token/);
    assert.equal(m.calls.length, 1, 'key 无效不重试');
  } finally { m.restore(); }
});

test('sendPush：多台设备一台失败不影响其他；全部失败才报错', async () => {
  const push = { ...cfg.push, keys: [KEY, 'BadKey0000000000'] };
  let m = mockFetch((b) => (b.device_key === KEY ? [200, { code: 200 }] : [400, { code: 400, message: 'bad' }]));
  try {
    const r = await sendPush(push, { title: 't' });
    assert.equal(r.sent, 1);
    assert.equal(r.failed.length, 1);
    assert.match(r.failed[0], /^BadK\*{4}/, '日志里 key 打码');
  } finally { m.restore(); }
  await assert.rejects(sendPush({ keys: [] }, { title: 't' }), /未配置/);
});

test('推送不等邮件：SMTP 卡住时推送已经发出', async () => {
  const state = { parts: {} };
  const mailGate = deferred();
  const pushed = [];
  const job = deliverAlerts([row(['R484'])], state, cfg, {
    persist: () => {}, pushed: new Set(),
    send: async () => { await mailGate.promise; return { accepted: ['x'] }; },
    push: async (kind, items) => { pushed.push(kind); return 'ok'; },
  });
  await tick();
  assert.deepEqual(pushed, ['priority'], '邮件还没发完，推送已经出去了');
  mailGate.resolve();
  await job;
  assert.ok(state.parts.P.lastAlertAt, '邮件成功后照常记为已通知');
});

test('邮件失败下一轮重试时，同一事件不会重复推送；推送失败不影响邮件和状态', async () => {
  const state = { parts: {} };
  const pushedIds = new Set();
  let pushes = 0;
  const logs = [];
  const opts = {
    persist: () => {}, pushed: pushedIds, log: (m) => logs.push(m),
    push: async () => { pushes++; return 'ok'; },
    send: async () => { throw new Error('SMTP timeout'); },
  };
  await deliverAlerts([row(['R484'])], state, cfg, opts);
  await deliverAlerts([row(['R484'])], state, cfg, opts);
  await tick();
  assert.equal(pushes, 1, '同一事件只推一次');
  assert.ok(state.parts.P.pending, '邮件失败仍保留待发送');

  // 推送失败：邮件照发，状态正常确认，并写日志
  const s2 = { parts: {} };
  await deliverAlerts([row(['R484'])], s2, cfg, {
    persist: () => {}, pushed: new Set(), log: (m) => logs.push(m),
    push: async () => { throw new Error('Bark 网络错误'); },
    send: async () => ({ accepted: ['x'] }),
  });
  await tick();
  assert.ok(s2.parts.P.lastAlertAt);
  assert.ok(logs.some((m) => /推送失败: Bark 网络错误/.test(m)));
});

test('推送失败后，邮件重试时允许再推一次；dry-run 不推送', async () => {
  const state = { parts: {} };
  const ids = new Set();
  let pushes = 0;
  const opts = {
    persist: () => {}, pushed: ids,
    push: async () => { pushes++; if (pushes === 1) throw new Error('timeout'); return 'ok'; },
    send: async () => { throw new Error('SMTP timeout'); },
  };
  await deliverAlerts([row(['R484'])], state, cfg, opts);
  await tick();
  await deliverAlerts([row(['R484'])], state, cfg, opts);
  await tick();
  assert.equal(pushes, 2);

  await deliverAlerts([row(['R484'])], { parts: {} }, cfg, {
    dryRun: true, persist: () => assert.fail('persist'), send: () => assert.fail('send'),
    push: () => assert.fail('push'),
  });
});

test('没配置推送时只发邮件，行为与原来一致', async () => {
  const state = { parts: {} };
  let mails = 0;
  await deliverAlerts([row(['R484'])], state, cfg, { persist: () => {}, send: async () => { mails++; return {}; } });
  assert.equal(mails, 1);
  assert.ok(state.parts.P.lastAlertAt);
});

test('写 .env：只改 BARK_* 几行，邮箱配置和注释原样保留；可删除', () => {
  const env = '# 邮件\r\nSMTP_USER=a@qq.com\nSMTP_PASS=secret\nBARK_KEY=old\n\n# 高级\nMAX_RETRIES=6\n';
  const next = updateEnvText(env, { BARK_KEY: KEY, BARK_CRITICAL: 'true' });
  assert.match(next, /SMTP_USER=a@qq\.com/);
  assert.match(next, /SMTP_PASS=secret/);
  assert.match(next, /# 高级\nMAX_RETRIES=6/);
  assert.match(next, new RegExp(`BARK_KEY=${KEY}`));
  assert.doesNotMatch(next, /BARK_KEY=old/);
  assert.match(next, /手机推送（Bark）[\s\S]*BARK_CRITICAL=true/);
  const off = updateEnvText(next, { BARK_KEY: null, BARK_CRITICAL: null });
  assert.doesNotMatch(off, /BARK_KEY|BARK_CRITICAL/);
  assert.match(off, /SMTP_PASS=secret/);
});

// ---------- 设置界面：测试推送按钮 ----------
import vm from 'node:vm';
import { PAGE } from '../src/webui-page.js';
import { startWebUi } from '../src/webui.js';

test('界面有「发送测试推送」按钮，未配置时禁用并提示，失败时写明原因', () => {
  assert.match(PAGE, /id="btn-testpush"[^>]*>发送测试推送</);
  assert.match(PAGE, /id="pushbox"/);
  const script = [...PAGE.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1];
  const begin = script.indexOf('  function renderPush()');
  const end = script.indexOf('  function renderStatus()', begin);
  const dom = { pushbox: {}, 'btn-testpush': { textContent: '发送测试推送' } };
  const render = (push, status) => vm.runInNewContext(script.slice(begin, end) + '\nrenderPush();', {
    el: (id) => dom[id], esc: (s) => s, state: { boot: { push, status } } });

  render({ configured: false }, {});
  assert.match(dom.pushbox.innerHTML, /配置手机推送\.bat/);
  assert.equal(dom['btn-testpush'].disabled, true);

  const p = { configured: true, devices: ['AbCd****'], critical: true, open: 'bag' };
  render(p, { push: { ok: null } });
  assert.equal(dom['btn-testpush'].disabled, false);
  assert.match(dom.pushbox.innerHTML, /AbCd\*{4}/);
  assert.match(dom.pushbox.innerHTML, /重要警告/);
  assert.match(dom.pushbox.innerHTML, /购物袋/);
  assert.match(dom.pushbox.innerHTML, /尚未推送过/);
  render(p, { push: { ok: true, checkedAt: '10:00' } });
  assert.match(dom.pushbox.innerHTML, /推送正常（10:00）/);
  render(p, { push: { ok: false, error: 'Bark 返回 400' } });
  assert.match(dom.pushbox.innerHTML, /推送失败：Bark 返回 400/);
  assert.match(dom.pushbox.innerHTML, /邮件通知不受影响/);
});

test('/api/test-push：成功返回设备数，失败返回原因；状态接口带推送信息但 key 打码', async () => {
  let fail = false;
  const cfg = { uiPort: 0, mail: { user: '', pass: '', to: [] },
    push: { keys: [KEY], critical: false, open: 'product' }, logFile: '' };
  const ui = await startWebUi({
    getCfg: () => cfg, reload: () => {}, status: () => ({}),
    sendTestPush: async () => { if (fail) throw new Error('Bark 返回 400：bad key'); return { sent: 1, failed: [] }; },
  }, () => {});
  try {
    const post = (p) => fetch(ui.url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json());
    assert.deepEqual(await post('/api/test-push'), { ok: true, sent: 1, failed: [] });
    fail = true;
    assert.deepEqual(await post('/api/test-push'), { ok: false, error: 'Bark 返回 400：bad key' });
    const st = await fetch(ui.url + '/api/status').then((r) => r.json());
    assert.deepEqual(st.push, { configured: true, devices: ['AbCd****'], critical: false, open: 'product' });
    assert.ok(!JSON.stringify(st).includes(KEY), '完整 key 不出现在接口里');
  } finally { ui.server.close(); }
});
