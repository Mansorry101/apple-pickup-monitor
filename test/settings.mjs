/**
 * config.json 读写与校验测试。
 *
 * 覆盖曾经踩过的坑：
 *  · 香港料号形如 MJXU4ZA/A（斜杠后只有 1 个字母），早期正则要求 2 个字母，
 *    导致所有目标被静默丢弃、回退成默认值。
 *  · 澳门没有网上商店，不能当成可监控门店。
 *  · 「用户故意清空机型」不能被偷偷塞回默认值。
 *
 * 运行： node test/settings.mjs
 */
import assert from 'node:assert';
import {
  normalizeSettings, DEFAULT_SETTINGS, enrichTargets, regionOfPartNumber,
} from '../src/settings.js';
import { STORE_BY_ID } from '../src/stores.js';

console.log('=== 料号 → 地区推断 ===');
{
  assert.equal(regionOfPartNumber('MJYC4CH/A'), 'CN');
  assert.equal(regionOfPartNumber('MJXU4ZA/A'), 'HK');
  assert.equal(regionOfPartNumber('MH3A4ZP/A'), 'HK');
  assert.equal(regionOfPartNumber('MJXU4XX/A'), null);
  assert.equal(regionOfPartNumber('garbage'), null);
  console.log('  ✓ CH→大陆，ZA/ZP→香港，其它不认');
}

console.log('\n=== 旧版配置自动迁移（v1 → v2）===');
{
  const r = normalizeSettings({
    version: 1,
    priorityStore: 'R499',
    cantonOnly: true,
    targets: [
      { partNumber: 'MJXU4ZA/A', name: 'iPhone 18 Pro Max 512GB 銀色' },
      { partNumber: 'MJXT4ZA/A', name: 'iPhone 18 Pro Max 512GB 黑色' },
    ],
  });
  assert.equal(r.version, 2);
  assert.equal(r.priorityOnly, true, 'cantonOnly 应迁移为 priorityOnly');
  assert.equal(r.targets.length, 2, '旧料号不应被丢弃');
  assert.deepEqual(r.targets[0].parts, { HK: 'MJXU4ZA/A' }, '旧料号应推断出香港地区');
  assert.deepEqual(r.watchStores, ['R499'], '未提供 watchStores 时应回填优先门店');
  console.log('  ✓ 旧配置的 cantonOnly / partNumber 都被正确迁移');
}

console.log('\n=== 料号校验 ===');
{
  const ok = ['MJXU4ZA/A', 'MJXT4ZA/A', 'MH3A4ZP/A', 'MJYC4CH/A', 'MHU64CH/A'];
  const r = normalizeSettings({ targets: ok.map((partNumber) => ({ partNumber })) });
  assert.equal(r.targets.length, ok.length, `这些真实料号都应被接受：${ok.join(', ')}`);
  console.log(`  ✓ ${ok.length} 个真实料号全部通过`);

  const bad = ['', 'ABC', 'MJXU4ZA', 'MJXU4ZA/', '/A', 'mj xu4za/a'];
  assert.equal(normalizeSettings({ targets: bad.map((partNumber) => ({ partNumber })) }).targets.length, 0);
  console.log('  ✓ 非法料号被正确过滤');

  // 新版格式：key + parts
  const r2 = normalizeSettings({
    targets: [{ key: 'iPhone 18 Pro Max|512GB|Silver', parts: { CN: 'mjYC4ch/a', HK: 'MJXU4ZA/A' } }],
  });
  assert.equal(r2.targets.length, 1);
  assert.deepEqual(r2.targets[0].parts, { CN: 'MJYC4CH/A', HK: 'MJXU4ZA/A' }, '料号应统一大写');
  console.log('  ✓ 新版 key+parts 格式正确规范化（大小写归一）');

  // 两部地区都没有的 key 应被丢弃
  assert.equal(normalizeSettings({ targets: [{ key: 'X', parts: { MO: 'MJXU4ZA/A' } }] }).targets.length, 0);
  console.log('  ✓ 没有可查询地区料号的目标被丢弃');

  // 去重
  const r3 = normalizeSettings({
    targets: [{ partNumber: 'MJXU4ZA/A' }, { partNumber: 'mjxu4za/a' }],
  });
  assert.equal(r3.targets.length, 1, '重复料号（含大小写差异）应去重');
  console.log('  ✓ 重复目标去重');
}

console.log('\n=== 显式清空 vs 未提供 ===');
{
  assert.equal(normalizeSettings({ targets: [] }).targets.length, 0, '显式传空数组应保持为空');
  console.log('  ✓ 显式清空 targets 被尊重');
  assert.equal(
    normalizeSettings({ priorityStore: 'R428' }).targets.length,
    DEFAULT_SETTINGS.targets.length,
    '未提供 targets 时应用默认值',
  );
  console.log('  ✓ 未提供 targets 时回退默认值');
}

console.log('\n=== 门店校验 ===');
{
  assert.equal(normalizeSettings({ priorityStore: 'R428' }).priorityStore, 'R428', '香港门店可用');
  assert.equal(normalizeSettings({ priorityStore: 'R401' }).priorityStore, 'R401', '大陆门店可用');
  assert.equal(normalizeSettings({ priorityStore: 'R999' }).priorityStore, 'R499', '非法门店应回退');
  assert.equal(normalizeSettings({ priorityStore: 'hack' }).priorityStore, 'R499');
  console.log('  ✓ 合法门店保留，非法门店回退');

  assert.equal(
    normalizeSettings({ priorityStore: 'R697' }).priorityStore, 'R499',
    '澳门门店没有网上商店，不能作为优先门店',
  );
  console.log('  ✓ 澳门门店被拒绝作为优先门店（无网上商店）');
}

