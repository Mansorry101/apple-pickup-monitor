/**
 * 邮件通知（QQ邮箱 SMTP / 任意 SMTP）。
 * 支持多地区：同一款机型在大陆/香港料号不同，邮件里会一并列出。
 */
import nodemailer from 'nodemailer';
import { storeLabel, STORE_BY_ID, REGIONS } from './stores.js';

export function createTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.mail.host,
    port: cfg.mail.port,
    secure: cfg.mail.secure, // 465 用 true；587 用 false
    auth: { user: cfg.mail.user, pass: cfg.mail.pass },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });
}

const cnTime = (d = new Date()) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(d);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** 把多个机型名合成简短标签：共用前缀只显示一次（避免"512GB 512GB"这种重复） */
export function namesLabel(items) {
  const names = items.map((i) => i.product.name).filter(Boolean);
  if (!names.length) return '';
  const wordLists = names.map((n) => n.split(/\s+/));
  const first = wordLists[0];
  let k = 0;
  while (k < first.length && wordLists.every((w) => w[k] === first[k])) k++;
  if (k === 0) return names.join(' / ');
  const prefix = first.slice(0, k).join(' ');
  const tails = wordLists.map((w) => w.slice(k).join(' ')).filter(Boolean);
  return tails.length ? `${prefix} ${tails.join(' / ')}` : prefix;
}

/** 料号按地区列出来 */
const partsLabel = (it) =>
  Object.entries(it.parts || {})
    .map(([r, pn]) => `${REGIONS[r]?.short || r} ${pn}`)
    .join(' / ');

/** 优先用有货地区的购买链接 */
function bestLink(it) {
  const urls = it.product.buyUrls || {};
  const order = [
    ...new Set((it.stores || []).map((s) => STORE_BY_ID[s]?.region).filter(Boolean)),
    ...Object.keys(urls),
  ];
  for (const r of order) if (urls[r]) return urls[r];
  return it.product.buyUrl || '';
}

/** 邮件中的每一行只对应一个地区的版本、门店和购买链接。 */
export function regionalMailItems(items) {
  return items.flatMap((it) => {
    const regions = it.stores?.length
      ? [...new Set(it.stores.map((id) => STORE_BY_ID[id]?.region).filter(Boolean))]
      : Object.keys(it.parts || {});
    return regions.map((region) => ({
      ...it,
      parts: it.parts?.[region] ? { [region]: it.parts[region] } : {},
      stores: (it.stores || []).filter((id) => STORE_BY_ID[id]?.region === region),
      product: { ...it.product,
        buyUrls: it.product.buyUrls?.[region] ? { [region]: it.product.buyUrls[region] } : {},
        buyUrl: it.product.buyUrls?.[region] || '',
      },
    }));
  });
}

function productRows(items) {
  return items
    .map((it) => {
      const stores = (it.stores || []).map((s) => storeLabel(s)).join('、') || '—';
      const link = bestLink(it);
      const linkHtml = link
        ? `<a href="${esc(link)}" style="color:#06c">立即前往 Apple 购买页</a>`
        : '';
      return `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #eee"><strong>${esc(it.product.name)}</strong><br>
          <span style="color:#888;font-size:12px">料号 ${esc(partsLabel(it))}</span></td>
        <td style="padding:10px;border-bottom:1px solid #eee">${esc(stores)}</td>
        <td style="padding:10px;border-bottom:1px solid #eee">${linkHtml}</td>
      </tr>`;
    })
    .join('');
}

