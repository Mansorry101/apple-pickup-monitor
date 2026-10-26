#!/usr/bin/env node
/**
 * 手机推送（Bark）配置向导：「配置手机推送.bat」调用。
 * 只改 .env 里的 BARK_* 几行，邮箱等其他配置原样保留。
 *
 *   node src/push-setup.js                     交互式
 *   node src/push-setup.js --key <key或地址>   无人值守
 *   node src/push-setup.js --off               关闭推送（删掉 BARK_KEY）
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './constants.js';
import { parseBarkInput, sendPush, maskKey, DEFAULT_SERVER } from './push.js';

export const ENV_PATH = path.join(ROOT, '.env');
const BARK_KEYS = ['BARK_KEY', 'BARK_SERVER', 'BARK_CRITICAL', 'BARK_OPEN', 'BARK_SOUND'];

/**
 * 在 .env 文本里设置 / 删除若干键（值为 null 表示删除），其他行原样保留。
 * 新增的键追加到「手机推送」小节末尾。
 */
export function updateEnvText(text, values) {
  const lines = String(text || '').split(/\r?\n/);
  const done = new Set();
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    const key = m?.[1];
    if (key && key in values) {
      if (values[key] !== null && !done.has(key)) out.push(`${key}=${values[key]}`);
      done.add(key);
      continue;
    }
    out.push(line);
  }
  const missing = Object.entries(values).filter(([k, v]) => v !== null && !done.has(k));
  if (missing.length) {
    while (out.length && out[out.length - 1] === '') out.pop();
    if (!out.some((l) => l.includes('手机推送'))) out.push('', '# ---------- 手机推送（Bark） ----------');
    for (const [k, v] of missing) out.push(`${k}=${v}`);
    out.push('');
  }
  return out.join('\n');
}

export function writePushEnv(values, file = ENV_PATH) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* 还没有 .env */ }
  fs.writeFileSync(file, updateEnvText(text, values), 'utf8');
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
}

function readEnv(file = ENV_PATH) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
  return out;
}

const yes = (s, dflt) => (s === '' ? dflt : /^(y|yes|是|1|true)$/i.test(s));

export async function runPushSetup(argv = [], out = console.log) {
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] || '' : ''; };
  const has = (n) => argv.includes(`--${n}`);

  if (has('off')) {
    writePushEnv(Object.fromEntries(BARK_KEYS.map((k) => [k, null])));
    out('✓ 已关闭手机推送（只发邮件）。重启监控后生效。');
    return true;
  }

  const existing = readEnv();
  let input = arg('key');
  let critical = has('critical') ? true : existing.BARK_CRITICAL === 'true';
  let open = arg('open') || existing.BARK_OPEN || 'product';
  let rl = null;

  try {
    if (!input) {
      rl = readline.createInterface({ input: stdin, output: stdout });
      out('');
      out('== 配置手机推送（Bark）==');
      out('1) iPhone 上从 App Store 安装「Bark」，打开后允许通知');
      out('2) 首页会显示一条示例地址，形如 https://api.day.app/xxxxxxxx/推送内容');
      out('3) 把这条地址整条复制，粘贴到下面（只粘 key 也行；多台手机用逗号隔开）');
      if (existing.BARK_KEY) out(`   当前已配置：${existing.BARK_KEY.split(',').map(maskKey).join('、')}，直接回车沿用`);
      out('');
      input = (await rl.question('Bark 地址或 key > ')).trim() || existing.BARK_KEY || '';
    }
    const parsed = parseBarkInput(input);
    if (!parsed.keys.length) {
      out('✗ 没认出 Bark key。请从 Bark App 首页复制那条 https://api.day.app/... 地址再试。');
      return false;
    }
    const server = parsed.server !== DEFAULT_SERVER ? parsed.server : (existing.BARK_SERVER || DEFAULT_SERVER);

    if (rl) {
      out('');
      out('优先门店有货时，要不要用「重要警告」？');
      out('  开启后手机静音、勿扰、专注模式下也会响铃（第一次推送时 Bark 会请求授权，请点允许）。');
      critical = yes((await rl.question(`开启重要警告？(y/n，回车=${critical ? 'y' : 'n'}) > `)).trim(), critical);
      out('');
      out('点开通知后打开哪里？');
      out('  1 = 商品购买页（推荐：直接选门市取货下单）');
      out('  2 = 购物袋（适合你已经提前把机型加进购物袋）');
      const o = (await rl.question(`请选择 1/2（回车=${open === 'bag' ? 2 : 1}）> `)).trim();
      if (o === '1') open = 'product';
      if (o === '2') open = 'bag';
    }

    const push = { keys: parsed.keys, server, critical, open };
    if (!has('no-test')) {
      stdout.write('\n正在发送测试推送… ');
      try {
        const r = await sendPush(push, {
          title: '✅ Apple 取货监控 — 推送已连通',
          body: '有货时会这样提醒你，点开直接去下单。',
          group: 'Apple 取货监控',
          level: critical ? 'critical' : 'timeSensitive',
        });
        out(`成功（${r.sent} 台设备）${r.failed.length ? `；失败：${r.failed.join('；')}` : ''}`);
      } catch (e) {
        out('失败');
        out(`✗ ${e.message}`);
        out('  请确认 key 复制完整、手机能上网。配置没有保存。');
        return false;
      }
    }

    writePushEnv({
      BARK_KEY: parsed.keys.join(','),
      BARK_SERVER: server,
      BARK_CRITICAL: String(critical),
      BARK_OPEN: open,
    });
    out('');
    out(`✓ 已保存到 .env（${parsed.keys.map(maskKey).join('、')}，${critical ? '重要警告' : '时效性通知'}，点开打开${open === 'bag' ? '购物袋' : '商品页'}）`);
    return true;
  } finally {
    rl?.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const ok = await runPushSetup(process.argv.slice(2));
  process.exit(ok ? 0 : 1);
}
