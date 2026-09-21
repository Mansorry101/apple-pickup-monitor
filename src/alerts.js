/**
 * 告警判定：比较"本轮结果"与"上一轮状态"，决定该发哪些邮件。
 * 抽成独立模块是为了能单独测试（尤其是"有货"这条正向路径）。
 *
 * 角色（role）：
 *   priority → 优先门店有货
 *   other    → 其他被监控的门店有货
 *   none     → 都没有
 */

export function decideAlerts(results, state, cfg, now = Date.now()) {
  const priority = [];
  const other = [];
  const soldOut = [];

  for (const r of results) {
    const key = r.key || r.partNumber;
    const prev = state.parts[key] || { role: 'none' };
    const newRole = r.atPriority ? 'priority' : r.stores.length > 0 ? 'other' : 'none';

    if (newRole === 'priority') {
      priority.push({ r, prev });
    } else if (newRole === 'other') {
      other.push({ r, prev, isNew: prev.role === 'none' || prev.role === undefined });
    } else if (prev.role && prev.role !== 'none') {
      soldOut.push(r);
    }

    state.parts[key] = {
      ...prev,
      role: newRole,
      stores: r.stores,
      lastSeenAt: new Date(now).toISOString(),
      availableSince:
        newRole !== 'none' ? prev.availableSince || new Date(now).toISOString() : null,
    };
  }

  const repeatMs = (cfg.repeatAlertMinutes ?? 0) * 60_000;
  const newPriority = priority.filter((c) => c.prev.role !== 'priority');
  const dueReminder =
    repeatMs > 0
      ? priority.filter(
          (c) =>
            c.prev.role === 'priority' &&
            now - new Date(c.prev.lastAlertAt || 0).getTime() > repeatMs,
        )
      : [];

  const priorityItems = (newPriority.length ? newPriority : dueReminder).map((c) => c.r);
  const isReminder = newPriority.length === 0 && dueReminder.length > 0;

  const stamp = (items, role) => {
    for (const it of items) {
      const k = it.key || it.partNumber;
      state.parts[k].lastAlertAt = new Date(now).toISOString();
      state.parts[k].lastAlertRole = role;
    }
  };
  stamp(priorityItems, 'priority');

  const otherItems = other.filter((o) => o.isNew).map((o) => o.r);
  stamp(otherItems, 'other');

  return { priorityItems, isReminder, otherItems, soldOut };
}
