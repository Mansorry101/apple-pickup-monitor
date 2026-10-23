#!/usr/bin/env node
import fs from 'node:fs';
import { loadConfig, validateMail, REGIONS, STORE_BY_ID } from './config.js';
import { ApplePickupClient, storeLabel, httpKeepAliveEnabled } from './apple.js';
import { createTransport, sendMail, buildPriorityMail, buildReferenceMail } from './mailer.js';
import { loadState, saveState } from './state.js';
import { decideAlerts } from './alerts.js';
import { deliverAlerts } from './notifications.js';
import { buildPush, sendPush, pushEnabled, maskKey } from './push.js';
import { runSetup } from './setup.js';
import { startWebUi } from './webui.js';
import { settingsMtime } from './settings.js';
import { dueRegions, msUntilNextDue, nextDueAt, pollJitterMs, pollPlan, parseHHMM, msUntilWindowEdge, selectLanes } from './scheduler.js';
import { VERSION } from './constants.js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

let cfg = loadConfig();

const LOG_TO_FILE = !has('--once') && !has('--help') && Boolean(cfg.logFile);
for (const level of ['log', 'error', 'warn']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    const line = args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : String(a)))
      .join(' ');
    orig(line);
    if (LOG_TO_FILE) {
      try { fs.appendFileSync(cfg.logFile, line + '\n', 'utf8'); } catch {}
    }
  };
}

