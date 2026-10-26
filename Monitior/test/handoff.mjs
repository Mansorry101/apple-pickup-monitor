// 有货 → 交给浏览器扩展下单：选机型、一次性令牌、冷却、浏览器启动参数、领取接口
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHandoff, pickHandoffItem, buildRecord, launchCommand, handoffUrl, checkoutUrlOf, HANDOFF_TTL_MS, BAG_URL,
  PROFILE_DIR, profileDirOf,
} from '../src/handoff.js';
import { deliverAlerts } from '../src/notifications.js';
import { normalizeSettings } from '../src/settings.js';
import { startWebUi } from '../src/webui.js';

const URL_SILVER = 'https://www.apple.com.cn/shop/buy-iphone/iphone-18-pro/mjyc4ch/a';
const URL_BLACK = 'https://www.apple.com.cn/shop/buy-iphone/iphone-18-pro/mjxt4ch/a';
const silver = { key: 'S', name: 'iPhone 18 Pro Max 512GB 银色', capacity: '512GB', colorZh: '银色', parts: { CN: 'MJYC4CH/A' }, buyUrls: { CN: URL_SILVER } };
const black = { key: 'B', name: 'iPhone 18 Pro Max 512GB 黑色', capacity: '512GB', colorZh: '黑色', parts: { CN: 'MJXT4CH/A' }, buyUrls: { CN: URL_BLACK } };
const cfg = (extra = {}) => ({
  autoCheckout: true, checkoutBrowser: 'chrome', checkoutCooldownMinutes: 10,
  priorityStore: 'R484', watchStores: ['R484', 'R761', 'R793'], products: [silver, black], ...extra,
});
const row = (product, stores, extra = {}) => ({
  key: product.key, product, parts: product.parts, stores, atPriority: stores.includes('R484'), ...extra,
});

test('选机型：优先门店有货的排前面，其次按监控列表顺序；没有大陆版本 / 大陆门店的不交接', () => {
  const c = cfg();
  assert.equal(pickHandoffItem([row(silver, ['R761']), row(black, ['R484'])], c).key, 'B');
  assert.equal(pickHandoffItem([row(black, ['R761']), row(silver, ['R793'])], c).key, 'S');
  const hkOnly = { ...silver, parts: { HK: 'MJYC4ZA/A' } };
  assert.equal(pickHandoffItem([row(hkOnly, ['R484'])], c), null);
  assert.equal(pickHandoffItem([row(silver, [])], c), null);
});

test('交接数据：门店按优先门店排序，只带下单需要的信息', () => {
  const r = buildRecord(row(silver, ['R761', 'R484']), cfg(), { id: 'x', now: 0 });
  assert.deepEqual(r.stores.map((s) => s.id), ['R484', 'R761']);
  assert.equal(r.product.part, 'MJYC4CH/A');
  assert.equal(r.product.buyUrl, URL_SILVER);
  assert.equal(Date.parse(r.expiresAt), HANDOFF_TTL_MS);
  assert.equal(handoffUrl('abc', 8787), BAG_URL + '#af-handoff=abc@8787');
});

test('浏览器启动：参数数组、不经 shell；只放行购物袋 + 令牌', () => {
  const url = handoffUrl('0f8a3c2e-1b2d-4c3e-8f9a-123456789abc', 8787);
  const found = { chrome: 'C:\\Chrome\\chrome.exe', edge: '' };
  assert.deepEqual(launchCommand(url, 'chrome', 'win32', found), { cmd: 'C:\\Chrome\\chrome.exe', args: [url] });
  assert.throws(() => launchCommand(url, 'edge', 'win32', found), /没找到 edge/);
  assert.deepEqual(launchCommand(url, 'D:\\b\\x.exe', 'win32', found).cmd, 'D:\\b\\x.exe');
  assert.deepEqual(launchCommand(url, 'chrome', 'darwin'), { cmd: 'open', args: ['-a', 'Google Chrome', url] });
  assert.throws(() => launchCommand('https://evil.example.com/#x', 'chrome', 'win32', found), /拒绝/);
  assert.throws(() => launchCommand(URL_SILVER + '#af-handoff=ab@1', 'chrome', 'win32', found), /拒绝/);
  assert.throws(() => launchCommand(BAG_URL + '#af-handoff=ab@1&calc', 'chrome', 'win32', found), /拒绝/);
  assert.equal(checkoutUrlOf({ buyUrls: { CN: 'http://www.apple.com.cn/shop/buy-iphone/x' } }), '');
});

