/**
 * 运行设置：优先门店、监控门店、监控机型、轮询行为。
 * 全部存在 config.json 里，由网页设置界面读写 —— 不写死在代码中。
 *
 * 分工：
 *   .env        → 邮箱凭据（敏感，界面不碰）
 *   config.json → 门店与机型（界面可改）
 *
 * 机型用「机型|容量|颜色」作为主键，而不是料号 ——
 * 因为同一款机型在各地料号不同（大陆 CH/A、香港 ZA/A），
 * 用主键才能一条记录同时覆盖两地的库存。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './constants.js';
import { STORE_BY_ID, SEARCHABLE_REGIONS, REGIONS } from './stores.js';
import { findVariant, findVariantByKey } from './catalog.js';

export const SETTINGS_FILE = process.env.SETTINGS_FILE || path.join(ROOT, 'config.json');
export const CATALOG_CACHE = path.join(ROOT, 'catalog-cache.json');

/**
 * 料号 → 地区（旧配置迁移用）。
 *
 * 注意地区码在斜杠**前面**的末尾两位，不是在斜杠后面：
 *   MJYC4CH/A → SKU "MJYC4CH" 结尾 CH = 中国大陆
 *   MJXU4ZA/A → SKU "MJXU4ZA" 结尾 ZA = 香港
 *   MH3A4ZP/A → SKU "MH3A4ZP" 结尾 ZP = 香港
 * （斜杠后面那个字母是版本/包装标识，跟地区无关。）
 */
export function regionOfPartNumber(pn) {
  const m = /^([A-Z0-9]{3,12})\/[A-Z]{1,2}$/i.exec(String(pn || '').trim());
  if (!m) return null;
  const code = m[1].toUpperCase().slice(-2);
  if (code === 'CH') return 'CN';
  if (code === 'ZA' || code === 'ZP') return 'HK';
  return null;
}

export const PART_RE = /^[A-Z0-9]{4,12}\/[A-Z]{1,2}$/;

/** 默认：广东道 + iPhone 18 Pro Max 512GB 银/黑（用户最初的诉求） */
export const DEFAULT_SETTINGS = {
  version: 2,
  priorityStore: 'R499',
  watchStores: ['R499'],
  priorityOnly: false,
  soldOutNotify: true,
  repeatAlertMinutes: 15,
  pollIntervalSeconds: 60,
  uiPort: 8787,
  targets: [
    { key: 'iPhone 18 Pro Max|512GB|Silver', name: 'iPhone 18 Pro Max 512GB 银色', parts: { HK: 'MJXU4ZA/A' } },
    { key: 'iPhone 18 Pro Max|512GB|Black', name: 'iPhone 18 Pro Max 512GB 黑色', parts: { HK: 'MJXT4ZA/A' } },
  ],
};

const clampInt = (v, dflt, min, max) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};

/** 把外部传入的门店列表清洗成合法、去重、且包含优先门店的数组 */
function cleanStores(list, priorityStore) {
  const out = [];
  for (const id of Array.isArray(list) ? list : []) {
    const s = String(id || '').trim().toUpperCase();
    if (!STORE_BY_ID[s] || out.includes(s)) continue;
    // 澳门没有网上商店，选了也查不了，直接不收
    if (!REGIONS[STORE_BY_ID[s].region].onlineStore) continue;
    out.push(s);
  }
  if (priorityStore && !out.includes(priorityStore)) out.unshift(priorityStore);
  return out.length ? out : [priorityStore || DEFAULT_SETTINGS.priorityStore];
}

/** 规范化外部传入的设置，挡住脏数据 */
export function normalizeSettings(input, base = DEFAULT_SETTINGS) {
  const s = { ...base, ...(input || {}) };
  const inp = input || {};

  const priorityStore =
    STORE_BY_ID[s.priorityStore] && REGIONS[STORE_BY_ID[s.priorityStore].region].onlineStore
      ? s.priorityStore
      : base.priorityStore || DEFAULT_SETTINGS.priorityStore;

  // 注意不能写成 `s.priorityOnly ?? s.cantonOnly`：
  // base 会把 priorityOnly 填成 false，问号 ?? 就永远短路了，
  // 结果旧配置里的 cantonOnly: true 被无声丢掉。
  const priorityOnly = inp.priorityOnly !== undefined
    ? Boolean(inp.priorityOnly)
    : inp.cantonOnly !== undefined
      ? Boolean(inp.cantonOnly)
      : Boolean(base.priorityOnly);

  const out = {
    version: 2,
    priorityStore,
    watchStores: cleanStores(s.watchStores, priorityStore),
    priorityOnly,
    soldOutNotify: s.soldOutNotify !== false,
    repeatAlertMinutes: clampInt(s.repeatAlertMinutes, 15, 0, 24 * 60),
    pollIntervalSeconds: clampInt(s.pollIntervalSeconds, 60, 30, 24 * 3600),
    uiPort: clampInt(s.uiPort, 8787, 1024, 65535),
    targets: [],
  };

  const seen = new Set();
  const providedTargets = Array.isArray(s.targets);
  for (const t of providedTargets ? s.targets : []) {
    const rec = normalizeTarget(t);
    if (!rec || seen.has(rec.key)) continue;
    seen.add(rec.key);
    out.targets.push(rec);
  }
  // 只有在调用方「根本没提供 targets」时才回退默认值；
  // 显式传空数组表示用户故意不监控任何机型，应当尊重。
  if (!providedTargets) out.targets = base.targets || DEFAULT_SETTINGS.targets;

  return out;
}