console.log('\n=== 监控门店列表清洗 ===');
{
  const r = normalizeSettings({ priorityStore: 'R401', watchStores: ['R401', 'R499', 'R499', 'R697', 'R888', ''] });
  assert.deepEqual(r.watchStores, ['R401', 'R499'], '应去重、剔除澳门与非法门店');
  console.log('  ✓ 去重 + 剔除澳门/非法门店');

  // 优先门店必须出现在监控列表里
  const r2 = normalizeSettings({ priorityStore: 'R499', watchStores: ['R401'] });
  assert.equal(r2.watchStores[0], 'R499', '优先门店应被补进监控列表的开头');
  console.log('  ✓ 优先门店始终包含在监控列表中');

  const r3 = normalizeSettings({ priorityStore: 'R401', watchStores: [] });
  assert.deepEqual(r3.watchStores, ['R401']);
  console.log('  ✓ 空列表回填优先门店');
}

console.log('\n=== 数值范围钳制 ===');
{
  assert.equal(normalizeSettings({ pollIntervalSeconds: 1 }).pollIntervalSeconds, 30, '轮询间隔过低应被抬到 30');
  assert.equal(normalizeSettings({ pollIntervalSeconds: 999999 }).pollIntervalSeconds, 86400);
  assert.equal(normalizeSettings({ repeatAlertMinutes: -5 }).repeatAlertMinutes, 0);
  assert.equal(normalizeSettings({ uiPort: 80 }).uiPort, 1024)
  assert.equal(normalizeSettings({ pollIntervalSeconds: 'abc' }).pollIntervalSeconds, 60);
  console.log('  ✓ 轮询间隔 / 重复提醒 / 端口 都被正确钳制');
}

console.log('\n=== 目录补全（多地区）===');
{
  const catalog = {
    regions: ['CN', 'HK'],
    variants: [{
      key: 'iPhone 18 Pro Max|512GB|Silver',
      family: 'iPhone 18 Pro Max', capacity: '512GB', color: 'Silver', colorZh: '银色',
      parts: { CN: 'MJYC4CH/A', HK: 'MJXU4ZA/A' },
      buyUrls: { CN: 'https://cn/x', HK: 'https://hk/y' },
      prices: { CN: 12999, HK: 13299 },
      availableIn: ['CN', 'HK'],
    }],
  };
  const [t] = enrichTargets([{ key: 'iPhone 18 Pro Max|512GB|Silver', parts: {} }], catalog);
  assert.equal(t.name, 'iPhone 18 Pro Max 512GB 银色');
  assert.deepEqual(t.parts, { CN: 'MJYC4CH/A', HK: 'MJXU4ZA/A' }, '应补全两地料号');
  assert.equal(t.buyUrls.CN, 'https://cn/x');
  console.log('  ✓ 一次选择补全两地料号与链接');

  // 只有香港料号的旧目标，也能被目录补成两地
  const [u] = enrichTargets([{ key: 'MJXU4ZA/A', parts: { HK: 'MJXU4ZA/A' } }], catalog);
  assert.deepEqual(u.parts, { HK: 'MJXU4ZA/A', CN: 'MJYC4CH/A' }, '按料号反查也能补全');
  console.log('  ✓ 按旧料号反查目录并补全');

  const [v] = enrichTargets([{ key: 'ZZZ', parts: { HK: 'ZZZZ9ZZ/A' } }], catalog);
  assert.equal(v.name, undefined, '目录里没有的目标应原样保留、不崩');
  assert.deepEqual(v.parts, { HK: 'ZZZZ9ZZ/A' });
  console.log('  ✓ 目录外的目标原样保留');
}

console.log('\n=== 门店目录完整性 ===');
{
  const { STORES, CITIES, REGIONS } = await import('../src/stores.js');
  assert.equal(STORES.length, 57, '大中华区应有 57 家 Apple Store');
  const byRegion = STORES.reduce((m, s) => ((m[s.region] = (m[s.region] || 0) + 1), m), {});
  assert.deepEqual(byRegion, { CN: 49, HK: 6, MO: 2 });
  console.log(`  ✓ 门店数：大陆 ${byRegion.CN} + 香港 ${byRegion.HK} + 澳门 ${byRegion.MO} = 57`);

  assert.equal(CITIES.length, 27, '应有 27 个有 Apple Store 的城市');
  assert.ok(CITIES.every((c) => c.stores.length === c.storeCount && c.storeCount > 0));
  console.log(`  ✓ 城市 ${CITIES.length} 个，与门店对应关系一致`);

  // 大陆每个城市都必须有定位用的「区」，否则查询会恒返回 0 家店
  const noDistrict = STORES.filter((s) => s.region === 'CN' && !s.district);
  assert.equal(noDistrict.length, 0, `这些大陆城市缺 district，会导致查不到库存：${noDistrict.map((s) => s.city).join(',')}`);
  console.log('  ✓ 大陆每个城市的定位行政区都已填好');

  assert.equal(REGIONS.MO.onlineStore, false, '澳门应标记为不可查询');
  assert.equal(REGIONS.CN.canaryPart, 'MH3A4CH/A');
  assert.equal(REGIONS.HK.canaryPart, 'MH3A4ZP/A');
  console.log('  ✓ 澳门标记为不可查询；两地哨兵料号正确');

  assert.ok(STORE_BY_ID.R499 && STORE_BY_ID.R499.region === 'HK');
  assert.ok(STORE_BY_ID.R401 && STORE_BY_ID.R401.region === 'CN');
  console.log('  ✓ 门店索引可用');
}

console.log('\n✅ 全部通过');
