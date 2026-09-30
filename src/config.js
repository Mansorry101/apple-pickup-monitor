import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './constants.js';
import { STORES, STORE_BY_ID, REGIONS, SEARCHABLE_REGIONS } from './stores.js';
import { loadSettings, CATALOG_CACHE, regionsOfStores, scopeProductsByStores } from './settings.js';
import { loadCatalogCache, findVariantByKey, findVariant, FAMILY_SLUGS } from './catalog.js';

export { ROOT, STORES, STORE_BY_ID, REGIONS, SEARCHABLE_REGIONS };

function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function loadEnvFile(file = path.join(ROOT, '.env')) {
  try {
    const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
    return true;
  } catch {
    return false;
  }
}

const bool = (v, dflt) => {
  if (v === undefined || v === '') return dflt;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(v).toLowerCase());
};
const num = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

export function loadConfig() {
  const envFileLoaded = loadEnvFile();
  const env = process.env;
  const settings = loadSettings();
  const catalog = loadCatalogCache(CATALOG_CACHE);

  const products = scopeProductsByStores(settings.targets.map((t) => {
    const v = t.key ? findVariantByKey(catalog, t.key) : null;
    const fallback = v || findVariant(catalog, Object.values(t.parts || {})[0]);
    const parts = { ...(t.parts || {}), ...((fallback && fallback.parts) || {}) };
    const buyUrls = { ...(t.buyUrls || {}), ...((fallback && fallback.buyUrls) || {}) };
    return {
      key: t.key,
      priority: Boolean(t.priority),
      name: fallback ? `${fallback.family} ${fallback.capacity} ${fallback.colorZh}` : t.name || t.key,
      family: fallback?.family || '',
      capacity: fallback?.capacity || '',
      color: fallback?.color || '',
      colorZh: fallback?.colorZh || '',
      prices: fallback?.prices || {},
      parts,
      buyUrls,
      partNumber: undefined,
    };
  }), settings.watchStores);

  const watchStores = settings.watchStores.filter((id) => STORE_BY_ID[id]);
  const watchRegions = regionsOfStores(watchStores);

  const priorityStoreFor = {};
  const defaultStoreFor = {};
  for (const r of SEARCHABLE_REGIONS) {
    const inRegion = watchStores.filter((id) => STORE_BY_ID[id].region === r);
    priorityStoreFor[r] = settings.priorityStore && STORE_BY_ID[settings.priorityStore]?.region === r
      ? settings.priorityStore
      : inRegion[0] || STORES.find((s) => s.region === r)?.id || '';
    defaultStoreFor[r] = STORES.find((s) => s.region === r)?.id || '';
  }

  const sessionPages = {};
  for (const r of SEARCHABLE_REGIONS) {
    const pages = products.map((p) => p.buyUrls?.[r]).filter(Boolean);
    for (const slug of FAMILY_SLUGS) {
      pages.push(`${REGIONS[r].origin}${REGIONS[r].prefix}/shop/buy-iphone/${slug}`);
    }
    sessionPages[r] = [...new Set(pages)].slice(0, 8);
  }

  return {
    envFileLoaded,
    settings,
    catalog,

    priorityStore: settings.priorityStore,
    priorityStoreInfo: STORE_BY_ID[settings.priorityStore] || null,
    priorityStoreRegion: STORE_BY_ID[settings.priorityStore]?.region || null,
    watchStores,
    watchStoresInfo: watchStores.map((id) => STORE_BY_ID[id]).filter(Boolean),
    watchRegions,
    priorityStoreFor,
    defaultStoreFor,
    sessionPages,

    intervalSeconds: settings.pollIntervalSeconds,
    hkIntervalSeconds: settings.hkIntervalSeconds,
    priorityBoost: settings.priorityBoost,
    priorityIntervalSeconds: settings.priorityIntervalSeconds,
    rushEnabled: settings.rushEnabled,
    rushStart: settings.rushStart,
    rushEnd: settings.rushEnd,
    rushPollIntervalSeconds: settings.rushPollIntervalSeconds,
    rushHkIntervalSeconds: settings.rushHkIntervalSeconds,
    rushPriorityIntervalSeconds: settings.rushPriorityIntervalSeconds,
    priorityOnly: settings.priorityOnly,
    soldOutNotify: settings.soldOutNotify,
    repeatAlertMinutes: settings.repeatAlertMinutes,
    uiPort: settings.uiPort,
    products,
    catalogCache: CATALOG_CACHE,

    requestTimeoutMs: num(env.REQUEST_TIMEOUT_MS, 25000),
    maxRetries: num(env.MAX_RETRIES, 6),
    sessionRefreshMinutes: num(env.SESSION_REFRESH_MINUTES, 30),
    userAgent:
      env.USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    stateFile: env.STATE_FILE || path.join(ROOT, 'state.json'),
    logFile: env.LOG_FILE || path.join(ROOT, 'monitor.log'),

    mail: {
      host: env.SMTP_HOST || 'smtp.qq.com',
      port: num(env.SMTP_PORT, 465),
      secure: bool(env.SMTP_SECURE, true),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.MAIL_FROM || env.SMTP_USER || '',
      to: (env.MAIL_TO || '')
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    },
  };
}

export function validateMail(cfg) {
  const errs = [];
  if (!cfg.mail.host) errs.push('SMTP_HOST 未填写');
  if (!cfg.mail.user) errs.push('SMTP_USER 未填写（你的邮箱地址）');
  if (!cfg.mail.pass) errs.push('SMTP_PASS 未填写（QQ邮箱的 SMTP 授权码，不是登录密码）');
  if (!cfg.mail.to.length) errs.push('MAIL_TO 未填写（接收通知的邮箱）');
  return errs;
}