/** 单个监控目标：支持新版（key+parts）与旧版（partNumber）两种写法 */
function normalizeTarget(t) {
  if (!t || typeof t !== 'object') return null;
  const parts = {};
  for (const [r, pn] of Object.entries(t.parts || {})) {
    const v = String(pn || '').trim().toUpperCase();
    if (SEARCHABLE_REGIONS.includes(r) && PART_RE.test(v)) parts[r] = v;
  }
  // 旧配置：只有一个 partNumber，按后缀推断地区
  if (!Object.keys(parts).length && t.partNumber) {
    const pn = String(t.partNumber).trim().toUpperCase();
    const r = regionOfPartNumber(pn);
    if (r && PART_RE.test(pn)) parts[r] = pn;
  }
  if (!Object.keys(parts).length) return null;

  const key = String(t.key || '').trim() || Object.values(parts)[0];
  return {
    key,
    name: String(t.name || key).slice(0, 120),
    parts,
    buyUrls: Object.fromEntries(
      Object.entries(t.buyUrls || {}).filter(([, u]) => /^https?:\/\//i.test(u || '')),
    ),
  };
}

export function loadSettings() {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch { /* 首次运行或文件损坏 → 用默认值 */ }
  return normalizeSettings(raw, DEFAULT_SETTINGS);
}

export function saveSettings(settings) {
  const normalized = normalizeSettings(settings, DEFAULT_SETTINGS);
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_FILE);
  return normalized;
}

/**
 * 用机型目录补全目标：把 key 展开成两地料号 + 直达链接 + 价格。
 * 没有目录缓存时原样保留（料号仍然可用），保证断网也能跑。
 */
export function enrichTargets(targets, catalog) {
  return (Array.isArray(targets) ? targets : []).map((t) => {
    const byKey = t.key ? findVariantByKey(catalog, t.key) : null;
    const byPart = byKey || findVariant(catalog, Object.values(t.parts || {})[0]);
    if (!byPart) return t;
    return {
      key: byPart.key,
      name: `${byPart.family} ${byPart.capacity} ${byPart.colorZh}`,
      parts: { ...t.parts, ...byPart.parts },
      buyUrls: { ...(t.buyUrls || {}), ...byPart.buyUrls },
      family: byPart.family,
      capacity: byPart.capacity,
      color: byPart.color,
      colorZh: byPart.colorZh,
      prices: byPart.prices,
    };
  });
}

/** 这些监控目标涉及哪些地区（决定要建立哪些地区的会话） */
export function regionsOfTargets(targets) {
  const set = new Set();
  for (const t of targets || []) for (const r of Object.keys(t.parts || {})) set.add(r);
  return SEARCHABLE_REGIONS.filter((r) => set.has(r));
}

/** 监控门店涉及哪些地区 */
export function regionsOfStores(storeIds) {
  const set = new Set();
  for (const id of storeIds || []) {
    const s = STORE_BY_ID[id];
    if (s) set.add(s.region);
  }
  return SEARCHABLE_REGIONS.filter((r) => set.has(r));
}

export function settingsMtime() {
  try {
    return fs.statSync(SETTINGS_FILE).mtimeMs;
  } catch {
    return 0;
  }
}

/** 保存的目标保留完整映射；运行时只使用所选门店所在地区的版本。 */
export function scopeProductsByStores(products, storeIds) {
  const regions = regionsOfStores(storeIds);
  const select = (values) => Object.fromEntries(regions
    .filter((r) => values?.[r] !== undefined).map((r) => [r, values[r]]));
  return products.map((p) => {
    const parts = select(p.parts);
    const buyUrls = select(p.buyUrls);
    const firstRegion = regions.find((r) => parts[r]);
    return { ...p, parts, buyUrls, prices: select(p.prices),
      partNumber: firstRegion ? parts[firstRegion] : undefined,
      buyUrl: firstRegion ? buyUrls[firstRegion] || '' : '' };
  });
}