test('专用下单配置：带 --user-data-dir 另起实例；不带令牌的购物袋也能打开', () => {
  const url = handoffUrl('0f8a3c2e-1b2d-4c3e-8f9a-123456789abc', 8787);
  const found = { chrome: 'C:\\Chrome\\chrome.exe', edge: '' };
  const prof = { profileDir: 'D:\\m\\browser-profile' };
  const flags = ['--user-data-dir=D:\\m\\browser-profile', '--no-first-run', '--no-default-browser-check'];
  assert.deepEqual(launchCommand(url, 'chrome', 'win32', found, prof).args, [...flags, url]);
  assert.deepEqual(launchCommand(BAG_URL, 'chrome', 'win32', found, prof).args, [...flags, BAG_URL]);
  assert.deepEqual(launchCommand(url, 'chrome', 'darwin', null, prof).args, ['-na', 'Google Chrome', '--args', ...flags, url]);
  assert.deepEqual(launchCommand(url, 'chrome', 'linux', null, prof), { cmd: 'google-chrome', args: [...flags, url] });
  assert.throws(() => launchCommand(BAG_URL + '?x=1', 'chrome', 'win32', found, prof), /拒绝/);
  assert.equal(profileDirOf({ checkoutProfile: true }), PROFILE_DIR);
  assert.equal(profileDirOf({}), PROFILE_DIR);
  assert.equal(profileDirOf({ checkoutProfile: false }), '');
  assert.match(PROFILE_DIR, /browser-profile$/);
});

function harness(extra = {}) {
  const opened = [];
  let t = 1_000_000;
  const logs = [];
  const h = createHandoff({
    getCfg: () => cfg(extra), getPort: () => 8787, now: () => t,
    open: async (url, browser, opts) => { opened.push({ url, browser, opts }); }, log: (m) => logs.push(m),
  });
  return { h, opened, logs, tick: (ms) => { t += ms; } };
}

test('触发：打开购物袋并带令牌；令牌只能领一次，过期作废', async () => {
  const { h, opened, tick } = harness();
  const rec = await h.trigger([row(silver, ['R484'], { alertId: 'a1' })]);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].url, handoffUrl(rec.id, 8787));
  assert.equal(opened[0].browser, 'chrome');
  assert.deepEqual(opened[0].opts, { profileDir: PROFILE_DIR });
  assert.equal(h.status().claimedAt, null);
  const got = h.claim(rec.id);
  assert.equal(got.product.part, 'MJYC4CH/A');
  assert.equal(got.claimedAt, undefined);
  assert.ok(h.status().claimedAt);
  assert.equal(h.claim(rec.id), null, '第二次领取应失败');
  assert.equal(h.claim('not-a-uuid'), null);

  tick(11 * 60_000);
  const rec2 = await h.trigger([row(black, ['R761'], { alertId: 'a2' })]);
  tick(HANDOFF_TTL_MS + 1);
  assert.equal(h.claim(rec2.id), null, '过期应失败');
});

test('冷却 / 提醒 / 重试：同一事件不重复交接，冷却期内不重复打开浏览器', async () => {
  const { h, opened, tick } = harness();
  await h.trigger([row(silver, ['R484'], { alertId: 'a1' })]);
  await h.trigger([row(silver, ['R484'], { alertId: 'a1' })]); // 邮件失败后同一事件重试
  tick(60_000);
  await h.trigger([row(black, ['R484'], { alertId: 'a2' })]); // 冷却中
  tick(10 * 60_000);
  await h.trigger([row(black, ['R484'], { alertId: 'a3', reminder: true })]); // 「仍有货」提醒不交接
  assert.equal(opened.length, 1);
  await h.trigger([row(black, ['R484'], { alertId: 'a4' })]);
  assert.equal(opened.length, 2);
});

