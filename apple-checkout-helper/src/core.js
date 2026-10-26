/* =============================================================
 * core.js —— 填写引擎（纯逻辑，不依赖 chrome API，便于测试）
 * 暴露 window.__AF
 * ============================================================= */
(function () {
  'use strict';

  const AF = {};
  const COMPOUND_SURNAMES = ['欧阳', '司马', '上官', '诸葛', '东方', '皇甫', '尉迟', '公孙', '慕容', '长孙', '宇文', '司徒', '夏侯', '令狐', '端木', '独孤', '南宫', '西门', '百里', '呼延'];

  /* ---------------- 工具 ---------------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  AF.sleep = sleep;

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    return true;
  }
  AF.isVisible = isVisible;

  function textOf(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }
  AF.textOf = textOf;

  // 有些 Apple 组件监听 pointerdown / mousedown，光靠 el.click() 不一定触发
  AF.realClick = function (el) {
    if (!el) return false;
    const opts = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (e) { /* 老浏览器 */ }
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (e) { /* ignore */ }
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
    return true;
  };

  function norm(s) {    return String(s || '')
      .replace(/\s+/g, '')
      .replace(/[\/·、,，。.\-—_()（）:：]/g, '')
      .replace(/^(中国|中华人民共和国)/, '')
      .replace(/(特别行政区|自治区|自治州|省|市|区|县|镇|街道)$/g, '')
      .toLowerCase();
  }
  AF.norm = norm;

  // 连 Shadow DOM 一起查（Apple 有些组件是 web component）
  AF.deepQueryAll = function (selector, root) {
    const out = [];
    const visit = (node) => {
      if (!node || !node.querySelectorAll) return;
      try { out.push.apply(out, node.querySelectorAll(selector)); } catch (e) { /* 无效选择器 */ }
      let els;
      try { els = node.querySelectorAll('*'); } catch (e) { return; }
      for (const el of els) if (el.shadowRoot) visit(el.shadowRoot);
    };
    visit(root || document);
    return out;
  };

  // 按文本节点找元素：不管卡片是 div / td / span 还是别的标签，都能捞出来
  AF.findTextNodes = function (re, maxLen) {
    const limit = maxLen || 30;
    const res = [];
    if (!document.body) return res;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let n = walker.nextNode();
    while (n) {
      const t = String(n.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (t && t.length <= limit && re.test(t)) {
        const el = n.parentElement;
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width >= 2 && r.height >= 2) res.push({ el, text: t, rect: r });
        }
      }
      n = walker.nextNode();
    }
    return res;
  };

  // 按坐标点击：和真人鼠标落点一致，能绕开各种奇怪的 DOM 结构
  AF.clickAtPoint = function (x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    AF.realClick(el);
    return el;
  };

  /* ---------------- 字段识别 ---------------- */
  // 顺序即优先级：越具体的越靠前
  const RULES = [
    ['otp', /验证码|校验码|动态码|短信码|verification|one-?time|securitycode|\botp\b/],
    ['idLast4', /后四位|末四位|后4位|last4|lastfour/],
    ['idCard', /身份证|证件号码|证件号|idnumber|idcard|identity/],
    ['taxNo', /税号|纳税人识别号|taxid|taxnumber/],
    ['invoiceTitle', /发票抬头|发票名称|invoicetitle/],
    ['email', /邮箱|电子邮件|e-mail|email/],
    ['phone', /手机|电话|联系方式|phone|mobile|telephone|\btel\b/],
    ['postal', /邮编|邮政编码|postal|zipcode|\bzip\b/],
    ['province', /省|自治区|直辖市|province|\bstate\b|\bregion\b/],
    ['city', /城市|\bcity\b|\btown\b/],
    ['district', /区县|行政区|区|\bdistrict\b|\bcounty\b/],
    ['company', /公司|单位|企业|company|organization/],
    ['street2', /地址2|地址二|详细地址2|addressline2|street2|\bapt\b|\bsuite\b|楼栋|单元|楼层|房间号/],
    ['street', /街道|地址|address|street|\broad\b/],
    ['lastName', /姓氏|lastname|familyname|surname/],
    ['firstName', /名字|firstname|givenname/],
    ['name', /收货人|收件人|取货人|联系人|姓名|fullname|recipient|\bname\b/]
  ];

  function detectKey(hint) {
    if (!hint) return null;
    const h = String(hint).toLowerCase().replace(/\s+/g, '');
    if (!h) return null;
    for (const [key, re] of RULES) {
      if (re.test(h)) return key;
    }
    return null;
  }
  AF.detectKey = detectKey;

  // 强提示：控件自身属性 + label；弱提示：附近兄弟节点文本
  function hintsFor(el) {
    const strong = [];
    const weak = [];
    const push = (arr, v) => { if (v && String(v).trim()) arr.push(String(v).trim()); };

    push(strong, el.getAttribute('data-autom'));
    push(strong, el.getAttribute('name'));
    // id 只取最后一段：checkout.pickupContact...address.lastName → lastName
    // 否则 id 里的 "address" 会把「姓氏」误判成街道地址
    if (el.id) {
      const segs = String(el.id).split('.');
      push(strong, segs[segs.length - 1]);
    }
    push(strong, el.getAttribute('placeholder'));
    push(strong, el.getAttribute('aria-label'));
    push(strong, el.getAttribute('autocomplete'));

    if (el.id) {
      try {
        const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (l) push(strong, textOf(l));
      } catch (e) { /* ignore */ }
    }
    const wrapLabel = el.closest('label');
    if (wrapLabel) push(strong, textOf(wrapLabel));

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => {
        const n = document.getElementById(id);
        if (n) push(strong, textOf(n));
      });
    }

    // 弱提示：向上 3 层，收集不含本控件的子节点文本
    let p = el.parentElement;
    for (let depth = 0; p && depth < 3; depth++) {
      for (const c of Array.from(p.children)) {
        if (c.contains(el)) continue;
        const t = textOf(c);
        if (t && t.length <= 40) push(weak, t);
      }
      if (weak.join(' ').length > 40) break;
      p = p.parentElement;
    }

    return { strong: strong.join(' | '), weak: weak.join(' | ') };
  }
  AF.hintsFor = hintsFor;

  /* ---------------- 取值 ---------------- */
  function splitName(full) {
    const n = String(full || '').trim();
    if (!n) return { last: '', first: '' };
    for (const s of COMPOUND_SURNAMES) {
      if (n.startsWith(s) && n.length > s.length) return { last: s, first: n.slice(s.length) };
    }
    return { last: n.slice(0, 1), first: n.slice(1) };
  }

  function valueFor(config, key) {
    const c = config || {};
    const pk = c.pickup || {};
    const usePickupContact = c.mode === 'pickup' && pk.useDifferentContact && (pk.contactName || pk.contactPhone);

    switch (key) {
      case 'name':
        if (usePickupContact && pk.contactName) return pk.contactName;
        // 以配置里的中文姓名为准，老配置里的拼音字段只作兜底
        return c.name || [c.lastName, c.firstName].filter(Boolean).join('') ||
          [pk.legalLastName, pk.legalFirstName].filter(Boolean).join('');
      case 'firstName':
        return c.firstName || splitName(c.name).first || pk.legalFirstName || '';
      case 'lastName':
        return c.lastName || splitName(c.name).last || pk.legalLastName || '';
      case 'phone':
        if (usePickupContact && pk.contactPhone) return String(pk.contactPhone).replace(/\s+/g, '');
        return String(c.phone || '').replace(/\s+/g, '');
      case 'email': return c.email || '';
      case 'idCard': return c.idCard || '';
      case 'idLast4': {
        const v = String(pk.idLast4 || '').trim();
        if (v) return v.replace(/\s+/g, '').slice(-4);
        return String(c.idCard || '').replace(/\s+/g, '').slice(-4);
      }
      case 'province': return c.province || '';
      case 'city': return c.city || '';
      case 'district': return c.district || '';
      case 'street': return c.street || '';
      case 'street2': return c.street2 || '';
      case 'postal': return c.postal || '';
      case 'company': return c.company || '';
      case 'invoiceTitle': return (c.invoice && c.invoice.title) || '';
      case 'taxNo': return (c.invoice && c.invoice.taxNo) || '';
      case 'otp': return ''; // 永远不自动填，必须本人输入
      default: return '';
    }
  }
  AF.valueFor = valueFor;

  /* ---------------- 收集页面字段 ---------------- */
  AF.collectFields = function (config) {
    const c = config || {};
    const overrides = Array.isArray(c.overrides) ? c.overrides : [];
    const candidates = [];
    const els = Array.from(document.querySelectorAll('input, select, textarea'));

    for (const el of els) {
      const type = String(el.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'range', 'color', 'password', 'search'].includes(type)) continue;
      if (el.disabled || el.readOnly) continue;
      if (!isVisible(el)) continue;

      let key = null;
      let strength = 0;
      let hint = '';

      for (const ov of overrides) {
        if (!ov || !ov.selector || !ov.key) continue;
        try {
          if (el.matches(ov.selector)) { key = ov.key; strength = 3; break; }
        } catch (e) { /* 无效选择器忽略 */ }
      }

      if (!key) {
        const h = hintsFor(el);
        hint = h.strong || h.weak;
        key = detectKey(h.strong);
        if (key) strength = 2;
        else {
          key = detectKey(h.weak);
          if (key) strength = 1;
        }
      }

      if (!key) continue;
      const val = valueFor(c, key);
      if (!val) continue;
      candidates.push({ el, key, strength, hint, value: val });
    }

    // 同一个 key 只保留最可信的一个
    const best = new Map();
    for (const cand of candidates) {
      const prev = best.get(cand.key);
      if (!prev || cand.strength > prev.strength) best.set(cand.key, cand);
    }
    return Array.from(best.values());
  };

  /* ---------------- 写入控件 ---------------- */
  // 走原生 setter，React 的 value tracker 才会认为值变了并触发 onChange
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }
  AF.setNativeValue = setNativeValue;

  // 原生 select 统一走这里：原生 setter + input/change
  AF.setSelectValue = function (sel, value) {
    if (!sel || sel.value === value) return !!sel;
    sel.focus();
    setNativeValue(sel, value);
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sel.blur();
    return sel.value === value;
  };

  AF.fillText = async function (el, value) {
    if (el.value === value) return true;
    el.focus();
    // 先清空：结账页常带旧值/掩码值（如 a*******1@example.com），必须整段覆盖
    try { el.select(); } catch (e) { /* ignore */ }
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Backspace' }));
    setNativeValue(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(20);
    setNativeValue(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    // 部分框架监听 keyup/blur 做校验
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
    el.blur();
    await sleep(30);
    return el.value === value;
  };

  // 轮询等待目标选项出现（省市区是异步级联加载的）
  AF.waitForOptions = async function (el, timeout = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const opts = Array.from(el.options || []).filter((o) => o.value && o.value !== '-1');
      if (opts.length) return opts;
      await sleep(120);
    }
    return Array.from(el.options || []);
  };

  AF.fillSelect = async function (el, value) {
    if (!value) return false;
    const target = norm(value);
    if (!target) return false;

    const deadline = Date.now() + 4000;
    let pick = null;
    while (Date.now() < deadline) {
      const opts = Array.from(el.options || []).filter((o) => o.value && o.value !== '-1');
      pick = opts.find((o) => norm(o.text) === target);
      if (!pick) {
        pick = opts.find((o) => {
          const n = norm(o.text);
          return n && (n.includes(target) || target.includes(n));
        });
      }
      if (pick) break;
      await sleep(120);
    }
    if (!pick) return false;

    if (el.value === pick.value) return true;
    AF.setSelectValue(el, pick.value);
    await sleep(60);
    return el.value === pick.value;
  };

  // 自定义下拉（button + listbox）兜底
  AF.fillCustomDropdown = async function (key, value) {
    if (!value) return false;
    const labelRe = {
      province: /省|自治区|province|state/,
      city: /城市|市|city/,
      district: /区|县|district/
    }[key];
    if (!labelRe) return false;

    const triggers = Array.from(document.querySelectorAll('[role="combobox"], button, [aria-haspopup="listbox"]'))
      .filter((el) => isVisible(el))
      .filter((el) => {
        const t = (textOf(el) + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
        return labelRe.test(t) && !/下一步|继续|结账|删除/.test(t);
      });
    if (!triggers.length) return false;

    const trigger = triggers[0];
    AF.realClick(trigger);
    await sleep(350);

    const options = Array.from(document.querySelectorAll('[role="option"], li, [role="menuitem"]')).filter(isVisible);
    const target = norm(value);
    const hit = options.find((o) => norm(textOf(o)) === target) || options.find((o) => norm(textOf(o)).includes(target));
    if (!hit) { document.body.click(); return false; }
    AF.realClick(hit);
    await sleep(250);
    return true;
  };

  /* ---------------- 按钮 ---------------- */
  const NEXT_AUTOMS = [
    'shipping-continue-button',
    'fulfillment-continue-button',
    'continue-button-review',
    'continue-with-applecard-button',
    'deliveryOptionApply'
  ];
  // 按页面类型决定「往下走」的那个按钮
  const NEXT_BY_TYPE = {
    'pickup-date': [/继续填写取货详情/, /填写取货详情/, /^继续$/],
    'pickup-contact': [/^继续$/, /继续选择付款方式/, /下一步/, /继续填写/],
    invoice: [/继续选择付款方式/, /继续选择/, /^继续$/, /^下一步$/],
    payment: [/检查订单/, /^检查$/],
    address: [/^下一步$/, /^继续$/, /^保存并继续$/],
    unknown: [/继续填写取货详情/, /检查订单/, /^下一步$/, /^继续$/]
  };
  const NEXT_BLOCK = /购物|返回|取消|删除|修改|上一步|查看|更改|展开|显示更多/;
  // 兜底：任何页面都认这几类「往前走」的按钮（文案开头匹配即可，如「继续选择付款方式」）
  const NEXT_GENERIC = [/^继续/, /^下一步/, /^前往/, /^检查订单/, /^确认并继续/];

  function isEnabled(el) {
    return !!el && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  }

  // 硬性停手：不管页面识别结果如何，这些按钮永远不点
  const NEVER_CLICK_TEXT = /立即下单|提交订单|确认下单|确认付款|立即付款|立即支付|去支付|place\s*order|pay\s*now|支付\s*[¥￥]/i;
  const NEVER_CLICK_AUTOM = /authorizePayment|placeOrder|place-order|submit-order/i;
  AF.isForbiddenButton = function (el) {
    if (!el) return false;
    const autom = (el.getAttribute('data-autom') || '') + ' ' + (el.id || '');
    const label = textOf(el) + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.value || '');
    return NEVER_CLICK_AUTOM.test(autom) || NEVER_CLICK_TEXT.test(label);
  };

  // 填完后 Apple 会重新校验，按钮可能短暂是灰的
  AF.waitEnabled = async function (el, timeout = 2500) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (isEnabled(el)) return true;
      await sleep(150);
    }
    return isEnabled(el);
  };

  AF.findNextButton = function (pageType) {
    if (pageType === 'review') return null;
    // 数据里带了 data-autom 的，优先
    for (const a of NEXT_AUTOMS) {
      const el = document.querySelector('[data-autom="' + a + '"]');
      if (el && isVisible(el) && isEnabled(el) && !AF.isForbiddenButton(el)) return el;
    }
    const clickable = Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .filter(isVisible)
      .filter((el) => !AF.isForbiddenButton(el));
    const scan = (patterns, maxLen) => {
      for (const re of patterns) {
        for (const el of clickable) {
          const t = textOf(el);
          if (!t || t.length > maxLen) continue;
          if (NEXT_BLOCK.test(t)) continue;
          if (re.test(t) && isEnabled(el)) return el;
        }
      }
      return null;
    };

    const patterns = NEXT_BY_TYPE[pageType] || NEXT_BY_TYPE.unknown;
    let hit = scan(patterns, 16);
    // 没命中就放宽：Apple 偶尔会换按钮文案（如「继续选择付款方式」）
    if (!hit) hit = scan(NEXT_GENERIC, 14);
    return hit;
  };

  /* ---------------- 页面类型 ---------------- */
  const PAGE_NAMES = {
    'pickup-date': '选择取货日期 / 门店',
    'pickup-contact': '填写取货人信息',
    invoice: '选择发票类型',
    payment: '选择支付方式',
    review: '检查订单',
    address: '收货地址',
    unknown: '未识别页面'
  };
  AF.PAGE_NAMES = PAGE_NAMES;

  // 按用户实际遇到的 4 个页面识别
  AF.detectPageType = function () {
    const t = document.body ? document.body.innerText : '';
    const has = (re) => re.test(t);

    // 检查订单页：底部「立即下单」
    if (has(/立即下单/) && has(/取货详情|付款详情|检查订单|总计/)) return 'review';
    // 选日期 + 门店页
    if (has(/选择取货日期|签到时段|可取的日期|选择取货时段/)) return 'pickup-date';
    // 取货联系人信息页
    if (has(/填写你的取货信息|身份证件号码的后四位|取货联系人信息|不可由他人取货/)) return 'pickup-contact';
    // 发票类型页（在取货信息和支付方式之间）
    if (has(/你需要什么类型的发票|电子发票|增值税专用发票|发票抬头/)) return 'invoice';
    // 支付方式页
    if (has(/支付方式|付款方式/) && (has(/微信支付|支付宝|信用卡|分期付款/) || has(/检查订单/))) return 'payment';
    // 收货地址页
    if (has(/收货信息|收货人姓名|街道地址|配送地址/)) return 'address';
    return 'unknown';
  };

  /* ---------------- 阶段判断 ---------------- */
  AF.detectGate = function () {
    const bodyText = document.body ? document.body.innerText : '';
    const visSel = (sel) => {
      const el = document.querySelector(sel);
      return el && isVisible(el);
    };

    // 支付/卡号 → 停手，交给本人
    if (visSel('[data-autom="card-number-input"]') || visSel('input[autocomplete="cc-number"]') || visSel('input[name*="cardNumber" i]')) {
      return { type: 'payment', msg: '已到支付环节，停止自动操作' };
    }
    // 提交订单按钮出现 → 说明已到付款页
    if (visSel('[data-autom="authorizePayment"]') || visSel('[data-autom="continue-button-placeOrder"]')) {
      return { type: 'payment', msg: '已到付款页，请手动完成付款' };
    }
    // 验证码 → 需要本人输入
    const otpField = Array.from(document.querySelectorAll('input')).find((el) => isVisible(el) && detectKey(hintsFor(el).strong) === 'otp');
    if (otpField) return { type: 'otp', msg: '需要短信验证码，请手动输入' };
    if (/输入验证码|获取验证码|短信验证码/.test(bodyText)) return { type: 'otp', msg: '需要短信验证码，请手动输入' };

    // 登录墙
    if (/登录以继续|使用 Apple 账户登录|sign in to continue/i.test(bodyText) && !/访客/.test(bodyText)) {
      return { type: 'login', msg: '需要登录，请手动登录后重试' };
    }
    return null;
  };

  // 不含按钮文案：点击后按钮会变成「处理中」/转圈，那不算换页
  AF.pageSignature = function () {
    const fields = Array.from(document.querySelectorAll('input, select, textarea')).filter(isVisible).length;
    const heads = Array.from(document.querySelectorAll('h1, h2, h3')).filter(isVisible).map(textOf).join('|').slice(0, 120);
    return location.href + '|' + AF.detectPageType() + '|' + fields + '|' + heads;
  };

  // 按钮还在、仍可点、文案没变 → 说明请求已经结束但没跳转
  function buttonSettled(btn, label) {
    return !!btn && btn.isConnected && isVisible(btn) && isEnabled(btn) && textOf(btn).slice(0, 16) === label;
  }

  // 等页面换到下一步。opts.button/label 用来判断「点了没反应」，提前结束等待
  AF.waitStepChange = async function (timeout = 12000, before, opts) {
    const o = opts || {};
    const sig = before || AF.pageSignature();
    const start = Date.now();
    let settledSince = 0;
    while (Date.now() - start < timeout) {
      await sleep(250);
      if (AF.pageSignature() !== sig) {
        // 等新页面稳定下来（SPA 会分几次渲染），连续两次签名一致再返回
        let last = AF.pageSignature();
        for (let i = 0; i < 8; i++) {
          await sleep(250);
          const now = AF.pageSignature();
          if (now === last) break;
          last = now;
        }
        return true;
      }
      // 按钮恢复原样 3 秒以上仍没换页，基本是校验没过
      if (o.button && Date.now() - start > 1500) {
        if (buttonSettled(o.button, o.label)) {
          if (!settledSince) settledSince = Date.now();
          else if (Date.now() - settledSince > 3000) return false;
        } else settledSince = 0;
      }
    }
    return false;
  };

  /* ---------------- 配送 / 取货方式 ---------------- */
  AF.chooseFulfillment = async function (mode, log) {
    const wantPickup = mode === 'pickup';
    const PICKUP = /取货|到店|门店自提|零售店取货/;
    const DELIVERY = /送货|配送|快递|寄送/;

    const clickable = Array.from(document.querySelectorAll('button, [role="radio"], [role="tab"], label, a, li'))
      .filter(isVisible)
      .filter((el) => {
        const t = textOf(el);
        if (!t || t.length > 16) return false;
        if (/查询|更多|了解|查看/.test(t)) return false;
        return PICKUP.test(t) || DELIVERY.test(t);
      });

    // 只有同时存在两种方式，才说明这是「选择配送方式」的区域，否则不乱点
    const hasPickup = clickable.some((el) => PICKUP.test(textOf(el)));
    const hasDelivery = clickable.some((el) => DELIVERY.test(textOf(el)));
    if (!(hasPickup && hasDelivery)) return false;

    const re = wantPickup ? PICKUP : DELIVERY;
    const el = clickable.find((x) => re.test(textOf(x)));
    if (!el) return false;

    AF.realClick(el);
    if (log) log('已选择' + (wantPickup ? '门店取货' : '送货上门'));
    await sleep(700);
    return true;
  };

  AF.handleStoreLocator = async function (pickup, log) {
    const p = pickup || {};
    const keyword = p.storeKeyword || p.storeName || '';
    if (!keyword) return false;

    const input = document.querySelector('[data-autom="bag-storelocator-input"], input[placeholder*="邮编"], input[placeholder*="搜索"], input[placeholder*="门店"]');
    if (!input || !isVisible(input)) return false;

    await AF.fillText(input, keyword);
    const searchBtn = document.querySelector('[data-autom="fulfillment-pickup-store-search-button"], [data-autom="bag-storelocator-input"] ~ button');
    if (searchBtn) searchBtn.click();
    else input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    if (log) log('搜索门店：' + keyword);
    await sleep(2200);

    // 优先点名字匹配的门店
    const results = Array.from(document.querySelectorAll('[data-autom="rt-storelocator-searchresult"], [role="option"], li'))
      .filter(isVisible)
      .filter((el) => textOf(el).length > 4);
    if (!results.length) return false;

    let target = null;
    if (p.storeName) {
      const n = norm(p.storeName);
      target = results.find((el) => norm(textOf(el)).includes(n));
    }
    if (!target) target = results[0];
    AF.realClick(target);
    if (log) log('已选择门店：' + textOf(target).slice(0, 20));
    await sleep(900);

    const confirm = document.querySelector('[data-autom="bag-storelocator-confirmstore"]');
    if (confirm && isVisible(confirm)) { confirm.click(); await sleep(700); }
    return true;
  };

  AF.pickFirstAvailableWindow = async function (log) {
    const sel = document.querySelector('[data-autom="pickup-availablewindow-dropdown"] select, select[data-autom="pickup-availablewindow-dropdown"]');
    if (sel && isVisible(sel)) {
      const opts = Array.from(sel.options).filter((o) => o.value && o.value !== '-1' && !o.disabled && !/不可用|暂无/.test(o.text));
      if (opts.length) {
        // opts 已过滤掉占位项，第一个就是最早可选的时段
        if (sel.value === opts[0].value) return true;
        AF.setSelectValue(sel, opts[0].value);
        if (log) log('已选取货时间：' + opts[0].text.trim());
        await sleep(400);
        return true;
      }
    }
    return false;
  };

  /* ---------------- 第 1 页：取货日期 + 签到时段 + 门店 ---------------- */
  AF.pickPickupDate = async function (datePref, log) {
    const cands = Array.from(document.querySelectorAll('button, [role="radio"], [role="tab"], [role="option"], li'))
      .filter(isVisible)
      .filter((el) => {
        const label = (el.getAttribute('aria-label') || '') + ' ' + textOf(el);
        if (!label.trim()) return false;
        if (/上一|下一|prev|next|更多|展开/.test(label)) return false;
        // 形如「周五 23」「10月23日」「周六24」
        return /周[一二三四五六日]\s*\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}\s*日/.test(label);
      });
    if (!cands.length) return false;

    let target = null;
    const pref = String(datePref || '').trim();
    if (pref) {
      // 支持「23」「10-23」「10月23日」这类写法
      const dayNum = (pref.match(/\d{1,2}/g) || []).pop();
      if (dayNum) target = cands.find((el) => new RegExp('(^|\\D)' + dayNum + '(\\D|$)').test(textOf(el) + ' ' + (el.getAttribute('aria-label') || '')));
    }
    // 禁用的日期一般只体现在属性上，文案里不一定有「不可选」
    const usable = (el) => isEnabled(el) && !/disabled|不可选|已满/.test(textOf(el) + ' ' + (el.className || ''));
    if (target && !usable(target)) {
      if (log) log('指定的 ' + pref + ' 号不可选，改选最早可取的日期', 'warn');
      target = null;
    }
    if (!target) target = cands.find(usable);
    if (!target) {
      if (log) log('没有可选的取货日期', 'warn');
      return false;
    }

    const already = target.getAttribute('aria-checked') === 'true' || /selected|active|is-selected/.test(target.className || '');
    if (already) {
      if (log) log('取货日期已是目标日期');
      return true;
    }
    AF.realClick(target);
    if (log) log('已选取货日期：' + textOf(target).slice(0, 16));
    await sleep(1200); // 日期变更后门店/时段会重新加载
    return true;
  };

  AF.pickTimeWindow = async function (log) {
    // 原生 select
    const sel = document.querySelector('[data-autom="pickup-availablewindow-dropdown"] select, select[data-autom="pickup-availablewindow-dropdown"]');
    if (sel && isVisible(sel)) {
      const opts = Array.from(sel.options).filter((o) => o.value && o.value !== '-1' && !o.disabled && !/不可用|暂无/.test(o.text));
      if (opts.length) {
        AF.setSelectValue(sel, opts[0].value);
        if (log) log('已选取货时段：' + opts[0].text.trim());
        await sleep(500);
        return true;
      }
    }

    // 自定义下拉：找「可选时段 / 签到时段」的触发器
    const triggers = Array.from(document.querySelectorAll('[role="combobox"], button, [aria-haspopup="listbox"]'))
      .filter(isVisible)
      .filter((el) => {
        const t = textOf(el) + ' ' + (el.getAttribute('aria-label') || '');
        return /可选时段|签到时段|取货时段|时段/.test(t) && !/确认|继续|取消/.test(t);
      });
    if (!triggers.length) return false;

    AF.realClick(triggers[0]);
    await sleep(450);
    const options = Array.from(document.querySelectorAll('[role="option"], li[role="option"], ul li, [role="menuitem"]'))
      .filter(isVisible)
      .filter((el) => /\d{1,2}:\d{2}/.test(textOf(el)));
    if (!options.length) { document.body.click(); return false; }

    AF.realClick(options[0]);
    if (log) log('已选取货时段：' + textOf(options[0]).slice(0, 18));
    await sleep(500);
    return true;
  };

  AF.pickStoreCard = async function (pickup, log) {
    const p = pickup || {};
    // 门店卡片：文本里有 Apple + 可取货 / 店内取货
    const cards = Array.from(document.querySelectorAll('button, li, [role="radio"], [role="option"], div[role="button"]'))
      .filter(isVisible)
      .filter((el) => {
        const t = textOf(el);
        if (!t || t.length > 80) return false;
        if (/显示更多|更多取货地点|展开地图|法律信息/.test(t)) return false;
        return /Apple\s/.test(t) && /可取货|店内取货|不可取货|暂无/.test(t);
      });
    if (!cards.length) return false;

    const usable = cards.filter((el) => !/不可取货|暂无|已售罄/.test(textOf(el)));
    if (!usable.length) return false;

    let target = null;
    // storePrefs：监控程序交接过来的有货门店（已按优先级排好），依次精确匹配
    const wants = [p.storeName].concat(Array.isArray(p.storePrefs) ? p.storePrefs : [], p.storeKeyword).filter(Boolean);
    for (const want of wants) {
      const n = norm(want);
      target = usable.find((el) => norm(textOf(el)).includes(n));
      if (target) break;
    }
    if (!target && wants.length) {
      // 退一步：按关键词里的地名匹配（如「万象城」）
      const key = String(wants[0]).split(/\s+/).filter((x) => x.length >= 2).pop();
      if (key) target = usable.find((el) => textOf(el).includes(key));
    }
    if (!target) {
      target = usable[0];
      if (wants.length && log) log('指定门店都不可取货，改选第一个可取货的门店', 'warn');
    }

    const name = textOf(target).replace(/\s+/g, ' ').slice(0, 30);
    AF.realClick(target);
    if (log) log('已选门店：' + name);
    await sleep(1000);
    return true;
  };

  AF.handlePickupDateStep = async function (cfg, log) {
    const pk = cfg.pickup || {};
    await AF.pickPickupDate(pk.datePreference, log);
    await AF.pickTimeWindow(log);
    await AF.pickStoreCard(pk, log);
    // 有些版本要先点「显示更多取货地点」才出目标门店
    const more = Array.from(document.querySelectorAll('button, a'))
      .filter(isVisible)
      .find((el) => /显示更多取货地点/.test(textOf(el)));
    if (more && pk.storeName && !document.body.innerText.includes(pk.storeName)) {
      AF.realClick(more);
      await sleep(1500);
      await AF.pickStoreCard(pk, log);
    }
    return true;
  };

  /* ---------------- 第 2 页：取货联系人（覆盖旧值） ---------------- */
  AF.handlePickupContactStep = async function (cfg, log) {
    const done = await AF.fillStep(cfg, log);
    // 只读字段填不进去（Apple 有时要你先点「更改」）
    const locked = Array.from(document.querySelectorAll('input[readonly], input[aria-readonly="true"]'))
      .filter(isVisible)
      .filter((el) => {
        const h = hintsFor(el);
        return detectKey(h.strong) || detectKey(h.weak);
      });
    if (locked.length && log) {
      log('⚠️ 有 ' + locked.length + ' 个字段是只读的，需要先点旁边的「更改」', 'warn');
    }
    // 手机号若被拆成「国家码 + 号码」，把国家码固定成 +86
    const cc = Array.from(document.querySelectorAll('select, button'))
      .filter(isVisible)
      .find((el) => /^\+?\s*86$|国家码|区号/.test(textOf(el) + ' ' + (el.getAttribute('aria-label') || '')));
    if (cc && cc.tagName === 'SELECT') {
      const opt = Array.from(cc.options).find((o) => /86/.test(o.text));
      if (opt && cc.value !== opt.value) {
        AF.setSelectValue(cc, opt.value);
        await sleep(200);
      }
    }
    return done;
  };

  /* ---------------- 发票类型页 ---------------- */
  // 卡片可能是 button / li / label / div，这里按「文本命中且不含其他选项」找叶子卡片
  AF.findOptionCards = function (re, maxLen) {
    const limit = maxLen || 26;
    const all = Array.from(document.querySelectorAll('button, li, label, [role="radio"], [role="button"], div, a'))
      .filter(isVisible)
      .filter((el) => {
        const t = textOf(el);
        if (!t || t.length > limit) return false;
        if (!re.test(t)) return false;
        // 排除包裹多个选项的父容器
        const inner = Array.from(el.querySelectorAll('*')).filter((c) => isVisible(c) && re.test(textOf(c)));
        return inner.length === 0;
      });

    // 真正的可点卡片优先（有 aria-checked 的、语义标签的），纯 div 排后面
    const rank = (el) => {
      if (el.hasAttribute('aria-checked') || el.getAttribute('role') === 'radio') return 0;
      const tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'LI' || tag === 'LABEL') return 1;
      return 2;
    };
    return all.sort((a, b) => rank(a) - rank(b));
  };

  AF.handleInvoiceStep = async function (cfg, log) {
    const inv = cfg.invoice || {};
    const type = inv.type || 'personal';

    const cards = AF.findOptionCards(/电子发票|增值税专用发票|发票/, 26)
      .filter((el) => !/发票抬头|选填/.test(textOf(el)));

    let target = null;
    if (type === 'company') target = cards.find((el) => /公司|其他/.test(textOf(el)));
    else if (type === 'vat') target = cards.find((el) => /增值税专用/.test(textOf(el)));
    if (!target) target = cards.find((el) => /个人/.test(textOf(el)));
    if (!target) target = cards[0];

    if (target) {
      const label = textOf(target).slice(0, 16);
      const selected = target.getAttribute('aria-checked') === 'true' || /selected|active|checked/.test(target.className || '');
      if (!selected) {
        AF.realClick(target);
        if (log) log('已选发票类型：' + label);
        await sleep(700);
      } else if (log) {
        log('发票类型已是「' + label + '」');
      }
    }

    // 抬头 / 税号（公司类型才需要）
    await AF.fillStep(cfg, log);

    if (type !== 'personal' && !inv.title && log) {
      log('⚠️ 选了公司发票但没填发票抬头，可能过不了校验', 'warn');
    }
    return true;
  };

  /* ---------------- 第 3 页：支付方式 ---------------- */
  // 取控件的可读文本：label[for] / 包裹 label / aria-labelledby / aria-label / 所在卡片
  AF.labelTextFor = function (el) {
    const parts = [];
    if (el.id) {
      try {
        const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (l) parts.push(textOf(l));
      } catch (e) { /* ignore */ }
    }
    const wrap = el.closest('label');
    if (wrap) parts.push(textOf(wrap));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      lb.split(/\s+/).forEach((id) => {
        const n = document.getElementById(id);
        if (n) parts.push(textOf(n));
      });
    }
    const al = el.getAttribute('aria-label');
    if (al) parts.push(al);
    const card = el.closest('li, [role="radio"], [data-autom], div');
    if (card) parts.push(textOf(card).slice(0, 80));
    return parts.filter(Boolean).join(' | ');
  };

  // autom / value 是 Apple 结账页的真实标识（2026-10 实测）：
  //   <input type="radio" data-autom="checkout-billingOptions-WECHAT" value="WECHAT" id="checkout.billing.billingoptions.wechat">
  // radio 视觉隐藏、label 里只有 logo 没有文字，所以必须按属性精确匹配
  const PAY_RULES = {
    wechat: { hit: /微信支付|wechat\s*pay/i, miss: /分付|分期|fenfu/i, name: '微信支付', autom: /billingOptions-WECHAT$/i, value: /^WECHAT$/i },
    alipay: { hit: /支付宝|alipay/i, miss: /花呗|分期/i, name: '支付宝', autom: /billingOptions-ALIPAY$/i, value: /^ALIPAY$/i },
    card: { hit: /信用卡|银行卡|credit\s*card/i, miss: null, name: '信用卡', autom: /billingOptions-CREDIT$/i, value: /^CREDIT$/i }
  };
  AF.PAY_RULES = PAY_RULES;

  // 按 data-autom / value 精确找支付方式 radio
  AF.findExactPaymentRadios = function (rule) {
    return AF.deepQueryAll('input[type="radio"]').filter((r) =>
      (rule.autom && rule.autom.test(r.getAttribute('data-autom') || '')) ||
      (rule.value && rule.value.test(r.value || '')));
  };

  // 判断「微信支付」看起来是否已被选中
  AF.paymentLooksSelected = function (rule) {
    if (AF.findExactPaymentRadios(rule).some((r) => r.checked)) return true;
    const okMeta = (s) => !!s && rule.hit.test(s) && !(rule.miss && rule.miss.test(s));
    for (const r of AF.deepQueryAll('input[type="radio"]')) {
      const meta = [r.value, r.id, r.name, r.getAttribute('data-autom') || '', AF.labelTextFor(r)].join(' ');
      if (okMeta(meta) && r.checked) return true;
    }
    for (const t of AF.findTextNodes(rule.hit, 24)) {
      if (rule.miss && rule.miss.test(t.text)) continue;
      let el = t.el;
      for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
        if (el.getAttribute('aria-checked') === 'true') return true;
        const cls = typeof el.className === 'string' ? el.className : '';
        if (/selected|active|checked|is-on/i.test(cls)) return true;
      }
    }
    return false;
  };

  AF.choosePayment = async function (method, log) {
    const want = method || 'wechat';
    const rule = PAY_RULES[want] || PAY_RULES.wechat;
    const hit = (s) => !!s && rule.hit.test(s) && !(rule.miss && rule.miss.test(s));

    // ⓪ 按 Apple 真实的 data-autom / value 精确匹配（最可靠）
    for (const r of AF.findExactPaymentRadios(rule)) {
      if (r.checked) { if (log) log('支付方式已是「' + rule.name + '」'); return true; }
      AF.realClick(r); // 隐藏的 radio 也能用原生 click 选中，并派发 click/input/change
      await sleep(300);
      if (!r.checked && r.id) {
        let lab = null;
        try { lab = document.querySelector('label[for="' + CSS.escape(r.id) + '"]'); } catch (e) { /* ignore */ }
        if (lab) { AF.realClick(lab); await sleep(300); }
      }
      if (!r.checked) {
        const box = r.closest('.form-selector, li, [role="radio"]');
        if (box) { AF.realClick(box); await sleep(300); }
      }
      if (r.checked) {
        if (log) log('已选择支付方式：' + rule.name);
        await sleep(400); // 选中后下方会展开说明，等页面重新渲染
        return true;
      }
    }

    // ① 原生 radio（含 Shadow DOM 里的）
    for (const r of AF.deepQueryAll('input[type="radio"]')) {
      const meta = [r.value, r.id, r.name, r.getAttribute('data-autom') || '', AF.labelTextFor(r)].join(' ');
      if (!hit(meta)) continue;
      if (r.checked) { if (log) log('支付方式已是「' + rule.name + '」'); return true; }
      AF.realClick(r);
      r.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(400);
      if (r.checked) { if (log) log('已选择支付方式：' + rule.name); return true; }
      if (r.id) {
        let lab = null;
        try { lab = document.querySelector('label[for="' + CSS.escape(r.id) + '"]'); } catch (e) { /* ignore */ }
        if (lab) {
          AF.realClick(lab);
          await sleep(400);
          if (r.checked) { if (log) log('已选择支付方式：' + rule.name); return true; }
        }
      }
    }

    // ② 按 data-autom / id / name 里出现的 wechat 之类直接找
    const byMeta = AF.deepQueryAll('[data-autom], [id], [name]').filter((el) => {
      const meta = (el.getAttribute('data-autom') || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('name') || '');
      return hit(meta);
    });
    if (byMeta.length) {
      const el = byMeta[0];
      const box = el.closest('li, label, [role="radio"]') || el;
      AF.realClick(box);
      if (log) log('已选择支付方式：' + rule.name);
      await sleep(600);
      return true;
    }

    // ③ 按文本节点找（不限定标签，div / td / span 都能捞）
    const texts = AF.findTextNodes(rule.hit, 24).filter((t) => !(rule.miss && rule.miss.test(t.text)));
    if (texts.length) {
      const t = texts[0];
      AF.realClick(t.el);
      await sleep(500);
      if (AF.paymentLooksSelected(rule)) {
        if (log) log('已选择支付方式：' + rule.name);
        return true;
      }

      // ④ 还没选上 → 按坐标点一下（等同真人鼠标落点）
      const r = t.rect;
      const pts = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 8, r.top + r.height / 2]
      ];
      for (const [x, y] of pts) {
        const el = AF.clickAtPoint(Math.round(x), Math.round(y));
        if (!el) continue;
        await sleep(450);
        if (AF.paymentLooksSelected(rule)) {
          if (log) log('已选择支付方式：' + rule.name + '（坐标点击）');
          return true;
        }
      }

      if (log) log('已点击「' + t.text + '」，但无法确认选中状态（若没选上请手动点一下）', 'warn');
      return true;
    }

    // 失败时把现场信息打出来，方便排查
    if (log) {
      const radios = AF.deepQueryAll('input[type="radio"]');
      const labels = radios.map((r) => AF.labelTextFor(r).split(' | ')[0]).filter(Boolean).slice(0, 8);
      log('没找到「' + rule.name + '」选项' + (labels.length ? '（单选项：' + labels.join(' / ') + '）' : '（页面上既没有单选项，也没有含「' + rule.name + '」的文字）'), 'warn');
    }
    return false;
  };

  // 页面上是否已经有任何支付方式被选中（用于「手动选」模式判断能不能往下走）
  AF.anyPaymentSelected = function () {
    if (AF.deepQueryAll('input[type="radio"]').some((r) => r.checked)) return true;
    const nodes = document.querySelectorAll('[aria-checked="true"], [aria-selected="true"]');
    for (const n of nodes) {
      const t = textOf(n);
      if (t && t.length < 40 && /微信|支付宝|信用卡|分期|支付|pay/i.test(t)) return true;
    }
    return false;
  };

  AF.handlePaymentStep = async function (cfg, log) {
    const p = cfg.payment || {};
    const method = p.method || 'wechat';
    const mode = p.mode || 'manual';

    // 手动模式：支付方式由用户自己点，扩展只负责点「检查订单」
    if (mode === 'manual') {
      const ready = AF.anyPaymentSelected() || AF.paymentLooksSelected(PAY_RULES[method] || PAY_RULES.wechat);
      if (!ready && !AF.payPrompted) {
        AF.payPrompted = true;
        if (log) {
          log('支付方式请你手动点一下「' + (PAY_RULES[method] || PAY_RULES.wechat).name + '」', 'warn');
          log('点好之后按 Alt+Q（或点面板的「我已选好」），我来点「检查订单」');
        }
        return 'manual-wait';
      }
      if (log) log('继续点「检查订单」');
      return true;
    }

    const ok = await AF.choosePayment(method, log);
    return ok;
  };

  /* ---------------- 单步填写 ---------------- */
  AF.fillStep = async function (config, log) {
    const cfg = config || {};
    const delay = (cfg.behavior && cfg.behavior.delayMs) || 120;
    const fields = AF.collectFields(cfg);
    const done = [];

    // 1) 省市区优先，触发级联加载
    const order = ['province', 'city', 'district', 'name', 'lastName', 'firstName', 'phone', 'email', 'idCard', 'idLast4',
      'street', 'street2', 'postal', 'company', 'invoiceTitle', 'taxNo'];

    const byKey = new Map(fields.map((f) => [f.key, f]));

    for (const key of order) {
      const f = byKey.get(key);
      if (!f) continue;

      if (f.el.tagName === 'SELECT') {
        const ok = await AF.fillSelect(f.el, f.value);
        if (!ok) {
          const ok2 = await AF.fillCustomDropdown(key, f.value);
          if (ok2) done.push(key);
        } else {
          done.push(key);
          if (key === 'province' || key === 'city') await sleep(350); // 等下一级开始加载
        }
      } else {
        const ok = await AF.fillText(f.el, f.value);
        if (ok) done.push(key);
      }
      await sleep(delay);
    }

    // 2) 取货门店 / 时间（旧的搜索式门店选择器，兼容老版本页面）
    if (cfg.mode === 'pickup') {
      const pk = cfg.pickup || {};
      if (pk.autoSelectStore !== false) await AF.handleStoreLocator(pk, log);
      if (pk.autoPickTime !== false) await AF.pickFirstAvailableWindow(log);
    }

    if (log) {
      const names = { name: '姓名', lastName: '姓', firstName: '名', phone: '手机号', email: '邮箱', province: '省', city: '市', district: '区', street: '街道地址', street2: '地址2', postal: '邮编', company: '公司', idCard: '身份证', idLast4: '证件后四位', invoiceTitle: '发票抬头', taxNo: '税号' };
      log(done.length ? '已填：' + done.map((k) => names[k] || k).join('、') : '本页没有可填字段');
    }
    return done;
  };

  /* ---------------- 检查订单页：可选自动下单 ---------------- */
  const ORDER_ONCE_MS = 90 * 1000; // 90 秒内只允许点一次「立即下单」，防重复下单

  AF.findPlaceOrderButton = function () {
    const cands = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((el) => isVisible(el) && isEnabled(el));
    return cands.find((el) => /placeOrder|place-order/i.test(el.getAttribute('data-autom') || '') && /下单/.test(textOf(el))) ||
      cands.find((el) => textOf(el) === '立即下单') || null;
  };

  // 返回 stopReason：ready-to-order（停手）/ order-placed（已下单）/ order-pending（点了但没确认）
  AF.handleReviewStep = async function (cfg, log) {
    const b = (cfg && cfg.behavior) || {};
    if (!b.autoPlaceOrder || b.clickNext === false) {
      log('已到检查订单页，等你点「立即下单」');
      return 'ready-to-order';
    }
    if (AF.detectPageType() !== 'review') return 'ready-to-order';

    if (AF.lastOrderClickAt && Date.now() - AF.lastOrderClickAt < ORDER_ONCE_MS) {
      log('刚才已经点过「立即下单」，为防止重复下单不再点击，请看页面结果', 'warn');
      return 'order-pending';
    }
    const btn = AF.findPlaceOrderButton();
    if (!btn) {
      log('没找到可点的「立即下单」按钮，请手动点击', 'warn');
      return 'ready-to-order';
    }

    const sig = AF.pageSignature();
    AF.lastOrderClickAt = Date.now();
    btn.click();
    log('已点击「立即下单」');
    const changed = await AF.waitStepChange(20000, sig, { button: btn, label: textOf(btn).slice(0, 16) });
    if (changed && AF.detectPageType() !== 'review') {
      log('订单已提交，请按页面提示完成付款');
      return 'order-placed';
    }
    log('点了「立即下单」但页面还没跳转，不要重复点，先看页面有没有报错', 'warn');
    return 'order-pending';
  };

  /* ---------------- 交接下单：购物袋 ---------------- */
  // 监控程序发现有货后打开购物袋，由这里点「结账」，之后走主流程
  AF.findCheckoutButton = function () {
    const sel = '[data-autom="checkout"], button[name="checkout"], [data-autom="bag-checkout-button"]';
    const byAttr = Array.from(document.querySelectorAll(sel)).find((el) => isVisible(el) && isEnabled(el));
    if (byAttr) return byAttr;
    return Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .filter((el) => isVisible(el) && isEnabled(el))
      .find((el) => /^结账$/.test(textOf(el))) || null;
  };

  /* ---------------- 主流程 ---------------- */
  // 流程：取货日期/门店 → 取货联系人 → 发票 → 支付方式 → 检查订单页（默认停手；开了自动下单就点一次「立即下单」）
  AF.run = async function (config, hooks) {
    const cfg = config || {};
    const h = hooks || {};
    const log = h.log || function () {};
    const onStatus = h.onStatus || function () {};
    const b = cfg.behavior || {};
    const maxSteps = Math.min(b.maxSteps || 6, 10);

    let steps = 0;
    let stopReason = 'done';
    let sameCount = 0;

    onStatus('running');
    try {
      for (steps = 1; steps <= maxSteps; steps++) {
        const pageType = AF.detectPageType();
        log('当前页面：' + PAGE_NAMES[pageType]);
        // 离开支付页就重置「已提示手动选」的标记
        if (pageType !== 'payment') AF.payPrompted = false;

        // 检查订单页：默认停手；开了「自动下单」才点一次「立即下单」
        if (pageType === 'review') {
          stopReason = await AF.handleReviewStep(cfg, log);
          break;
        }

        const gate = AF.detectGate();
        if (gate) {
          log(gate.msg);
          stopReason = gate.type;
          break;
        }

        if (pageType === 'pickup-date') {
          await AF.handlePickupDateStep(cfg, log);
        } else if (pageType === 'pickup-contact') {
          await AF.handlePickupContactStep(cfg, log);
        } else if (pageType === 'invoice') {
          await AF.handleInvoiceStep(cfg, log);
        } else if (pageType === 'payment') {
          const payRes = await AF.handlePaymentStep(cfg, log);
          if (payRes === 'manual-wait') { stopReason = 'manual-pay'; break; }
          if (!payRes) {
            log('支付方式没选上，已停手。手动点一下再按 Alt+Q 即可');
            stopReason = 'need-manual';
            break;
          }
        } else {
          // 兼容：还没进入取货流程时的配送/地址页
          await AF.chooseFulfillment(cfg.mode || 'pickup', log);
          await AF.fillStep(cfg, log);
        }

        if (b.clickNext === false) { stopReason = 'filled'; break; }

        const next = AF.findNextButton(pageType);
        if (!next) {
          log('没找到继续按钮，已停手');
          stopReason = 'no-next';
          break;
        }

        const label = textOf(next).slice(0, 16);
        if (!(await AF.waitEnabled(next))) {
          log('「' + label + '」一直是灰的，可能有必填项没通过校验');
          stopReason = 'stuck';
          break;
        }
        // 点击前再查一次：等待期间可能已经到了检查订单页
        if (AF.detectPageType() === 'review') {
          stopReason = await AF.handleReviewStep(cfg, log);
          break;
        }
        // 不在检查订单页却找到了下单类按钮 → 页面识别不可信，停手
        if (AF.isForbiddenButton(next)) {
          log('已到下单环节，停手等你操作');
          stopReason = 'ready-to-order';
          break;
        }
        const sigBefore = AF.pageSignature();
        next.click();
        log('点击「' + label + '」');

        // 支付页如果没选支付方式，点「检查订单」不会跳转，不用等太久
        const changed = await AF.waitStepChange(pageType === 'payment' ? 8000 : 14000, sigBefore, { button: next, label });
        if (!changed) {
          log('页面没有变化，可能卡在必填校验');
          stopReason = 'stuck';
          break;
        }

        // 检查订单页要先于付款闸门判断：页面上的「立即下单」按钮本身会命中闸门
        if (AF.detectPageType() === 'review') {
          stopReason = await AF.handleReviewStep(cfg, log);
          break;
        }

        const gate2 = AF.detectGate();
        if (gate2) {
          log(gate2.msg);
          stopReason = gate2.type;
          break;
        }

        if (!b.autoAdvance) { stopReason = 'filled'; break; }

        // 同一类页面连续出现 3 次，说明在原地打转，停下来别重复提交
        const nowType = AF.detectPageType();
        if (nowType !== 'unknown' && nowType === pageType) {
          sameCount++;
          if (sameCount >= 2) {
            log('「' + PAGE_NAMES[nowType] + '」重复出现，可能有校验没过，已停手', 'warn');
            stopReason = 'stuck';
            break;
          }
        } else sameCount = 0;
      }
    } catch (err) {
      log('出错：' + (err && err.message ? err.message : err));
      stopReason = 'error';
    }

    const statusMap = { 'ready-to-order': 'ready-to-order', payment: 'ready-to-pay', done: 'done' };
    onStatus(statusMap[stopReason] || stopReason);
    return { steps, stopReason };
  };

  /* ---------------- 学习模式：导出本页结构 ---------------- */
  AF.inspect = function () {
    const fields = [];
    for (const el of Array.from(document.querySelectorAll('input, select, textarea'))) {
      const type = String(el.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'image'].includes(type)) continue;
      const h = hintsFor(el);
      fields.push({
        tag: el.tagName.toLowerCase(),
        type: type || '',
        autom: el.getAttribute('data-autom') || '',
        name: el.name || '',
        id: el.id || '',
        placeholder: el.getAttribute('placeholder') || '',
        strong: h.strong,
        weak: h.weak,
        key: detectKey(h.strong) || detectKey(h.weak) || '',
        value: el.value || '',
        visible: isVisible(el)
      });
    }

    // 单选项（含视觉隐藏的）
    const radios = AF.deepQueryAll('input[type="radio"]').map((r) => ({
      id: r.id || '',
      name: r.name || '',
      value: r.value || '',
      autom: r.getAttribute('data-autom') || '',
      checked: !!r.checked,
      label: AF.labelTextFor(r).slice(0, 60),
      visible: isVisible(r)
    }));

    // 含支付关键词的文本节点，连它往上三层的标签/class/role 一起导出
    const PAY_RE = /微信|支付|wechat|alipay|支付宝|信用卡|分期/;
    const textHits = AF.findTextNodes(PAY_RE, 24).slice(0, 40).map((t) => {
      const chain = [];
      let p = t.el;
      for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
        const cls = typeof p.className === 'string' ? p.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        chain.push(
          p.tagName.toLowerCase() +
          (cls ? '.' + cls : '') +
          (p.getAttribute('role') ? '[role=' + p.getAttribute('role') + ']' : '') +
          (p.hasAttribute('aria-checked') ? '[aria-checked=' + p.getAttribute('aria-checked') + ']' : '') +
          (p.getAttribute('data-autom') ? '[autom=' + p.getAttribute('data-autom') + ']' : '')
        );
      }
      const r = t.rect;
      return {
        text: t.text,
        tag: t.el.tagName.toLowerCase(),
        autom: t.el.getAttribute('data-autom') || '',
        cls: (typeof t.el.className === 'string' ? t.el.className : '').slice(0, 60),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        chain
      };
    });

    const iframes = Array.from(document.querySelectorAll('iframe')).map((f) => f.src || '(no src)').slice(0, 5);
    const shadowHosts = Array.from(document.querySelectorAll('*'))
      .filter((el) => el.shadowRoot)
      .map((el) => el.tagName.toLowerCase())
      .slice(0, 5);

    return { fields, radios, textHits, iframes, shadowHosts };
  };

  window.__AF = AF;
})();
