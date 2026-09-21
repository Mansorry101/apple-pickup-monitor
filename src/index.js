#!/usr/bin/env node
/**
 * Apple Store 门市取货监控 —— 主程序
 * 支持中国大陆 / 香港全部 Apple Store。
 *
 *   node src/index.js              持续监控（默认每 60 秒）
 *   node src/index.js --once       只查一次，打印结果，不发邮件
 *   node src/index.js --test-email 发一封测试邮件，验证邮箱配置
 */
import fs from 'node:fs';
import { loadConfig, validateMail, REGIONS } from './config.js';
import { ApplePickupClient, storeLabel } from './apple.js';
import { createTransport, sendMail, buildPriorityMail, buildReferenceMail, buildSoldOutMail } from './mailer.js';
import { loadState, saveState } from './state.js';
import { decideAlerts } from './alerts.js';
import { runSetup } from './setup.js';
import { startWebUi } from './webui.js';
import { settingsMtime } from './settings.js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

let cfg = loadConfig();

// ---------- 统一输出 ----------
// 后台运行时没有控制台窗口，stdout 会被丢弃。这里把 console 的所有输出
// 同时写入日志文件，保证「一键部署」后出问题时有据可查。
const LOG_TO_FILE = !has('--once') && !has('--help') && Boolean(cfg.logFile);
for (const level of ['log', 'error', 'warn']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    const line = args
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : String(a)))
      .join(' ');
    orig(line);
    if (LOG_TO_FILE) {
      try { fs.appendFileSync(cfg.logFile, line + '\n', 'utf8'); } catch { /* 写日志失败不影响监控 */ }
    }
  };
}

