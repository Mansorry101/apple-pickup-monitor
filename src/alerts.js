import { randomUUID } from 'node:crypto';

/** 记录观测和待发送事件；只有 acknowledgeAlerts 才记录通知成功。 */
export function decideAlerts(results, state, cfg, now = Date.now()) {
  state.parts ||= {};
  const priorityItems = [], otherItems = [], soldOut = [];
  const stamp = new Date(now).toISOString();
  for (const r of results) {
    const key = r.key || r.partNumber;
    if (r.ok === false || (!r.stores.length && r.complete === false)) continue;
    const scope = JSON.stringify([cfg.priorityStore, [...(cfg.watchStores || [])].sort(), r.parts]);
    let prev = state.parts[key] || { role: 'none' };
    if (prev.scope && prev.scope !== scope) prev = { role: 'none' };
    // 优先地区未知时，不能把此前的优先门店库存降级为备选。
    if (!r.atPriority && r.priorityKnown === false && prev.role === 'priority') continue;
    const role = r.atPriority ? 'priority' : r.stores.length ? 'other' : 'none';
    const next = { ...prev, scope, role, stores: r.stores, lastSeenAt: stamp,
      availableSince: role !== 'none' ? prev.availableSince || stamp : null };
    if (role !== prev.role) delete next.pending;
    const enabled = role === 'priority' || (role === 'other' ? !cfg.priorityOnly : cfg.soldOutNotify);
    if (!enabled) delete next.pending;
    const repeatMs = (cfg.repeatAlertMinutes ?? 0) * 60_000;
    const reminder = role === 'priority' && prev.role === 'priority' &&
      repeatMs > 0 && now - new Date(prev.lastAlertAt || 0).getTime() > repeatMs;
    const transition = role === 'priority' ? prev.role !== role :
      role === 'other' ? !prev.role || prev.role === 'none' : prev.role && prev.role !== 'none';
    if (enabled && !next.pending && (transition || reminder)) {
      next.pending = { id: randomUUID(), role, reminder: Boolean(!transition && reminder), createdAt: stamp };
    }
    state.parts[key] = next;
    if (!next.pending) continue;
    const item = { ...r, alertId: next.pending.id, reminder: next.pending.reminder };
    (role === 'priority' ? priorityItems : role === 'other' ? otherItems : soldOut).push(item);
  }
  return { priorityItems, otherItems, soldOut,
    isReminder: priorityItems.length > 0 && priorityItems.every((r) => r.reminder) };
}

/** 发信成功后确认对应事件，避免清除随后产生的新事件。 */
export function acknowledgeAlerts(items, state, now = Date.now()) {
  for (const item of items) {
    const entry = state.parts[item.key || item.partNumber];
    if (!entry?.pending || entry.pending.id !== item.alertId) continue;
    entry.lastAlertAt = new Date(now).toISOString();
    entry.lastAlertRole = entry.pending.role;
    delete entry.pending;
  }
}
