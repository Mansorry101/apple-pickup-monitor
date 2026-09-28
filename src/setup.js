#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, loadEnvFile } from './config.js';
import { createTransport, sendMail } from './mailer.js';

const ENV_PATH = path.join(ROOT, '.env');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PRESETS = {
  'smtp.qq.com': { label: 'QQ邮箱', port: 465, secure: true },
  'smtp.163.com': { label: '163邮箱', port: 465, secure: true },
  'smtp.gmail.com': { label: 'Gmail', port: 465, secure: true },
  'smtp-mail.outlook.com': { label: 'Outlook', port: 587, secure: false },
};

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
};

export const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

class LineSource {
  constructor() {
    this.rl = null;
    this.lines = null;
    this.idx = 0;
  }

  async init() {
    if (stdin.isTTY) {
      this.rl = readline.createInterface({ input: stdin, output: stdout });
    } else {
      const chunks = [];
      for await (const c of stdin) chunks.push(Buffer.from(c));
      this.lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
    }
  }

  get interactive() {
    return Boolean(this.rl);
  }

  async ask(prompt) {
    if (this.rl) return (await this.rl.question(prompt)).trim();

    stdout.write(prompt);
    if (this.idx >= this.lines.length || (this.idx === this.lines.length - 1 && this.lines[this.idx] === '')) {
      throw new Error(
        '输入不足：脚本化配置需要依次提供「收件邮箱、发件邮箱、SMTP授权码」三行输入。\n' +
          '   也可以改用参数：node src/setup.js --to 收件邮箱 --from 发件邮箱 --pass 授权码',
      );
    }
    const line = this.lines[this.idx++] ?? '';
    stdout.write('\n');
    return line.trim();
  }

  async askHidden(prompt, redraw = '   > ') {
    if (!this.rl) return this.ask(prompt);

    this.rl.close();
    this.rl = null;

    return new Promise((resolve) => {
      stdout.write(prompt);
      const wasRaw = stdin.isRaw;
      let buf = '';
      const cleanup = () => {
        stdin.removeListener('data', onData);
        try { stdin.setRawMode(wasRaw); } catch {}
        stdin.pause();
      };
      const onData = (chunk) => {
        for (const c of chunk.toString('utf8')) {
          if (c === '\r' || c === '\n') {
            cleanup();
            stdout.write('\n');
            resolve(buf.trim());
            return;
          }
          if (c === '\u0003') { cleanup(); stdout.write('\n'); process.exit(130); }
          if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
          else if (c >= ' ') buf += c;
        }
        stdout.write('\r\x1b[K' + redraw + '*'.repeat(buf.length));
      };
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on('data', onData);
    });
  }

  close() {
    if (this.rl) { try { this.rl.close(); } catch { /* ignore */ } this.rl = null; }
    try { stdin.pause(); } catch { /* ignore */ }
  }
}

