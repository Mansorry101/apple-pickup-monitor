/**
 * 机型目录（多地区）：从 Apple 各地购买页抓取「机型 / 容量 / 颜色 / 料号 / 价格 / 直达链接」。
 *
 * 支持地区：中国大陆（apple.com.cn）、香港（apple.com/hk-zh）。
 * 澳门没有网上商店（apple.com/mo/shop/* 一律 403），因此没有可抓取的机型目录。
 *
 * 同一款机型在不同地区的料号不同（大陆 CH/A、香港 ZA/A），
 * 所以这里把两个地区的目录按「机型+容量+颜色」合并成一条记录，
 * 一条记录里同时带着两地的料号与链接 —— 用户只需选一次机型。
 *
 * 直达链接的做法每个地区不一样（实测 2026-09）：
 *   · 大陆页面的 slug 就是料号的小写形式：/iphone-18-pro/mjyc4ch/a  ✅ 精确
 *   · 香港页面的 slug 是中文描述：/iphone-18-pro/6.9-吋顯示器-512gb-銀色
 * 两地都用「页面上真实存在的 slug 集合」做校验，推不出来就退回机型主页，
 * 绝不给出一个 404 的链接。
 */
import fs from 'node:fs';
import path from 'node:path';
import { REGIONS, SEARCHABLE_REGIONS } from './stores.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** 购买页 slug（各地区通用） */
export const FAMILY_SLUGS = [
  'iphone-duo',
  'iphone-18-pro',
  'iphone-air',
  'iphone-17',
  'iphone-17e',
  'iphone-16',
];

/** 机型在界面里的排序（越新越靠前） */
const FAMILY_RANK = {
  'iPhone Duo': 0,
  'iPhone 18 Pro Max': 1,
  'iPhone 18 Pro': 2,
  'iPhone Air': 3,
  'iPhone 17': 4,
  'iPhone 17e': 5,
  'iPhone 16': 6,
};
export const familyRank = (f) => (f in FAMILY_RANK ? FAMILY_RANK[f] : 90);

const CAP_ORDER = ['64GB', '128GB', '256GB', '512GB', '1TB', '2TB', '4TB', '8TB'];
export const capRank = (c) => {
  const i = CAP_ORDER.indexOf(c);
  return i < 0 ? 90 : i;
};

/** 英文颜色名 → 繁体（香港页面用） */
const COLOR_ZH_HK = {
  black: '黑色',
  white: '白色',
  silver: '銀色',
  burgundy: '布根地紅色',
  glacier: '冰川色',
  'star white': '星光白色',
  'night sky': '夜空色',
  'light gold': '淺金色',
  'sky blue': '天藍色',
  'cloud white': '浮雲白色',
  'space black': '太空黑',
  'mist blue': '霧藍色',
  lavender: '薰衣草紫色',
  sage: '鼠尾草綠色',
  'soft pink': '淺粉紅色',
  ultramarine: '群青色',
  pink: '粉紅色',
  teal: '湖水綠色',
  'space gray': '太空灰',
  'space grey': '太空灰',
  starlight: '星光色',
  midnight: '午夜暗色',
  purple: '紫色',
  blue: '藍色',
  green: '綠色',
  yellow: '黃色',
  red: '紅色',
  gold: '金色',
  graphite: '石墨色',
  'natural titanium': '原色鈦金屬',
  'blue titanium': '藍色鈦金屬',
  'white titanium': '白色鈦金屬',
  'black titanium': '黑色鈦金屬',
  'desert titanium': '沙漠色鈦金屬',
};

/**
 * 英文颜色名 → 简体（大陆页面用 / 界面显示用）。
 * 已逐一对照大陆购买页的实际标题核对，别凭感觉改 ——
 * 两地叫法确实不同：Teal 大陆是"深青色"、香港是"湖水綠色"。
 */
const COLOR_ZH_CN = {
  black: '黑色',
  white: '白色',
  silver: '银色',
  burgundy: '勃艮第酒红色',
  glacier: '冰川蓝色',
  'star white': '星光白色',
  'night sky': '夜空色',
  'light gold': '浅金色',
  'sky blue': '天蓝色',
  'cloud white': '云白色',
  'space black': '深空黑色',
  'mist blue': '青雾蓝色',
  lavender: '薰衣草紫色',
  sage: '鼠尾草绿色',
  'soft pink': '浅粉色',
  ultramarine: '群青色',
  pink: '粉色',
  teal: '深青色',
  'space gray': '深空灰色',
  'space grey': '深空灰色',
  starlight: '星光色',
  midnight: '午夜色',
  purple: '紫色',
  blue: '蓝色',
  green: '绿色',
  yellow: '黄色',
  red: '红色',
  gold: '金色',
  graphite: '石墨色',
};

const cap = (en, region) => {
  const k = String(en).toLowerCase();
  const table = region === 'CN' ? COLOR_ZH_CN : COLOR_ZH_HK;
  return table[k] || COLOR_ZH_HK[k] || en;
};

