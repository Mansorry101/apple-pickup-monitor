/** iPhone Air 两地真实查询回归：只读库存，不发送邮件，不修改用户配置。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadConfig, STORE_BY_ID, REGIONS } from '../src/config.js';
import { ApplePickupClient } from '../src/apple.js';
import { scopeProductsByStores } from '../src/settings.js';

const base = loadConfig();
const variant = base.catalog?.variants.find((v) => v.family === 'iPhone Air' && v.capacity === '256GB' && v.color === 'Cloud White');
assert.ok(variant?.parts.CN && variant?.parts.HK, '目录必须包含 iPhone Air 256GB 云白色的两地料号');
const target = { ...variant, name: 'iPhone Air 256GB 云白色' };
const report = { checkedAt: new Date().toISOString(), product: target.name, scenarios: [] };
const originalFetch = globalThis.fetch;
try {
  for (const [region, store] of [['CN', 'R401'], ['HK', 'R499']]) {
    const requests = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/availability-message')) {
        const parts = [...url.searchParams].filter(([k]) => k.startsWith('parts.')).map(([,v]) => v);
        assert.equal(url.origin, REGIONS[region].origin);
        assert.equal(url.searchParams.get('store'), store);
        assert.ok(parts.every((pn) => pn === REGIONS[region].canaryPart || pn === target.parts[region]), '不能发送另一地区料号');
        requests.push({ origin: url.origin, path: url.pathname, store, parts });
      }
      return originalFetch(input, init);
    };
    const products = scopeProductsByStores([target], [store]);
    const cfg = { ...base, products, priorityStore: store, priorityStoreRegion: region,
      watchStores: [store], watchRegions: [region], priorityStoreFor: { [region]: store },
      sessionPages: { [region]: [target.buyUrls[region]] }, maxRetries: 2, requestTimeoutMs: 15000 };
    const [result] = await new ApplePickupClient(cfg, (line) => console.log(line)).checkAvailability();
    assert.equal(result.ok, true, JSON.stringify(result.perRegion));
    assert.deepEqual(Object.keys(result.parts), [region]);
    assert.deepEqual(Object.keys(result.perRegion), [region]);
    assert.ok(result.stores.every((id) => STORE_BY_ID[id]?.region === region));
    assert.ok(requests.some((r) => r.parts.includes(target.parts[region])), '应实际查询目标料号');
    report.scenarios.push({ region, store, storeName: STORE_BY_ID[store].name,
      partNumber: target.parts[region], availability: result.availability,
      atPriority: result.atPriority, stores: result.stores, requests });
    console.log(`${region} ${STORE_BY_ID[store].name}: ${target.parts[region]} → ${result.availability}; ${requests.length} requests; no cross-region SKU`);
  }
} finally {
  globalThis.fetch = originalFetch;
}
const reportIndex = process.argv.indexOf('--report');
if (reportIndex >= 0) fs.writeFileSync(process.argv[reportIndex + 1], JSON.stringify(report, null, 2));
console.log('PASS: iPhone Air 大陆、香港版本与门店完全对应。');