function shell(title, color, subtitle, items, footerNote) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e5e7">
      <div style="background:${color};color:#fff;padding:18px 22px">
        <div style="font-size:19px;font-weight:700">${esc(title)}</div>
        <div style="font-size:13px;opacity:.92;margin-top:4px">${esc(subtitle)}</div>
      </div>
      <div style="padding:8px 12px 4px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead><tr style="text-align:left;color:#666;font-size:12px">
            <th style="padding:8px 10px">机型</th><th style="padding:8px 10px">有货门店</th><th style="padding:8px 10px">操作</th>
          </tr></thead>
          <tbody>${productRows(items)}</tbody>
        </table>
      </div>
      <div style="padding:14px 22px 20px;color:#666;font-size:12px;line-height:1.7">
        ${footerNote || ''}
        <div>检查时间（北京时间）：<strong>${cnTime()}</strong></div>
        <div>数据来源：Apple 官网门市取货接口，程序自动轮询核对</div>
      </div>
    </div>
    <div style="text-align:center;color:#999;font-size:11px;margin-top:12px">Apple Pickup Monitor · 自动发送，请勿回复</div>
  </div></body></html>`;
}

/** 优先门店有货 */
export function buildPriorityMail(items, cfg) {
  items = regionalMailItems(items);
  const p = cfg.priorityStoreInfo || {};
  const where = `${p.city || ''} · ${p.name || ''}`.replace(/^ · /, '');
  const label = namesLabel(items);
  return {
    subject: `🎉【${p.name || '优先门店'}有货】${label} — ${p.city || ''} 可门市取货`,
    html: shell(
      `🎉 ${where} 有货了！`,
      '#1d7a3d',
      `${p.address || ''} · 请尽快下单`,
      items,
      `<div style="background:#eaf7ee;border-left:3px solid #1d7a3d;padding:10px 12px;border-radius:6px;margin-bottom:10px">
         <strong>行动建议：</strong>点上方链接 → 选择「到店取货 / 門市取貨」→ 选 ${esc(where)} → 尽快付款。
         热销机型库存可能在几分钟内被抢完。</div>`,
    ),
    text:
      `【${and(cfg)}有货】\n` +
      items.map((i) => `${i.product.name}（${partsLabel(i)}）: ${(i.stores || []).map(storeLabel).join('、')}`).join('\n') +
      `\n检查时间: ${cnTime()}`,
  };
}

/** 其他被监控的门店有货 */
export function buildReferenceMail(items, cfg) {
  items = regionalMailItems(items);
  const p = cfg.priorityStoreInfo || {};
  const label = namesLabel(items);
  const priorityStatus = items.some((i) => i.priorityKnown === false) ? '库存尚未确认' : '暂无库存';
  return {
    subject: `🔔【其他门店有货】${label}（${p.name || '优先门店'}${priorityStatus}）`,
    html: shell(
      '🔔 其他门店有货',
      '#0b5fff',
      `${p.city || ''}${p.name || ''} ${priorityStatus}，以下门店可取货，可作为备选`,
      items,
      `<div style="background:#eef4ff;border-left:3px solid #0b5fff;padding:10px 12px;border-radius:6px;margin-bottom:10px">
         程序仍在持续监控优先门店，一旦有货会立刻再发一封「🎉 有货」邮件。</div>`,
    ),
    text:
      `【其他门店有货】优先门店${priorityStatus}\n` +
      items.map((i) => `${i.product.name}（${partsLabel(i)}）: ${(i.stores || []).map(storeLabel).join('、')}`).join('\n') +
      `\n检查时间: ${cnTime()}`,
  };
}

export function buildSoldOutMail(items, cfg) {
  items = regionalMailItems(items);
  return {
    subject: `⌛【库存已消失】${namesLabel(items)} 已不可门市取货`,
    html: shell(
      '⌛ 库存已消失',
      '#8a6d00',
      '之前有货的机型现在已查不到门市取货库存，程序继续监控中',
      items,
      `<div style="background:#fff8e1;border-left:3px solid #8a6d00;padding:10px 12px;border-radius:6px;margin-bottom:10px">
         如果你还没下单，可能已被抢完。程序会继续盯，重新放货会再通知。</div>`,
    ),
    text: `【库存已消失】${items.map((i) => i.product.name).join('、')}\n检查时间: ${cnTime()}`,
  };
}

function and(cfg) {
  const p = cfg.priorityStoreInfo;
  return p ? `${p.city || ''}${p.name}` : '优先门店';
}

export async function sendMail(transport, cfg, { subject, html, text }) {
  return transport.sendMail({
    from: cfg.mail.from || cfg.mail.user,
    to: cfg.mail.to.join(', '),
    subject,
    text,
    html,
  });
}
