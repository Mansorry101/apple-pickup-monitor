/* options.js */
const DEFAULTS = window.__AF_DEFAULTS; // 来自 defaults.js

const KEY_LABELS = {
  '': '（不填）',
  name: '姓名', lastName: '姓', firstName: '名',
  phone: '手机号', email: '邮箱', idCard: '身份证号', idLast4: '身份证后四位',
  province: '省', city: '市', district: '区/县',
  street: '街道地址', street2: '地址第二行', postal: '邮编', company: '公司/单位',
  invoiceTitle: '发票抬头', taxNo: '税号'
};

let config = JSON.parse(JSON.stringify(DEFAULTS));
let saveTimer = null;

const $ = (id) => document.getElementById(id);
const toast = (msg) => {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 1800);
};

const merge = window.__AF_MERGE;

/* ---------- 表单绑定 ---------- */
const TEXT_FIELDS = [
  ['name', (c) => c.name],
  ['firstName', (c) => c.firstName],
  ['lastName', (c) => c.lastName],
  ['phone', (c) => c.phone],
  ['email', (c) => c.email],
  ['idCard', (c) => c.idCard],
  ['province', (c) => c.province],
  ['city', (c) => c.city],
  ['district', (c) => c.district],
  ['street', (c) => c.street],
  ['street2', (c) => c.street2],
  ['postal', (c) => c.postal],
  ['company', (c) => c.company],
  ['storeKeyword', (c) => c.pickup.storeKeyword],
  ['storeName', (c) => c.pickup.storeName],
  ['idLast4', (c) => c.pickup.idLast4],
  ['datePreference', (c) => c.pickup.datePreference],
  ['contactName', (c) => c.pickup.contactName],
  ['contactPhone', (c) => c.pickup.contactPhone],
  ['invoiceTitle', (c) => c.invoice.title],
  ['invoiceTaxNo', (c) => c.invoice.taxNo],
  ['delayMs', (c) => c.behavior.delayMs],
  ['maxSteps', (c) => c.behavior.maxSteps]
];

const CHECK_FIELDS = [
  ['autoSelectStore', (c) => c.pickup.autoSelectStore],
  ['autoPickTime', (c) => c.pickup.autoPickTime],
  ['useDifferentContact', (c) => c.pickup.useDifferentContact],
  ['clickNext', (c) => c.behavior.clickNext],
  ['autoAdvance', (c) => c.behavior.autoAdvance],
  ['autoPlaceOrder', (c) => c.behavior.autoPlaceOrder],
  ['autoStart', (c) => c.behavior.autoStart]
];

function fillForm() {
  TEXT_FIELDS.forEach(([id, get]) => { const el = $(id); if (el) el.value = get(config) ?? ''; });
  CHECK_FIELDS.forEach(([id, get]) => { const el = $(id); if (el) el.checked = !!get(config); });
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === config.mode));
  document.querySelectorAll('#paySeg button').forEach((b) => b.classList.toggle('on', b.dataset.pay === (config.payment.method || 'wechat')));
  document.querySelectorAll('#payModeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.paymode === (config.payment.mode || 'auto')));
  document.querySelectorAll('#invSeg button').forEach((b) => b.classList.toggle('on', b.dataset.inv === (config.invoice.type || 'personal')));
  syncVisibility();
}

function syncVisibility() {
  $('addrCard').style.display = config.mode === 'delivery' ? '' : 'none';
  $('pickupCard').style.display = config.mode === 'pickup' ? '' : 'none';
  $('contactBox').style.display = config.pickup.useDifferentContact ? '' : 'none';
  $('invoiceBox').style.display = (config.invoice.type && config.invoice.type !== 'personal') ? '' : 'none';
  renumber();
}

// 隐藏的卡片不占编号，避免出现「3 不见了」
function renumber() {
  let i = 0;
  document.querySelectorAll('main > section.card').forEach((sec) => {
    const h = sec.querySelector('h2');
    if (!h) return;
    if (!h.dataset.title) h.dataset.title = h.textContent.replace(/^\d+\.\s*/, '');
    if (sec.style.display === 'none') { h.textContent = h.dataset.title; return; }
    i++;
    h.textContent = i + '. ' + h.dataset.title;
  });
}

function collect() {
  TEXT_FIELDS.forEach(([id, get]) => {
    const el = $(id);
    if (!el) return;
    const isNum = el.type === 'number';
    const v = el.value.trim();
    // 写回配置
    const path = {
      storeKeyword: 'pickup', storeName: 'pickup',
      idLast4: 'pickup', datePreference: 'pickup',
      contactName: 'pickup', contactPhone: 'pickup',
      invoiceTitle: 'invoice', invoiceTaxNo: 'invoice', delayMs: 'behavior', maxSteps: 'behavior'
    }[id];
    const value = isNum ? Number(v || 0) : v;
    if (id === 'invoiceTitle') config.invoice.title = value;
    else if (id === 'invoiceTaxNo') config.invoice.taxNo = value;
    else if (!path) config[id] = value;
    else config[path][id] = value;
  });
  CHECK_FIELDS.forEach(([id]) => {
    const el = $(id);
    if (!el) return;
    const path = { autoSelectStore: 'pickup', autoPickTime: 'pickup', useDifferentContact: 'pickup' }[id];
    if (path) config[path][id] = el.checked;
    else config.behavior[id] = el.checked;
  });
}

