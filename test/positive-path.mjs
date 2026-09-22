/**
 * 告警状态机 + 邮件渲染测试（纯逻辑，不打网络）。
 * 网络部分见 test/live.mjs。
 *
 * 运行： node test/positive-path.mjs
 */
import assert from 'node:assert';
import { loadConfig } from '../src/config.js';
import { storeLabel } from '../src/apple.js';
import { decideAlerts as planAlerts, acknowledgeAlerts } from '../src/alerts.js';
// 本测试模拟成功发送；失败与重启由 reliability.mjs 覆盖。
function decideAlerts(results, state, cfg, now) {
  const plan = planAlerts(results, state, cfg, now);
  acknowledgeAlerts([...plan.priorityItems, ...plan.otherItems, ...plan.soldOut], state, now);
  return plan;
}
import { buildPriorityMail, buildReferenceMail, buildSoldOutMail } from '../src/mailer.js';

const cfg = loadConfig();

const mk = (key, stores, parts = { HK: 'MJXU4ZA/A' }) => ({
  key,
  parts,
  product: { key, name: `测试机 ${key}`, parts, buyUrls: {} },
  ok: true,
  count: stores.length,
  stores,
  otherStores: [],
  atPriority: stores.includes(cfg.priorityStore),
});

console.log('=== 1. 告警状态机（优先门店 = ' + cfg.priorityStore + '） ===');
{
  const P = cfg.priorityStore;
  const st = { parts: {} };

  let a = decideAlerts([mk('P1', [P, 'R610'])], st, cfg);
  assert.equal(a.priorityItems.length, 1, '优先门店有货应触发优先通知');
  assert.equal(a.otherItems.length, 0);
  console.log('  ✓ 优先门店有货 → 优先通知');

  a = decideAlerts([mk('P1', [P])], st, cfg);
  assert.equal(a.priorityItems.length, 0, '未到间隔不应重复提醒');
  assert.equal(a.isReminder, false);
  console.log('  ✓ 持续有货且未到间隔 → 不重复打扰');

  const st2 = { parts: { P1: { role: 'priority', lastAlertAt: new Date(Date.now() - 60 * 60_000).toISOString() } } };
  a = decideAlerts([mk('P1', [P])], st2, cfg);
  assert.equal(a.priorityItems.length, 1);
  assert.equal(a.isReminder, true, '超过间隔应标记为提醒');
  console.log('  ✓ 超过重复提醒间隔 → 再提醒一次');

  const st3 = { parts: {} };
  a = decideAlerts([mk('P2', ['R610', 'R428'])], st3, cfg);
  assert.equal(a.priorityItems.length, 0);
  assert.equal(a.otherItems.length, 1, '其他门店有货应发备选通知');
  console.log('  ✓ 其他门店有货 → 备选通知');

  a = decideAlerts([mk('P2', [P, 'R610'])], st3, cfg);
  assert.equal(a.priorityItems.length, 1, '备选升级为优先门店应再发优先通知');
  console.log('  ✓ 备选门店 → 优先门店（升级）→ 优先通知');

  const st4 = { parts: { P3: { role: 'priority' } } };
  a = decideAlerts([mk('P3', [])], st4, cfg);
  assert.equal(a.soldOut.length, 1, '库存消失应发收尾通知');
  console.log('  ✓ 库存消失 → 收尾通知');

  const st5 = { parts: {} };
  a = decideAlerts([mk('P4', [])], st5, cfg);
  assert.equal(a.soldOut.length, 0);
  console.log('  ✓ 一直没有货 → 不发任何邮件');

  // 多地区目标：状态按 key 隔离，不会互相污染
  const st6 = { parts: {} };
  decideAlerts([mk('A', []), mk('B', [P])], st6, cfg);
  assert.equal(st6.parts.A.role, 'none');
  assert.equal(st6.parts.B.role, 'priority');
  console.log('  ✓ 多目标状态互相隔离');
}

console.log('\n=== 2. 邮件渲染 ===');
{
  const items = [mk('iPhone 18 Pro Max|512GB|Silver', [cfg.priorityStore, 'R610'], { CN: 'MJYC4CH/A', HK: 'MJXU4ZA/A' })];
  items[0].product = {
    key: items[0].key,
    name: 'iPhone 18 Pro Max 512GB 银色',
    parts: { CN: 'MJYC4CH/A', HK: 'MJXU4ZA/A' },
    buyUrls: { CN: 'https://www.apple.com.cn/shop/buy-iphone/iphone-18-pro/mjyc4ch/a' },
  };

  const p = buildPriorityMail(items, cfg);
  assert.ok(p.subject.includes('有货'), '优先邮件标题应说明有货');
  assert.ok(p.html.includes(storeLabel(cfg.priorityStore)), '邮件正文应列出优先门店');
  assert.ok(!p.html.includes('MJYC4CH/A'), '香港门店邮件不应混入大陆料号');
  assert.ok(p.html.includes('MJXU4ZA/A'), '邮件正文应列出香港料号');
  console.log(`  ✓ 优先邮件: ${p.subject}`);
  console.log(`     ${p.text.split('\n')[1]}`);

  const r = buildReferenceMail(items, cfg);
  assert.ok(r.subject.includes('其他门店有货'));
  console.log(`  ✓ 备选邮件: ${r.subject}`);

  const s = buildSoldOutMail(items, cfg);
  assert.ok(s.subject.includes('库存已消失'));
  console.log(`  ✓ 收尾邮件: ${s.subject}`);

  // 多机型共用前缀应折叠（避免 "512GB 512GB"）
  const two = [
    { product: { name: 'iPhone 18 Pro Max 512GB 银色' }, parts: { HK: 'A' }, stores: ['R499'] },
    { product: { name: 'iPhone 18 Pro Max 512GB 黑色' }, parts: { HK: 'B' }, stores: ['R499'] },
  ];
  const m = buildPriorityMail(two, cfg);
  assert.ok(m.subject.includes('银色 / 黑色'), `标题应折叠公共前缀，实际: ${m.subject}`);
  assert.ok(!/512GB 512GB/.test(m.subject), '标题不应重复容量');
  console.log(`  ✓ 多机型标题折叠: ${m.subject}`);
}

console.log('\n✅ 全部通过');