function log(...args) {
  console.log(`[${new Date().toISOString()}] ${args.join(' ')}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rshort = (r) => REGIONS[r]?.short || r;

function banner(extra = '') {
  const p = cfg.priorityStoreInfo || {};
  const others = cfg.watchStoresInfo.filter((s) => s.id !== cfg.priorityStore);
  console.log('='.repeat(68));
  const city = cfg.fastCity || '同城';
  console.log(cfg.sameCityFast
    ? ` Apple Store 门市取货监控（同城高速模式 · ${city} ${cfg.watchStores.length} 家门店）`
    : ' Apple Store 门市取货监控（全国城市 / 香港）');
  console.log(` 优先门店 : ${p.city || ''} · ${p.name || '—'} (${cfg.priorityStore})  ← 第一优先`);
  if (others.length) {
    console.log(` 同时监控 : ${others.map((s) => `${s.city}·${s.name}`).join('、')}`);
  }
  console.log(` 查询地区 : ${cfg.sameCityFast
    ? `仅${city} ${cfg.watchStores.length} 家门店（${cfg.watchStoresInfo.map((s) => s.name).join('、')}）— 同城高速，不跑大陆整轮`
    : cfg.watchRegions.map(rshort).join('、') || '(无)'}`);
  console.log(` 监控机型 : ${cfg.products.map((x) => x.name).join('  |  ')}`);
  const intervalText = cfg.sameCityFast
    ? `${city} ${cfg.szIntervalSeconds} 秒（同城高速，与香港同速）`
    : cfg.watchRegions.length
      ? cfg.watchRegions
          .map((r) => (r === 'HK' ? `香港 ${cfg.hkIntervalSeconds} 秒` : `${rshort(r)} ${cfg.intervalSeconds} 秒`))
          .concat(cfg.fastCity && cfg.szIntervalSeconds < cfg.intervalSeconds ? [`${city}通道 ${cfg.szIntervalSeconds} 秒`] : [])
          .join('，')
      : '—';
  console.log(` 轮询间隔 : ${intervalText}`);
  if (cfg.rushEnabled) {
    console.log(` 放货时段 : 北京时间 ${cfg.rushStart}–${cfg.rushEnd}（${cfg.sameCityFast
      ? `${city} ${cfg.rushSzIntervalSeconds} 秒`
      : `大陆 ${cfg.rushPollIntervalSeconds} 秒 / 香港 ${cfg.rushHkIntervalSeconds} 秒 / ${city}通道 ${cfg.rushSzIntervalSeconds} 秒 / 优先 ${cfg.rushPriorityIntervalSeconds} 秒`}）`);
  }
  if (cfg.priorityBoost) console.log(` 优先通道 : 常规 ${cfg.priorityIntervalSeconds} 秒，只查优先门店所在城市的优先机型`);
  console.log(` 通知邮箱 : ${cfg.mail.to.join(', ') || '(未配置)'}`);
  if (extra) console.log(` ${extra}`);
  console.log('='.repeat(68));
}

const clientSignature = (c) =>
  JSON.stringify([
    c.products.map((p) => [p.key, p.parts]),
    c.watchStores,
    c.priorityStore,
    c.watchRegions,
  ]);

function render(results) {
  const lines = [];
  for (const r of results) {
    const parts = Object.entries(r.parts || {}).map(([k, v]) => `${rshort(k)} ${v}`).join(' / ');
    const stores = r.stores.length ? r.stores.map(storeLabel).join('、') : r.complete === false ? '库存未知（查询未完成或失败）' : '无门店有货';
    const warning = r.complete === false ? ' [部分地区数据未知]' : '';
    const localLines = Object.entries(r.perRegion || {}).map(([region, d]) => {
      const local = r.stores.filter((id) => STORE_BY_ID[id]?.region === region);
      return rshort(region) + '版本 ' + d.partNumber + ' → ' +
        (d.ok === false ? (d.pending ? '等待下一轮查询' : d.inProgress ? '查询中' : '库存未知') : local.map(storeLabel).join('、') || '无门店有货');
    });
    lines.push('  • ' + r.product.name + '\n      ' +
      (localLines.length ? localLines.join('\n      ') : '[' + parts + '] → ' + stores) + warning);
  }
  return lines.join('\n');
}

function queryErrors(results) {
  return [...new Set(results.flatMap((r) => Object.entries(r.perRegion || {})
    .filter(([, d]) => d.ok === false && !d.pending && !d.inProgress).map(([region, d]) => region + ': ' + d.error)))].join('；') || null;
}

const SIM_POOL = {
  HK: ['MH3D4ZP/A', 'MH3E4ZP/A', 'MH354ZP/A', 'MH334ZP/A', 'MH374ZP/A', 'MH344ZP/A'],
  CN: ['MH3A4CH/A', 'MH3G4CH/A', 'MH304CH/A', 'MH354CH/A', 'MH3D4CH/A', 'MH3J4CH/A'],
};

async function run() {
  const dryRun = has('--dry-run');
  const uiOnly = has('--ui-only');
  const noUi = has('--no-ui');

  banner(uiOnly ? '模式     : 仅设置界面（不监控）' : '');
  if (dryRun) log('⚠️  DRY-RUN 模式：只监控和记录，不发送任何邮件');
  if (!httpKeepAliveEnabled() && !uiOnly) {
    log('⚠️  未安装 undici，查询无法复用连接（每轮会慢 0.3~0.8 秒）。请重新运行「一键部署.bat」或 npm install');
  }

  const mailErrs = validateMail(cfg);
  if (!cfg.envFileLoaded) log('⚠️  未找到 .env 文件，使用默认/环境变量配置');
  if (mailErrs.length && !dryRun && !uiOnly) {
    console.error('\n❌ 邮件配置不完整，无法发送通知：');
    for (const e of mailErrs) console.error(`   - ${e}`);
    console.error('\n请运行配置向导：  node src/setup.js');
    console.error('只想先看看库存：  node src/index.js --once');
    console.error('先试跑不发邮件：  node src/index.js --dry-run\n');
    process.exit(1);
  }

  const status = {
    lastCheckAt: null,
    lastError: null,
    results: [],
    running: !uiOnly,
    startedAt: new Date().toISOString(),
    // 邮箱连通性：ok=null 表示还没验证过。界面据此显示红点，避免"邮箱坏了却一直显示正常"。
    mail: { ok: null, error: null, checkedAt: null },
    // 手机推送（Bark）最近一次的结果，同上：ok=null 表示还没推送过
    push: { ok: null, error: null, checkedAt: null },
    schedule: null,
  };

  function setMailStatus(ok, error = null) {
    status.mail = { ok, error, checkedAt: new Date().toLocaleTimeString('zh-CN') };
  }
  function setPushStatus(ok, error = null) {
    status.push = { ok, error, checkedAt: new Date().toLocaleTimeString('zh-CN') };
  }

  let transport = null;
  let transportCfgSig = '';
  async function getTransport({ verify = false } = {}) {
    const sig = JSON.stringify([cfg.mail.host, cfg.mail.port, cfg.mail.user, cfg.mail.pass, cfg.mail.to]);
    if (!transport || transportCfgSig !== sig) {
      transport = createTransport(cfg);
      transportCfgSig = sig;
      if (verify) {
        try {
          await transport.verify();
          log(`✅ SMTP 连接成功 (${cfg.mail.host}:${cfg.mail.port})`);
          setMailStatus(true);
        } catch (e) {
          transport = null;
          console.error(`\n❌ SMTP 登录失败: ${e.message}`);
          console.error('   QQ邮箱请确认：已开启 SMTP 服务、SMTP_PASS 填的是 16 位授权码（不是登录密码）。\n');
          log('监控继续运行，后续发信将重试连接。');
          setMailStatus(false, e.message);
        }
      }
    }
    return transport;
  }
  if (!dryRun && !uiOnly) await getTransport({ verify: true });
  if (!uiOnly) {
    log(pushEnabled(cfg)
      ? `📱 手机推送已开启（Bark，${cfg.push.keys.map(maskKey).join('、')}${cfg.push.critical ? '，重要警告' : ''}）`
      : '📱 未配置手机推送，只发邮件（双击「配置手机推送.bat」可开启）');
  }

  const state = loadState(cfg.stateFile);
  const persist = () => {
    if (!dryRun && !uiOnly && saveState(cfg.stateFile, state) === false) {
      throw new Error('状态持久化失败，保留待发送通知');
    }
  };
  let stopping = false;
  const stop = () => {
    if (stopping) process.exit(0);
    stopping = true;
    log('收到退出信号，正在停止…');
    if (!dryRun && !uiOnly) saveState(cfg.stateFile, state);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  let client = new ApplePickupClient(cfg, log);
  // 每个机型最近一次的展示结果（raw），优先通道的局部结果据此合并
  const latestRows = new Map();
  let clientSig = clientSignature(cfg);

  const dueAt = {};
  // 主循环睡眠可被唤醒：配置变化、某地区查完时立即重新调度
  let wake = () => {};
  const waitFor = (ms) => new Promise((resolve) => {
    const timer = ms === Infinity ? null : setTimeout(resolve, Math.max(0, ms));
    wake = () => { if (timer) clearTimeout(timer); resolve(); };
  });

  function reload(why = '配置变更') {
    cfg = loadConfig();
    const sig = clientSignature(cfg);
    for (const key of Object.keys(dueAt)) delete dueAt[key];
    if (sig !== clientSig) {
      client = new ApplePickupClient(cfg, log);
      clientSig = sig;
      status.results = [];
      latestRows.clear();
      status.lastCheckAt = null;
      status.lastError = null;
      log(`[配置] ${why} → 监控目标已更新，重建会话`);
      log(render(productsPreview()));
    } else {
      log(`[配置] ${why} → 已重新加载`);
    }
    wake();
  }
  const productsPreview = () =>
    cfg.products.map((p) => ({
      key: p.key,
      product: p,
      parts: p.parts,
      stores: [],
      atPriority: false,
      complete: false,
      deliveryDate: null,
    }));

  const asStatus = (results) =>
    results.map((r) => ({
      key: r.key,
      name: r.product.name,
      parts: r.parts,
      stores: r.stores,
      storeLabels: r.stores.map(storeLabel),
      atPriority: r.atPriority,
      count: r.count,
      deliveryDate: r.deliveryDate,
      perRegion: r.perRegion,
      ok: r.ok, complete: r.complete, availability: r.availability, priorityKnown: r.priorityKnown,
    }));

  let ui = { server: null, url: null };
  if (!noUi) {
    ui = await startWebUi(
      {
        getCfg: () => cfg,
        reload,
        status: () => status,
        runsMonitor: !uiOnly,
        version: VERSION,
        idleExitMinutes: uiOnly ? 30 : 0,
        runCheckNow: async () => {
          const checkClient = client;
          const results = await checkClient.checkAvailability();
          if (checkClient !== client) throw new Error('监控目标已变更，请重新检查');
          latestRows.clear();
          for (const r of results) latestRows.set(r.key, r);
          status.results = asStatus(results);
          status.lastCheckAt = new Date().toLocaleTimeString('zh-CN');
          status.lastError = queryErrors(results);
          log(`[界面] 手动检查完成\n${render(results)}`);
          return status.results;
        },
        sendTestMail: async () => {
          const errs = validateMail(cfg);
          if (errs.length) throw new Error(errs.join('；'));
          const t = await getTransport();
          const p = cfg.priorityStoreInfo || {};
          try {
            await sendMail(t, cfg, {
              subject: '✅ Apple 取货监控 — 测试邮件',
              text: '这是一封测试邮件，说明通知配置正常。',
              html: `<p>这是一封<strong>测试邮件</strong>，说明通知配置正常。</p>
                   <p>当前优先门店：${p.city || ''} · ${p.name || ''}（${cfg.priorityStore}）</p>
                   <p>监控机型：${cfg.products.map((x) => x.name).join('、')}</p>`,
            });
          } catch (e) {
            setMailStatus(false, e.message);
            throw e;
          }
          setMailStatus(true);
          log(`[界面] 已发送测试邮件 → ${cfg.mail.to.join(', ')}`);
        },
        sendTestPush: async () => {
          if (!pushEnabled(cfg)) throw new Error('还没配置手机推送：请先双击「配置手机推送.bat」');
          const p = cfg.priorityStoreInfo || {};
          let r;
          try {
            r = await sendPush(cfg.push, {
              title: '✅ Apple 取货监控 — 测试推送',
              body: `推送正常。${p.name || '优先门店'}有货时会这样提醒你，点开直接去下单。`,
              group: 'Apple 取货监控',
              level: cfg.push.critical ? 'critical' : 'timeSensitive',
            });
          } catch (e) {
            setPushStatus(false, e.message);
            throw e;
          }
          setPushStatus(true, r.failed.length ? `部分设备失败：${r.failed.join('；')}` : null);
          log(`[界面] 已发送测试推送 → ${r.sent} 台设备${r.failed.length ? `（失败：${r.failed.join('；')}）` : ''}`);
          return r;
        },
      },
      log,
    );
    if (!ui.server) {
      const why = ui.error?.code === 'EADDRINUSE'
        ? `设置界面端口已被其他程序占用（${ui.error.message}）`
        : `设置界面启动失败：${ui.error?.message || '未知原因'}`;
      throw new Error(`${why}；请先关闭旧监控，再启动新版。如需无界面运行请使用 --no-ui`);
    }
  }

  if (uiOnly) {
    log('仅设置界面模式：不会检查库存。按 Ctrl+C 退出。');
    await new Promise(() => {});
    return;
  }

  let cycle = 0;
  let lastSettingsMtime = settingsMtime();
  const regionPrint = {};
  let lastFingerprint = null;
  const inFlight = new Map(); // 通道（CN / HK / SZ / PRI）→ 正在进行的轮次
  let updateChain = Promise.resolve();
  // 这两个必须在下面的主循环之前定义：主循环永不退出，写在它后面的 const 永远不会被初始化
  // 已推送过的告警事件 id：邮件失败、下一轮重试同一事件时不重复推送
  const pushed = new Set();
  const alertOpts = (checkCfg) => ({ persist, dryRun, log, send: makeSender(checkCfg), push: makePusher(checkCfg), pushed });
  let lastRush = null;
  // SZ = 城市快车道（同城高速通道），标签随当前监控城市变化（配置重载后自动更新）
  const LANE_LABEL = { CN: '大陆', HK: '香港', get SZ() { return cfg.fastCity || '同城'; }, PRI: '优先' };
  const priorityKeys = () => cfg.products.filter((p) => p.priority).map((p) => p.key);

  /**
   * 当前要跑的通道：各监控地区 + 城市快车道 + （需要时）优先通道。
   * 城市快车道照搬香港「单独一条快车道」的思路：它只查一个大陆城市（任意城市），
   * 和大陆整轮各自的间隔互不影响。监控门店全部同城时只跑这一条（同城高速模式）。
   * 规则本身在 scheduler.selectLanes（可离线测试）。
   */
  function lanesNow(plan) {
    const priorityScope = cfg.priorityBoost && client.priorityEligible() ? client.priorityScope(priorityKeys()) : null;
    return selectLanes({
      active: client.activeRegions(),
      intervals: plan.intervals,
      szScope: client.szScope(),
      priorityScope,
      cityOnly: cfg.sameCityFast,
    });
  }

  while (!stopping) {
    const mt = settingsMtime();
    if (mt !== lastSettingsMtime) {
      lastSettingsMtime = mt;
      reload('检测到 config.json 变化');
      continue;
    }

    const plan = pollPlan(cfg, Date.now());
    if (lastRush !== null && plan.rush !== lastRush) {
      log(plan.rush ? `[调度] 进入放货时段（${cfg.rushStart}–${cfg.rushEnd}），切换为高速查询` : '[调度] 放货时段结束，恢复常规查询');
      for (const key of Object.keys(dueAt)) delete dueAt[key];
    }
    lastRush = plan.rush;

    const { lanes, coveredBySz, priorityScope } = lanesNow(plan);
    // 优先通道被城市快车道顶掉时，界面上也要说明原因，否则「优先通道消失了」看起来像 bug
    if (coveredBySz && priorityScope?.region) {
      lanes.push({ id: 'PRI', region: priorityScope.region, interval: plan.intervals.PRI, skipped: `已被${LANE_LABEL.SZ}通道覆盖` });
    }
    if (!lanes.length) {
      // 同城高速模式没有可跑的通道时，不退回大陆整轮（全国几十个城市逐个定位，又慢又容易被限流）。
      // 空转并明确报错，让用户去检查机型是否有大陆料号。
      if (cfg.sameCityFast) {
        const msg = `同城高速模式没有可查询的通道：监控机型缺少大陆料号，或${LANE_LABEL.SZ}门店未生效`;
        if (status.lastError !== msg) log(`❌ ${msg}`);
        status.lastError = msg;
        await waitFor(Math.max(3000, cfg.szIntervalSeconds * 1000));
        continue;
      }
      cycle++;
      const started = Date.now();
      try {
        await client.checkAvailability();
      } catch (e) {
        log(`#${cycle} ❌ 本轮检查失败: ${e.message}`);
        status.lastError = e.message;
      }
      await sleep(nextDueAt(started, cfg.intervalSeconds * 1000, pollJitterMs(cfg.intervalSeconds * 1000)) - Date.now());
      continue;
    }

    // 被限流的地区：冷却结束前不再派发
    for (const lane of lanes) {
      const until = client.cooldownUntil(lane.region);
      if (until && (dueAt[lane.id] === undefined || dueAt[lane.id] < until)) dueAt[lane.id] = until;
    }
    status.schedule = {
      rush: plan.rush,
      rushEnabled: cfg.rushEnabled,
      rushWindow: cfg.rushStart + '–' + cfg.rushEnd,
      lanes: lanes.map((l) => ({
        id: l.id, label: LANE_LABEL[l.id] || l.id, region: l.region,
        intervalSeconds: l.interval / 1000,
        running: inFlight.has(l.id),
        nextAt: dueAt[l.id] || null,
        cooldownUntil: client.cooldownUntil(l.region) || null,
        skipped: l.skipped || null,
      })),
    };

    // 正在查询中的通道不重复派发；各通道独立并发，大陆的慢查询 / 重试不会拖住香港 / 深圳。
    const idle = lanes.filter((l) => !inFlight.has(l.id) && !l.skipped);
    const due = dueRegions(dueAt, idle.map((l) => l.id), Date.now());
    if (due.length) {
      cycle++;
      const started = Date.now();
      const dueLanes = idle.filter((l) => due.includes(l.id));
      for (const lane of dueLanes) {
        dueAt[lane.id] = nextDueAt(started, lane.interval, pollJitterMs(lane.interval));
      }
      // 地区整轮（大陆 / 香港）只在本地区到期时跑；深圳 / 优先是城市级通道，各自单独跑。
      // 注意这里必须按「本轮到期」过滤 —— 否则每次深圳快车道都会顺带跑一遍完整大陆轮询。
      const regionDue = dueLanes.filter((l) => !l.cities);
      const cityDue = dueLanes.filter((l) => l.cities);
      const coversAll = regionDue.every((l) => l.covers !== false);
      const tasks = [];
      if (regionDue.length) {
        // 覆盖全部监控门店的本轮结果才可以被其他通道复用
        const reuseMaxAgeMs = coversAll ? Math.min(...regionDue.map((l) => l.interval)) : 0;
        tasks.push([regionDue.map((l) => l.id), runRound(cycle, regionDue.map((l) => l.id), started, reuseMaxAgeMs)]);
      }
      for (const lane of cityDue) tasks.push([[lane.id], runCityRound(cycle, lane.id, started)]);
      for (const [ids, task] of tasks) {
        for (const id of ids) inFlight.set(id, task);
        task.finally(() => {
          for (const id of ids) if (inFlight.get(id) === task) inFlight.delete(id);
          wake();
        });
      }
      continue;
    }

    // 睡到下一个通道到期，或者放货时段开始 / 结束（到点立即切换间隔）
    const idleIds = idle.map((l) => l.id);
    const untilDue = idleIds.length ? msUntilNextDue(dueAt, idleIds, Date.now()) : Infinity;
    const untilEdge = cfg.rushEnabled ? msUntilWindowEdge(Date.now(), parseHHMM(cfg.rushStart), parseHHMM(cfg.rushEnd)) : Infinity;
    await waitFor(Math.min(untilDue, untilEdge));
  }

  function makePusher(checkCfg) {
    if (!pushEnabled(checkCfg)) return null;
    return async (kind, items, opts) => {
      if (checkCfg !== cfg) throw new Error('配置已变化，取消旧推送');
      const msg = buildPush(kind, items, checkCfg, opts);
      let r;
      try {
        r = await sendPush(checkCfg.push, msg);
      } catch (e) {
        setPushStatus(false, e.message);
        throw e;
      }
      setPushStatus(true, r.failed.length ? `部分设备失败：${r.failed.join('；')}` : null);
      if (r.failed.length) log(`📱 部分设备推送失败: ${r.failed.join('；')}`);
      return msg.title;
    };
  }

  function makeSender(checkCfg) {
    return async (mail) => {
      if (checkCfg !== cfg) throw new Error('配置已变化，取消旧通知');
      const t = await getTransport();
      if (checkCfg !== cfg) throw new Error('配置已变化，取消旧通知');
      try {
        const info = await sendMail(t, checkCfg, mail);
        setMailStatus(true);
        return info;
      } catch (e) {
        setMailStatus(false, e.message);
        throw e;
      }
    };
  }

  /**
   * 仅用于界面展示：本轮没查的地区（pending）沿用上一次的已知结果，
   * 避免香港 / 深圳 3 秒一轮时大陆整轮在「无货」和「等待下一轮」之间来回跳。告警不走这里。
   */
  function keepKnownRegions(prev, next) {
    if (!prev) return next;
    const perRegion = { ...next.perRegion };
    let stores = [...(next.stores || [])];
    let changed = false;
    for (const [r, d] of Object.entries(next.perRegion || {})) {
      const old = prev.perRegion?.[r];
      if (!(d.pending || d.inProgress) || !old || old.pending || old.inProgress) continue;
      perRegion[r] = old;
      stores = stores.filter((id) => STORE_BY_ID[id]?.region !== r)
        .concat((prev.stores || []).filter((id) => STORE_BY_ID[id]?.region === r));
      changed = true;
    }
    if (!changed) return next;
    stores.sort((a, b) => (a === cfg.priorityStore ? -1 : b === cfg.priorityStore ? 1 : 0));
    const regional = Object.values(perRegion);
    const complete = regional.length > 0 && regional.every((d) => d.ok);
    return { ...next, perRegion, stores, count: stores.length, atPriority: stores.includes(cfg.priorityStore),
      complete, availability: stores.length ? 'available' : complete ? 'unavailable' : 'unknown' };
  }

  /** 更新界面状态和日志指纹；返回结果是否有变化 */
  function publish(displayRows, printRows, prefix) {
    for (const r of displayRows) latestRows.set(r.key, keepKnownRegions(latestRows.get(r.key), r));
    status.results = asStatus(cfg.products.map((p) => latestRows.get(p.key)).filter(Boolean));
    status.lastCheckAt = new Date().toLocaleTimeString('zh-CN');
    for (const row of printRows) {
      for (const [reg, d] of Object.entries(row.perRegion || {})) {
        if (d.pending) continue;
        regionPrint[prefix + row.key + '|' + reg] = JSON.stringify([d.ok, d.stores, d.error]);
      }
    }
    const fingerprint = Object.keys(regionPrint).sort().map((k) => k + '=' + regionPrint[k]).join(';');
    const changed = fingerprint !== lastFingerprint;
    lastFingerprint = fingerprint;
    return changed;
  }

  /**
   * 城市级快车道的一轮（深圳 / 优先通道）：只查自己覆盖的城市。
   * 展示时把局部结果并入最近一次完整结果；告警只用本通道确认过的数据
   *（没覆盖到的门店不会因此被判「售罄」）。
   */
  async function runCityRound(round, laneId, started) {
    const label = LANE_LABEL[laneId] || laneId;
    try {
      const checkClient = client;
      const checkCfg = cfg;
      const rows = laneId === 'PRI'
        ? await checkClient.checkPriority(priorityKeys())
        : await checkClient.checkCityLane();
      const job = updateChain.then(async () => {
        if (checkCfg !== cfg || checkClient !== client) return;
        const display = rows.map((r) => {
          const merged = checkClient.mergeLaneRow(latestRows.get(r.key), r);
          merged.lane = laneId;
          return merged;
        });
        for (const r of rows) r.lane = laneId;
        const changed = publish(display, rows, laneId + '|');
        const tag = '#' + round + ' [' + label + '] (' + (Date.now() - started) + 'ms)';
        log(changed ? tag + ' 结果更新\n' + render(display) : tag + ' 无变化');
        const errors = await deliverAlerts(rows, state, checkCfg, alertOpts(checkCfg));
        const all = cfg.products.map((p) => latestRows.get(p.key)).filter(Boolean);
        status.lastError = [queryErrors(all), ...errors].filter(Boolean).join('；') || null;
      });
      updateChain = job.catch(() => {});
      await job;
    } catch (e) {
      log(`#${round} ❌ ${label}通道检查失败: ${e.message}`);
      status.lastError = e.message;
    }
  }

  async function runRound(round, due, started, reuseMaxAgeMs) {
    try {
      const checkClient = client;
      const checkCfg = cfg;
      const mailErrors = new Set();
      // 其他地区若在「最短轮询间隔」内刚查过，就并入本轮快照，
      // 这样两地交替出结果时也能得到完整结论（例如两地都售罄）。
      await checkClient.checkAvailability({ only: due, reuseMaxAgeMs, onUpdate: (results) => {
        // 不同通道的轮次会并发出结果：状态更新和发信串行处理，避免重复发信。
        const job = updateChain.then(() => handleResults(results));
        updateChain = job.catch(() => {});
        return job;
      } });

      async function handleResults(results) {
        if (checkCfg !== cfg || checkClient !== client) return;
        const changed = publish(results, results, '');
        const tag = '#' + round + ' [' + due.map((id) => LANE_LABEL[id] || id).join('+') + '] (' + (Date.now() - started) + 'ms)';
        log(changed ? tag + ' 地区结果更新\n' + render(results) : tag + ' 无变化');
        const errors = await deliverAlerts(results, state, checkCfg, alertOpts(checkCfg));
        for (const error of errors) mailErrors.add(error);
        status.lastError = [queryErrors(results), ...mailErrors].filter(Boolean).join('；') || null;
      }
    } catch (e) {
      log(`#${round} ❌ 本轮检查失败: ${e.message}`);
      status.lastError = e.message;
    }
  }
}