function log(...args) {
  console.log(`[${new Date().toISOString()}] ${args.join(' ')}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 某个地区该用什么门店标签 */
const rshort = (r) => REGIONS[r]?.short || r;

function banner(extra = '') {
  const p = cfg.priorityStoreInfo || {};
  const others = cfg.watchStoresInfo.filter((s) => s.id !== cfg.priorityStore);
  console.log('='.repeat(68));
  console.log(' Apple Store 门市取货监控（中国大陆 / 香港）');
  console.log(` 优先门店 : ${p.city || ''} · ${p.name || '—'} (${cfg.priorityStore})  ← 第一优先`);
  if (others.length) {
    console.log(` 同时监控 : ${others.map((s) => `${s.city}·${s.name}`).join('、')}`);
  }
  console.log(` 查询地区 : ${cfg.watchRegions.map(rshort).join('、') || '(无)'}`);
  console.log(` 监控机型 : ${cfg.products.map((x) => x.name).join('  |  ')}`);
  console.log(` 轮询间隔 : ${cfg.intervalSeconds} 秒`);
  console.log(` 通知邮箱 : ${cfg.mail.to.join(', ') || '(未配置)'}`);
  if (extra) console.log(` ${extra}`);
  console.log('='.repeat(68));
}

/** 影响会话的配置指纹：目标机型 / 门店变了就要重建客户端 */
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
    const stores = r.stores.length ? r.stores.map(storeLabel).join('、') : '无门店有货';
    const extra = r.otherStores?.length ? `   (附近另有 ${r.otherStores.length} 家门店有货，未监控)` : '';
    lines.push(`  • ${r.product.name}  [${parts}]\n      → ${stores}${extra}`);
  }
  return lines.join('\n');
}

/** 模拟测试用的"确实有货"配件（按地区给不同的料号） */
const SIM_POOL = {
  HK: ['MH3D4ZP/A', 'MH3E4ZP/A', 'MH354ZP/A', 'MH334ZP/A', 'MH374ZP/A', 'MH344ZP/A'],
  CN: ['MH3A4CH/A', 'MH3G4CH/A', 'MH304CH/A', 'MH354CH/A', 'MH3D4CH/A', 'MH3J4CH/A'],
};

// ---------- 主循环 ----------
async function run() {
  const dryRun = has('--dry-run');
  const uiOnly = has('--ui-only');
  const noUi = has('--no-ui');

  banner(uiOnly ? '模式     : 仅设置界面（不监控）' : '');
  if (dryRun) log('⚠️  DRY-RUN 模式：只监控和记录，不发送任何邮件');

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
        } catch (e) {
          transport = null;
          console.error(`\n❌ SMTP 登录失败: ${e.message}`);
          console.error('   QQ邮箱请确认：已开启 SMTP 服务、SMTP_PASS 填的是 16 位授权码（不是登录密码）。\n');
          process.exit(1);
        }
      }
    }
    return transport;
  }
  if (!dryRun && !uiOnly) await getTransport({ verify: true });

  const state = loadState(cfg.stateFile);
  let stopping = false;
  const stop = () => {
    if (stopping) process.exit(0);
    stopping = true;
    log('收到退出信号，正在停止…');
    saveState(cfg.stateFile, state);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const status = { lastCheckAt: null, lastError: null, results: [], running: !uiOnly, startedAt: new Date().toISOString() };

  let client = new ApplePickupClient(cfg, log);
  let clientSig = clientSignature(cfg);

  function reload(why = '配置变更') {
    cfg = loadConfig();
    const sig = clientSignature(cfg);
    if (sig !== clientSig) {
      client = new ApplePickupClient(cfg, log);
      clientSig = sig;
      log(`[配置] ${why} → 监控目标已更新，重建会话`);
      log(render(productsPreview()));
    } else {
      log(`[配置] ${why} → 已重新加载`);
    }
  }
  const productsPreview = () =>
    cfg.products.map((p) => ({
      key: p.key,
      product: p,
      parts: p.parts,
      stores: [],
      atPriority: false,
      deliveryDate: null,
    }));

  const asStatus = (results) =>
    results.map((r) => ({
      key: r.key,
      name: r.product.name,
      parts: r.parts,
      stores: r.stores,
      storeLabels: r.stores.map(storeLabel),
      otherStores: r.otherStores || [],
      atPriority: r.atPriority,
      count: r.count,
      deliveryDate: r.deliveryDate,
      perRegion: r.perRegion,
    }));

  let ui = { server: null, url: null };
  if (!noUi) {
    ui = await startWebUi(
      {
        getCfg: () => cfg,
        reload,
        status: () => status,
        runsMonitor: !uiOnly,
        version: '2.0.0',
        idleExitMinutes: uiOnly ? 30 : 0,
        runCheckNow: async () => {
          const results = await client.checkAvailability();
          status.results = asStatus(results);
          status.lastCheckAt = new Date().toLocaleTimeString('zh-CN');
          status.lastError = null;
          log(`[界面] 手动检查完成\n${render(results)}`);
          return status.results;
        },
        sendTestMail: async () => {
          const errs = validateMail(cfg);
          if (errs.length) throw new Error(errs.join('；'));
          const t = await getTransport();
          const p = cfg.priorityStoreInfo || {};
          await sendMail(t, cfg, {
            subject: '✅ Apple 取货监控 — 测试邮件',
            text: '这是一封测试邮件，说明通知配置正常。',
            html: `<p>这是一封<strong>测试邮件</strong>，说明通知配置正常。</p>
                   <p>当前优先门店：${p.city || ''} · ${p.name || ''}（${cfg.priorityStore}）</p>
                   <p>监控机型：${cfg.products.map((x) => x.name).join('、')}</p>`,
          });
          log(`[界面] 已发送测试邮件 → ${cfg.mail.to.join(', ')}`);
        },
      },
      log,
    );
  }

  if (uiOnly) {
    log('仅设置界面模式：不会检查库存。按 Ctrl+C 退出。');
    await new Promise(() => {});
    return;
  }

  let cycle = 0;
  let lastSettingsMtime = settingsMtime();
  while (!stopping) {
    cycle++;
    const started = Date.now();
    try {
      const mt = settingsMtime();
      if (mt !== lastSettingsMtime) {
        lastSettingsMtime = mt;
        reload('检测到 config.json 变化');
      }

      const results = await client.checkAvailability();
      log(`#${cycle} 检查完成 (${Date.now() - started}ms)\n${render(results)}`);
      status.results = asStatus(results);
      status.lastCheckAt = new Date().toLocaleTimeString('zh-CN');
      status.lastError = null;

      const { priorityItems, isReminder, otherItems, soldOut } = decideAlerts(results, state, cfg);
      saveState(cfg.stateFile, state);

      const t = dryRun ? null : await getTransport();
      const pname = cfg.priorityStoreInfo?.name || '优先门店';
      if (priorityItems.length) {
        const mail = buildPriorityMail(priorityItems, cfg);
        mail.subject = `${isReminder ? '⏰【仍在售】' : ''}${mail.subject}`;
        if (dryRun) log(`📧 [DRY-RUN] 将发送【${pname}有货】: ${mail.subject}`);
        else {
          await sendMail(t, cfg, mail);
          log(`📧 已发送【${pname}有货】通知 → ${cfg.mail.to.join(', ')}`);
        }
      }
      if (!cfg.priorityOnly && otherItems.length) {
        const mail = buildReferenceMail(otherItems, cfg);
        if (dryRun) log(`📧 [DRY-RUN] 将发送【其他门店有货】: ${mail.subject}`);
        else {
          await sendMail(t, cfg, mail);
          log(`📧 已发送【其他门店有货】通知`);
        }
      }
      if (cfg.soldOutNotify && soldOut.length) {
        const mail = buildSoldOutMail(soldOut, cfg);
        if (dryRun) log(`📧 [DRY-RUN] 将发送【库存已消失】: ${mail.subject}`);
        else {
          await sendMail(t, cfg, mail);
          log(`📧 已发送【库存已消失】通知`);
        }
      }
    } catch (e) {
      log(`#${cycle} ❌ 本轮检查失败: ${e.message}`);
      status.lastError = e.message;
    }

    if (stopping) break;
    // 加一点随机抖动，避免被 Apple 判定为机器人固定节奏
    const jitter = Math.floor(Math.random() * 5000);
    await sleep(cfg.intervalSeconds * 1000 + jitter);
  }
}

// ---------- 模拟测试：用"确实有货"的配件走一遍完整告警流程 ----------
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
  node src/index.js --simulate     模拟一次真实「有货」告警（走完整识别+发信链路）
  node src/index.js --help         显示帮助`);
    return;
  }

  const needsMail = !has('--once') && !has('--dry-run') && !has('--ui-only');
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

  if (has('--simulate')) {
    await simulate();
    return;
  }

  if (has('--once')) {
    const p = cfg.priorityStoreInfo || {};
    console.log(`优先门店: ${p.city || ''} · ${p.name || ''} (${cfg.priorityStore})`);
    console.log(`查询地区: ${cfg.watchRegions.map(rshort).join('、')}`);
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
