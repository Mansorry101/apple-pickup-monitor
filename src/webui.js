/**
 * 本地网页设置界面（只用 node 内置 http，无第三方依赖）。
 *
 *   http://127.0.0.1:8787
 *
 * 只监听回环地址，外部网络访问不到。
 * 可以：选城市 → 选门店 / 选机型-容量-颜色 / 调轮询行为 / 立即检查 / 发测试邮件 / 看日志。
 */
import http from 'node:http';
import fs from 'node:fs';
import { REGIONS, REGION_ORDER, CITIES, STORES, STORE_BY_ID } from './stores.js';
import { loadSettings, saveSettings, enrichTargets, CATALOG_CACHE } from './settings.js';
import { fetchCatalog, loadCatalogCache, saveCatalogCache } from './catalog.js';
import { PAGE } from './webui-page.js';

const json = (res, code, obj) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });

function tailLog(file, lines) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

/** 给界面用的地区 + 城市 + 门店目录 */
function directoryPayload() {
  return {
    regions: REGION_ORDER.map((id) => ({
      id,
      label: REGIONS[id].label,
      short: REGIONS[id].short,
      onlineStore: Boolean(REGIONS[id].onlineStore),
      currency: REGIONS[id].currency,
      note: REGIONS[id].onlineStore
        ? ''
        : 'Apple 澳门没有网上商店，无法查询门店取货库存',
    })),
    cities: CITIES.map((c) => ({
      key: c.key,
      region: c.region,
      regionLabel: c.regionLabel,
      province: c.province,
      city: c.city,
      district: c.district,
      searchable: c.searchable,
      storeCount: c.storeCount,
    })),
    stores: STORES.map((s) => ({
      id: s.id, region: s.region, province: s.province, city: s.city,
      name: s.name, address: s.address, phone: s.phone,
      searchable: Boolean(REGIONS[s.region].onlineStore),
    })),
  };
}

/**
 * @param {object} ctx  { getCfg, reload, runCheckNow, sendTestMail, status }
 */
export function startWebUi(ctx, log = console.log) {
  let lastRequestAt = Date.now();

  const server = http.createServer(async (req, res) => {
    lastRequestAt = Date.now();
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = `${req.method} ${url.pathname}`;

    try {
      if (route === 'GET /') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(PAGE);
        return;
      }

      if (route === 'GET /api/bootstrap') {
        const cfg = ctx.getCfg();
        const settings = loadSettings();
        const catalog = loadCatalogCache(CATALOG_CACHE) || { families: [], variants: [], regions: [], fetchedAt: null };
        return json(res, 200, {
          settings,
          directory: directoryPayload(),
          catalog,
          mail: {
            configured: Boolean(cfg.mail.user && cfg.mail.pass && cfg.mail.to.length),
            from: cfg.mail.user,
            to: cfg.mail.to,
          },
          status: ctx.status(),
          runsMonitor: ctx.runsMonitor !== false,
          version: ctx.version || '2.0.0',
        });
      }

      if (route === 'POST /api/settings') {
        const body = await readBody(req);
        const catalog = loadCatalogCache(CATALOG_CACHE);
        // 保存前用目录补全机型名称与直达链接，让 config.json 本身可读
        if (Array.isArray(body.targets)) body.targets = enrichTargets(body.targets, catalog);
        const saved = saveSettings(body);
        ctx.reload('设置已更新');
        log('[界面] 设置已保存并生效');
        log(`[界面] 优先门店 ${saved.priorityStore}，监控门店 ${saved.watchStores.join('、')}，机型 ${saved.targets.map((t) => t.name).join('、') || '(空)'}`);
        return json(res, 200, { ok: true, settings: saved, enriched: enrichTargets(saved.targets, catalog) });
      }

      if (route === 'POST /api/catalog/refresh') {
        log('[界面] 开始刷新机型目录');
        const catalog = await fetchCatalog({ log });
        if (catalog.variants.length) {
          saveCatalogCache(CATALOG_CACHE, catalog);
          ctx.reload('机型目录已更新');
          log(`[界面] 机型目录已更新：${catalog.variants.length} 个变体`);
          return json(res, 200, { ok: true, catalog });
        }
        return json(res, 200, { ok: false, error: '未能获取到任何机型，请检查网络', errors: catalog.errors });
      }

      if (route === 'POST /api/check') {
        const results = await ctx.runCheckNow();
        return json(res, 200, { ok: true, results, status: ctx.status() });
      }

      if (route === 'POST /api/test-email') {
        try {
          await ctx.sendTestMail();
          return json(res, 200, { ok: true });
        } catch (e) {
          return json(res, 200, { ok: false, error: e.message });
        }
      }

      if (route === 'GET /api/logs') {
        const cfg = ctx.getCfg();
        const n = Math.min(500, Math.max(20, Number(url.searchParams.get('lines')) || 120));
        return json(res, 200, { ok: true, text: tailLog(cfg.logFile, n) });
      }

      if (route === 'GET /api/store') {
        const id = url.searchParams.get('id');
        const s = STORE_BY_ID[id];
        return json(res, s ? 200 : 404, s || { error: 'not found' });
      }

      return json(res, 404, { error: 'not found' });
    } catch (e) {
      log(`[界面] 请求出错 ${route}: ${e.message}`);
      return json(res, 500, { error: e.message });
    }
  });

  return new Promise((resolve) => {
    const port = ctx.getCfg().uiPort;
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      log(`[界面] 设置界面已启动： http://127.0.0.1:${actual}`);
      if (ctx.idleExitMinutes) {
        const timer = setInterval(
          () => {
            if (Date.now() - lastRequestAt > ctx.idleExitMinutes * 60_000) {
              log(`[界面] 已闲置 ${ctx.idleExitMinutes} 分钟，自动退出设置界面`);
              process.exit(0);
            }
          },
          60_000,
        );
        timer.unref();
      }
      resolve({ server, port: actual, url: `http://127.0.0.1:${actual}` });
    });
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        log(`[界面] 端口 ${port} 已被占用，未启动设置界面（监控不受影响）`);
      } else {
        log(`[界面] 启动失败: ${e.message}`);
      }
      resolve({ server: null, port: null, url: null });
    });
  });
}
