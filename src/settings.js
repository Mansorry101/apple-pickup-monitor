import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './constants.js';
import { STORES, STORE_BY_ID, SEARCHABLE_REGIONS, REGIONS, fastLaneInfo } from './stores.js';
import { findVariant, findVariantByKey } from './catalog.js';

/**
 * 默认监控的门店（深圳 3 家，同城 → 默认就是同城高速模式）。
 * 全国任意城市都可以在界面里选；这里只是首次运行时的默认值。
 */
const SZ_PREFERRED_ORDER = ['R484', 'R761', 'R793'];
export const SHENZHEN_STORES = [
  ...SZ_PREFERRED_ORDER.filter((id) => STORE_BY_ID[id]?.city === '深圳'),
  ...STORES.filter((s) => s.city === '深圳' && !SZ_PREFERRED_ORDER.includes(s.id)).map((s) => s.id),
];

export const SETTINGS_FILE = process.env.SETTINGS_FILE || path.join(ROOT, 'config.json');
export const CATALOG_CACHE = path.join(ROOT, 'catalog-cache.json');

export function regionOfPartNumber(pn) {
  const m = /^([A-Z0-9]{3,12})\/[A-Z]{1,2}$/i.exec(String(pn || '').trim());
  if (!m) return null;
  const code = m[1].toUpperCase().slice(-2);
  if (code === 'CH') return 'CN';
  if (code === 'ZA' || code === 'ZP') return 'HK';
  return null;
}

export const PART_RE = /^[A-Z0-9]{4,12}\/[A-Z]{1,2}$/;

export const DEFAULT_SETTINGS = {
  version: 2,
  // 全国城市都可查询。优先门店 + 监控门店全部在同一个大陆城市时，自动启用「同城高速模式」：
  // 只跑该城市一条通道，速度与香港同级（常规 5 秒 / 放货 3 秒）；跨城市时恢复大陆整轮 + 城市快车道。
  // 默认盯深圳：优先门店 = 深圳益田假日广场（R484）
  priorityStore: 'R484',
  // 默认深圳 3 家门店（益田假日广场 / 万象城 / 前海壹方城），可在界面里换成任意城市
  watchStores: SHENZHEN_STORES,
  priorityOnly: false,
  soldOutNotify: true,
  repeatAlertMinutes: 15,
  pollIntervalSeconds: 60,
  hkIntervalSeconds: 5,
  // 同城高速通道（城市快车道）：同城高速模式下它就是唯一通道，与香港同速（5 秒 / 放货 3 秒）。
  szIntervalSeconds: 5,
  // 优先门店 + 优先机型的快速通道：只查优先门店所在城市，比整轮扫描更勤
  priorityBoost: true,
  priorityIntervalSeconds: 20,
  // 放货时段（北京时间）：这段时间内使用更快的间隔
  rushEnabled: true,
  rushStart: '06:00',
  rushEnd: '09:00',
  rushPollIntervalSeconds: 15,
  rushHkIntervalSeconds: 3,
  rushSzIntervalSeconds: 3,
  rushPriorityIntervalSeconds: 8,
  uiPort: 8787,
  targets: [
    { key: 'iPhone 18 Pro Max|512GB|Silver', name: 'iPhone 18 Pro Max 512GB 银色', parts: { CN: 'MJYC4CH/A' } },
    { key: 'iPhone 18 Pro Max|512GB|Black', name: 'iPhone 18 Pro Max 512GB 黑色', parts: { CN: 'MJXT4CH/A' } },
  ],
};

const hhmm = (v, dflt) => {
  const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(String(v || '').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return dflt;
  return String(m[1]).padStart(2, '0') + ':' + m[2];
};

const clampInt = (v, dflt, min, max) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};

function cleanStores(list, priorityStore) {
  const out = [];
  for (const id of Array.isArray(list) ? list : []) {
    const s = String(id || '').trim().toUpperCase();
    if (!STORE_BY_ID[s] || out.includes(s)) continue;
    if (!REGIONS[STORE_BY_ID[s].region].onlineStore) continue;
    out.push(s);
  }
  if (priorityStore && !out.includes(priorityStore)) out.unshift(priorityStore);
  return out.length ? out : [priorityStore || DEFAULT_SETTINGS.priorityStore];
}

function sameCityStores(storeIds, priorityStore) {
  const primary = STORE_BY_ID[priorityStore];
  if (!primary) return false;
  return storeIds.every((id) => {
    const store = STORE_BY_ID[id];
    return store && store.region === primary.region && store.city === primary.city;
  });
}

