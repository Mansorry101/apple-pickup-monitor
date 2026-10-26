/**
 * 有货 → 交给浏览器扩展「Apple 结账速填」自动下单。
 *
 * 流程：
 *   1. 告警判定有货（首次，不含「仍有货」定时提醒）时，登记一次交接（一次性令牌，15 分钟有效）
 *   2. 用 Chrome 打开购物袋（机型要提前加进购物袋），地址末尾带 #af-handoff=<令牌>@<设置界面端口>
 *   3. 扩展读到令牌后 POST http://127.0.0.1:<端口>/api/handoff/claim 领取机型 / 门店信息，
 *      然后自己走：点「结账」→ 选有货门店 → 取货信息 → 发票 → 支付 → 检查订单
 *
 * 浏览器默认用专用的 Chrome 配置（项目下 browser-profile/）：和日常 Chrome 分开，
 * 不带日常浏览器里的旧 cookie；登录状态和购物袋会一直保存在里面。
 * 这个配置要提前打开一次（设置界面「打开下单浏览器」）：登录 Apple 账户、加购、装扩展。
 *
 * 令牌只能领取一次、过期作废；领取接口只监听 127.0.0.1。
 * 同一段冷却时间内只交接一次，避免持续有货时反复弹出浏览器。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STORE_BY_ID } from './stores.js';
import { ROOT } from './constants.js';

export const HANDOFF_TTL_MS = 15 * 60_000;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// 交接时打开的地址：大陆官网购物袋。机型由你提前加进购物袋，扩展只负责点结账、填信息
export const BAG_URL = 'https://www.apple.com.cn/shop/bag';
const BUY_URL_RE = /^https:\/\/www\.apple\.com\.cn\/shop\/buy-[a-z]+\/[A-Za-z0-9/._~-]+$/;

/** 大陆购买页（只放进交接数据里给扩展显示，不会被打开） */
export function checkoutUrlOf(product) {
  const url = product?.buyUrls?.CN || '';
  return BUY_URL_RE.test(url) ? url : '';
}

export const handoffUrl = (id, port) => `${BAG_URL}#af-handoff=${id}@${port}`;

/** 专用下单浏览器的配置目录（Chrome 的 --user-data-dir） */
export const PROFILE_DIR = process.env.CHECKOUT_PROFILE_DIR || path.join(ROOT, 'browser-profile');
/** 下单浏览器要用哪个配置目录；不用专用配置时返回空，打开的就是日常浏览器 */
export const profileDirOf = (cfg) => (cfg.checkoutProfile === false ? '' : PROFILE_DIR);

/**
 * 从一批告警里挑出要交接的那一个：只看大陆有货的机型；
 * 优先门店有货的排前面，其次按监控列表里机型的先后。
 */
export function pickHandoffItem(items, cfg) {
  const order = (cfg.products || []).map((p) => p.key);
  const rank = (it) => [it.atPriority ? 0 : 1, Math.max(0, order.indexOf(it.key || it.product?.key))];
  return items
    .filter((it) => (it.stores || []).some((id) => STORE_BY_ID[id]?.region === 'CN'))
    .filter((it) => it.parts?.CN)
    .sort((a, b) => {
      const [a1, a2] = rank(a);
      const [b1, b2] = rank(b);
      return a1 - b1 || a2 - b2;
    })[0] || null;
}

/** 交给扩展的数据：只有下单需要的信息，不含任何凭据 */
export function buildRecord(item, cfg, { id = randomUUID(), now = Date.now(), test = false } = {}) {
  const p = item.product || {};
  const stores = (item.stores || [])
    .filter((sid) => STORE_BY_ID[sid]?.region === 'CN')
    .sort((a, b) => (a === cfg.priorityStore ? -1 : b === cfg.priorityStore ? 1 : 0))
    .map((sid) => ({ id: sid, name: STORE_BY_ID[sid].name }));
  return {
    id,
    test,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + HANDOFF_TTL_MS).toISOString(),
    product: {
      key: p.key || item.key || '',
      name: p.name || '',
      part: item.parts?.CN || p.parts?.CN || '',
      capacity: p.capacity || '',
      colorZh: p.colorZh || '',
      buyUrl: checkoutUrlOf(p),
    },
    stores,
  };
}