async function simulate() {
  const errs = validateMail(cfg);
  if (errs.length) {
    console.error('❌ 邮件配置不完整：\n   - ' + errs.join('\n   - '));
    process.exit(1);
  }
  const transport = createTransport(cfg);
  await transport.verify();
  console.log('✅ SMTP 连接成功，开始模拟一次真实的「优先门店有货」告警…\n');

  const region = cfg.priorityStoreRegion || 'HK';
  const pool = SIM_POOL[region] || SIM_POOL.HK;
  const simCfg = {
    ...cfg,
    products: pool.map((pn) => ({
      key: pn, name: pn, parts: { [region]: pn },
      buyUrls: cfg.products[0]?.buyUrls || {}, buyUrl: cfg.products[0]?.buyUrl || '',
    })),
  };
  const client = new ApplePickupClient(simCfg, log);
  const results = await client.checkAvailability();

  const withStock = results.filter((r) => r.stores.length > 0).slice(0, 2);
  if (!withStock.length) {
    console.error('❌ 配件这会儿也没库存，稍后再试（这不代表监控坏了）');
    process.exit(1);
  }
  withStock.forEach((r, i) => {
    const real = cfg.products[i] || cfg.products[0];
    r.product = { ...(real || {}), name: `${real?.name || '测试机型'}（🔬模拟）`, buyUrls: real?.buyUrls || {}, parts: real?.parts || r.parts };
    r.parts = real?.parts || r.parts;
  });

  console.log('模拟识别结果:');
  console.log(render(withStock));

  const { priorityItems, otherItems } = decideAlerts(withStock, { parts: {} }, cfg);
  const mail = priorityItems.length ? buildPriorityMail(priorityItems, cfg) : buildReferenceMail(otherItems, cfg);
  mail.subject = `【模拟测试·请忽略】${mail.subject}`;
  await sendMail(transport, cfg, mail);
  console.log(`\n✅ 模拟告警邮件已发送 → ${cfg.mail.to.join(', ')}`);
  console.log('   主题:', mail.subject);
}

