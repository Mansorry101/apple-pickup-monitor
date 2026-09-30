/**
 * 轮询调度：各地区可以有各自的间隔（香港不需要定位、一次请求就能出结果，
 * 可以查得比大陆频繁得多），所以调度以「地区」为单位，记录「下次该查的时间」。
 *
 * 两个约定：
 *   1. 按「轮开始到轮开始」计算，检查本身的耗时不会叠加到间隔上；
 *   2. 随机抖动只让下一轮提前、绝不推后 —— 这样配置的间隔就是最长间隔，
 *      「香港 5 秒」就等于「5 秒内必定又查了一次」。
 */

/** 抖动毫秒数：最多 1 秒，且不超过间隔的 20%。 */
export function pollJitterMs(intervalMs, random = Math.random) {
  return Math.floor(random() * Math.min(1000, intervalMs * 0.2));
}

/** 下一次该查这个地区的时间（从这一轮的开始时间算起）。 */
export function nextDueAt(startedAt, intervalMs, jitterMs = 0) {
  return startedAt + Math.max(0, intervalMs - jitterMs);
}

/** 已到期的地区；没有到期时间的（从未查过）视为立即到期。 */
export function dueRegions(dueAtByRegion, regionIds, now = Date.now()) {
  return regionIds.filter((r) => {
    const t = dueAtByRegion[r];
    return t === undefined || t <= now;
  });
}

// ---------- 放货时段（北京时间） ----------
// 中国没有夏令时，固定 UTC+8；不依赖机器时区（Docker 默认 UTC）。
const BEIJING_OFFSET_MS = 8 * 3600_000;

/** "HH:MM" → 当天分钟数；格式不对返回 null。 */
export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

/** 北京时间当天第几分钟（0–1439）。 */
export function beijingMinutes(now = Date.now()) {
  const d = new Date(now + BEIJING_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 是否处于 [start, end) 时段；支持跨零点（如 22:00–02:00）。start === end 视为不启用。 */
export function inWindow(now, startMin, endMin) {
  if (startMin === null || endMin === null || startMin === endMin) return false;
  const m = beijingMinutes(now);
  return startMin < endMin ? m >= startMin && m < endMin : m >= startMin || m < endMin;
}

/** 距离下一次进入 / 离开时段还有多少毫秒（至少 1 秒）。时段不启用时返回 Infinity。 */
export function msUntilWindowEdge(now, startMin, endMin) {
  if (startMin === null || endMin === null || startMin === endMin) return Infinity;
  const target = inWindow(now, startMin, endMin) ? endMin : startMin;
  const local = now + BEIJING_OFFSET_MS;
  const msIntoDay = ((local % 86_400_000) + 86_400_000) % 86_400_000;
  let diff = target * 60_000 - msIntoDay;
  if (diff <= 0) diff += 86_400_000;
  return Math.max(1000, diff);
}

/**
 * 当前生效的轮询计划。
 * @returns {{ rush: boolean, intervals: { CN: number, HK: number, PRI: number } }}（毫秒）
 */
export function pollPlan(cfg, now = Date.now()) {
  const rush = Boolean(cfg.rushEnabled) && inWindow(now, parseHHMM(cfg.rushStart), parseHHMM(cfg.rushEnd));
  const s = rush
    ? { CN: cfg.rushPollIntervalSeconds, HK: cfg.rushHkIntervalSeconds, PRI: cfg.rushPriorityIntervalSeconds }
    : { CN: cfg.intervalSeconds, HK: cfg.hkIntervalSeconds, PRI: cfg.priorityIntervalSeconds };
  return { rush, intervals: { CN: s.CN * 1000, HK: s.HK * 1000, PRI: s.PRI * 1000 } };
}

/** 限流冷却：第 n 次连续限流暂停 60s × 2^(n-1)，最长 5 分钟。 */
export function throttleBackoffMs(hits) {
  return Math.min(300_000, 60_000 * 2 ** Math.max(0, hits - 1));
}

/** 距离最近一个地区到期还有多少毫秒；都已经到期返回 0。 */
export function msUntilNextDue(dueAtByRegion, regionIds, now = Date.now()) {
  let min = Infinity;
  for (const r of regionIds) {
    const t = dueAtByRegion[r];
    if (t !== undefined) min = Math.min(min, t - now);
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0;
}
