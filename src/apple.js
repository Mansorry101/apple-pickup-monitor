/**
 * Apple Store 门市取货库存客户端（多地区：中国大陆 / 香港）。
 *
 * 协议（2026-09 实测，两地一致）：
 *   1) GET 购买页 → 从 "v2UserInterestUrl":"...fnode=xxx" 取 fnode
 *   2) GET /shop/sba/d/init?fnode=xxx 建立 SBA 会话
 *      —— 少了这步，接口只会返回送货信息，partAvailableStoresCount 恒为 0（假无货）
 *   3) GET /shop/sba/availability-message?parts.0=..&store=R###
 *      返回 content[].eligibleStores = "哪些门店有货"（逗号分隔）
 *
 * 两地的差别 —— 这是最关键的坑：
 *   · 香港：直接查就有门店数据，eligibleStores 是香港全部门店。
 *   · 大陆：**必须先提交定位**，否则永远返回 0 家店（HTTP 200、字段齐全，
 *     看起来就像"真没货"）：
 *         GET /shop/address/location/update?state=省&city=市&district=区
 *     其中 district 是必填，缺了它同样返回 0。
 *     提交定位后，eligibleStores 是"定位点附近有货的门店"，
 *     会跨市（例如定位上海能拿到苏州/无锡/杭州的门店），
 *     所以用户关心的每个城市都要单独提交一次定位。
 *   · 澳门：没有网上商店，无法查询（见 stores.js 说明）。
 *
 * 因此这里用「哨兵料号」做健康检查：哨兵没数据 = 本次请求不可信 → 重试，
 * 绝不把"接口坏了"当成"没货"。
 */
import { scopeProductsByStores } from './settings.js';
import { REGIONS, STORE_BY_ID, storeLabel, CITY_KEY, CITY_BY_KEY } from './stores.js';
import { throttleBackoffMs } from './scheduler.js';

export { storeLabel };

const MAX_PARTS_PER_REQUEST = 12; // 接口实测可用 12，减少机型较多时的分批请求
const CITY_QUERY_CONCURRENCY = 3;
const BATCH_CONCURRENCY = 2; // 同一城市会话内的分批请求并发数（机型 > 11 个时才有多批）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 限并发执行。任一项失败后不再派发新任务，但会等已发出的请求全部结束再抛出第一个错误，
 * 避免重试时旧请求还在同一个会话上跑。
 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  let failure = null;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failure && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index], index);
      } catch (e) {
        failure ||= { error: e };
      }
    }
  }));
  if (failure) throw failure.error;
  return results;
}

class CookieJar {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(res) {
    let list = [];
    try {
      list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    } catch { list = []; }
    if (!list.length) {
      const single = res.headers.get('set-cookie');
      if (single) list = [single];
    }
    for (const raw of list) {
      const pair = String(raw).split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  clear() { this.cookies.clear(); }
}

/** 一个地区的会话：负责建会话、定位、查询 */
class RegionSession {
  constructor(regionId, cfg, log) {
    this.regionId = regionId;
    this.R = REGIONS[regionId];
    this.cfg = cfg;
    this.log = log;
    this.jar = new CookieJar();
    this.ready = false;
    this.createdAt = 0;
    this.locationKey = null;
    this.warmedKey = null;
    this.base = `${this.R.origin}${this.R.prefix}`;
  }