/* ---------------- 打开浏览器 ---------------- */

function windowsBrowsers() {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const rel = {
    chrome: ['Google\\Chrome\\Application\\chrome.exe'],
    edge: ['Microsoft\\Edge\\Application\\msedge.exe'],
  };
  const out = {};
  for (const [name, list] of Object.entries(rel)) {
    out[name] = roots.flatMap((r) => list.map((x) => path.join(r, x))).find((f) => fs.existsSync(f)) || '';
  }
  return out;
}

const MAC_APPS = { chrome: 'Google Chrome', edge: 'Microsoft Edge' };
const LINUX_BINS = { chrome: ['google-chrome', 'google-chrome-stable', 'chromium'], edge: ['microsoft-edge'] };

/**
 * 算出启动命令（纯函数，便于测试）。browser: chrome / edge / 浏览器 exe 的完整路径。
 * 扩展只装在 Chrome 系浏览器里，所以不回退到「系统默认浏览器」—— 那可能是没装扩展的浏览器。
 * profileDir: 专用配置目录。带上它，浏览器就是一个独立的实例，和日常浏览器互不影响
 */
export function launchCommand(url, browser = 'chrome', platform = process.platform, found = null, { profileDir = '' } = {}) {
  // 地址会被交给系统去启动浏览器，只放行购物袋（可带交接令牌）这一种形状
  if (!/^https:\/\/www\.apple\.com\.cn\/shop\/bag(#af-handoff=[0-9a-f-]+@\d+)?$/.test(url)) throw new Error('拒绝打开非 Apple 购物袋地址');
  const b = String(browser || 'chrome').trim();
  const flags = profileDir ? [`--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check'] : [];
  if (platform === 'win32') {
    const exe = /\.exe$/i.test(b) ? b : (found || windowsBrowsers())[b.toLowerCase()] || '';
    if (!exe) throw new Error(`没找到 ${b} 浏览器，请在设置界面里填浏览器 exe 的完整路径`);
    return { cmd: exe, args: [...flags, url] };
  }
  if (platform === 'darwin') {
    const app = MAC_APPS[b.toLowerCase()] || b;
    // 日常浏览器开着时 open -a 会把参数丢掉，所以专用配置要加 -n 另起一个实例
    return { cmd: 'open', args: flags.length ? ['-na', app, '--args', ...flags, url] : ['-a', app, url] };
  }
  const bin = path.isAbsolute(b) ? b : (LINUX_BINS[b.toLowerCase()] || [b])[0];
  return { cmd: bin, args: [...flags, url] };
}

export function openInBrowser(url, browser, opts = {}) {
  if (opts.profileDir) fs.mkdirSync(opts.profileDir, { recursive: true });
  const { cmd, args } = launchCommand(url, browser, process.platform, null, opts);
  return new Promise((resolve, reject) => {
    // 参数数组直接交给进程，不经过 shell，地址里的字符不会被解释
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/* ---------------- 交接登记 ---------------- */

/**
 * @param {object} o
 *   getCfg   () => 当前配置
 *   getPort  () => 设置界面实际监听的端口（没启动界面时返回 null，扩展就领不到）
 *   open     (url, browser, { profileDir }) => Promise   默认 openInBrowser
 *   log
 */
export function createHandoff({ getCfg, getPort, open = openInBrowser, log = () => {}, now = () => Date.now() }) {
  const records = new Map();
  const seenAlerts = new Set(); // 已处理过的告警事件：邮件失败重试同一事件时不重复交接
  let lastAt = 0;
  let last = null;

  const prune = () => {
    const t = now();
    for (const [id, r] of records) if (Date.parse(r.expiresAt) < t) records.delete(id);
  };

  async function launch(record, cfg) {
    const port = getPort();
    if (!port) throw new Error('设置界面没有启动，扩展无法领取交接信息（不要用 --no-ui 运行）');
    records.set(record.id, { ...record, claimedAt: null });
    const url = handoffUrl(record.id, port);
    await open(url, cfg.checkoutBrowser, { profileDir: profileDirOf(cfg) });
    last = { id: record.id, at: record.createdAt, name: record.product.name, stores: record.stores.map((s) => s.name), test: record.test, claimedAt: null };
    return record;
  }

  /** 告警触发。返回登记的交接；不需要交接时返回 null */
  async function trigger(items, cfg = getCfg(), { dryRun = false } = {}) {
    if (!cfg.autoCheckout) return null;
    const fresh = items.filter((it) => !it.reminder && !(it.alertId && seenAlerts.has(it.alertId)));
    const item = pickHandoffItem(fresh, cfg);
    if (!item) return null;
    if (!dryRun) for (const it of fresh) if (it.alertId) seenAlerts.add(it.alertId);
    const t = now();
    const cooldown = (cfg.checkoutCooldownMinutes ?? 10) * 60_000;
    if (lastAt && t - lastAt < cooldown) {
      log(`🛒 ${item.product.name} 有货，但 ${Math.ceil((cooldown - (t - lastAt)) / 60_000)} 分钟内已交接过一次，不再重复打开浏览器`);
      return null;
    }
    const record = buildRecord(item, cfg, { now: t });
    if (dryRun) {
      log(`🛒 [DRY-RUN] 将打开浏览器交给扩展下单：${record.product.name}（${record.stores.map((s) => s.name).join('、')}）`);
      return null;
    }
    prune();
    await launch(record, cfg);
    lastAt = t;
    log(`🛒 已打开浏览器，交给扩展自动下单：${record.product.name}（${record.stores.map((s) => s.name).join('、')}）`);
    return record;
  }

  /** 设置界面「测试联动」：打开购物袋，扩展只校验能否领取，不点结账 */
  async function test(cfg = getCfg()) {
    const p = (cfg.products || []).find((x) => x.parts?.CN);
    if (!p) throw new Error('监控机型里没有大陆版本，无法测试（先在界面里刷新机型目录）');
    const sid = cfg.priorityStore;
    const item = { key: p.key, product: p, parts: p.parts, stores: STORE_BY_ID[sid]?.region === 'CN' ? [sid] : [] };
    const record = buildRecord(item, cfg, { now: now(), test: true });
    prune();
    await launch(record, cfg);
    log(`🛒 [测试] 已打开浏览器测试扩展联动：${record.product.name}`);
    return record;
  }

  /** 设置界面「打开下单浏览器」：不带令牌打开购物袋，让你提前登录、加购、装扩展 */
  async function openBrowser(cfg = getCfg()) {
    await open(BAG_URL, cfg.checkoutBrowser, { profileDir: profileDirOf(cfg) });
    log(`🛒 已打开下单浏览器${profileDirOf(cfg) ? '（专用配置）' : ''}`);
  }

  /** 扩展领取。一次性：领过的、过期的、不存在的都返回 null */
  function claim(id) {
    if (!ID_RE.test(String(id || ''))) return null;
    prune();
    const r = records.get(id);
    if (!r || r.claimedAt) return null;
    r.claimedAt = new Date(now()).toISOString();
    if (last?.id === id) last.claimedAt = r.claimedAt;
    log(`🛒 扩展已接手${r.test ? '（测试）' : ''}：${r.product.name}`);
    const { claimedAt, ...out } = r;
    return out;
  }

  return { trigger, test, claim, openBrowser, status: () => last };
}
