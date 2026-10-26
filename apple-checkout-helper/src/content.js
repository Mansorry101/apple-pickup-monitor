/* =============================================================
 * content.js —— 悬浮按钮 UI + 与扩展其他部分通信
 * ============================================================= */
(function () {
  'use strict';
  if (window.__AF_UI_LOADED__) return;
  window.__AF_UI_LOADED__ = true;

  const AF = window.__AF;
  if (!AF) return;

  const isTop = (() => { try { return window.top === window.self; } catch (e) { return false; } })();

  const DEFAULTS = window.__AF_DEFAULTS; // 来自 defaults.js
  const merge = window.__AF_MERGE;
  if (!DEFAULTS || !merge) return;

  const PAY_NAMES = { wechat: '微信支付', alipay: '支付宝', card: '信用卡' };

  let config = JSON.parse(JSON.stringify(DEFAULTS));
  let ui = null;
  let running = false;
  let autoStarted = false;

  /* ---------- 配置读取 ---------- */

  function loadConfig() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['afConfig'], (res) => {
          if (res && res.afConfig) config = merge(DEFAULTS, res.afConfig);
          resolve(config);
        });
      } catch (e) { resolve(config); }
    });
  }

  /* ---------- UI ---------- */
  const CSS = `
    :host { all: initial; }
    .wrap { position: relative; width: 56px; height: 56px; font-family: -apple-system, "SF Pro SC", "PingFang SC", "Microsoft YaHei", sans-serif; }
    .fab {
      width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
      background: linear-gradient(160deg, #1d1d1f, #3a3a3c); color: #fff;
      box-shadow: 0 8px 24px rgba(0,0,0,.28), 0 2px 6px rgba(0,0,0,.18);
      font-size: 15px; font-weight: 600; letter-spacing: .5px;
      display: flex; align-items: center; justify-content: center; position: relative;
      transition: transform .15s ease, box-shadow .15s ease;
      touch-action: none; user-select: none;
    }
    .fab:hover { transform: translateY(-1px) scale(1.03); }
    .fab:active { transform: scale(.97); }
    .fab .dot {
      position: absolute; top: 3px; right: 3px; width: 12px; height: 12px; border-radius: 50%;
      background: #34c759; border: 2px solid #fff;
    }
    .fab .dot.busy { background: #ff9f0a; animation: pulse 1s infinite; }
    .fab .dot.warn { background: #ff3b30; }
    .fab .dot.idle { background: #8e8e93; }
    @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }

    .panel {
      position: absolute; right: 0; bottom: 68px; width: 268px;
      background: #fff; color: #1d1d1f; border-radius: 14px;
      box-shadow: 0 16px 48px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.1);
      overflow: hidden; display: none; border: 1px solid rgba(0,0,0,.06);
    }
    .panel.open { display: block; }
    .head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px 8px; }
    .title { font-size: 13px; font-weight: 600; }
    .sub { font-size: 11px; color: #86868b; margin-top: 2px; }
    .x { border: none; background: transparent; cursor: pointer; font-size: 16px; color: #86868b; line-height: 1; padding: 2px 4px; }
    .btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 8px 14px 10px; }
    .btn {
      border: none; border-radius: 9px; padding: 9px 8px; font-size: 12.5px; font-weight: 600;
      cursor: pointer; background: #f5f5f7; color: #1d1d1f; transition: background .12s;
      font-family: inherit;
    }
    .btn:hover { background: #ebebef; }
    .btn.primary { background: #0071e3; color: #fff; }
    .btn.primary:hover { background: #0077ed; }
    .btn.wide { grid-column: 1 / -1; }
    .btn:disabled { opacity: .5; cursor: default; }
    .log { max-height: 132px; overflow-y: auto; padding: 8px 14px 12px; border-top: 1px solid #f0f0f2; font-size: 11.5px; color: #6e6e73; line-height: 1.55; }
    .log:empty { display: none; }
    .log div { padding: 1px 0; }
    .log .ok { color: #1a7f37; }
    .log .warn { color: #b25000; }
    .foot { padding: 8px 14px 12px; border-top: 1px solid #f0f0f2; display: flex; justify-content: space-between; font-size: 11px; color: #86868b; }
    .foot a { color: #0071e3; text-decoration: none; cursor: pointer; }
    .toast {
      position: absolute; right: 64px; bottom: 14px; white-space: nowrap;
      background: rgba(29,29,31,.92); color: #fff; font-size: 12px; padding: 7px 12px;
      border-radius: 999px; opacity: 0; transform: translateX(6px); transition: all .2s ease;
      pointer-events: none;
    }
    .toast.show { opacity: 1; transform: translateX(0); }
  `;

  function buildUI() {
    const host = document.createElement('div');
    host.id = '__af_host__';
    host.style.cssText = 'position:fixed;z-index:2147483646;right:24px;bottom:110px;';
    const root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
      <div class="panel" id="panel">
        <div class="head">
          <div>
            <div class="title">Apple 结账速填</div>
            <div class="sub" id="sub">待命中 · Alt+Q</div>
          </div>
          <button class="x" id="close" title="收起">✕</button>
        </div>
        <div class="btns">
          <button class="btn primary wide" id="go">一键填写 + 下一步</button>
          <button class="btn" id="fill">只填不点</button>
          <button class="btn" id="auto">自动跑到底</button>
          <button class="btn" id="inspect">记录本页字段</button>
          <button class="btn" id="settings">设置</button>
        </div>
        <div class="log" id="log"></div>
        <div class="foot">
          <span id="mode">取货模式</span>
          <a id="openopt">打开配置页 →</a>
        </div>
      </div>
      <div class="toast" id="toast"></div>
      <button class="fab" id="fab" title="Apple 结账速填 (Alt+Q)">
        <span>填</span><span class="dot idle" id="dot"></span>
      </button>
    `;

    root.appendChild(style);
    root.appendChild(wrap);
    document.documentElement.appendChild(host);

    const $ = (id) => root.getElementById(id);
    ui = { host, root, $, panel: $('panel'), dot: $('dot'), logEl: $('log'), sub: $('sub'), modeEl: $('mode') };

    // 拖动
    const fab = $('fab');
    let drag = null;
    let dragMoved = false;
    fab.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      dragMoved = false;
      fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
      if (!dragMoved) return;
      const r = host.getBoundingClientRect();
      host.style.left = Math.max(4, Math.min(window.innerWidth - r.width - 4, r.left + dx)) + 'px';
      host.style.top = Math.max(4, Math.min(window.innerHeight - r.height - 4, r.top + dy)) + 'px';
      host.style.right = 'auto';
      host.style.bottom = 'auto';
      drag.x = e.clientX; drag.y = e.clientY;
    });
    fab.addEventListener('pointerup', () => {
      drag = null;
      if (dragMoved) savePos();
    });
    fab.addEventListener('click', () => {
      if (dragMoved) { dragMoved = false; return; }
      togglePanel();
    });

    $('close').onclick = () => ui.panel.classList.remove('open');
    $('go').onclick = () => run('fillNext');
    $('fill').onclick = () => run('fill');
    $('auto').onclick = () => run('auto');
    $('inspect').onclick = () => inspectFields();
    $('settings').onclick = () => chrome.runtime.sendMessage({ type: 'AF_OPEN_OPTIONS' });
    $('openopt').onclick = () => chrome.runtime.sendMessage({ type: 'AF_OPEN_OPTIONS' });

    chrome.storage.local.get(['afPos'], (r) => {
      if (r && r.afPos) {
        host.style.left = r.afPos.left + 'px';
        host.style.top = r.afPos.top + 'px';
        host.style.right = 'auto';
        host.style.bottom = 'auto';
      }
    });
  }

  function savePos() {
    const r = ui.host.getBoundingClientRect();
    chrome.storage.local.set({ afPos: { left: Math.round(r.left), top: Math.round(r.top) } });
  }

  function togglePanel() {
    ui.panel.classList.toggle('open');
  }

  function toast(msg) {
    if (!ui) return;
    const t = ui.$('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function log(msg, kind) {
    if (!ui) return;
    const d = document.createElement('div');
    if (kind) d.className = kind;
    d.textContent = '· ' + msg;
    ui.logEl.appendChild(d);
    ui.logEl.scrollTop = ui.logEl.scrollHeight;
    while (ui.logEl.children.length > 60) ui.logEl.removeChild(ui.logEl.firstChild);
  }

  function setDot(kind, sub) {
    if (!ui) return;
    ui.dot.className = 'dot ' + kind;
    if (sub) ui.sub.textContent = sub;
  }

  /* ---------- 动作 ---------- */
  function pickBehavior(mode) {
    const b = Object.assign({}, config.behavior || {});
    if (mode === 'fill') { b.clickNext = false; b.autoAdvance = false; }
    else if (mode === 'fillNext') { b.clickNext = true; b.autoAdvance = false; b.maxSteps = 1; }
    else {
      // 自动到底：整条流程 5 步左右，留点余量
      b.clickNext = true;
      b.autoAdvance = true;
      b.maxSteps = Math.max(Number(b.maxSteps) || 8, 8);
    }
    return b;
  }

  // patch：临时覆盖的配置（交接下单时用监控到的有货门店）。返回 stopReason
  async function run(mode, patch) {
    if (!ui) return 'no-ui'; // 子框架没有 UI
    if (running) { toast('正在执行中…'); return 'busy'; }
    if (!ui.panel.classList.contains('open')) ui.panel.classList.add('open');

    const cfg = JSON.parse(JSON.stringify(patch ? merge(config, patch) : config));
    cfg.behavior = pickBehavior(mode);

    // 前置检查：关键信息是否齐全（支付页只差点按钮，不用查这些）
    const missing = [];
    const curType = AF.detectPageType();
    const pk = cfg.pickup || {};
    const hasName = (pk.legalLastName && pk.legalFirstName) || cfg.name || (cfg.lastName && cfg.firstName);
    if (curType !== 'payment' && curType !== 'review') {
      if (!hasName) missing.push('姓名');
      if (!cfg.phone) missing.push('手机号');
      if (cfg.mode === 'pickup') {
        if (!cfg.email) missing.push('邮箱');
        if (!(pk.idLast4 || cfg.idCard)) missing.push('身份证后四位');
      } else {
        if (!cfg.province) missing.push('省');
        if (!cfg.city) missing.push('市');
        if (!cfg.street) missing.push('街道地址');
      }
    }
    if (missing.length) {
      log('配置缺少：' + missing.join('、'), 'warn');
      toast('请先在设置里补全：' + missing.join('、'));
      setDot('warn', '配置不完整');
      return 'missing-config';
    }

    running = true;
    setDot('busy', '填写中…');
    if (ui) ui.$('go').textContent = '一键填写 + 下一步';
    if (!patch) ui.logEl.innerHTML = ''; // 交接下单时保留前面购物袋的日志
    const t0 = Date.now();
    let reason = 'error';

    try {
      const res = await AF.run(cfg, { log, onStatus: () => {} });
      reason = res.stopReason;
      const ms = ((Date.now() - t0) / 1000).toFixed(1);
      if (res.stopReason === 'order-placed') {
        log('✅ 已点击「立即下单」，订单已提交，请按页面提示完成付款（用时 ' + ms + ' 秒）', 'ok');
        setDot('ok', '已下单，去付款');
        toast('订单已提交，请完成付款');
      } else if (res.stopReason === 'order-pending') {
        log('⚠️ 已点过「立即下单」，页面还没跳转。不要重复点，先看页面提示', 'warn');
        setDot('warn', '下单结果待确认');
        toast('已点过立即下单，请看页面结果');
      } else if (res.stopReason === 'ready-to-order') {
        log('✅ 已到检查订单页，核对无误后点「立即下单」（用时 ' + ms + ' 秒）', 'ok');
        setDot('ok', '可以下单了');
        toast('已停在检查订单页，你来点「立即下单」');
      } else if (res.stopReason === 'payment') {
        log('✅ 信息已填完，请手动付款（用时 ' + ms + ' 秒）', 'ok');
        setDot('ok', '可以付款了');
        toast('已到付款页，去付款吧');
      } else if (res.stopReason === 'manual-pay') {
        const payName = PAY_NAMES[(cfg.payment && cfg.payment.method) || 'wechat'] || '微信支付';
        log('👉 请你手动点一下「' + payName + '」，点好按 Alt+Q 或点下面的按钮，我来点「检查订单」', 'warn');
        setDot('warn', '等你选支付方式');
        toast('请手动点' + payName + '，选好后按 Alt+Q');
        if (ui) ui.$('go').textContent = '我已选好 → 点检查订单';
      } else if (res.stopReason === 'need-manual') {
        log('⚠️ 自动没搞定，请手动操作后再按 Alt+Q', 'warn');
        setDot('warn', '需要手动点一下');
        toast('支付方式没选上，请手动点一下');
      } else if (res.stopReason === 'otp') {
        log('⚠️ 需要短信验证码，请手动输入后点“一键填写”继续', 'warn');
        setDot('warn', '等待验证码');
      } else if (res.stopReason === 'filled' || res.stopReason === 'done') {
        log('✅ 完成（用时 ' + ms + ' 秒）', 'ok');
        setDot('ok', '已填写');
      } else {
        setDot('warn', '需要人工确认');
      }
    } catch (e) {
      log('出错：' + e.message, 'warn');
      setDot('warn', '出错');
    } finally {
      running = false;
    }
    return reason;
  }

  function inspectFields() {
    const info = AF.inspect();
    const pageType = AF.detectPageType();
    const payload = {
      url: location.href,
      at: new Date().toISOString(),
      pageType,
      pageName: AF.PAGE_NAMES ? AF.PAGE_NAMES[pageType] : pageType,
      buttons: Array.from(document.querySelectorAll('button, a[role="button"]'))
        .filter((el) => el.offsetParent)
        .map((el) => (el.innerText || '').trim().replace(/\s+/g, ' '))
        .filter(Boolean)
        .slice(0, 30),
      fields: info.fields,
      radios: info.radios,
      textHits: info.textHits,
      iframes: info.iframes,
      shadowHosts: info.shadowHosts
    };
    chrome.storage.local.set({ afLastInspect: payload });

    if (!ui.panel.classList.contains('open')) ui.panel.classList.add('open');
    ui.logEl.innerHTML = '';
    log('当前页面：' + (payload.pageName || pageType));
    log('输入框 ' + info.fields.length + ' 个 · 单选项 ' + info.radios.length + ' 个 · 支付相关文字 ' + info.textHits.length + ' 处');
    info.fields.forEach((f) => {
      const tag = f.key ? '✔ ' : '· ';
      log(tag + (f.strong || f.weak || f.tag).slice(0, 60) + (f.key ? ' → ' + f.key : ''), f.key ? 'ok' : '');
    });
    info.textHits.slice(0, 6).forEach((t) => log('「' + t.text + '」<' + t.tag + '>', 'ok'));
    if (info.iframes.length) log('页面里有 iframe：' + info.iframes.length + ' 个', 'warn');
    log('已记录，内容已复制到剪贴板', 'ok');

    // 直接复制一份，方便贴给我看
    const text = JSON.stringify(payload, null, 1);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast('已复制到剪贴板，直接粘给我'),
        () => toast('已记录，可在设置页查看')
      );
    } else {
      toast('已记录，可在设置页查看');
    }
  }

  /* ---------- 消息（仅顶层页面；子框架在 boot() 里单独处理） ---------- */
  if (isTop) chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'AF_RUN') { run(msg.mode || 'fillNext'); sendResponse({ ok: true }); }
    else if (msg.type === 'AF_CONFIG_UPDATED') { loadConfig().then(() => { updateModeLabel(); sendResponse({ ok: true }); }); return true; }
    else if (msg.type === 'AF_PING') { sendResponse({ ok: true, url: location.href }); }
    else if (msg.type === 'AF_STATUS') {
      sendResponse({ running, mode: config.mode, fields: AF.inspect().fields.length });
    }
  });

  function updateModeLabel() {
    if (ui) ui.modeEl.textContent = config.mode === 'pickup' ? '取货模式' : '配送模式';
  }

  /* ---------- 自动启动（可选） ---------- */
  async function maybeAutoStart() {
    if (autoStarted) return;
    const b = config.behavior || {};
    if (!b.autoStart) return;
    const isCheckout = /\/shop\/(checkout|bag)|secure\d*\.store\.apple\.com\.cn/i.test(location.href);
    if (!isCheckout) return;
    // 等结账表单出现
    for (let i = 0; i < 40; i++) {
      const n = AF.inspect().fields.filter((f) => f.key).length;
      if (n >= 2) break;
      await AF.sleep(500);
    }
    const n = AF.inspect().fields.filter((f) => f.key).length;
    if (n < 2) return;
    autoStarted = true;
    log('检测到结账表单，自动执行');
    run('fillNext');
  }

  /* ---------- 交接下单：本机库存监控（定制版）发现有货后打开购物袋，这里接手 ---------- */
  // 地址形如 https://www.apple.com.cn/shop/bag#af-handoff=<一次性令牌>@<监控程序端口>
  // 机型由用户提前加进购物袋；这里只点「结账」，之后交给原来的结账流程
  // 进度存在 chrome.storage.local.afHandoff，跨页面（购物袋 → 登录 → 结账）延续
  const HANDOFF_HASH_RE = /af-handoff=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@(\d{4,5})/;
  const HANDOFF_LOCAL_TTL = 30 * 60 * 1000; // 中途要登录的话也来得及
  let handoffBusy = false;

  const getHandoff = () => new Promise((resolve) => {
    chrome.storage.local.get(['afHandoff'], (r) => {
      const h = r && r.afHandoff;
      if (h && h.until > Date.now() && h.stage !== 'done') resolve(h);
      else { if (h) chrome.storage.local.remove('afHandoff'); resolve(null); }
    });
  });
  const saveHandoff = (h) => new Promise((resolve) => chrome.storage.local.set({ afHandoff: h }, resolve));
  const endHandoff = () => new Promise((resolve) => chrome.storage.local.remove('afHandoff', resolve));

  function pageKind() {
    const u = location.href;
    if (/\/shop\/(checkout|signIn)|secure\d*\.store\.apple\.com\.cn/i.test(u)) return 'checkout';
    if (/\/shop\/bag/i.test(u)) return 'bag';
    return 'other';
  }

  function handoffSay(msg, kind, dot) {
    if (!ui.panel.classList.contains('open')) ui.panel.classList.add('open');
    log(msg, kind);
    if (dot) setDot(dot[0], dot[1]);
  }

  async function claimFromHash() {
    const m = HANDOFF_HASH_RE.exec(location.hash || '');
    if (!m || !/(^|\.)apple\.com\.cn$/i.test(location.hostname)) return;
    // 去掉令牌，避免刷新 / 分享地址时带出去
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    handoffSay('收到库存监控的交接，正在领取…', '', ['busy', '接手中…']);
    let res;
    try { res = await chrome.runtime.sendMessage({ type: 'AF_HANDOFF_CLAIM', id: m[1], port: Number(m[2]) }); }
    catch (e) { res = { ok: false, error: String(e && e.message || e) }; }
    if (!res || !res.ok) {
      handoffSay('领取失败：' + ((res && res.error) || '未知错误'), 'warn', ['warn', '交接失败']);
      return;
    }
    const h = res.handoff;
    const stores = (h.stores || []).map((s) => s.name);
    if (h.test) {
      handoffSay('✅ 已接手（测试）：' + h.product.name + (stores.length ? ' · ' + stores.join('、') : '') + '。联动正常，测试不会点结账', 'ok', ['ok', '联动正常']);
      toast('联动正常：扩展已接手（测试）');
      return;
    }
    await saveHandoff({ id: h.id, product: h.product, stores, stage: 'bag', until: Date.now() + HANDOFF_LOCAL_TTL });
    handoffSay('✅ 已接手：' + h.product.name + '（有货门店：' + (stores.join('、') || '未知') + '）', 'ok');
    toast('有货！扩展开始自动下单');
  }

  async function handoffBag(h) {
    handoffSay('购物袋：点「结账」', '', ['busy', '结账中…']);
    const isEmpty = () => /购物袋是空的|购物袋为空|购物袋中没有商品|your bag is empty/i.test(document.body.innerText || '');
    let btn = null;
    for (let i = 0; i < 30 && !btn && !isEmpty(); i++) { btn = AF.findCheckoutButton(); if (!btn) await AF.sleep(500); }
    if (!btn) {
      const empty = isEmpty();
      handoffSay(empty
        ? '⚠️ 购物袋是空的：请先把要买的机型加进购物袋，再点「结账」，之后我继续接手'
        : '⚠️ 购物袋里没找到可点的「结账」，请手动点「结账」，之后我继续接手', 'warn', ['warn', '需要手动结账']);
      h.stage = 'checkout';
      await saveHandoff(h);
      return;
    }
    // 购物袋里同款超过限购（以前加过没结账），Apple 不让结账
    const limit = /每名顾客最多可购买[^。]*。/.exec(document.body.innerText || '');
    if (limit) {
      handoffSay('⚠️ ' + limit[0] + '请在购物袋里把数量改好，再点「结账」，之后我继续接手', 'warn', ['warn', '超出限购']);
      h.stage = 'checkout';
      await saveHandoff(h);
      return;
    }
    h.stage = 'checkout';
    await saveHandoff(h);
    AF.realClick(btn);
    log('点击「结账」');
  }

  async function handoffCheckout(h) {
    // 等结账页渲染出可识别的页面（登录页就停下等你登录，登录后回到结账页会自动继续）
    for (let i = 0; i < 40; i++) {
      const gate = AF.detectGate();
      // 真实登录页是 /shop/signIn（登录框在 idmsa iframe 里，页面上还有「以游客身份继续」），按地址判断最稳
      if (/\/shop\/signIn/i.test(location.pathname) || (gate && gate.type === 'login')) {
        handoffSay('需要登录 Apple 账户（或点「以游客身份继续」），进入结账页后我会继续', 'warn', ['warn', '等你登录']);
        return;
      }
      if (AF.detectPageType() !== 'unknown') break;
      await AF.sleep(500);
    }
    if (AF.detectPageType() === 'unknown') {
      // 结账第一屏可能还要先选「取货」，交给原流程处理
      log('结账页还没识别出来，按通用流程继续');
    }
    const [first, ...rest] = h.stores;
    const patch = first ? { mode: 'pickup', pickup: { storeName: first, storePrefs: rest, storeKeyword: '' } } : null;
    const reason = await run('auto', patch);
    if (reason === 'busy' || reason === 'login') return; // 稍后再接着跑
    if (reason === 'missing-config') {
      handoffSay('⚠️ 扩展配置不完整，补全后在结账页点「自动跑到底」', 'warn');
    }
    h.stage = 'done';
    await endHandoff();
  }

  async function handoffTick() {
    if (handoffBusy || !isTop || !ui) return;
    handoffBusy = true;
    try {
      const h = await getHandoff();
      if (!h) return;
      const kind = pageKind();
      if (kind === 'bag' && h.stage === 'bag') await handoffBag(h);
      else if (kind === 'checkout') await handoffCheckout(h);
    } catch (e) {
      log('交接下单出错：' + (e && e.message || e), 'warn');
    } finally {
      handoffBusy = false;
    }
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    await loadConfig();

    // 设置页保存后，已打开的结账页立即用上新配置
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.afConfig) return;
        config = merge(DEFAULTS, changes.afConfig.newValue || {});
        updateModeLabel();
      });
    } catch (e) { /* 测试环境没有 onChanged */ }

    // 子框架（万一结账表单在 iframe 里）：不建 UI，只响应填写指令
    if (!isTop) {
      let busy = false;
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg || msg.type !== 'AF_RUN') return;
        // 只有真的含结账表单的 iframe 才动手，避免在广告/统计 iframe 里乱点
        if (busy || AF.inspect().fields.filter((f) => f.key && f.visible).length < 2) return;
        busy = true;
        const cfg = JSON.parse(JSON.stringify(config));
        cfg.behavior = pickBehavior(msg.mode || 'fillNext');
        AF.run(cfg, { log: () => {} })
          .then((r) => sendResponse({ ok: true, result: r }))
          .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }))
          .finally(() => { busy = false; });
        return true;
      });
      return;
    }

    buildUI();
    updateModeLabel();
    // 页面是 SPA，URL 变化时重置自动启动标记，并看看交接下单要不要接着走
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) { lastHref = location.href; autoStarted = false; handoffTick(); }
    }, 1200);
    await claimFromHash();
    if (await getHandoff()) handoffTick(); // 交接下单进行中：不再走普通的自动启动，免得重复执行
    else maybeAutoStart();
  }

  boot();
})();
