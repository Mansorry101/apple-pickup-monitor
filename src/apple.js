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

export { storeLabel };

const MAX_PARTS_PER_REQUEST = 8; // 实测 12 也可用，留点余量
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  }

  session(regionId) {
    if (!this.sessions.has(regionId)) {
      const s = new RegionSession(regionId, this.cfg, this.log);
      // 接口要求带 store 参数才会返回门店数据，用监控范围内的门店当触发器
      s.fallbackStore =
        this.cfg.priorityStoreFor?.[regionId] || this.cfg.defaultStoreFor?.[regionId] || '';
      this.sessions.set(regionId, s);
    }
    return this.sessions.get(regionId);
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
  // 同一客户端的手动检查和自动轮询排队，避免交错修改城市定位。
  checkAvailability(options = {}) {
    const task = (this.checkQueue || Promise.resolve()).then(() => this.collectAvailability(options));
    this.checkQueue = task.catch(() => {});
    return task;
  }

  async collectAvailability({ onUpdate } = {}) {
    const regions = this.activeRegions();
    if (!regions.length) throw new Error('没有可查询的地区：请检查监控门店与监控机型');
    const products = this.cfg.products;
    const acc = new Map(products.map((p) => [p.key, { stores: new Set(), perRegion: {} }]));
    for (const p of products) for (const r of regions) {
      if (p.parts[r]) acc.get(p.key).perRegion[r] = {
        partNumber: p.parts[r], stores: [], ok: false, error: '查询尚未完成',
      };
    }
    let updates = Promise.resolve();
    // 每个地区有独立会话；最多大陆、香港两个并发查询。
    await Promise.all(regions.map(async (regionId) => {
      let regionData;
      try {
        regionData = await this.checkRegion(regionId, products);
      } catch (e) {
        this.log('[地区:' + regionId + '] 查询失败: ' + e.message);
        regionData = Object.fromEntries(products.filter((p) => p.parts[regionId]).map((p) =>
          [p.key, { partNumber: p.parts[regionId], stores: [], ok: false, error: e.message }]));
      }
      for (const p of products) {
        const d = regionData[p.key];
        if (!d) continue;
        const a = acc.get(p.key);
        if (d.ok !== false) for (const store of d.stores) {
          if (STORE_BY_ID[store]?.region === regionId) a.stores.add(store);
        }
        a.perRegion[regionId] = d;
      }
      if (onUpdate) {
        const snapshot = products.map((p) => this.normalize(p, acc.get(p.key)));
        updates = updates.then(() => onUpdate(snapshot));
        // 立即观察拒绝，等所有地区结束后再向调用方传播。
        updates.catch(() => {});
      }
    }));
    await updates;
    return products.map((p) => this.normalize(p, acc.get(p.key)));
  }

  /** 查一个地区：必要时按城市逐个提交定位 */
  async checkRegion(regionId, products) {
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
      if (!cityPasses.length) {
        throw new Error(`${R.label}：没有可用的城市定位信息（无法查询门店库存）`);
      }
    }

    const parts = wanted.map((p) => p.parts[regionId]);
    let lastError = null;

    for (let attempt = 1; attempt <= this.cfg.maxRetries; attempt++) {
      // 每次尝试独立汇总，不继承失败尝试的门店或送达日期。
      const perCity = cityPasses.map(() => new Map());
      const delivery = {};
      try {
        const sess = this.session(regionId);
        const stale = !sess.ready || Date.now() - sess.createdAt > this.cfg.sessionRefreshMinutes * 60_000;
        if (stale) {
          sess.jar.clear();
          await sess.ensureSession();
        }

        let allGood = true;
        for (let ci = 0; ci < cityPasses.length; ci++) {
          const city = cityPasses[ci];
          if (city) await sess.setLocation(city);

          // 会话刚建立、或刚换过定位时，第一次查询常常返回空数据。
          // 必须先拿哨兵热身，否则会把"接口没准备好"误判成"没货"。
          const warmKey = city ? city.key : '';
          if (sess.warmedKey !== warmKey) {
            const warm = await sess.warmUp();
            if (!warm) {
              allGood = false;
              this.log(`[校验:${R.short}] 第 ${attempt} 次：热身失败（${city ? city.city : '默认'}）`);
              break;
            }
            sess.warmedKey = warmKey;
          }

          const uniqueParts = [...new Set(parts)];
          const raw = [];
          for (let i = 0; i < uniqueParts.length; i += MAX_PARTS_PER_REQUEST - 1) {
            const chunk = [...new Set([R.canaryPart, ...uniqueParts.slice(i, i + MAX_PARTS_PER_REQUEST - 1)])];
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
            raw.push(...content);
          }

          const m = perCity[ci];
          const targetParts = new Set(parts);
          for (const item of raw) {
            // 只收监控目标；哨兵是额外塞进去做健康检查的。
            // 注意别用 partNumber === canaryPart 来判断 —— 用户完全可能
            // 正好把哨兵那款机型设成监控目标，那样会被静默丢掉。
            if (!targetParts.has(item.partNumber)) continue;
            m.set(item.partNumber, new Set(storesOf(item)));
            const d = item.deliveryMessage?.deliveryOptions?.[0]?.date;
            if (d) delivery[item.partNumber] = d;
          }
        }
        if (!allGood) {
          sess.ready = false;
          await sleep(1200 * attempt);
          continue;
        }

        // 汇总：每个目标在这几个城市的并集
        const out = {};
        for (const p of wanted) {
          const pn = p.parts[regionId];
          const set = new Set();
          for (const m of perCity) for (const s of m.get(pn) || []) set.add(s);
          out[p.key] = {
            region: regionId,
            partNumber: pn,
            stores: [...set],
            deliveryDate: delivery[pn] || null,
            ok: true,
          };
        }
        return out;
      } catch (e) {
        lastError = e;
        this.log(`[重试:${R.short}] 第 ${attempt}/${this.cfg.maxRetries} 次失败: ${e.message}`);
        this.session(regionId).ready = false;
        if (attempt === this.cfg.maxRetries) throw e;
        await sleep(Math.min(1500 * attempt, 10_000));
      }
    }
    throw lastError || new Error(`${R.label}：多次重试后仍未取得可信库存数据`);
  }

  /** 把原始结果整理成我们自己的结构 */
  normalize(product, data) {
    const watched = this.cfg.watchStores || [];
    const stores = data ? [...data.stores].filter((s) => watched.includes(s)) : [];
    // 优先门店排在最前面
    stores.sort((a, b) => (a === this.cfg.priorityStore ? -1 : b === this.cfg.priorityStore ? 1 : 0));

    const allEligible = new Set();
    const perRegion = {};
    for (const [r, d] of Object.entries(data?.perRegion || {})) {
      perRegion[r] = { partNumber: d.partNumber, stores: [...d.stores], ok: d.ok !== false, error: d.error || null };
      for (const s of d.stores) allEligible.add(s);
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
      // Apple 报出来、但我们没在监控的门店（用于提示"附近还有别的店有货"）
      otherStores: [...allEligible].filter((s) => !watched.includes(s)),
      atPriority: stores.includes(this.cfg.priorityStore),
      perRegion,
      deliveryDates,
      deliveryDate: deliveryDates[this.cfg.priorityStoreRegion] || Object.values(deliveryDates)[0] || null,
    };
  }
}