/** 读取已有 .env 作为默认值（重新配置时不用重敲） */
function readExisting() {
  const out = {};
  try {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {}
  return out;
}

export function writeEnvFile(v) {
  const content = `# ============================================================
#  Apple Store 香港 门市取货监控 —— 配置（由首次启动向导生成）
#  想重新配置： 删除本文件后重新启动，或运行 node src/setup.js
# ============================================================

# ---------- 邮件 ----------
SMTP_HOST=${v.host}
SMTP_PORT=${v.port}
SMTP_SECURE=${v.secure}
SMTP_USER=${v.from}
SMTP_PASS=${v.pass}
MAIL_FROM=${v.from}
MAIL_TO=${v.to}

# ---------- 监控 ----------
# 轮询间隔（秒）
POLL_INTERVAL_SECONDS=60

# 第一优先门店：R499 = Apple Canton Road（广东道）
PRIORITY_STORE=R499

# false = 其他门店有货也发一封「备选」邮件
CANTON_ONLY=false

# 广东道持续有货时，每隔多少分钟再提醒一次
REPEAT_ALERT_MINUTES=15

# 库存消失时发一封收尾邮件
SOLD_OUT_NOTIFY=true

# ---------- 高级（一般不用改） ----------
REQUEST_TIMEOUT_MS=25000
MAX_RETRIES=6
SESSION_REFRESH_MINUTES=30
`;
  fs.writeFileSync(ENV_PATH, content, 'utf8');
  try { fs.chmodSync(ENV_PATH, 0o600); } catch {}
}

export async function runSetup(argv = [], out = console.log) {
  const arg = (name, dflt = '') => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const has = (n) => argv.includes(`--${n}`);
  const noTest = has('no-test');

  const existing = readExisting();
  let to = arg('to') || process.env.SETUP_TO || '';
  let from = arg('from') || process.env.SETUP_FROM || existing.SMTP_USER || '';
  let pass = arg('pass') || process.env.SETUP_PASS || '';
  let host = arg('host') || process.env.SETUP_HOST || existing.SMTP_HOST || 'smtp.qq.com';
  let port = Number(arg('port') || existing.SMTP_PORT || 0) || 0;

  const nonInteractive = Boolean(to) && Boolean(from) && Boolean(pass);

  out('');
  out(`${C.bold}┌──────────────────────────────────────────────────────────┐${C.reset}`);
  out(`${C.bold}│  Apple Store 香港 · 门市取货监控 —— 首次配置向导         │${C.reset}`);
  out(`${C.bold}└──────────────────────────────────────────────────────────┘${C.reset}`);
  out(`${C.dim}  监控目标：iPhone 18 Pro Max 512GB 銀色/黑色 @ Apple 廣東道${C.reset}`);
  out(`${C.dim}  只需配置这一次，以后启动会直接后台运行。${C.reset}`);
  out('');

  const src = new LineSource();
  try {
    if (!nonInteractive) {
      await src.init();
      let step = 1;
      const label = (t, hint = '') =>
        `${C.cyan}${step++}. ${t}${C.reset}${hint ? ` ${C.dim}(${hint})${C.reset}` : ''}`;

      let head = label('收件邮箱', '有货通知发到这里，例如你的 Outlook');
      let answer = '';
      while (!EMAIL_RE.test(answer)) {
        answer = await src.ask(`${head}\n   > `);
        if (!EMAIL_RE.test(answer)) out(`   ${C.red}✗ 邮箱格式不对，请重新输入${C.reset}\n`);
      }
      to = answer;

      out('');
      const dflt = existing.SMTP_USER || '';
      head = label('发件邮箱', `用来发送的 QQ 邮箱${dflt ? `，回车沿用 ${dflt}` : ''}`);
      answer = '';
      while (!EMAIL_RE.test(answer)) {
        answer = (await src.ask(`${head}\n   > `)) || dflt;
        if (!EMAIL_RE.test(answer)) out(`   ${C.red}✗ 邮箱格式不对，请重新输入${C.reset}\n`);
      }
      from = answer;

      host = from.endsWith('@qq.com') ? 'smtp.qq.com' : '';
      while (!host) {
        out('');
        const h = await src.ask(`${label('SMTP 服务器', '1=QQ, 2=163, 3=Gmail, 4=Outlook；回车默认 QQ')}\n   > `);
        host =
          { '1': 'smtp.qq.com', '2': 'smtp.163.com', '3': 'smtp.gmail.com', '4': 'smtp-mail.outlook.com', '': 'smtp.qq.com' }[h] || '';
        if (!host) { step--; out(`   ${C.red}✗ 请输入 1-4 或直接回车${C.reset}`); }
      }

      out('');
      out(`${C.dim}   拿授权码：QQ邮箱网页版 → 设置 → 账号 → 开启「IMAP/SMTP服务」→ 短信验证 → 得 16 位授权码${C.reset}`);
      const authHead = label('SMTP 授权码', '不是登录密码');
      pass = '';
      while (pass.length < 6) {
        pass = await src.askHidden(`${authHead}\n   > `);
        if (pass.length < 6) out(`   ${C.red}✗ 授权码太短，请重新输入${C.reset}\n`);
      }
    }

    const preset = PRESETS[host];
    port = port || preset?.port || 465;
    let secure = preset ? preset.secure : port === 465;
    if (has('no-secure')) secure = false;

    out('');
    out(`${C.dim}   发件：${from}  →  收件：${to}${C.reset}`);
    out(`${C.dim}   服务器：${host}:${port} (${secure ? 'SSL' : 'STARTTLS'})${C.reset}`);
    out('');

    const mailCfg = { mail: { host, port, secure, user: from, pass, from, to: [to] } };
    const transport = createTransport(mailCfg);

    process.stdout.write('   正在验证邮箱登录… ');
    try {
      await transport.verify();
      out(`${C.green}成功${C.reset}`);
    } catch (e) {
      out(`${C.red}失败${C.reset}`);
      out(`${C.red}✗ 无法登录 SMTP：${e.message}${C.reset}`);
      out('  常见原因：授权码填错（要 16 位授权码，不是登录密码）／未开启 IMAP/SMTP 服务／网络不通');
      out('  改好后重新运行即可。\n');
      return false;
    }

    if (!noTest) {
      process.stdout.write(`   正在发送测试邮件到 ${to} … `);
      try {
        await sendMail(transport, mailCfg, {
          subject: '✅ Apple 取货监控 — 配置成功',
          text: '配置成功。程序会在 Apple Canton Road（广东道）出现 iPhone 18 Pro Max 512GB 银/黑库存时，发邮件到这里。',
          html: `<p>配置成功 ✅</p><p>程序会在 <strong>Apple Canton Road（广东道）</strong> 出现
                 <strong>iPhone 18 Pro Max 512GB 銀色/黑色</strong> 门市取货库存时，立刻发邮件到这里。</p>
                 <p style="color:#888;font-size:12px">如果这封邮件进了垃圾箱，请把发件人加入白名单。</p>`,
        });
        out(`${C.green}已发送${C.reset} ${C.dim}(没收到先翻垃圾邮件箱)${C.reset}`);
      } catch (e) {
        out(`${C.yellow}发送失败${C.reset}`);
        out(`  ${e.message}（登录是通的，可能收件地址被拒）`);
      }
    }

    writeEnvFile({ host, port, secure, from, pass, to });
    Object.assign(process.env, {
      SMTP_HOST: host, SMTP_PORT: String(port), SMTP_SECURE: String(secure),
      SMTP_USER: from, SMTP_PASS: pass, MAIL_FROM: from, MAIL_TO: to,
    });

    out('');
    out(`   ${C.green}${C.bold}✓ 配置已保存${C.reset} → ${ENV_PATH}`);
    out(`   ${C.dim}收件邮箱：${to}${C.reset}`);
    out('');
    return true;
  } finally {
    src.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  loadEnvFile();
  const ok = await runSetup(process.argv.slice(2));
  process.exit(ok ? 0 : 1);
}
