/**
 * 多地区「有货识别」实测（需要联网）。
 *
 * 用长期有门店库存的 iPad Air 当靶子，验证真实链路真的能识别到有货：
 *   1. 大陆：必须先提交定位，且返回的门店要能与"监控门店"正确求交集
 *   2. 香港：不需要定位，直接返回全港有货门店
 *   3. 优先门店判定（atPriority）正确
 *
 * 运行： node test/live.mjs
 */
import assert from 'node:assert';
import { loadConfig } from '../src/config.js';
import { ApplePickupClient } from '../src/apple.js';
import { STORE_BY_ID } from '../src/stores.js';

const base = loadConfig();
const SHANGHAI = ['R683', 'R390', 'R581', 'R401', 'R389', 'R678', 'R359', 'R705'];
const HK_ALL = ['R428', 'R673', 'R610', 'R409', 'R499', 'R485'];

const log = (m) => console.log('   ', m);

const cfg = {
  ...base,
  priorityStore: 'R401',
  priorityStoreInfo: STORE_BY_ID.R401,
  priorityStoreRegion: 'CN',
  watchStores: [...SHANGHAI, ...HK_ALL],
  watchRegions: ['CN', 'HK'],
  priorityStoreFor: { CN: 'R401', HK: 'R499' },
  defaultStoreFor: { CN: 'R401', HK: 'R499' },
  products: [
    { key: 'iPad Air|512GB|CN', name: 'iPad Air 512GB（大陆）', parts: { CN: 'MH3A4CH/A' }, buyUrls: {} },
    { key: 'iPad Air|512GB|HK', name: 'iPad Air 512GB（香港）', parts: { HK: 'MH3A4ZP/A' }, buyUrls: {} },
  ],
};

console.log('=== 大陆 + 香港 实时有货识别 ===');
const client = new ApplePickupClient(cfg, log);
const results = await client.checkAvailability();

for (const r of results) {
  console.log(`\n  ${r.product.name}`);
  console.log(`    命中门店: ${r.stores.join(', ') || '(无)'}`);
  console.log(`    Apple 报出的全部门店: ${r.otherStores.concat(r.stores).join(', ') || '(无)'}`);
  console.log(`    优先门店(${cfg.priorityStore})有货: ${r.atPriority}`);
}

const cn = results.find((r) => r.key === 'iPad Air|512GB|CN');
const hk = results.find((r) => r.key === 'iPad Air|512GB|HK');

assert.ok(cn.ok, '大陆查询应成功');
assert.ok(hk.ok, '香港查询应成功');

// 大陆：定位到上海后，Apple 会返回"上海及周边"有货门店
assert.ok(
  cn.stores.length > 0,
  '大陆 iPad Air 应至少命中一家监控中的门店（若为 0，多半是定位或会话出了问题）',
);
assert.ok(
  cn.stores.every((s) => SHANGHAI.includes(s)),
  '大陆结果里不应出现非香港/非监控门店',
);
console.log(`\n  ✓ 大陆：命中 ${cn.stores.length} 家监控门店`);

// 香港：6 家全在监控范围内
assert.ok(hk.stores.length > 0, '香港 iPad Air 应至少命中一家监控中的门店');
assert.ok(hk.stores.every((s) => HK_ALL.includes(s)), '香港结果里不应出现非监控门店');
console.log(`  ✓ 香港：命中 ${hk.stores.length} 家监控门店`);

// 优先门店判定
assert.equal(cn.atPriority, cn.stores.includes('R401'), 'atPriority 应与优先门店是否命中一致');
assert.equal(hk.atPriority, hk.stores.includes('R401'), '香港结果不应把大陆门店算成优先门店');
console.log('  ✓ atPriority 判定正确（香港结果不会误判大陆优先门店）');

// 跨地区串味检查：大陆的料号不应该出现在香港结果里
assert.ok(!Object.keys(hk.perRegion).includes('CN'), '香港目标不该有大陆分区的结果');
console.log('  ✓ 地区隔离正确');

console.log('\n✅ 多地区实测全部通过');
