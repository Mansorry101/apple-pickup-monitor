import { decideAlerts, acknowledgeAlerts } from './alerts.js';
import { buildPriorityMail, buildReferenceMail, buildSoldOutMail } from './mailer.js';

/**
 * 观测状态里「有意义」的部分。lastSeenAt 每轮都会变，但它只是诊断信息、
 * 没有任何地方读它，所以不算变化 —— 否则香港每 5 秒一轮就会每 5 秒写一次盘。
 */
const stateDigest = (state) =>
  JSON.stringify(Object.entries(state.parts || {}).map(([k, v]) =>
    [k, v.role, v.stores, v.availableSince, v.lastAlertAt, v.pending?.id, v.pending?.reminder]));

/** 先持久化待发送状态；各类邮件独立发送，失败留待下一轮重新确认库存后重试。 */
export async function deliverAlerts(results, state, cfg, { send, persist, log = () => {}, dryRun = false }) {
  const working = dryRun ? structuredClone(state) : state;
  const before = stateDigest(working);
  const plan = decideAlerts(results, working, cfg);
  // 只有观测结果真的变了才落盘
  if (!dryRun && stateDigest(working) !== before) persist();
  const groups = [
    [plan.priorityItems, (items) => {
      const mail = buildPriorityMail(items, cfg);
      if (plan.isReminder) mail.subject = `⏰【仍在售】${mail.subject}`;
      return mail;
    }],
    [plan.otherItems, buildReferenceMail],
    [plan.soldOut, buildSoldOutMail],
  ];
  const errors = [];
  for (const [items, build] of groups) {
    if (!items.length) continue;
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