function scheduleSave() {
  collect();
  syncVisibility();
  $('saveState').textContent = '保存中…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ afConfig: config }, () => {
      $('saveState').textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
    });
  }, 250);
}

/* ---------- 字段映射表 ---------- */
function selectorFor(f) {
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'));
  if (f.autom) return '[data-autom="' + String(f.autom).replace(/"/g, '\\"') + '"]';
  if (f.id) return '#' + esc(f.id);
  if (f.name) return '[name="' + String(f.name).replace(/"/g, '\\"') + '"]';
  return '';
}

function renderInspect() {
  chrome.storage.local.get(['afLastInspect'], (res) => {
    const data = res && res.afLastInspect;
    const tbody = $('inspectTable').querySelector('tbody');
    tbody.innerHTML = '';
    if (!data || !data.fields || !data.fields.length) {
      $('inspectInfo').textContent = '还没有记录：打开 Apple 结账页，点悬浮按钮里的「记录本页字段」';
      return;
    }
    $('inspectInfo').textContent = '来自 ' + new Date(data.at).toLocaleString('zh-CN', { hour12: false }) + ' · ' + data.fields.length + ' 个字段';

    const overrides = config.overrides || [];
    data.fields.forEach((f) => {
      const sel = selectorFor(f);
      const ov = overrides.find((o) => o.selector === sel);
      const cur = ov ? ov.key : (f.key || '');

      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.className = 'mono';
      td1.textContent = f.strong || f.weak || f.tag;
      td1.title = (f.strong || '') + ' | ' + (f.weak || '');

      const td2 = document.createElement('td');
      td2.textContent = f.key ? KEY_LABELS[f.key] || f.key : '未识别';
      td2.style.color = f.key ? '' : '#b25000';

      const td3 = document.createElement('td');
      const selEl = document.createElement('select');
      Object.entries(KEY_LABELS).forEach(([k, label]) => {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = label;
        if (k === cur) o.selected = true;
        selEl.appendChild(o);
      });
      selEl.onchange = () => {
        config.overrides = (config.overrides || []).filter((o) => o.selector !== sel);
        if (selEl.value) config.overrides.push({ selector: sel, key: selEl.value });
        scheduleSave();
        toast('映射已更新');
      };
      td3.appendChild(selEl);

      tr.append(td1, td2, td3);
      tbody.appendChild(tr);
    });
  });
}

/* ---------- 事件 ---------- */
document.querySelectorAll('#modeSeg button').forEach((b) => {
  b.onclick = () => {
    config.mode = b.dataset.mode;
    document.querySelectorAll('#modeSeg button').forEach((x) => x.classList.toggle('on', x === b));
    syncVisibility();
    scheduleSave();
  };
});

document.querySelectorAll('#paySeg button').forEach((b) => {
  b.onclick = () => {
    config.payment = config.payment || {};
    config.payment.method = b.dataset.pay;
    document.querySelectorAll('#paySeg button').forEach((x) => x.classList.toggle('on', x === b));
    scheduleSave();
  };
});

document.querySelectorAll('#payModeSeg button').forEach((b) => {
  b.onclick = () => {
    config.payment = config.payment || {};
    config.payment.mode = b.dataset.paymode;
    document.querySelectorAll('#payModeSeg button').forEach((x) => x.classList.toggle('on', x === b));
    scheduleSave();
  };
});

document.querySelectorAll('#invSeg button').forEach((b) => {
  b.onclick = () => {
    config.invoice = config.invoice || {};
    config.invoice.type = b.dataset.inv;
    document.querySelectorAll('#invSeg button').forEach((x) => x.classList.toggle('on', x === b));
    syncVisibility();
    scheduleSave();
  };
});

[...TEXT_FIELDS.map((x) => x[0]), ...CHECK_FIELDS.map((x) => x[0])].forEach((id) => {
  const el = $(id);
  if (!el) return;
  el.addEventListener('input', scheduleSave);
  el.addEventListener('change', scheduleSave);
});

// 自动下单会真实提交订单，打开时确认一次
$('autoPlaceOrder').addEventListener('change', (e) => {
  if (e.target.checked && !confirm('开启后，扩展到检查订单页会自动点「立即下单」，这会真实提交订单。\n\n确定开启？')) {
    e.target.checked = false;
    scheduleSave();
  }
}, true);

$('refreshInspect').onclick = renderInspect;

$('exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'apple-checkout-config.json';
  a.click();
  URL.revokeObjectURL(a.href);
};

$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      config = merge(DEFAULTS, obj);
      fillForm();
      scheduleSave();
      toast('导入成功');
    } catch (err) {
      toast('文件格式不对');
    }
  };
  reader.readAsText(file);
};

$('clearBtn').onclick = () => {
  if (!confirm('确定清空所有已保存的收货信息？')) return;
  config = JSON.parse(JSON.stringify(DEFAULTS));
  chrome.storage.local.remove(['afConfig', 'afLastInspect'], () => {
    fillForm();
    renderInspect();
    toast('已清空');
  });
};

/* ---------- 启动 ---------- */
chrome.storage.local.get(['afConfig'], (res) => {
  if (res && res.afConfig) config = merge(DEFAULTS, res.afConfig);
  fillForm();
  renderInspect();
  if (new URLSearchParams(location.search).get('welcome')) {
    toast('先填好下面的信息，抢购时点悬浮按钮即可');
  }
});