export function normalizeSettings(input, base) {
  // 不传 base 表示「只有这一份配置」：缺字段就用默认值。
  // 传了 base（loadSettings 的上一份配置 / saveSettings 的默认值）时，
  // 缺字段才从 base 继承 —— 见下面 watchStores 的处理。
  const hasBase = base !== undefined;
  const resolvedBase = hasBase ? base : DEFAULT_SETTINGS;
  const s = { ...resolvedBase, ...(input || {}) };
  const inp = input || {};

  // 全国城市都可查询（旧版的 shenzhenOnly 锁定已移除，config.json 里残留该字段也会被忽略）。
  const requestedStore =
    STORE_BY_ID[s.priorityStore] && REGIONS[STORE_BY_ID[s.priorityStore].region].onlineStore
      ? s.priorityStore
      : null;
  const priorityStore = requestedStore || resolvedBase.priorityStore || DEFAULT_SETTINGS.priorityStore;

  const priorityOnly = inp.priorityOnly !== undefined
    ? Boolean(inp.priorityOnly)
    : inp.cantonOnly !== undefined
      ? Boolean(inp.cantonOnly)
      : Boolean(resolvedBase.priorityOnly);

  // 监控门店列表：只有「这一份配置自己写了 watchStores」或「继承的 base 里确实有」时才用它。
  // 都没有（旧版配置只记了优先门店）就只回填优先门店一个 —— 不能因为
  // 合并默认值而把默认门店悄悄加进用户的监控列表。
  const rawWatch = Array.isArray(inp.watchStores) ? inp.watchStores
    : hasBase && Array.isArray(resolvedBase.watchStores) ? resolvedBase.watchStores
      : [];
  const watchStores = cleanStores(rawWatch, priorityStore);
  // 同城高速模式：优先门店 + 监控门店全部在同一个大陆城市时自动开启（任意城市，不限深圳）
  const { sameCityFast } = fastLaneInfo(watchStores, priorityStore);

  const hkIntervalSeconds = clampInt(s.hkIntervalSeconds, 5, 3, 24 * 3600);
  const rushHkIntervalSeconds = clampInt(s.rushHkIntervalSeconds, 3, 3, 24 * 3600);

  const out = {
    version: 2,
    // 只读的派生字段（每次读取都会重新计算），给界面 / 日志说明当前模式
    sameCityFast,
    priorityStore,
    watchStores,
    priorityOnly,
    soldOutNotify: s.soldOutNotify !== false,
    repeatAlertMinutes: clampInt(s.repeatAlertMinutes, 15, 0, 24 * 60),
    pollIntervalSeconds: clampInt(s.pollIntervalSeconds, 60, 15, 24 * 3600),
    hkIntervalSeconds,
    // 同城高速通道（城市快车道）：与香港同级，默认 5 秒 / 放货 3 秒，下限 3 秒。
    szIntervalSeconds: clampInt(s.szIntervalSeconds, 5, 3, 24 * 3600),
    // 优先高频通道只对同一城市的监控列表开放，跨城市时自动关闭。
    // 同城高速模式下城市通道已经覆盖同一批门店且更快，优先通道没有意义，直接关闭。
    priorityBoost: !sameCityFast && s.priorityBoost !== false && sameCityStores(watchStores, priorityStore),
    priorityIntervalSeconds: clampInt(s.priorityIntervalSeconds, 20, 5, 24 * 3600),
    rushEnabled: s.rushEnabled !== false,
    rushStart: hhmm(s.rushStart, '06:00'),
    rushEnd: hhmm(s.rushEnd, '09:00'),
    rushPollIntervalSeconds: clampInt(s.rushPollIntervalSeconds, 15, 15, 24 * 3600),
    rushHkIntervalSeconds,
    rushSzIntervalSeconds: clampInt(s.rushSzIntervalSeconds, 3, 3, 24 * 3600),
    rushPriorityIntervalSeconds: clampInt(s.rushPriorityIntervalSeconds, 8, 5, 24 * 3600),
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
  if (!providedTargets) out.targets = resolvedBase.targets || DEFAULT_SETTINGS.targets;

  return out;
}

function normalizeTarget(t) {
  if (!t || typeof t !== 'object') return null;
  const parts = {};
  for (const [r, pn] of Object.entries(t.parts || {})) {
    const v = String(pn || '').trim().toUpperCase();
    if (SEARCHABLE_REGIONS.includes(r) && PART_RE.test(v)) parts[r] = v;
  }
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
    ...(t.priority ? { priority: true } : {}),
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
  } catch {}
  return normalizeSettings(raw, DEFAULT_SETTINGS);
}

export function saveSettings(settings) {
  const normalized = normalizeSettings(settings, DEFAULT_SETTINGS);
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_FILE);
  return normalized;
}

export function enrichTargets(targets, catalog) {
  return (Array.isArray(targets) ? targets : []).map((t) => {
    const byKey = t.key ? findVariantByKey(catalog, t.key) : null;
    const byPart = byKey || findVariant(catalog, Object.values(t.parts || {})[0]);
    if (!byPart) return t;
    return {
      ...(t.priority ? { priority: true } : {}),
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

export function regionsOfTargets(targets) {
  const set = new Set();
  for (const t of targets || []) for (const r of Object.keys(t.parts || {})) set.add(r);
  return SEARCHABLE_REGIONS.filter((r) => set.has(r));
}

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