test('关闭自动下单 / 打开浏览器失败：不交接，失败后不进入冷却', async () => {
  const off = harness({ autoCheckout: false });
  assert.equal(await off.h.trigger([row(silver, ['R484'])]), null);
  assert.equal(off.opened.length, 0);

  let fail = true;
  const opened = [];
  const h = createHandoff({
    getCfg: () => cfg(), getPort: () => 8787,
    open: async (url) => { if (fail) throw new Error('boom'); opened.push(url); },
  });
  await assert.rejects(h.trigger([row(silver, ['R484'], { alertId: 'x1' })]), /boom/);
  fail = false;
  await h.trigger([row(silver, ['R484'], { alertId: 'x2' })]);
  assert.equal(opened.length, 1, '上次失败不该占用冷却');

  const noUi = createHandoff({ getCfg: () => cfg(), getPort: () => null, open: async () => {} });
  await assert.rejects(noUi.trigger([row(silver, ['R484'])]), /设置界面没有启动/);
});

test('告警链路：有货时调用交接，且不等它（交接卡住不拖慢邮件）', async () => {
  const state = { parts: {} };
  const calls = [];
  const sent = [];
  const errors = await deliverAlerts([row(silver, ['R484'], { ok: true, complete: true })], state, cfg(), {
    send: async (m) => { sent.push(m.subject); return {}; }, persist: () => {},
    handoff: (items) => { calls.push(items.map((i) => i.key)); return new Promise(() => {}); },
  });
  assert.deepEqual(errors, []);
  assert.equal(sent.length, 1);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [['S']]);
});

test('设置：默认开启自动下单；浏览器只接受 chrome / edge / 路径', () => {
  const s = normalizeSettings({});
  assert.equal(s.autoCheckout, true);
  assert.equal(s.checkoutBrowser, 'chrome');
  assert.equal(s.checkoutCooldownMinutes, 10);
  assert.equal(normalizeSettings({ autoCheckout: false }).autoCheckout, false);
  assert.equal(s.checkoutProfile, true);
  assert.equal(normalizeSettings({ checkoutProfile: false }).checkoutProfile, false);
  assert.equal(normalizeSettings({ checkoutBrowser: 'EDGE' }).checkoutBrowser, 'edge');
  assert.equal(normalizeSettings({ checkoutBrowser: 'C:\\Program Files\\Chrome\\chrome.exe' }).checkoutBrowser, 'C:\\Program Files\\Chrome\\chrome.exe');
  assert.equal(normalizeSettings({ checkoutBrowser: 'calc" & x' }).checkoutBrowser, 'chrome');
  assert.equal(normalizeSettings({ checkoutCooldownMinutes: 0 }).checkoutCooldownMinutes, 1);
});

test('领取接口：只接受扩展来源，网页来源 403；领过返回 410', async () => {
  const { h } = harness();
  const ui = await startWebUi({
    getCfg: () => ({ uiPort: 0, mail: { to: [] } }), reload() {}, status: () => ({}), handoff: h,
  }, () => {});
  try {
    const rec = await h.trigger([row(silver, ['R484'], { alertId: 'w1' })]);
    const post = (origin) => fetch(`${ui.url}/api/handoff/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify({ id: rec.id }),
    });
    assert.equal((await post('https://evil.example.com')).status, 403);
    const ok = await post('chrome-extension://abcdefghijklmnop');
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).handoff.product.part, 'MJYC4CH/A');
    assert.equal((await post('chrome-extension://abcdefghijklmnop')).status, 410);
  } finally {
    ui.server.close();
  }
});
