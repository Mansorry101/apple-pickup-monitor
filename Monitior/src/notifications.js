import { decideAlerts, acknowledgeAlerts } from './alerts.js';
import { buildPriorityMail, buildReferenceMail, buildSoldOutMail } from './mailer.js';

/**
 * 观测状态里「有意义」的部分。lastSeenAt 每轮都会变，但它只是诊断信息、
 * 没有任何地方读它，所以不算变化 —— 否则香港每 5 秒一轮就会每 5 秒写一次盘。
 */
const stateDigest = (state) =>
  JSON.stringify(Object.entries(state.parts || {}).map(([k, v]) =>
    [k, v.role, v.stores, v.availableSince, v.lastAlertAt, v.pending?.id, v.pending?.reminder]));

const KIND_LABEL = { priority: '优先门店有货', other: '其他门店有货', soldOut: '库存已消失' };

/**
 * 先持久化待发送状态；各类邮件独立发送，失败留待下一轮重新确认库存后重试。
 *
 * push（可选）：手机推送。和邮件同时发出、不等待它，所以不会被 SMTP 拖慢；
 * 推送结果不影响「已通知」的判定（仍以邮件为准）。
 * pushed（可选 Set）：已推送过的告警事件 id。邮件失败、下一轮重试同一事件时不会重复推送。
 * handoff（可选）：有货时交给浏览器扩展自动下单（handoff.js）。同样不等待、不影响告警状态。
 */
export async function deliverAlerts(results, state, cfg, {
  send, persist, log = () => {}, dryRun = false, push = null, pushed = null, handoff = null,
}) {
  const working = dryRun ? structuredClone(state) : state;
  const before = stateDigest(working);
  const plan = decideAlerts(results, working, cfg);
  // 只有观测结果真的变了才落盘
  if (!dryRun && stateDigest(working) !== before) persist();
  const groups = [
    ['priority', plan.priorityItems, (items) => {
      const mail = buildPriorityMail(items, cfg);
      if (plan.isReminder) mail.subject = `⏰【仍在售】${mail.subject}`;
      return mail;
    }],
    ['other', plan.otherItems, buildReferenceMail],
    ['soldOut', plan.soldOut, buildSoldOutMail],
  ];

  const firePush = (kind, items) => {
    const ids = items.map((i) => i.alertId).filter(Boolean);
    if (pushed && ids.length && ids.every((id) => pushed.has(id))) return;
    if (dryRun) { log(`📱 [DRY-RUN] 将推送: ${KIND_LABEL[kind]}`); return; }
    for (const id of ids) pushed?.add(id);
    let job;
    try {
      job = Promise.resolve(push(kind, items, { reminder: kind === 'priority' && plan.isReminder }));
    } catch (e) {
      job = Promise.reject(e);
    }
    job.then(
      (title) => log(`📱 已推送: ${title || KIND_LABEL[kind]}`),
      (e) => {
        // 推送失败：允许同一事件在邮件重试时再推一次
        for (const id of ids) pushed?.delete(id);
        log(`📱 推送失败: ${e.message}`);
      },
    );
  };

  // 下单最争分夺秒：先于邮件发起，不等它
  const stocked = [...plan.priorityItems, ...plan.otherItems];
  if (handoff && stocked.length) {
    Promise.resolve()
      .then(() => handoff(stocked, { dryRun }))
      .catch((e) => log(`🛒 交接自动下单失败: ${e.message}`));
  }

  const errors = [];
  for (const [kind, items, build] of groups) {
    if (!items.length) continue;
    if (push) firePush(kind, items);
    try {
      const mail = build(items, cfg);
      if (dryRun) { log(`📧 [DRY-RUN] 将发送: ${mail.subject}`); continue; }
      const info = await send(mail);
      if (info?.rejected?.length) throw new Error('部分收件人被 SMTP 拒绝');
      const previous = items.map((item) => {
        const key = item.key || item.partNumber;
        return [key, structuredClone(state.parts[key])];
      });
      acknowledgeAlerts(items, state);
      try { persist(); } catch (e) {
        // 磁盘未确认时保留内存事件，宁可重发也不静默丢失。
        for (const [key, entry] of previous) state.parts[key] = entry;
        throw e;
      }
      log(`📧 已发送: ${mail.subject}`);
    } catch (e) {
      errors.push(e.message);
      log(`📧 发送失败，保留待发送事件: ${e.message}`);
    }
  }
  return errors;
}