async function main() {
  if (has('-h') || has('--help')) {
    console.log(`用法:
  node src/index.js                持续监控 + 启动设置界面（首次会自动进入配置向导）
  node src/index.js --ui-only      只打开设置界面，不监控（配置用）
  node src/index.js --no-ui        只监控，不启动设置界面
  node src/index.js --setup        重新运行邮箱配置向导
  node src/index.js --dry-run      持续监控但只记录、不发邮件（先试跑用）
  node src/index.js --once         只检查一次并打印结果（不发邮件）
  node src/index.js --test-email   发送测试邮件验证配置
  node src/index.js --test-push    发送一条手机推送（Bark）验证配置
  node src/index.js --simulate     模拟一次真实「有货」告警（走完整识别+发信链路）
  node src/index.js --help         显示帮助`);
    return;
  }

  const needsMail = !has('--once') && !has('--dry-run') && !has('--ui-only') && !has('--test-push');
  if ((needsMail || has('--setup')) && validateMail(cfg).length) {
    if (!process.stdin.isTTY) {
      console.error('❌ 邮件尚未配置，且当前不是交互式终端，无法进入配置向导。');
      console.error('   请先运行： node src/setup.js');
      console.error('   或无人值守： node src/setup.js --to 收件邮箱 --from 发件邮箱 --pass 授权码');
      process.exit(1);
    }
    const ok = await runSetup(argv);
    if (!ok) process.exit(1);
    cfg = loadConfig();
    if (has('--setup')) {
      console.log('✅ 配置向导已完成。运行  npm start  开始后台监控。');
      return;
    }
  }

  if (has('--test-email')) {
    const errs = validateMail(cfg);
    if (errs.length) {
      console.error('❌ 邮件配置不完整：\n   - ' + errs.join('\n   - '));
      process.exit(1);
    }
    const transport = createTransport(cfg);
    await transport.verify();
    const p = cfg.priorityStoreInfo || {};
    await sendMail(transport, cfg, {
      subject: '✅ Apple 取货监控 — 邮件通知测试成功',
      text: '如果你收到这封邮件，说明通知配置正确。',
      html: `<p>如果你收到这封邮件，说明 <strong>通知配置正确</strong>。</p>
             <p>程序会在 <strong>${p.city || ''} · ${p.name || ''}</strong> 出现
             「${cfg.products.map((x) => x.name).join('、')}」库存时立即发邮件给你。</p>`,
    });
    console.log('✅ 测试邮件已发送，请查收（含垃圾邮件箱）。');
    return;
  }

  if (has('--test-push')) {
    if (!pushEnabled(cfg)) {
      console.error('❌ 未配置手机推送：请双击「配置手机推送.bat」，或在 .env 里填 BARK_KEY');
      process.exit(1);
    }
    try {
      const r = await sendPush(cfg.push, {
        title: '✅ Apple 取货监控 — 推送测试',
        body: '收到这条说明手机推送正常。有货时会这样提醒你，点开直接去下单。',
        group: 'Apple 取货监控',
        level: cfg.push.critical ? 'critical' : 'timeSensitive',
      });
      console.log(`✅ 已推送到 ${r.sent} 台设备${r.failed.length ? `；失败：${r.failed.join('；')}` : ''}`);
    } catch (e) {
      console.error(`❌ 推送失败：${e.message}`);
      console.error('   请确认 BARK_KEY 复制完整、电脑和手机都能上网。');
      process.exit(1);
    }
    return;
  }

  if (has('--simulate')) {
    await simulate();
    return;
  }

  if (has('--once')) {
    const p = cfg.priorityStoreInfo || {};
    console.log(`优先门店: ${p.city || ''} · ${p.name || ''} (${cfg.priorityStore})`);
    console.log(`查询地区: ${cfg.sameCityFast
      ? `仅${cfg.fastCity} ${cfg.watchStores.length} 家门店（${cfg.watchStores.join(' / ')}）· 同城高速`
      : cfg.watchRegions.map(rshort).join('、')}`);
    const client = new ApplePickupClient(cfg, log);
    const results = await client.checkAvailability();
    console.log(render(results));
    console.log('\nJSON:');
    console.log(JSON.stringify(results.map(({ product, ...rest }) => ({ name: product.name, ...rest })), null, 2));
    return;
  }

  await run();
}

main().catch((e) => {
  console.error(`致命错误: ${e.stack || e.message}`);
  process.exit(1);
});