/** 界面显示统一用简体名 */
export const colorLabel = (en) => cap(en, 'CN');

const CAPACITY_RE = /^(64GB|128GB|256GB|512GB|1TB|2TB|4TB|8TB)$/i;

/**
 * Apple 的商品名里混了普通空格和 U+00A0 不换行空格
 * （实测大陆页用 \u00A0、香港页用普通空格，
 *   甚至同一页里两种都有）—— 不统一就会把同一款机型拆成两条记录。
 */
const normalizeSpace = (s) =>
  String(s)
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 解析 name: "iPhone 18 Pro Max 512GB Silver" → { family, capacity, color } */
function parseName(rawName) {
  const name = normalizeSpace(rawName);
  const m = name.match(/^(.*?)\s+((?:64|128|256|512)\s?GB|(?:1|2|4|8)\s?TB)\s+(.+)$/i);
  if (!m) return null;
  const capacity = m[2].replace(/\s+/g, '').toUpperCase();
  if (!CAPACITY_RE.test(capacity)) return null;
  return { family: m[1].trim(), capacity, color: m[3].trim() };
}

/** 从页面 HTML 里提取真实存在的购买链接 slug（全页扫描，不只看 href） */
function extractSlugs(html, sourceUrl) {
  const pathname = new URL(sourceUrl).pathname.replace(/\/+$/, '');
  const escaped = pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}/([^"'<>\\\\\\s?#]+)`, 'g');
  const out = new Set();
  for (const m of html.matchAll(re)) {
    let slug = m[1];
    if (!slug || slug.includes('//')) continue;
    try {
      slug = decodeURIComponent(slug);
    } catch { /* 保持原样 */ }
    out.add(slug);
  }
  return out;
}

/** "iPhone 18 Pro Max" → 最大屏；其余取最小屏 */
function deriveScreen(family, screens) {
  const sizes = [...screens].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sizes.length) return null;
  return String(/\b(max|plus|ultra)\b/i.test(family) ? sizes[sizes.length - 1] : sizes[0]);
}