  async request(url, { accept = 'application/json, text/javascript, */*; q=0.01', referer } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.requestTimeoutMs);
    try {
      const headers = {
        'User-Agent': this.cfg.userAgent,
        'Accept-Language': this.R.lang,
        Accept: accept,
        'Accept-Encoding': 'gzip, deflate, br',
      };
      const cookie = this.jar.header();
      if (cookie) headers.Cookie = cookie;
      if (accept.includes('json')) headers['X-Requested-With'] = 'XMLHttpRequest';
      if (referer) headers.Referer = referer;
      const res = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
      this.jar.absorb(res);
      // 429 / 503：Apple 在限制请求频率。直接报限流，不在本轮里继续重试加重限制。
      if (res.status === 429 || res.status === 503) {
        const err = new Error(`${this.R.label}：Apple 限制了查询频率 (HTTP ${res.status})`);
        err.throttled = true;
        throw err;
      }
      return { status: res.status, text: await res.text() };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 建会话：从某个购买页取 fnode → d/init */
  async ensureSession() {
    const pages = this.cfg.sessionPages?.[this.regionId]?.length
      ? this.cfg.sessionPages[this.regionId]
      : [`${this.base}/shop/buy-iphone`];

    let fnode = null;
    let lastStatus = null;
    for (const page of pages) {
      const { status, text } = await this.request(page, {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      });
      lastStatus = status;
      if (status !== 200) continue;
      fnode = text.match(/"v2UserInterestUrl":"[^"]*fnode=([a-f0-9]+)"/)?.[1] || null;
      if (fnode) break;
    }
    if (!fnode) {
      throw new Error(`${this.R.label}：无法从 Apple 商品页取得 fnode（最后一次 HTTP ${lastStatus}；页面结构可能已变化）`);
    }

    const { status, text } = await this.request(`${this.base}/shop/sba/d/init?fnode=${fnode}`);
    if (status !== 200 || !text.includes('"status":"OK"')) {
      throw new Error(`${this.R.label}：SBA 会话初始化失败 (HTTP ${status})`);
    }
    this.ready = true;
    this.createdAt = Date.now();
    this.locationKey = null; // 会话重建后必须重新定位
    this.warmedKey = null;   // 而且必须重新热身
  }

  /**
   * 提交定位（只有大陆需要）。
   * district 是必填 —— 缺了它接口会一直返回 0 家店。
   */
  async setLocation(city) {
    if (!this.R.needsLocation) return;
    const key = city.key;
    if (this.locationKey === key) return;
    const qs = new URLSearchParams({ state: city.province, city: city.city, district: city.district });
    const { status, text } = await this.request(`${this.base}/shop/address/location/update?${qs}`, {
      referer: `${this.base}/shop/buy-iphone`,
    });
    if (status !== 200) throw new Error(`${this.R.label}：定位失败 (HTTP ${status})`);
    let ok = false;
    try {
      ok = Boolean(JSON.parse(text)?.body?.content?.address);
    } catch { ok = false; }
    if (!ok) throw new Error(`${this.R.label}：定位返回异常：${text.slice(0, 120)}`);
    this.locationKey = key;
  }

  /** 查询一批料号，返回 content[] */
  async queryParts(partNumbers, store) {
    const qs = partNumbers.map((p, i) => `parts.${i}=${encodeURIComponent(p)}`).join('&');
    const url = `${this.base}/shop/sba/availability-message?${qs}&store=${store}`;
    const { status, text } = await this.request(url, { referer: `${this.base}/shop/buy-iphone` });
    if (status !== 200) throw new Error(`${this.R.label}：availability-message HTTP ${status}`);
    let json;
    try { json = JSON.parse(text); } catch {
      throw new Error(`${this.R.label}：availability-message 返回非 JSON：${text.slice(0, 120)}`);
    }
    const content = json?.body?.content;
    if (!Array.isArray(content)) throw new Error(this.R.label + '：库存响应缺少 content 数组');
    return content;
  }

  /** 哨兵：能拿到门店信息才说明本次数据可信 */
  isHealthy(content) {
    const c = content.find((x) => x.partNumber === this.R.canaryPart);
    return Boolean(c && (c.storeId || (c.eligibleStores && c.eligibleStores.length)));
  }

  /** 会话热身：反复查哨兵直到拿到可信数据 */
  async warmUp(maxTries = 6) {
    for (let i = 1; i <= maxTries; i++) {
      try {
        const content = await this.queryParts([this.R.canaryPart], this.fallbackStore);
        if (this.isHealthy(content)) {
          if (i > 1) this.log(`[会话:${this.R.short}] 第 ${i} 次热身成功`);
          return true;
        }
      } catch (e) {
        this.log(`[会话:${this.R.short}] 热身第 ${i} 次异常: ${e.message}`);
      }
      await sleep(Math.min(900 * i, 4000));
    }
    return false;
  }
}

/** 从 content 里取出有货门店列表 */
function storesOf(item) {
  if (!item) return [];
  if (item.partAvailableStoresCount > 0 && item.eligibleStores) {
    return String(item.eligibleStores).split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export class ApplePickupClient {
  /**
   * @param cfg 见 config.js
   * @param log 日志函数
   */
  constructor(cfg, log = console.log) {
    this.cfg = { ...cfg, products: scopeProductsByStores(cfg.products, cfg.watchStores) };
    this.log = log;
    this.sessions = new Map();
    this.regionLocks = new Map();   // 地区 → 该地区最后一个排队任务
    this.lastRegionData = new Map(); // 地区 → { at, data }，供其他地区的轮次拼完整快照
    this.throttle = new Map();       // 地区 → { hits, until }：被限流后的冷却
  }

  /** 该地区的限流冷却结束时间（毫秒时间戳），未限流返回 0。 */
  cooldownUntil(regionId) {
    const t = this.throttle.get(regionId);
    return t && t.until > Date.now() ? t.until : 0;
  }

  /** 加锁执行一次地区查询，并记录限流冷却（连续限流指数退避，成功一次即清零）。 */
  async runRegion(regionId, fn) {
    try {
      const out = await this.withRegionLock(regionId, fn);
      this.throttle.delete(regionId);
      return out;
    } catch (e) {
      if (e.throttled) {
        const hits = (this.throttle.get(regionId)?.hits || 0) + 1;
        const ms = throttleBackoffMs(hits);
        this.throttle.set(regionId, { hits, until: Date.now() + ms });
        e.message += `，暂停该地区查询 ${Math.round(ms / 1000)} 秒`;
      }
      throw e;
    }
  }

  /** 同一地区的查询串行（会共用城市会话与定位），不同地区互不等待。 */
  withRegionLock(regionId, fn) {
    const task = (this.regionLocks.get(regionId) || Promise.resolve()).then(fn);
    this.regionLocks.set(regionId, task.catch(() => {}));
    return task;
  }

  session(regionId, locationKey = '') {
    // 城市键本身带地区前缀（如 CN:上海），拼会话键时去掉，避免出现会话键 CN:CN:上海
    const city = locationKey.startsWith(regionId + ':') ? locationKey.slice(regionId.length + 1) : locationKey;
    const key = city ? `${regionId}:${city}` : regionId;
    if (!this.sessions.has(key)) {
      const s = new RegionSession(regionId, this.cfg, this.log);
      // 接口要求带 store 参数才会返回门店数据，用监控范围内的门店当触发器
      s.fallbackStore =
        this.cfg.priorityStoreFor?.[regionId] || this.cfg.defaultStoreFor?.[regionId] || '';
      this.sessions.set(key, s);
    }
    return this.sessions.get(key);
  }

  /** 需要查询的地区：监控门店所在地区 ∩ 监控机型有料号的地区 */
  activeRegions() {
    const regions = new Set((this.cfg.watchStores || []).map((id) => STORE_BY_ID[id]?.region).filter((r) => REGIONS[r]?.onlineStore));
    const out = [];
    for (const t of this.cfg.products) {
      for (const r of Object.keys(t.parts || {})) {
        if (regions.has(r) && !out.includes(r)) out.push(r);
      }
    }
    return out;
  }

  /** 某个地区要监控的门店 */
  watchedStoresIn(regionId) {
    return (this.cfg.watchStores || []).filter((id) => STORE_BY_ID[id]?.region === regionId);
  }

  /**
   * 对外主方法：查询所有目标机型在所有监控门店的库存。
   * 会自动建会话 / 定位 / 热身 / 重试，只有拿到可信数据才算数。
   */
  // 同一地区的手动检查和自动轮询排队（避免交错修改城市定位），不同地区并行、互不阻塞。
  checkAvailability(options = {}) {
    return this.collectAvailability(options);
  }

  /**
   * @param onUpdate      每个地区出结果后回调一次（按顺序调用）
   * @param only          本轮只查这几个地区（各地区间隔不同，香港会查得更频繁）
   * @param reuseMaxAgeMs 本轮不查的地区：若其最近一次结果不早于「本轮开始 - reuseMaxAgeMs」，
   *                      直接并入快照（否则标成 pending）。默认不复用。
   */
  async collectAvailability({ onUpdate, only, reuseMaxAgeMs = 0 } = {}) {
    const active = this.activeRegions();
    const regions = Array.isArray(only) && only.length ? active.filter((r) => only.includes(r)) : active;
    if (!regions.length) throw new Error('没有可查询的地区：请检查监控门店与监控机型');
    const products = this.cfg.products;
    const startedAt = Date.now();
    const startSeq = this.regionSeq || 0;

    // 快照总是取每个地区「最新的」结果：并行的轮次交替回调时，旧数据不会覆盖新数据。
    const snapshot = () => products.map((p) => {
      const acc = { stores: new Set(), perRegion: {} };
      for (const r of active) {
        if (!p.parts[r]) continue;
        const entry = this.lastRegionData.get(r);
        const fresh = entry && (regions.includes(r)
          ? entry.seq > startSeq
          : reuseMaxAgeMs > 0 && entry.at >= startedAt - reuseMaxAgeMs);
        const d = fresh ? entry.data[p.key] : null;
        if (d) {
          acc.perRegion[r] = d;
          if (d.ok !== false) for (const s of d.stores) if (STORE_BY_ID[s]?.region === r) acc.stores.add(s);
        } else {
          // 本轮不查的地区标成 pending：界面上写「等待下一轮」，
          // 而且它的 ok 是 false，complete 因此为 false —— 拿不到新数据时
          // 就不会用旧数据下「已售罄」的结论。
          acc.perRegion[r] = regions.includes(r)
            ? { partNumber: p.parts[r], stores: [], ok: false, inProgress: true, error: '查询尚未完成' }
            : { partNumber: p.parts[r], stores: [], ok: false, pending: true, error: '本轮未查询' };
        }
      }
      return this.normalize(p, acc);
    });

    let updates = Promise.resolve();
    // 每个地区有独立会话；最多大陆、香港两个并发查询。
    await Promise.all(regions.map(async (regionId) => {
      let regionData;
      try {
        regionData = await this.runRegion(regionId, () => this.checkRegion(regionId, products));
      } catch (e) {
        this.log('[地区:' + regionId + '] 查询失败: ' + e.message);
        regionData = Object.fromEntries(products.filter((p) => p.parts[regionId]).map((p) =>
          [p.key, { partNumber: p.parts[regionId], stores: [], ok: false, error: e.message }]));
      }
      this.regionSeq = (this.regionSeq || 0) + 1;
      this.lastRegionData.set(regionId, { seq: this.regionSeq, at: Date.now(), data: regionData });
      if (onUpdate) {
        updates = updates.then(() => onUpdate(snapshot()));
        // 立即观察拒绝，等所有地区结束后再向调用方传播。
        updates.catch(() => {});
      }
    }));
    await updates;
    return snapshot();
  }

  /** 查一个地区：必要时按城市逐个提交定位 */
  async checkRegion(regionId, products, { cities } = {}) {
    const R = REGIONS[regionId];
    const wanted = products.filter((p) => p.parts?.[regionId]);
    if (!wanted.length) return {};

    const watched = this.watchedStoresIn(regionId);
    const store = this.cfg.priorityStoreFor?.[regionId] || watched[0] || this.cfg.defaultStoreFor?.[regionId] || '';

    // 需要提交定位的城市（大陆）；香港不需要
    let cityPasses = [null];
    if (R.needsLocation) {
      const byKey = new Map();
      for (const id of watched) {
        const s = STORE_BY_ID[id];
        if (!s) continue;
        const c = CITY_BY_KEY[CITY_KEY(s.region, s.city)];
        if (c) byKey.set(c.key, c);
      }
      cityPasses = byKey.size ? [...byKey.values()] : [];
      if (cities) cityPasses = cityPasses.filter((c) => cities.includes(c.key));
      if (!cityPasses.length) {
        throw new Error(`${R.label}：没有可用的城市定位信息（无法查询门店库存）`);
      }
    }

    const parts = wanted.map((p) => p.parts[regionId]);
    const uniqueParts = [...new Set(parts)];
    const targetParts = new Set(parts);
    const chunks = [];
    for (let i = 0; i < uniqueParts.length; i += MAX_PARTS_PER_REQUEST - 1) {
      chunks.push([...new Set([R.canaryPart, ...uniqueParts.slice(i, i + MAX_PARTS_PER_REQUEST - 1)])]);
    }

    /** 查一个城市（香港为 null）：返回 { stores: Map<料号, Set<门店>>, delivery: {料号: 日期} } */
    const queryCity = async (city) => {
      // 大陆会话固定到单个城市，定位与热身结果可跨轮询复用。
      const sess = this.session(regionId, city?.key || '');
      try {
        const stale = !sess.ready || Date.now() - sess.createdAt > this.cfg.sessionRefreshMinutes * 60_000;
        if (stale) {
          sess.jar.clear();
          await sess.ensureSession();
        }
        if (city) await sess.setLocation(city);

        // 会话刚建立、或刚换过定位时，第一次查询常常返回空数据。
        // 每个城市复用独立会话，热身仅在会话首次建立时执行。
        const warmKey = city ? city.key : '';
        if (sess.warmedKey !== warmKey) {
          const warm = await sess.warmUp();
          if (!warm) throw new Error(`${R.label}：热身失败（${city ? city.city : '默认'}）`);
          sess.warmedKey = warmKey;
        }

        // 机型较多时分批：各批独立带哨兵、独立校验，可以并发发出。
        const contents = await mapLimit(chunks, BATCH_CONCURRENCY, async (chunk) => {
          const content = await sess.queryParts(chunk, store);
          if (!Array.isArray(content) || !sess.isHealthy(content)) {
            throw new Error(R.label + '：本批哨兵无数据，库存未知');
          }
          for (const pn of chunk) {
            const matches = content.filter((item) => item?.partNumber === pn);
            if (matches.length !== 1) throw new Error(R.label + '：库存响应缺失或重复料号 ' + pn);
            const item = matches[0];
            const count = item.partAvailableStoresCount;
            if (count === null || count === undefined || (typeof count === 'string' && !count.trim()) ||
                !['number', 'string'].includes(typeof count) || !Number.isInteger(Number(count)) || Number(count) < 0 ||
                (Number(count) > 0 && (typeof item.eligibleStores !== 'string' || !storesOf(item).length)) ||
                (Number(count) === 0 && String(item.eligibleStores || '').trim())) {
              throw new Error(R.label + '：库存字段不完整或矛盾 ' + pn);
            }
          }
          return content;
        });

        const stores = new Map();
        const delivery = {};
        for (const item of contents.flat()) {
          // 只收监控目标；哨兵是额外塞进去做健康检查的。
          if (!targetParts.has(item.partNumber)) continue;
          stores.set(item.partNumber, new Set(storesOf(item)));
          const d = item.deliveryMessage?.deliveryOptions?.[0]?.date;
          if (d) delivery[item.partNumber] = d;
        }
        return { stores, delivery };
      } catch (e) {
        // 只作废出错的这个城市会话，其他城市的定位 / 热身继续复用。
        sess.ready = false;
        throw e;
      }
    };

    // 每个城市的结果只在该城市全部批次校验通过后才记下；
    // 重试时只重查失败的城市，已成功城市不再重建会话、重新定位和热身。
    const perCity = cityPasses.map(() => null);
    let lastError = null;
    for (let attempt = 1; attempt <= this.cfg.maxRetries; attempt++) {
      const todo = cityPasses.map((c, i) => i).filter((i) => !perCity[i]);
      const errors = [];
      await mapLimit(todo, CITY_QUERY_CONCURRENCY, async (ci) => {
        try {
          perCity[ci] = await queryCity(cityPasses[ci]);
        } catch (e) {
          errors.push(e);
        }
      });
      if (!errors.length) break;
      lastError = errors.find((e) => e.throttled) || errors[0];
      if (lastError.throttled) throw lastError;
      const failed = cityPasses.length - perCity.filter(Boolean).length;
      this.log(`[重试:${R.short}] 第 ${attempt}/${this.cfg.maxRetries} 次失败（${failed}/${cityPasses.length} 个查询点）: ${lastError.message}`);
      if (attempt === this.cfg.maxRetries) throw lastError;
      await sleep(Math.min(1500 * attempt, 10_000));
    }
    if (perCity.some((c) => !c)) throw lastError || new Error(`${R.label}：多次重试后仍未取得可信库存数据`);

    // 汇总：每个目标在这几个城市的并集，只保留用户选中的门店
    // （Apple 会连带返回定位点附近的其他门店，例如定位上海会带出苏州 / 杭州，一律丢弃）；
    // 送达日期按城市顺序取第一个
    const watchedSet = new Set(watched);
    const out = {};
    for (const p of wanted) {
      const pn = p.parts[regionId];
      const set = new Set();
      for (const c of perCity) for (const s of c.stores.get(pn) || []) if (watchedSet.has(s)) set.add(s);
      out[p.key] = {
        region: regionId,
        partNumber: pn,
        stores: [...set],
        deliveryDate: perCity.map((c) => c.delivery[pn]).find(Boolean) || null,
        ok: true,
      };
    }
    return out;
  }

  /**
   * 优先通道的查询范围：优先门店所在地区 / 城市 + 优先机型。
   * @param priorityKeys 标了「优先」的机型 key；为空时视为全部机型
   * @returns {{ region, city, stores, keys, coversRegion } | null}
   */
  priorityScope(priorityKeys = []) {
    const store = STORE_BY_ID[this.cfg.priorityStore];
    const R = store && REGIONS[store.region];
    if (!R?.onlineStore) return null;
    const region = store.region;
    const inRegion = this.cfg.products.filter((p) => p.parts?.[region]);
    const starred = inRegion.filter((p) => priorityKeys.includes(p.key));
    const keys = (starred.length ? starred : inRegion).map((p) => p.key);
    if (!keys.length) return null;
    const cityKey = R.needsLocation ? CITY_KEY(region, store.city) : null;
    const watched = this.watchedStoresIn(region);
    // 本通道能确认的门店：香港一次请求覆盖全港；大陆只算优先门店所在城市
    const stores = cityKey ? watched.filter((id) => CITY_KEY(region, STORE_BY_ID[id].city) === cityKey) : watched;
    return { region, city: cityKey, stores, keys, coversRegion: stores.length === watched.length };
  }

  /**
   * 优先通道：只查优先门店所在城市的优先机型。
   * 返回的行只包含这些机型；没覆盖到的门店不下「无货」结论（complete=false）。
   */
  async checkPriority(priorityKeys = []) {
    const scope = this.priorityScope(priorityKeys);
    if (!scope) throw new Error('没有可用的优先通道（优先门店所在地区没有监控机型）');
    const { region } = scope;
    const products = this.cfg.products.filter((p) => scope.keys.includes(p.key));
    const inScope = new Set(scope.stores);
    let regionData;
    try {
      regionData = await this.runRegion(region, () =>
        this.checkRegion(region, products, scope.city ? { cities: [scope.city] } : {}));
    } catch (e) {
      this.log('[优先通道:' + region + '] 查询失败: ' + e.message);
      regionData = Object.fromEntries(products.map((p) =>
        [p.key, { partNumber: p.parts[region], stores: [], ok: false, error: e.message }]));
    }
    return products.map((p) => {
      const d = regionData[p.key];
      const acc = { stores: new Set(), perRegion: {} };
      if (d) {
        // 定位带出的其他城市门店不算：那些城市不在本通道的确认范围内
        const stores = d.ok === false ? [] : d.stores.filter((s) => inScope.has(s));
        acc.perRegion[region] = { ...d, stores };
        for (const s of stores) acc.stores.add(s);
      }
      // 其他地区本通道不查
      for (const r of Object.keys(p.parts || {})) {
        if (r !== region) acc.perRegion[r] = { partNumber: p.parts[r], stores: [], ok: false, pending: true, error: '本轮未查询' };
      }
      const row = this.normalize(p, acc);
      if (!scope.coversRegion && row.complete) {
        row.complete = false;
        if (!row.stores.length) row.availability = 'unknown';
      }
      row.lane = 'priority';
      row.scopeStores = scope.stores;
      row.scopeRegion = region;
      return row;
    });
  }

  /**
   * 界面展示用：把优先通道的新结果并入上一次的完整结果。
   * 通道覆盖范围内的门店用新数据，范围外的门店沿用完整结果。
   */
  mergeLaneRow(full, lane) {
    if (!full) return lane;
    const region = lane.scopeRegion;
    const scope = new Set(lane.scopeStores || []);
    const laneRegion = lane.perRegion?.[region];
    const fullRegion = full.perRegion?.[region];
    const inRegion = (id) => STORE_BY_ID[id]?.region === region;
    const outside = (full.stores || []).filter((id) => inRegion(id) && !scope.has(id));
    const regionStores = [...new Set([...(laneRegion?.stores || []), ...outside])];
    const stores = [...(full.stores || []).filter((id) => !inRegion(id)), ...regionStores];
    stores.sort((a, b) => (a === this.cfg.priorityStore ? -1 : b === this.cfg.priorityStore ? 1 : 0));
    const covers = scope.size === this.watchedStoresIn(region).length;
    const perRegion = { ...full.perRegion };
    if (laneRegion) {
      const known = laneRegion.ok && (covers || fullRegion?.ok);
      perRegion[region] = {
        ...laneRegion,
        stores: regionStores,
        ok: Boolean(known),
        pending: !known && laneRegion.ok ? Boolean(fullRegion?.pending) : false,
        error: known ? null : laneRegion.error || fullRegion?.error || null,
      };
    }
    const regional = Object.values(perRegion);
    const complete = regional.length > 0 && regional.every((d) => d.ok);
    return {
      ...full,
      stores,
      count: stores.length,
      atPriority: stores.includes(this.cfg.priorityStore),
      perRegion,
      ok: regional.some((d) => d.ok),
      complete,
      availability: stores.length ? 'available' : complete ? 'unavailable' : 'unknown',
      priorityKnown: lane.priorityKnown || full.priorityKnown,
    };
  }

  /** 把原始结果整理成我们自己的结构 */
  normalize(product, data) {
    const watched = this.cfg.watchStores || [];
    const stores = data ? [...data.stores].filter((s) => watched.includes(s)) : [];
    // 优先门店排在最前面
    stores.sort((a, b) => (a === this.cfg.priorityStore ? -1 : b === this.cfg.priorityStore ? 1 : 0));

    const perRegion = {};
    for (const [r, d] of Object.entries(data?.perRegion || {})) {
      perRegion[r] = {
        partNumber: d.partNumber,
        stores: d.stores.filter((s) => watched.includes(s)),
        ok: d.ok !== false,
        error: d.error || null,
        pending: Boolean(d.pending),
        inProgress: Boolean(d.inProgress),
      };
    }

    const deliveryDates = {};
    for (const [r, d] of Object.entries(data?.perRegion || {})) {
      if (d.deliveryDate) deliveryDates[r] = d.deliveryDate;
    }

    const regional = Object.values(perRegion);
    const complete = regional.length > 0 && regional.every((d) => d.ok);
    const ok = regional.some((d) => d.ok);
    const priorityRegion = STORE_BY_ID[this.cfg.priorityStore]?.region;
    return {
      key: product.key,
      product,
      parts: product.parts || {},
      ok,
      complete,
      availability: stores.length ? 'available' : complete ? 'unavailable' : 'unknown',
      priorityKnown: !product.parts?.[priorityRegion] || Boolean(perRegion[priorityRegion]?.ok),
      count: stores.length,
      stores,
      atPriority: stores.includes(this.cfg.priorityStore),
      perRegion,
      deliveryDates,
      deliveryDate: deliveryDates[this.cfg.priorityStoreRegion] || Object.values(deliveryDates)[0] || null,
    };
  }
}
