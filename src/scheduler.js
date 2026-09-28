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

/** 距离最近一个地区到期还有多少毫秒；都已经到期返回 0。 */
export function msUntilNextDue(dueAtByRegion, regionIds, now = Date.now()) {
  let min = Infinity;
  for (const r of regionIds) {
    const t = dueAtByRegion[r];
    if (t !== undefined) min = Math.min(min, t - now);
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0;
}
