/**
 * 手机推送（Bark）。
 *
 * 邮件从发出到手机弹出常常要几秒到一两分钟；Bark 走苹果 APNs，一般 1~2 秒就到。
 * 推送和邮件并行发出、互不等待：邮件仍是备份和「已通知」的确认依据，
 * 推送失败只记日志，不影响邮件和告警状态。
 *
 * 配置（.env，由「配置手机推送.bat」写入）：
 *   BARK_KEY       设备 key，多台设备用英文逗号隔开
 *   BARK_SERVER    推送服务器，默认 https://api.day.app（自建 bark-server 时才改）
 *   BARK_CRITICAL  true = 优先门店有货用「重要警告」，静音 / 勿扰也响铃（需在 Bark 里授权）
 *   BARK_OPEN      product = 点通知打开商品购买页（默认）；bag = 打开购物袋
 *   BARK_SOUND     铃声名，可不填
 */
import { regionalMailItems, namesLabel } from './mailer.js';
import { STORE_BY_ID } from './stores.js';

export const DEFAULT_SERVER = 'https://api.day.app';
export const BAG_URL = {
  CN: 'https://www.apple.com.cn/shop/bag',
  HK: 'https://www.apple.com/hk-zh/shop/bag',
};
const GROUP = 'Apple 取货监控';
const TIMEOUT_MS = 10_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const pushEnabled = (cfg) => Boolean(cfg?.push?.keys?.length);

/** 只露出前 4 位，日志和界面里用 */
export const maskKey = (k) => (k ? `${String(k).slice(0, 4)}****` : '');

/**
 * 解析用户粘贴的内容：可以是 Bark App 里复制的整条地址
 * （https://api.day.app/KEY/推送内容），也可以只是 key；多台设备用逗号 / 空格隔开。
 */
export function parseBarkInput(input) {
  const keys = [];
  let server = '';
  for (const token of String(input || '').split(/[\s,，;；]+/).filter(Boolean)) {
    let key = token;
    if (/^https?:\/\//i.test(token)) {
      let u;
      try { u = new URL(token); } catch { continue; }
      key = decodeURIComponent(u.pathname.split('/').filter(Boolean)[0] || '');
      if (key === 'push') continue;
      server ||= u.origin;
    }
    if (KEY_RE.test(key) && !keys.includes(key)) keys.push(key);
  }
  return { server: server || DEFAULT_SERVER, keys };
}

const storeNames = (it) => (it.stores || []).map((id) => STORE_BY_ID[id]?.name || id).join('、');

/** 把一组告警变成一条推送。kind: priority / other / soldOut */
export function buildPush(kind, items, cfg, { reminder = false } = {}) {
  const rows = regionalMailItems(items);
  const p = cfg.priorityStoreInfo || {};
  const push = cfg.push || {};
  const lines = rows.map((it) => `${it.product.name}：${storeNames(it) || '—'}`);
  const region =
    rows.flatMap((it) => (it.stores || []).map((id) => STORE_BY_ID[id]?.region)).find(Boolean) ||
    Object.keys(rows[0]?.parts || {})[0] || cfg.priorityStoreRegion || 'CN';
  const productUrl = rows.map((it) => it.product.buyUrl).find(Boolean) || '';
  const bagUrl = BAG_URL[region] || '';
  const url = push.open === 'bag' ? bagUrl || productUrl : productUrl || bagUrl;
  const base = { group: GROUP, ...(url ? { url } : {}) };

  if (kind === 'priority') {
    return {
      ...base,
      title: reminder ? `⏰ 仍有货：${p.name || '优先门店'}` : `🎉 ${p.name || '优先门店'}有货`,
      body: `${lines.join('\n')}\n点开立即下单，选门市取货`,
      level: push.critical ? 'critical' : 'timeSensitive',
      // 首次有货循环响铃 30 秒；定时的「仍有货」提醒只响一声
      ...(reminder ? {} : { call: '1' }),
    };
  }
  if (kind === 'other') {
    const status = items.some((i) => i.priorityKnown === false) ? '库存未确认' : '暂无库存';
    return {
      ...base,
      title: '🔔 其他门店有货',
      subtitle: `${p.name || '优先门店'}${status}`,
      body: lines.join('\n'),
      level: 'timeSensitive',
    };
  }
  return {
    ...base,
    title: '⌛ 库存已消失',
    body: `${namesLabel(rows) || '监控机型'} 已不可门市取货`,
    level: 'passive',
  };
}

/**
 * 发一条推送到所有设备。每台设备独立发送，网络错误重试一次；
 * key 无效之类的 4xx 不重试。全部设备都失败才抛错。
 */
export async function sendPush(push, msg, { attempts = 2 } = {}) {
  const keys = push?.keys || [];
  if (!keys.length) throw new Error('未配置 Bark key');
  const server = String(push.server || DEFAULT_SERVER).replace(/\/+$/, '');
  const payload = { isArchive: '1', ...msg };
  if (push.sound && !payload.sound) payload.sound = push.sound;

  const one = async (key) => {
    let last = null;
    for (let i = 1; i <= attempts; i++) {
      try {
        const res = await fetch(`${server}/push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ ...payload, device_key: key }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* 非 JSON */ }
        if (res.ok && json?.code === 200) return;
        const err = new Error(`Bark 返回 ${json?.code ?? res.status}：${json?.message || text.slice(0, 100)}`);
        if (res.status >= 400 && res.status < 500) { err.fatal = true; throw err; }
        last = err;
      } catch (e) {
        if (e.fatal) throw e;
        last = e.name === 'TimeoutError' || e.name === 'AbortError'
          ? new Error(`Bark 推送超时（${TIMEOUT_MS / 1000} 秒无响应）`)
          : new Error(`Bark 网络错误：${e.cause?.code || e.message}`);
      }
      if (i < attempts) await sleep(800);
    }
    throw last;
  };

  const results = await Promise.allSettled(keys.map(one));
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? `${maskKey(keys[i])} ${r.reason.message}` : null))
    .filter(Boolean);
  if (failed.length === keys.length) throw new Error(failed.join('；'));
  return { sent: keys.length - failed.length, failed };
}