async function get(url, regionId, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': REGIONS[regionId].lang },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 抓一个地区的一个购买页 */
async function fetchFamilyPage(regionId, slug, timeoutMs) {
  const R = REGIONS[regionId];
  const sourceUrl = `${R.origin}${R.prefix}/shop/buy-iphone/${slug}`;
  const html = await get(sourceUrl, regionId, timeoutMs);

  const raw = [
    ...html.matchAll(
      /\{"sku":"([A-Z0-9]+)","partNumber":"([A-Z0-9/]+)","price":\{"fullPrice":([0-9.]+)\},"category":"[^"]*","name":"([^"]+)"\}/g,
    ),
  ].map((m) => ({ sku: m[1], partNumber: m[2], price: Number(m[3]), name: m[4] }));
  if (!raw.length) throw new Error('页面上没解析到任何机型（Apple 可能改了页面结构）');

  const validSlugs = extractSlugs(html, sourceUrl);
  const screens = new Set();
  for (const s of validSlugs) {
    const mm = s.match(/^([\d.]+)-/);
    if (mm) screens.add(mm[1]);
  }

  const variants = [];
  for (const item of raw) {
    const parsed = parseName(item.name);
    if (!parsed) continue;
    const screen = deriveScreen(parsed.family, screens);

    // 各地区各自的 slug 规则
    let slugCandidate = null;
    if (regionId === 'CN') {
      slugCandidate = item.partNumber.toLowerCase();
    } else if (screen) {
      slugCandidate = `${screen}-吋顯示器-${parsed.capacity.toLowerCase()}-${cap(parsed.color, regionId)}`;
    }
    const exact = slugCandidate && validSlugs.has(slugCandidate);
    // 注意：大陆的 slug 就是料号（含斜杠，如 mjyc4ch/a），
    // 整段 encodeURIComponent 会把 / 变成 %2F 从而 404，所以逐段编码。
    const buyUrl = exact
      ? `${sourceUrl}/${slugCandidate.split('/').map(encodeURIComponent).join('/')}`
      : sourceUrl;

    variants.push({
      partNumber: item.partNumber,
      sku: item.sku,
      family: parsed.family,
      familySlug: slug,
      screen,
      capacity: parsed.capacity,
      color: parsed.color,
      colorZh: colorLabel(parsed.color),
      colorLocal: cap(parsed.color, regionId),
      price: item.price,
      currency: R.currency,
      buyUrl,
      exactLink: Boolean(exact),
      sourceUrl,
      region: regionId,
      key: `${parsed.family}|${parsed.capacity}|${parsed.color}`,
    });
  }
  return variants;
}

/** 抓一个地区的全部机型（限制并发，对 Apple 友好一点） */
async function fetchRegion(regionId, log, timeoutMs) {
  const out = [];
  const errors = [];
  const queue = [...FAMILY_SLUGS];
  const worker = async () => {
    while (queue.length) {
      const slug = queue.shift();
      try {
        const v = await fetchFamilyPage(regionId, slug, timeoutMs);
        out.push(...v);
      } catch (e) {
        errors.push({ region: regionId, slug, error: e.message });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { region: regionId, variants: out, errors };
}

/** 抓取所有可查询地区的目录，并按「机型+容量+颜色」合并 */
export async function fetchCatalog({ regions = SEARCHABLE_REGIONS, log = () => {}, timeoutMs = 30000 } = {}) {
  const parts = [];
  const errors = [];
  for (const r of regions) {
    log(`[目录] 抓取 ${REGIONS[r].label} 机型目录…`);
    const res = await fetchRegion(r, log, timeoutMs);
    parts.push(res);
    errors.push(...res.errors);
    log(`[目录] ${REGIONS[r].label} → ${res.variants.length} 个机型${res.errors.length ? `（${res.errors.length} 个页面失败）` : ''}`);
  }

  const merged = new Map();
  for (const p of parts) {
    for (const v of p.variants) {
      if (!merged.has(v.key)) {
        merged.set(v.key, {
          key: v.key,
          family: v.family,
          familySlug: v.familySlug,
          screen: v.screen,
          capacity: v.capacity,
          color: v.color,
          colorZh: v.colorZh,
          parts: {},
          buyUrls: {},
          prices: {},
          exactLinks: {},
          availableIn: [],
        });
      }
      const rec = merged.get(v.key);
      rec.parts[v.region] = v.partNumber;
      rec.buyUrls[v.region] = v.buyUrl;
      rec.prices[v.region] = v.price;
      rec.exactLinks[v.region] = v.exactLink;
      if (!rec.screen) rec.screen = v.screen;
      rec.availableIn.push(v.region);
    }
  }

  const variants = [...merged.values()].sort(
    (a, b) =>
      familyRank(a.family) - familyRank(b.family) ||
      capRank(a.capacity) - capRank(b.capacity) ||
      a.color.localeCompare(b.color),
  );

  // 按机型分组，供界面做级联下拉
  const famMap = new Map();
  for (const v of variants) {
    if (!famMap.has(v.family)) {
      famMap.set(v.family, {
        name: v.family,
        familySlug: v.familySlug,
        screen: v.screen,
        capacities: new Set(),
        colors: new Set(),
        variants: [],
      });
    }
    const f = famMap.get(v.family);
    f.capacities.add(v.capacity);
    f.colors.add(v.color);
    f.variants.push(v);
  }
  const families = [...famMap.values()]
    .map((f) => ({
      ...f,
      capacities: [...f.capacities].sort((a, b) => capRank(a) - capRank(b)),
      colors: [...f.colors].sort(),
    }))
    .sort((a, b) => familyRank(a.name) - familyRank(b.name));

  return {
    fetchedAt: new Date().toISOString(),
    regions: parts.map((p) => p.region),
    families,
    variants,
    errors,
  };
}

export function loadCatalogCache(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    // 旧版缓存（只有 families，且是单地区的）直接丢弃，避免字段错乱
    if (!j || !Array.isArray(j.variants) || !j.regions) return null;
    return j;
  } catch {
    return null;
  }
}

export function saveCatalogCache(file, catalog) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // 只缓存界面需要的字段，去掉重复的 sourceUrl 之类，控制体积
    const lean = {
      fetchedAt: catalog.fetchedAt,
      regions: catalog.regions,
      families: catalog.families,
      variants: catalog.variants.map((v) => ({
        key: v.key, family: v.family, familySlug: v.familySlug, screen: v.screen,
        capacity: v.capacity, color: v.color, colorZh: v.colorZh,
        parts: v.parts, buyUrls: v.buyUrls, prices: v.prices, exactLinks: v.exactLinks,
        availableIn: v.availableIn,
      })),
      errors: catalog.errors || [],
    };
    fs.writeFileSync(file, JSON.stringify(lean, null, 1), 'utf8');
  } catch { /* 缓存失败不影响主流程 */ }
}

/** 按「机型+容量+颜色」找一条记录 */
export function findVariantByKey(catalog, key) {
  return (catalog?.variants || []).find((v) => v.key === key) || null;
}

/** 按任一地区的料号找一条记录 */
export function findVariant(catalog, partNumber) {
  const pn = String(partNumber || '').toUpperCase();
  if (!pn) return null;
  return (catalog?.variants || []).find((v) => Object.values(v.parts || {}).includes(pn)) || null;
}

/**
 * 解析一个监控目标真正要查询的料号：只查「有门店在监控范围内」的地区，
 * 避免为用不到的地区白白发请求。
 */
export function partsForRegions(variant, regions) {
  const out = {};
  for (const r of regions) {
    const pn = variant?.parts?.[r];
    if (pn) out[r] = pn;
  }
  return out;
}
