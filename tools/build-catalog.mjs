/**
 * 抓取机型目录并写入 catalog-cache.json。
 *   node tools/build-catalog.mjs
 *
 * 打包时会把生成的 catalog-cache.json 一起带上，这样新电脑首次启动
 * 就能直接在下拉框里选机型，不用等网络抓取。
 */
import { fetchCatalog, saveCatalogCache } from '../src/catalog.js';
import { CATALOG_CACHE } from '../src/settings.js';

const t0 = Date.now();
const catalog = await fetchCatalog({ log: (m) => console.log(m) });
console.log(`\n用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`地区: ${catalog.regions.join(', ')}`);
console.log(`机型系列: ${catalog.families.length}`);
for (const f of catalog.families) {
  console.log(`  ${f.name.padEnd(20)} 容量 ${f.capacities.join('/')}  颜色 ${f.colors.length} 变体 ${f.variants.length}`);
}
console.log(`合计变体: ${catalog.variants.length}`);
if (catalog.errors.length) {
  console.log('\n失败页面:');
  for (const e of catalog.errors) console.log(`  ${e.region}/${e.slug}: ${e.error}`);
}
const sample = catalog.variants.find((v) => v.key === 'iPhone 18 Pro Max|512GB|Silver');
console.log('\n样例:', JSON.stringify(sample, null, 1));
saveCatalogCache(CATALOG_CACHE, catalog);
console.log('\n已写入', CATALOG_CACHE);
