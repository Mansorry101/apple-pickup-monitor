/**
 * 设置界面的 HTML（单页，无外部依赖、无 CDN，离线可用）。
 * 客户端 JS 刻意不用模板字符串，避免与外层模板字面量冲突。
 *
 * 交互：全部走下拉框 —— 先选城市，再选门店；机型 → 容量 → 颜色。
 */
export const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Apple 取货监控 · 设置</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; background:#f5f5f7; color:#1d1d1f;
    font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;
    font-size:14px; line-height:1.5; }
  .wrap { max-width:920px; margin:0 auto; padding:24px 16px 64px; }
  header { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
  h1 { font-size:21px; margin:0; letter-spacing:-.2px; }
  .sub { color:#6e6e73; font-size:12.5px; margin-top:2px; }
  .card { background:#fff; border:1px solid #e5e5e7; border-radius:14px; padding:18px 20px; margin-bottom:14px; }
  .card h2 { font-size:14px; margin:0 0 4px; }
  .card .hint { color:#86868b; font-size:12px; margin-bottom:14px; }
  .picker { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
  .picker .fl { display:flex; flex-direction:column; gap:4px; }
  .picker .fl > span { font-size:11.5px; color:#86868b; }
  select, input[type=number], input[type=text] { border:1.5px solid #e0e0e3; border-radius:9px; padding:7px 11px; font-size:13px; font-family:inherit; background:#fff; color:inherit; max-width:100%; }
  select:focus, input:focus { outline:none; border-color:#0071e3; }
  select:disabled { background:#f5f5f7; color:#a1a1a6; }
  input[type=number] { width:84px; }
  .btn { border:0; border-radius:10px; padding:9px 18px; font-size:13.5px; font-weight:600; cursor:pointer; font-family:inherit; white-space:nowrap; }
  .btn.primary { background:#0071e3; color:#fff; }
  .btn.primary:hover { background:#0062c4; }
  .btn.ghost { background:#f0f0f2; color:#1d1d1f; }
  .btn.ghost:hover { background:#e5e5e7; }
  .btn.sm { padding:6px 13px; font-size:12.5px; }
  .btn:disabled { opacity:.45; cursor:default; }
  .actions { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:16px; }
  .row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; justify-content:space-between; padding:9px 0; border-top:1px solid #f0f0f2; }
  .row:first-of-type { border-top:0; }
  .row .d { color:#86868b; font-size:12px; }
  .list { display:flex; flex-direction:column; gap:8px; }
  .item { display:flex; align-items:center; justify-content:space-between; gap:10px; background:#fafafa; border:1px solid #ececef; border-radius:10px; padding:9px 13px; }
  .item .meta { color:#86868b; font-size:11.5px; }
  .item .x { border:0; background:#ffe9e9; color:#c00; border-radius:7px; padding:4px 10px; cursor:pointer; font-size:12px; white-space:nowrap; }
  .item.pri { background:#f0f7ff; border-color:#cfe4ff; }
  .tag { display:inline-block; background:#0071e3; color:#fff; font-size:10.5px; padding:1px 7px; border-radius:999px; margin-left:6px; vertical-align:1px; }
  .tag.gray { background:#c7c7cc; }
  .empty { color:#86868b; font-size:13px; padding:12px 0; }
  .status { display:flex; gap:18px; flex-wrap:wrap; font-size:12.5px; color:#6e6e73; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; vertical-align:1px; }
  .ok { background:#34c759; } .warn { background:#ff9f0a; } .err { background:#ff3b30; } .idle { background:#c7c7cc; }
  .res { display:flex; justify-content:space-between; gap:10px; padding:8px 0; border-top:1px solid #f0f0f2; flex-wrap:wrap; }
  .res:first-child { border-top:0; }
  .res .hit { color:#1d7a3d; font-weight:600; }
  .res .miss { color:#86868b; }
  pre.logs { background:#1d1d1f; color:#d6d6d6; border-radius:10px; padding:12px; max-height:300px; overflow:auto; font-size:11.5px; line-height:1.6; white-space:pre-wrap; word-break:break-all; margin:0; }
  #toast { position:fixed; left:50%; bottom:28px; transform:translateX(-50%) translateY(20px); background:#1d1d1f; color:#fff; padding:11px 22px; border-radius:11px; font-size:13.5px; opacity:0; pointer-events:none; transition:.22s; z-index:99; max-width:90vw; }
  #toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
  .mailbox { background:#fafafa; border:1px solid #ececef; border-radius:10px; padding:11px 13px; font-size:13px; }
  .warnbox { background:#fff8e1; border-left:3px solid #ff9f0a; border-radius:8px; padding:11px 13px; font-size:12.5px; margin-bottom:14px; }
  .infobox { background:#f0f7ff; border-left:3px solid #0071e3; border-radius:8px; padding:11px 13px; font-size:12.5px; margin-bottom:14px; }
  .addr { color:#6e6e73; font-size:12.5px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>Apple 取货监控 · 设置</h1>
      <div class="sub">中国大陆 / 香港 Apple Store 门市取货库存，有货时邮件通知</div>
    </div>
    <div class="status" style="margin:0">
      <span><span id="s-dot" class="dot idle"></span><span id="s-text">加载中…</span></span>
    </div>
  </header>

  <div id="catalog-warn"></div>

  <div class="card">
    <h2>1. 优先取货门店</h2>
    <div class="hint">先选城市，再选门店。这个门店一有货就立刻发「急」邮件。</div>
    <div class="picker">
      <label class="fl"><span>城市</span><select id="p-city"></select></label>
      <label class="fl"><span>门店</span><select id="p-store"></select></label>
    </div>
    <div class="addr" id="p-addr">—</div>
  </div>

  <div class="card">
    <h2>2. 同时监控的门店（可选）</h2>
    <div class="hint">这些门店有货时发「备选」邮件。留空则只监控上面的优先门店。</div>
    <div class="picker">
      <label class="fl"><span>城市</span><select id="w-city"></select></label>
      <label class="fl"><span>门店</span><select id="w-store"></select></label>
      <button class="btn ghost" id="btn-addstore" style="align-self:flex-end">添加门店</button>
    </div>
    <div id="w-list" class="list"></div>
  </div>

  <div class="card">
    <h2>3. 监控机型</h2>
    <div class="hint">先选机型，再选容量和颜色，然后点「添加」。同一款机型在大陆/香港的料号不同，程序会自动对应。</div>
    <div class="picker">
      <label class="fl"><span>机型</span><select id="m-family"></select></label>
      <label class="fl"><span>容量</span><select id="m-cap"></select></label>
      <label class="fl"><span>颜色</span><select id="m-color"></select></label>
      <button class="btn ghost" id="btn-addmodel" style="align-self:flex-end">添加</button>
      <button class="btn ghost" id="btn-addall" style="align-self:flex-end">添加该容量全部颜色</button>
    </div>
    <div class="actions" style="margin-top:6px">
      <button class="btn ghost sm" id="btn-refresh">↻ 刷新机型目录</button>
      <input type="text" id="manual-pn" placeholder="或手动输入料号，如 MJXU4ZA/A" style="width:230px">
      <button class="btn ghost sm" id="btn-manual">添加料号</button>
    </div>
  </div>

  <div class="card">
    <h2>4. 已选监控目标</h2>
    <div class="hint">这些是程序实际会盯的机型。留空则不会监控任何东西。</div>
    <div id="targets" class="list"></div>
  </div>

  <div class="card">
    <h2>5. 监控行为</h2>
    <div class="row">
      <div><label>轮询间隔</label><div class="d">多久查一次库存，建议 60 秒（最低 30 秒）</div></div>
      <div><input type="number" id="interval" min="30" max="3600"> 秒</div>
    </div>
    <div class="row">
      <div><label>只有优先门店有货才通知</label><div class="d">开启后，其他门店有货不再发「备选」邮件</div></div>
      <div><input type="checkbox" id="priorityOnly" style="width:18px;height:18px"></div>
    </div>
    <div class="row">
      <div><label>持续有货重复提醒</label><div class="d">优先门店一直有货时，每隔多久再提醒一次；0 = 只提醒一次</div></div>
      <div><input type="number" id="repeat" min="0" max="1440"> 分钟</div>
    </div>
    <div class="row">
      <div><label>库存消失时通知</label><div class="d">之前有货、现在没了，发一封收尾邮件</div></div>
      <div><input type="checkbox" id="soldOut" style="width:18px;height:18px"></div>
    </div>
  </div>

  <div class="card">
    <h2>6. 通知邮箱</h2>
    <div class="hint">邮箱凭据存在 .env 里，为安全起见不在此页面显示/修改。</div>
    <div class="mailbox" id="mailbox">—</div>
    <div class="actions">
      <button class="btn ghost" id="btn-testmail">发送测试邮件</button>
    </div>
  </div>

  <div class="actions" style="margin-bottom:18px">
    <button class="btn primary" id="btn-save">保存并生效</button>
    <button class="btn ghost" id="btn-check">立即检查一次</button>
    <span class="d" id="save-hint" style="color:#86868b;font-size:12.5px"></span>
  </div>

  <div class="card">
    <h2>运行状态</h2>
    <div class="hint" id="status-hint">—</div>
    <div id="results"></div>
  </div>

  <div class="card">
    <h2>运行日志</h2>
    <div class="hint">最近 120 行，每 20 秒自动刷新。</div>
    <pre class="logs" id="logs">加载中…</pre>
  </div>
</div>
<div id="toast"></div>

<script>
(function () {
  var state = { boot: null, dirty: false, timer: null };

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 2800);
  }
  function api(path, opts) {
    return fetch(path, opts || {}).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body.error || '请求失败');
        return body;
      });
    });
  }
  function post(path, body) {
    return api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }

  // ---------- 数据访问 ----------
  function dir() { return state.boot.directory || { regions: [], cities: [], stores: [] }; }
  function cat() { return state.boot.catalog || { families: [], variants: [] }; }
  function settings() { return state.boot.settings; }
  function markDirty() {
    state.dirty = true;
    renderStatus();
  }

  function storeById(id) {
    var list = dir().stores || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function cityByKey(k) {
    var list = dir().cities || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === k) return list[i];
    return null;
  }
  function cityKeyOfStore(s) { return s.region + ':' + s.city; }

  function variants() { return cat().variants || []; }
  function variantByKey(k) {
    var vs = variants();
    for (var i = 0; i < vs.length; i++) if (vs[i].key === k) return vs[i];
    return null;
  }
  function regionShort(r) {
    var rs = dir().regions || [];
    for (var i = 0; i < rs.length; i++) if (rs[i].id === r) return rs[i].short;
    return r;
  }
  function regionCurrency(r) {
    var rs = dir().regions || [];
    for (var i = 0; i < rs.length; i++) if (rs[i].id === r) return rs[i].currency;
    return '';
  }
  function money(n, cur) { return n ? cur + Number(n).toLocaleString('en-US') : ''; }

  function selectedRegions() {
    return Array.from(new Set(settings().watchStores.concat([settings().priorityStore]).map(function (id) {
      var store = storeById(id); return store ? store.region : null;
    }).filter(Boolean)));
  }
  function partsLabel(v) {
    if (!v || !v.parts) return '';
    var out = [];
    for (var r in v.parts) if (v.parts[r] && selectedRegions().indexOf(r) >= 0) out.push(regionShort(r) + ' ' + v.parts[r]);
    return out.join(' / ');
  }
  function priceLabel(v) {
    if (!v || !v.prices) return '';
    var out = [];
    for (var r in v.prices) if (v.prices[r] && selectedRegions().indexOf(r) >= 0) out.push(money(v.prices[r], regionCurrency(r)));
    return out.join(' / ');
  }
  function variantName(v) { return v ? (v.family + ' ' + v.capacity + ' ' + (v.colorZh || v.color)) : ''; }

  // ---------- 城市 / 门店下拉 ----------
  function cityOptgroups() {
    var regions = dir().regions || [];
    var cities = dir().cities || [];
    var html = '';
    regions.forEach(function (r) {
      var mine = cities.filter(function (c) { return c.region === r.id; });
      if (!mine.length) return;
      html += '<optgroup label="' + esc(r.label) + (r.onlineStore ? '' : '（不支持查询）') + '">';
      mine.forEach(function (c) {
        html += '<option value="' + esc(c.key) + '">' + esc(c.city) +
          (c.storeCount > 1 ? '（' + c.storeCount + ' 家）' : '') + '</option>';
      });
      html += '</optgroup>';
    });
    return html;
  }

  function fillCitySelect(sel, prefer) {
    sel.innerHTML = cityOptgroups();
    var keys = Array.prototype.map.call(sel.options, function (o) { return o.value; });
    if (prefer && keys.indexOf(prefer) >= 0) sel.value = prefer;
  }

  function storesOfCity(key) {
    return (dir().stores || []).filter(function (s) { return cityKeyOfStore(s) === key; });
  }

  function fillStoreSelect(sel, cityKey, prefer) {
    var list = storesOfCity(cityKey);
    var city = cityByKey(cityKey);
    var searchable = city && city.searchable;
    sel.innerHTML = list.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>';
    }).join('');
    sel.disabled = !searchable || !list.length;
    if (prefer && list.some(function (s) { return s.id === prefer; })) sel.value = prefer;
    return searchable;
  }

  // ---------- 渲染：监控门店选择器 ----------
  // 注意：这一对下拉框必须单独初始化。之前漏了，导致「同时监控的门店」
  // 里的城市/门店是空的 <select>，点开什么都不显示。
  function renderWatchPicker() {
    var pri = el('p-store').value || settings().priorityStore;
    var s = storeById(pri);
    var cur = el('w-city').value;
    // 默认和优先门店同一个城市（多数人想在同城再加一家）；否则用第一个城市
    var prefer = (cur && cityByKey(cur)) ? cur : (s ? cityKeyOfStore(s) : ((dir().cities || [])[0] || {}).key);
    fillCitySelect(el('w-city'), prefer);
    fillStoreSelect(el('w-store'), el('w-city').value);
  }

  // ---------- 渲染：优先门店 ----------
  function renderPriority() {
    var id = settings().priorityStore;
    var s = storeById(id);
    var key = s ? cityKeyOfStore(s) : ((dir().cities || [])[0] || {}).key;
    fillCitySelect(el('p-city'), key);
    var ok = fillStoreSelect(el('p-store'), el('p-city').value, id);
    updateAddr();
    void ok;
  }

  function updateAddr() {
    var s = storeById(el('p-store').value);
    var city = cityByKey(el('p-city').value);
    if (!s) { el('p-addr').textContent = '—'; return; }
    if (city && !city.searchable) {
      el('p-addr').innerHTML = '<span style="color:#c00">Apple 澳门没有网上商店，无法查询门店取货库存。</span>';
      return;
    }
    el('p-addr').textContent = s.province + ' ' + s.city + ' · ' + s.address + (s.phone ? ' · ' + s.phone : '');
  }

  // ---------- 渲染：监控门店列表 ----------
  function renderWatch() {
    var pri = el('p-store').value || settings().priorityStore;
    el('w-list').innerHTML = settings().watchStores.map(function (id) {
      var s = storeById(id);
      if (!s) return '';
      var isPri = id === pri;
      return '<div class="item' + (isPri ? ' pri' : '') + '">' +
        '<div><div>' + esc(s.city) + ' · ' + esc(s.name) +
        (isPri ? '<span class="tag">优先</span>' : '') + '</div>' +
        '<div class="meta">' + esc(s.province) + ' · ' + esc(s.address) + '</div></div>' +
        (isPri ? '<div class="meta">主目标</div>' : '<button class="x" data-rm="' + esc(id) + '">移除</button>') +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(el('w-list').querySelectorAll('.x'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-rm');
        settings().watchStores = settings().watchStores.filter(function (x) { return x !== id; });
        markDirty();
        renderWatch();
      };
    });
    renderTargets();
    if (!settings().watchStores.length) {
      el('w-list').innerHTML = '<div class="empty">还没有监控门店。</div>';
    }
  }

  // ---------- 渲染：机型下拉 ----------
  function fillFamilySelect() {
    var fams = cat().families || [];
    var sel = el('m-family');
    if (!fams.length) { sel.innerHTML = ''; sel.disabled = true; return; }
    sel.disabled = false;
    var cur = sel.value;
    sel.innerHTML = fams.map(function (f) {
      return '<option value="' + esc(f.name) + '">' + esc(f.name) + '</option>';
    }).join('');
    if (cur && fams.some(function (f) { return f.name === cur; })) sel.value = cur;
  }

  function fillCapSelect() {
    var fams = cat().families || [];
    var fam = fams.filter(function (f) { return f.name === el('m-family').value; })[0];
    var sel = el('m-cap');
    if (!fam) { sel.innerHTML = ''; sel.disabled = true; return; }
    sel.disabled = false;
    var cur = sel.value;
    var done = false;
    sel.innerHTML = (fam.capacities || []).map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');
    Array.prototype.forEach.call(sel.options, function (o) { if (o.value === cur) done = true; });
    if (!done && sel.options.length) sel.selectedIndex = 0;
  }

  function currentVariants() {
    var fam = el('m-family').value, capv = el('m-cap').value;
    return variants().filter(function (v) { return v.family === fam && v.capacity === capv; });
  }

  function fillColorSelect() {
    var vs = currentVariants();
    var sel = el('m-color');
    sel.innerHTML = vs.map(function (v) {
      return '<option value="' + esc(v.key) + '">' + esc(v.colorZh || v.color) + '</option>';
    }).join('');
    sel.disabled = !vs.length;
    var chosen = state.chosen || [];
    if (chosen.length) {
      Array.prototype.forEach.call(sel.options, function (o) {
        if (chosen.indexOf(o.value) >= 0) o.textContent = '✓ ' + o.textContent;
      });
    }
  }

  function refreshModelSelects() {
    fillFamilySelect(); fillCapSelect(); fillColorSelect();
  }

  // ---------- 渲染：已选目标 ----------
  function renderTargets() {
    var ts = settings().targets || [];
    if (!ts.length) {
      el('targets').innerHTML = '<div class="empty">还没有选择任何机型。请在上面选好机型/容量/颜色后点「添加」。</div>';
      return;
    }
    el('targets').innerHTML = ts.map(function (t) {
      var v = variantByKey(t.key);
      var name = v ? variantName(v) : (t.name || t.key);
      var parts = partsLabel(v || t) || '所选门店地区没有对应料号，暂不查询此机型';
      var price = v ? priceLabel(v) : '';
      return '<div class="item"><div><div>' + esc(name) + '</div>' +
        '<div class="meta">' + esc(parts) + (price ? ' · ' + esc(price) : '') + '</div></div>' +
        '<button class="x" data-rm="' + esc(t.key) + '">移除</button></div>';
    }).join('');
    Array.prototype.forEach.call(el('targets').querySelectorAll('.x'), function (b) {
      b.onclick = function () {
        var k = b.getAttribute('data-rm');
        settings().targets = settings().targets.filter(function (t) { return t.key !== k; });
        markDirty();
        renderTargets();
      };
    });
  }

  function addKeys(keys) {
    var existing = {};
    (settings().targets || []).forEach(function (t) { existing[t.key] = 1; });
    var added = 0;
    keys.forEach(function (k) {
      if (existing[k]) return;
      var v = variantByKey(k);
      settings().targets.push({
        key: k,
        name: v ? variantName(v) : k,
        parts: v ? v.parts : {},
        buyUrls: v ? v.buyUrls : {},
      });
      existing[k] = 1; added++;
    });
    if (added) { markDirty(); renderTargets(); }
    return added;
  }

  function renderSettings() {
    var s = settings();
    el('interval').value = s.pollIntervalSeconds;
    el('priorityOnly').checked = !!s.priorityOnly;
    el('repeat').value = s.repeatAlertMinutes;
    el('soldOut').checked = s.soldOutNotify !== false;
  }

  function renderMail() {
    var m = state.boot.mail || {};
    var st = state.boot.status || {};
    var ms = st.mail || {};
    var smtp;
    if (ms.ok === true) {
      smtp = '<div style="color:#1a7f37;margin-top:4px">✅ SMTP 连接正常' +
        (ms.checkedAt ? '（' + esc(ms.checkedAt) + ' 验证）' : '') + '</div>';
    } else if (ms.ok === false) {
      smtp = '<div style="color:#c00;margin-top:4px">❌ SMTP 连接失败：' + esc(ms.error || '未知错误') +
        '<br>库存查询仍在运行，但通知发不出去。请检查授权码，然后点「发送测试邮件」重试。</div>';
    } else {
      smtp = '<div style="color:#86868b;margin-top:4px">SMTP 尚未验证：点「发送测试邮件」可验证。</div>';
    }
    if (!m.configured) {
      el('mailbox').innerHTML = '<span style="color:#c00">邮箱尚未配置。</span> 请先运行配置向导（双击「重新配置邮箱.bat」）。' + smtp;
      return;
    }
    el('mailbox').innerHTML = '发件邮箱：<b>' + esc(m.from) + '</b><br>收件邮箱：<b>' +
      esc((m.to || []).join('、')) + '</b>' + smtp;
  }

  function renderStatus() {
    var st = state.boot.status || {};
    var dot = el('s-dot'), txt = el('s-text');
    var mailBad = Boolean(st.mail && st.mail.ok === false);
    var mailNote = mailBad ? ' ⚠️ 邮箱发信异常，通知可能发不出去。' : '';
    if (state.dirty) {
      dot.className = 'dot warn'; txt.textContent = '设置待保存';
      el('status-hint').textContent = '立即检查会先保存当前选择，再查询对应地区版本。';
      el('results').innerHTML = '<div class="empty">选择已变更，旧库存结果已隐藏。请点击「立即检查一次」。</div>';
      return;
    }
    if (!state.boot.runsMonitor) {
      dot.className = 'dot idle'; txt.textContent = '仅设置模式（未在监控）';
      el('status-hint').textContent = '当前只打开了设置界面。关闭后运行「一键部署.bat」或重启服务即开始监控。' + mailNote;
    } else if (st.lastError) {
      dot.className = 'dot err'; txt.textContent = '上次检查出错';
      el('status-hint').textContent = '上次检查出错：' + st.lastError + mailNote;
    } else if (mailBad) {
      dot.className = 'dot err'; txt.textContent = '监控中 · 邮件发送异常';
      el('status-hint').textContent = '邮件发送异常：' + (st.mail.error || '未知错误') +
        '。库存查询照常运行，但通知发不出去，请检查邮箱授权码。';
    } else if (st.lastCheckAt) {
      dot.className = 'dot ok'; txt.textContent = '监控中 · 上次检查 ' + st.lastCheckAt;
      el('status-hint').textContent = '优先门店：' + priorityLabel();
    } else {
      dot.className = 'dot warn'; txt.textContent = '监控中 · 等待首次检查';
      el('status-hint').textContent = '优先门店：' + priorityLabel();
    }

    var rs = st.results || [];
    if (!rs.length) {
      el('results').innerHTML = '<div class="empty">还没有检查结果。</div>';
      return;
    }
    el('results').innerHTML = rs.map(function (r) {
      var stores = (r.storeLabels && r.storeLabels.length) ? r.storeLabels.join('、')
        : ((r.stores && r.stores.length) ? r.stores.join('、') : r.complete === false ? '库存未知（查询未完成或失败）' : '无门店有货');
      var parts = [];
      for (var reg in (r.parts || {})) parts.push(regionShort(reg) + ' ' + r.parts[reg]);
      var regionRows = Object.keys(r.perRegion || {}).map(function (reg) {
        var d = r.perRegion[reg];
        var local = (r.stores || []).filter(function (id) { var s = storeById(id); return s && s.region === reg; });
        var names = local.map(function (id) { var s = storeById(id); return s.city + ' · ' + s.name; });
        return '<div>' + esc(regionShort(reg) + '版本 · ' + d.partNumber + ' → ' +
          (d.ok === false ? '库存未知（查询未完成或失败）' : names.join('、') || '无门店有货')) + '</div>';
      }).join('');
      var badge = (r.atPriority ? ' ✅ 优先门店有货' : '') + (r.complete === false ? ' · 部分地区数据未知' : '');
      var other = (r.otherStores && r.otherStores.length) ? '（附近另有 ' + r.otherStores.length + ' 家未监控门店有货）' : '';
      return '<div class="res"><div>' + esc(r.name) +
        '<div class="meta" style="color:#86868b;font-size:11.5px">' + esc(parts.join(' / ')) + '</div></div>' +
        '<div class="' + (r.atPriority ? 'hit' : 'miss') + '">' + (regionRows || esc(stores)) + badge + esc(other) + '</div></div>';
    }).join('');
  }

  function priorityLabel() {
    var s = storeById(settings().priorityStore);
    return s ? (s.city + ' · ' + s.name) : '—';
  }

  function renderWarn() {
    var c = cat();
    var box = el('catalog-warn');
    if (c && c.variants && c.variants.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = '<div class="warnbox">机型目录尚未拉取。点「刷新机型目录」从 Apple 官网获取最新机型、容量、颜色和价格。</div>';
  }

  function refreshLogs() {
    api('/api/logs?lines=120').then(function (r) {
      if (r.ok) {
        var p = el('logs');
        var atBottom = p.scrollTop + p.clientHeight >= p.scrollHeight - 30;
        p.textContent = r.text || '（暂无日志）';
        if (atBottom) p.scrollTop = p.scrollHeight;
      }
    });
  }

  function refreshStatus() {
    return api('/api/bootstrap').then(function (b) {
      state.boot.status = b.status;
      state.boot.mail = b.mail;
      renderStatus(); renderMail();
    });
  }

  function collect() {
    var pri = el('p-store').value || settings().priorityStore;
    var watch = settings().watchStores.slice();
    if (watch.indexOf(pri) < 0) watch.unshift(pri);
    return {
      priorityStore: pri,
      uiPort: settings().uiPort,
      watchStores: watch,
      pollIntervalSeconds: Number(el('interval').value),
      priorityOnly: el('priorityOnly').checked,
      repeatAlertMinutes: Number(el('repeat').value),
      soldOutNotify: el('soldOut').checked,
      targets: settings().targets,
    };
  }

  function save() {
    var btn = el('btn-save');
    btn.disabled = true; btn.textContent = '保存中…';
    return post('/api/settings', collect()).then(function (r) {
      if (r.ok) {
        state.boot.settings = r.settings;
        state.dirty = false;
        renderWatch(); refreshModelSelects(); renderTargets();
        toast('已保存，监控即刻按新配置运行');
        return refreshStatus();
      }
      throw new Error('保存失败：' + (r.error || '未知错误'));
    }).finally(function () {
      btn.disabled = false; btn.textContent = '保存并生效';
    });
  }

  // ---------- 启动 ----------
  function init() {
    return api('/api/bootstrap').then(function (b) {
      state.boot = b;
      state.chosen = [];

      renderWarn();
      renderPriority();
      renderWatchPicker();
      renderWatch();
      refreshModelSelects();
      renderTargets();
      renderSettings();
      renderMail();
      renderStatus();
      refreshLogs();

      el('p-city').onchange = function () {
        fillStoreSelect(el('p-store'), el('p-city').value);
        el('p-store').onchange();
      };
      el('p-store').onchange = function () {
        var id = el('p-store').value;
        if (!id) return;
        var previous = settings().priorityStore;
        settings().watchStores = settings().watchStores.filter(function (store) { return store !== previous; });
        settings().priorityStore = id;
        if (settings().watchStores.indexOf(id) < 0) settings().watchStores.unshift(id);
        markDirty();
        updateAddr(); renderWatch();
      };

      el('w-city').onchange = function () {
        fillStoreSelect(el('w-store'), el('w-city').value);
      };
      el('btn-addstore').onclick = function () {
        var sel = el('w-store');
        var id = sel.value;
        if (!id || sel.disabled) { toast('这个城市不支持查询库存'); return; }
        if (settings().watchStores.indexOf(id) >= 0) { toast('这个门店已经在监控列表里了'); return; }
        settings().watchStores.push(id);
        markDirty();
        renderWatch();
        toast('已添加 ' + sel.options[sel.selectedIndex].textContent);
      };

      el('m-family').onchange = function () { state.chosen = []; fillCapSelect(); fillColorSelect(); };
      el('m-cap').onchange = function () { state.chosen = []; fillColorSelect(); };
      el('m-color').onchange = function () {
        state.chosen = [el('m-color').value];
        fillColorSelect();
      };
      el('btn-addmodel').onclick = function () {
        if (el('m-color').disabled) { toast('没有可选机型，请先刷新机型目录'); return; }
        var n = addKeys([el('m-color').value]);
        toast(n ? '已添加' : '这个机型已经在列表里了');
      };
      el('btn-addall').onclick = function () {
        var vs = currentVariants();
        if (!vs.length) { toast('没有可选机型'); return; }
        var n = addKeys(vs.map(function (v) { return v.key; }));
        toast(n ? ('已添加 ' + n + ' 个颜色') : '这个容量的颜色都已经在列表里了');
      };

      el('btn-save').onclick = function () { return save().catch(function (e) { toast(e.message); }); };
      el('btn-check').onclick = function () {
        var b = this; b.disabled = true; b.textContent = '检查中…';
        return (state.dirty ? save() : Promise.resolve()).then(function () {
          return post('/api/check');
        }).then(function (r) {
          state.boot.status = r.status;
          renderStatus();
          toast('检查完成');
          refreshLogs();
        }).catch(function (e) { toast('检查失败：' + e.message); })
          .finally(function () { b.disabled = false; b.textContent = '立即检查一次'; });
      };
      el('btn-testmail').onclick = function () {
        var b = this; b.disabled = true; b.textContent = '发送中…';
        return post('/api/test-email').then(function (r) {
          toast(r.ok ? '测试邮件已发送，请查收（含垃圾箱）' : '发送失败：' + r.error);
        }).finally(function () { b.disabled = false; b.textContent = '发送测试邮件'; });
      };
      el('btn-refresh').onclick = function () {
        var b = this; b.disabled = true; b.textContent = '抓取中…（约 20 秒）';
        return post('/api/catalog/refresh').then(function (r) {
          if (r.ok) {
            state.boot.catalog = r.catalog;
            state.chosen = [];
            renderWarn(); refreshModelSelects(); renderTargets();
            toast('机型目录已更新：' + (r.catalog.variants || []).length + ' 个变体');
          } else { toast(r.error || '抓取失败'); }
        }).catch(function (e) { toast('抓取失败：' + e.message); })
          .finally(function () { b.disabled = false; b.textContent = '↻ 刷新机型目录'; });
      };
      el('btn-manual').onclick = function () {
        var pn = (el('manual-pn').value || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{4,12}\\/[A-Z]{1,2}$/.test(pn)) { toast('料号格式看起来不对，例：MJXU4ZA/A'); return; }
        var mm = /^([A-Z0-9]{3,12})\\//.exec(pn);
        var code = mm ? mm[1].slice(-2) : '';
        var reg = code === 'CH' ? 'CN' : (code === 'ZA' || code === 'ZP' ? 'HK' : null);
        if (!reg) { toast('看不懂这个料号属于哪个地区（只支持地区码 CH / ZA / ZP）'); return; }
        var ts = settings().targets;
        for (var i = 0; i < ts.length; i++) {
          if (ts[i].key === pn || Object.values(ts[i].parts || {}).indexOf(pn) >= 0) {
            toast('这个料号已经在列表里了'); return;
          }
        }
        var parts = {}; parts[reg] = pn;
        ts.push({ key: pn, name: pn, parts: parts, buyUrls: {} });
        markDirty();
        el('manual-pn').value = '';
        renderTargets();
        toast('已添加 ' + pn);
      };

      window.addEventListener('beforeunload', function (e) {
        if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
      });
      el('save-hint').textContent = state.boot.version ? ('版本 ' + state.boot.version) : '';
      setInterval(function () {
        refreshLogs();
        refreshStatus().catch(function () {});
      }, 20000);
    });
  }

  init().catch(function (e) {
    el('s-text').textContent = '加载失败：' + e.message;
    el('logs').textContent = String(e.stack || e);
  });
})();
</script>
</body>
</html>`;
