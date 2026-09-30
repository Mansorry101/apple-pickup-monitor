export const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Apple 取货监控</title>
<style>
  :root {
    --bg:#f5f5f7; --card:#fff; --line:#e8e8ed; --soft:#f5f5f7; --text:#1d1d1f; --muted:#6e6e73; --faint:#86868b;
    --blue:#0071e3; --blue-soft:#e8f2ff; --green:#1a7f37; --green-soft:#e6f6ea; --amber:#b25e00; --amber-soft:#fff4e0;
    --red:#d70015; --red-soft:#ffeceb; --shadow:0 1px 2px rgba(0,0,0,.04),0 4px 16px rgba(0,0,0,.04);
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#000; --card:#1c1c1e; --line:#2c2c2e; --soft:#2c2c2e; --text:#f5f5f7; --muted:#a1a1a6; --faint:#8e8e93;
      --blue:#0a84ff; --blue-soft:#0a84ff22; --green:#30d158; --green-soft:#30d15822; --amber:#ffb340; --amber-soft:#ff9f0a22;
      --red:#ff453a; --red-soft:#ff453a22; --shadow:none; }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;
    font-size:14px; line-height:1.5; -webkit-font-smoothing:antialiased; }
  .topbar { position:sticky; top:0; z-index:20; background:color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter:saturate(180%) blur(18px); -webkit-backdrop-filter:saturate(180%) blur(18px); border-bottom:1px solid var(--line); }
  .topbar-in { max-width:1240px; margin:0 auto; padding:10px 20px; display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  .brand { display:flex; align-items:center; gap:10px; margin-right:auto; }
  .logo { width:30px; height:30px; border-radius:8px; background:linear-gradient(135deg,#0071e3,#5ac8fa); color:#fff;
    display:grid; place-items:center; font-weight:700; font-size:15px; }
  h1 { font-size:16px; margin:0; letter-spacing:-.2px; }
  .sub { color:var(--faint); font-size:11.5px; }
  .pill { display:inline-flex; align-items:center; gap:7px; padding:5px 12px; border-radius:999px; background:var(--card);
    border:1px solid var(--line); font-size:12.5px; color:var(--muted); max-width:340px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .chip { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:600; white-space:nowrap; }
  .chip.rush { background:var(--amber-soft); color:var(--amber); }
  .chip.normal { background:var(--soft); color:var(--muted); }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; flex:none; }
  .ok { background:#34c759; } .warn { background:#ff9f0a; } .err { background:#ff3b30; } .idle { background:#c7c7cc; }
  .dot.ok { box-shadow:0 0 0 3px #34c75933; }

  .layout { max-width:1240px; margin:0 auto; padding:20px 20px 64px; display:grid; grid-template-columns:minmax(0,1fr) 400px; gap:18px; align-items:start; }
  .side { position:sticky; top:66px; display:flex; flex-direction:column; gap:14px; max-height:calc(100vh - 80px); overflow:auto; padding-bottom:4px; }
  @media (max-width: 1000px) { .layout { grid-template-columns:1fr; } .side { position:static; max-height:none; order:-1; } }

  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:18px 20px; margin-bottom:14px; box-shadow:var(--shadow); }
  .side .card { margin-bottom:0; }
  .card-h { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:4px; }
  .card h2 { font-size:14.5px; margin:0; display:flex; align-items:center; gap:8px; }
  .step { display:inline-grid; place-items:center; width:20px; height:20px; border-radius:50%; background:var(--blue-soft); color:var(--blue); font-size:11.5px; font-weight:700; }
  .card .hint { color:var(--faint); font-size:12px; margin-bottom:14px; }
  .picker { display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; margin-bottom:12px; }
  .picker .fl { display:flex; flex-direction:column; gap:4px; min-width:130px; }
  .picker .fl > span { font-size:11.5px; color:var(--faint); }
  select, input[type=number], input[type=text], input[type=time] { border:1px solid var(--line); border-radius:9px; padding:7px 11px; font-size:13px;
    font-family:inherit; background:var(--card); color:inherit; max-width:100%; transition:border-color .15s, box-shadow .15s; }
  select:focus, input:focus { outline:none; border-color:var(--blue); box-shadow:0 0 0 3px var(--blue-soft); }
  select:disabled { background:var(--soft); color:var(--faint); }
  input[type=number] { width:78px; text-align:right; }
  .btn { border:0; border-radius:10px; padding:8px 16px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; white-space:nowrap;
    transition:background .15s, transform .05s; }
  .btn:active { transform:scale(.98); }
  .btn.primary { background:var(--blue); color:#fff; }
  .btn.primary:hover { filter:brightness(1.08); }
  .btn.ghost { background:var(--soft); color:var(--text); }
  .btn.ghost:hover { filter:brightness(.96); }
  .btn.sm { padding:6px 12px; font-size:12.5px; }
  .btn:disabled { opacity:.45; cursor:default; }
  .btn.primary.dirty { box-shadow:0 0 0 3px var(--amber-soft); }
  .actions { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:14px; }

  .list { display:flex; flex-direction:column; gap:8px; }
  .item { display:flex; align-items:center; justify-content:space-between; gap:10px; background:var(--soft); border:1px solid transparent; border-radius:11px; padding:9px 13px; }
  .item .meta { color:var(--faint); font-size:11.5px; }
  .item .x { border:0; background:transparent; color:var(--faint); border-radius:7px; padding:4px 9px; cursor:pointer; font-size:12px; white-space:nowrap; }
  .item .x:hover { background:var(--red-soft); color:var(--red); }
  .item.pri { background:var(--blue-soft); border-color:color-mix(in srgb, var(--blue) 25%, transparent); }
  .item .ops { display:flex; gap:4px; align-items:center; }
  .star { border:0; background:transparent; cursor:pointer; font-size:17px; line-height:1; padding:3px 6px; border-radius:7px; color:var(--faint); }
  .star:hover { background:var(--amber-soft); }
  .star.on { color:#ff9f0a; }
  .tag { display:inline-block; background:var(--blue); color:#fff; font-size:10.5px; padding:1px 7px; border-radius:999px; margin-left:6px; vertical-align:1px; }
  .tag.amber { background:#ff9f0a; }
  .empty { color:var(--faint); font-size:13px; padding:10px 0; }
  .addr { color:var(--muted); font-size:12.5px; }

  .row { display:flex; gap:12px; align-items:center; justify-content:space-between; padding:10px 0; border-top:1px solid var(--line); }
  .row:first-of-type { border-top:0; }
  .row .d { color:var(--faint); font-size:12px; }
  .sec { font-size:12px; font-weight:600; color:var(--muted); margin:16px 0 6px; text-transform:none; }
  .sec:first-of-type { margin-top:4px; }
  .speed { width:100%; border-collapse:collapse; font-size:13px; }
  .speed th { text-align:right; font-weight:600; font-size:12px; color:var(--muted); padding:6px 4px; }
  .speed th:first-child { text-align:left; }
  .speed td { padding:7px 4px; border-top:1px solid var(--line); text-align:right; white-space:nowrap; }
  .speed td:first-child { text-align:left; white-space:normal; }
  .speed td .d { color:var(--faint); font-size:11.5px; }
  .speed .u { color:var(--faint); font-size:12px; margin-left:3px; }
  .speed th.rushcol { color:var(--amber); }
  .switch { position:relative; width:40px; height:24px; flex:none; }
  .switch input { opacity:0; width:0; height:0; position:absolute; }
  .switch i { position:absolute; inset:0; background:#d1d1d6; border-radius:999px; transition:.2s; cursor:pointer; }
  .switch i::after { content:""; position:absolute; left:2px; top:2px; width:20px; height:20px; background:#fff; border-radius:50%; transition:.2s; box-shadow:0 1px 3px rgba(0,0,0,.25); }
  .switch input:checked + i { background:#34c759; }
  .switch input:checked + i::after { transform:translateX(16px); }
  .switch input:focus-visible + i { box-shadow:0 0 0 3px var(--blue-soft); }

  .res { border:1px solid var(--line); border-radius:12px; padding:11px 13px; margin-top:8px; }
  .res:first-child { margin-top:0; }
  .res.hit { border-color:color-mix(in srgb, #34c759 55%, transparent); background:var(--green-soft); }
  .res-h { display:flex; justify-content:space-between; gap:8px; align-items:flex-start; }
  .res-name { font-weight:600; font-size:13.5px; }
  .res .meta { color:var(--faint); font-size:11.5px; }
  .reg { display:flex; gap:8px; align-items:baseline; margin-top:6px; font-size:12.5px; }
  .reg b { font-weight:600; min-width:34px; color:var(--muted); }
  .badge { display:inline-block; border-radius:6px; padding:1px 8px; font-size:11.5px; font-weight:600; white-space:nowrap; }
  .b-in { background:var(--green-soft); color:var(--green); }
  .b-out { background:var(--soft); color:var(--faint); }
  .b-unk { background:var(--amber-soft); color:var(--amber); }
  .b-wait { background:var(--blue-soft); color:var(--blue); }
  .b-hit { background:#34c759; color:#fff; }
  .stores { color:var(--text); }
  .summary { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
  .summary .s { flex:1; min-width:80px; background:var(--soft); border-radius:10px; padding:8px 10px; }
  .summary .s .n { font-size:18px; font-weight:700; }
  .summary .s .l { font-size:11px; color:var(--faint); }
  .lanes { display:flex; flex-direction:column; gap:6px; }
  .lane { display:flex; align-items:center; gap:10px; font-size:12.5px; padding:7px 10px; background:var(--soft); border-radius:9px; }
  .lane .nm { font-weight:600; min-width:34px; }
  .lane .iv { color:var(--faint); }
  .lane .st { margin-left:auto; font-variant-numeric:tabular-nums; color:var(--muted); }
  .lane .st.run { color:var(--blue); }
  .lane .st.cool { color:var(--red); }

  pre.logs { background:#111; color:#d6d6d6; border-radius:10px; padding:12px; max-height:320px; overflow:auto; font-size:11.5px; line-height:1.6;
    white-space:pre-wrap; word-break:break-all; margin:0; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; }
  #toast { position:fixed; left:50%; bottom:28px; transform:translateX(-50%) translateY(20px); background:#1d1d1f; color:#fff; padding:11px 22px;
    border-radius:12px; font-size:13.5px; opacity:0; pointer-events:none; transition:.22s; z-index:99; max-width:90vw; box-shadow:0 8px 30px rgba(0,0,0,.25); }
  #toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
  .mailbox { background:var(--soft); border-radius:11px; padding:11px 13px; font-size:13px; }
  .warnbox { background:var(--amber-soft); border-left:3px solid #ff9f0a; border-radius:10px; padding:11px 13px; font-size:12.5px; margin-bottom:14px; }
  .kbd { font-size:11px; color:var(--faint); }
</style>
</head>
<body>
<div class="topbar"><div class="topbar-in">
  <div class="brand">
    <div class="logo">A</div>
    <div><h1>Apple 取货监控</h1><div class="sub">中国大陆 / 香港 Apple Store 门市取货库存，有货时邮件通知</div></div>
  </div>
  <span id="mode-chip" class="chip normal" title="查询节奏">常规查询</span>
  <span class="pill" title="运行状态"><span id="s-dot" class="dot idle"></span><span id="s-text">加载中…</span></span>
  <button class="btn ghost" id="btn-check">立即检查一次</button>
  <button class="btn primary" id="btn-save" title="Ctrl+S">保存并生效</button>
</div></div>

<div class="layout">
<main>
  <div id="catalog-warn"></div>

  <div class="card">
    <div class="card-h"><h2><span class="step">1</span>优先取货门店</h2></div>
    <div class="hint">先选城市，再选门店。这个门店一有货就立刻发「急」邮件。</div>
    <div class="picker">
      <label class="fl"><span>城市</span><select id="p-city"></select></label>
      <label class="fl"><span>门店</span><select id="p-store"></select></label>
    </div>
    <div class="addr" id="p-addr">—</div>
  </div>

  <div class="card">
    <div class="card-h"><h2><span class="step">2</span>同时监控的门店（可选）</h2></div>
    <div class="hint">这些门店有货时发「备选」邮件。只查这里列出的门店，Apple 顺带返回的其他门店一律忽略。</div>
    <div class="picker">
      <label class="fl"><span>城市</span><select id="w-city"></select></label>
      <label class="fl"><span>门店</span><select id="w-store"></select></label>
      <button class="btn ghost" id="btn-addstore">添加门店</button>
    </div>
    <div id="w-list" class="list"></div>
  </div>

  <div class="card">
    <div class="card-h"><h2><span class="step">3</span>监控机型</h2>
      <button class="btn ghost sm" id="btn-refresh">↻ 刷新机型目录</button></div>
    <div class="hint">先选机型，再选容量和颜色，然后点「添加」。同一款机型在大陆 / 香港的料号不同，程序会自动对应。</div>
    <div class="picker">
      <label class="fl"><span>机型</span><select id="m-family"></select></label>
      <label class="fl"><span>容量</span><select id="m-cap"></select></label>
      <label class="fl"><span>颜色</span><select id="m-color"></select></label>
      <button class="btn ghost" id="btn-addmodel">添加</button>
      <button class="btn ghost" id="btn-addall">添加该容量全部颜色</button>
    </div>
    <div class="picker" style="margin-bottom:0">
      <input type="text" id="manual-pn" placeholder="或手动输入料号，如 MJXU4ZA/A" style="width:240px" aria-label="手动输入料号">
      <button class="btn ghost sm" id="btn-manual">添加料号</button>
    </div>
  </div>

  <div class="card">
    <div class="card-h"><h2><span class="step">4</span>已选监控目标</h2><span class="kbd" id="target-count"></span></div>
    <div class="hint">点 ☆ 标为「优先机型」：优先通道只盯优先门店 + 优先机型，查得更勤。都不标时，优先通道盯全部机型。</div>
    <div id="targets" class="list"></div>
  </div>

  <div class="card">
    <div class="card-h"><h2><span class="step">5</span>查询节奏</h2></div>
    <div class="hint">放货时段（北京时间）内自动切换为高速间隔，时段结束恢复常规。间隔都是「两轮开始之间」的时间。</div>
    <div class="row">
      <div><label for="rushEnabled">启用放货时段高速查询</label><div class="d">Apple 通常在清晨放货</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="time" id="rushStart" aria-label="放货开始"> – <input type="time" id="rushEnd" aria-label="放货结束">
        <label class="switch"><input type="checkbox" id="rushEnabled"><i></i></label>
      </div>
    </div>
    <div class="row">
      <div><label for="priorityBoost">优先通道</label><div class="d">单独只查优先门店所在城市的优先机型；间隔比所在地区整轮更短时才会启用</div></div>
      <label class="switch"><input type="checkbox" id="priorityBoost"><i></i></label>
    </div>
    <table class="speed">
      <thead><tr><th>通道</th><th>常规</th><th class="rushcol">放货时段</th></tr></thead>
      <tbody>
        <tr><td>大陆全部门店<div class="d">每个城市一次请求，最低 15 秒</div></td>
          <td><input type="number" id="interval" min="15" max="3600" aria-label="大陆常规间隔"><span class="u">秒</span></td>
          <td><input type="number" id="rush-interval" min="15" max="3600" aria-label="大陆放货间隔"><span class="u">秒</span></td></tr>
        <tr><td>香港全部门店<div class="d">不用定位、一次请求出结果，最低 3 秒</div></td>
          <td><input type="number" id="hk-interval" min="3" max="3600" aria-label="香港常规间隔"><span class="u">秒</span></td>
          <td><input type="number" id="rush-hk-interval" min="3" max="3600" aria-label="香港放货间隔"><span class="u">秒</span></td></tr>
        <tr><td>优先门店 + 优先机型<div class="d">最低 5 秒</div></td>
          <td><input type="number" id="pri-interval" min="5" max="3600" aria-label="优先通道常规间隔"><span class="u">秒</span></td>
          <td><input type="number" id="rush-pri-interval" min="5" max="3600" aria-label="优先通道放货间隔"><span class="u">秒</span></td></tr>
      </tbody>
    </table>
    <div class="d" style="color:var(--faint);font-size:12px;margin-top:10px">被 Apple 限流（HTTP 429 / 503）时会自动暂停该地区 1–5 分钟，避免越查越被封。</div>
  </div>

  <div class="card">
    <div class="card-h"><h2><span class="step">6</span>通知</h2></div>
    <div class="row">
      <div><label for="priorityOnly">只有优先门店有货才通知</label><div class="d">开启后，其他门店有货不再发「备选」邮件</div></div>
      <label class="switch"><input type="checkbox" id="priorityOnly"><i></i></label>
    </div>
    <div class="row">
      <div><label for="repeat">持续有货重复提醒</label><div class="d">优先门店一直有货时，每隔多久再提醒一次；0 = 只提醒一次</div></div>
      <div><input type="number" id="repeat" min="0" max="1440"> 分钟</div>
    </div>
    <div class="row">
      <div><label for="soldOut">库存消失时通知</label><div class="d">之前有货、现在没了，发一封收尾邮件</div></div>
      <label class="switch"><input type="checkbox" id="soldOut"><i></i></label>
    </div>
    <div class="sec">通知邮箱</div>
    <div class="mailbox" id="mailbox">—</div>
    <div class="actions">
      <button class="btn ghost sm" id="btn-testmail">发送测试邮件</button>
      <span class="kbd">邮箱凭据存在 .env 里，为安全起见不在此页面显示 / 修改。</span>
    </div>
  </div>
  <div class="kbd" id="save-hint" style="text-align:center"></div>
</main>

<aside class="side">
  <div class="card">
    <div class="card-h"><h2>库存状态</h2><span class="kbd" id="last-check"></span></div>
    <div class="hint" id="status-hint">—</div>
    <div id="summary"></div>
    <div id="results"></div>
  </div>
  <div class="card" id="sched-card">
    <div class="card-h"><h2>查询通道</h2><span class="kbd" id="sched-note"></span></div>
    <div id="lanes" class="lanes"><div class="empty">—</div></div>
  </div>
  <div class="card">
    <div class="card-h"><h2>运行日志</h2><button class="btn ghost sm" id="btn-logs">暂停滚动</button></div>
    <pre class="logs" id="logs">加载中…</pre>
  </div>
</aside>
</div>
<div id="toast" role="status" aria-live="polite"></div>
<script>
(function () {
  var state = { boot: null, dirty: false, timer: null, logsPaused: false, lastResKey: '', clockOffset: 0 };

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
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2800);
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

  function dir() { return state.boot.directory || { regions: [], cities: [], stores: [] }; }
  function cat() { return state.boot.catalog || { families: [], variants: [] }; }
  function settings() { return state.boot.settings; }
  function markDirty() {
    state.dirty = true;
    var b = el('btn-save');
    if (b) b.classList.add('dirty');
    renderStatus();
  }

  var storeIndex = null, cityIndex = null, variantIndex = null;
  function storeById(id) {
    if (!storeIndex) { storeIndex = {}; (dir().stores || []).forEach(function (s) { storeIndex[s.id] = s; }); }
    return storeIndex[id] || null;
  }
  function cityByKey(k) {
    if (!cityIndex) { cityIndex = {}; (dir().cities || []).forEach(function (c) { cityIndex[c.key] = c; }); }
    return cityIndex[k] || null;
  }
  function cityKeyOfStore(s) { return s.region + ':' + s.city; }

  function variants() { return cat().variants || []; }
  function variantByKey(k) {
    if (!variantIndex) { variantIndex = {}; variants().forEach(function (v) { variantIndex[v.key] = v; }); }
    return variantIndex[k] || null;
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

  function renderWatchPicker() {
    var pri = el('p-store').value || settings().priorityStore;
    var s = storeById(pri);
    var cur = el('w-city').value;
    var prefer = (cur && cityByKey(cur)) ? cur : (s ? cityKeyOfStore(s) : ((dir().cities || [])[0] || {}).key);
    fillCitySelect(el('w-city'), prefer);
    fillStoreSelect(el('w-store'), el('w-city').value);
  }

  function renderPriority() {
    var id = settings().priorityStore;
    var s = storeById(id);
    var key = s ? cityKeyOfStore(s) : ((dir().cities || [])[0] || {}).key;
    fillCitySelect(el('p-city'), key);
    fillStoreSelect(el('p-store'), el('p-city').value, id);
    updateAddr();
  }

  function updateAddr() {
    var s = storeById(el('p-store').value);
    var city = cityByKey(el('p-city').value);
    if (!s) { el('p-addr').textContent = '—'; return; }
    if (city && !city.searchable) {
      el('p-addr').innerHTML = '<span style="color:var(--red)">Apple 澳门没有网上商店，无法查询门店取货库存。</span>';
      return;
    }
    el('p-addr').textContent = s.province + ' ' + s.city + ' · ' + s.address + (s.phone ? ' · ' + s.phone : '');
  }

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
        (isPri ? '<div class="meta">主目标</div>' : '<button class="x" data-rm="' + esc(id) + '" aria-label="移除门店">移除</button>') +
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
    Array.prototype.forEach.call(sel.options, function (o) { if (o.value === cur) { done = true; sel.value = cur; } });
    if (!done && sel.options.length) sel.selectedIndex = 0;
  }

  function currentVariants() {
    var fam = el('m-family').value, capv = el('m-cap').value;
    return variants().filter(function (v) { return v.family === fam && v.capacity === capv; });
  }

  function fillColorSelect() {
    var vs = currentVariants();
    var sel = el('m-color');
    var cur = sel.value;
    var picked = {};
    (settings().targets || []).forEach(function (t) { picked[t.key] = 1; });
    sel.innerHTML = vs.map(function (v) {
      return '<option value="' + esc(v.key) + '">' + (picked[v.key] ? '✓ ' : '') + esc(v.colorZh || v.color) + '</option>';
    }).join('');
    sel.disabled = !vs.length;
    if (cur && vs.some(function (v) { return v.key === cur; })) sel.value = cur;
  }

  function refreshModelSelects() {
    fillFamilySelect(); fillCapSelect(); fillColorSelect();
  }

  function renderTargets() {
    var ts = settings().targets || [];
    var count = el('target-count');
    if (count) {
      var starred = ts.filter(function (t) { return t.priority; }).length;
      count.textContent = ts.length ? (ts.length + ' 个机型' + (starred ? ' · ' + starred + ' 个优先' : '')) : '';
    }
    if (!ts.length) {
      el('targets').innerHTML = '<div class="empty">还没有选择任何机型。请在上面选好机型/容量/颜色后点「添加」。</div>';
      return;
    }
    el('targets').innerHTML = ts.map(function (t) {
      var v = variantByKey(t.key);
      var name = v ? variantName(v) : (t.name || t.key);
      var parts = partsLabel(v || t) || '所选门店地区没有对应料号，暂不查询此机型';
      var price = v ? priceLabel(v) : '';
      return '<div class="item' + (t.priority ? ' pri' : '') + '"><div><div>' + esc(name) +
        (t.priority ? '<span class="tag amber">优先</span>' : '') + '</div>' +
        '<div class="meta">' + esc(parts) + (price ? ' · ' + esc(price) : '') + '</div></div>' +
        '<div class="ops"><button class="star' + (t.priority ? ' on' : '') + '" data-star="' + esc(t.key) + '" title="' +
        (t.priority ? '取消优先' : '标为优先机型') + '" aria-label="' + (t.priority ? '取消优先' : '标为优先机型') + '">' +
        (t.priority ? '★' : '☆') + '</button>' +
        '<button class="x" data-rm="' + esc(t.key) + '" aria-label="移除机型">移除</button></div></div>';
    }).join('');
    Array.prototype.forEach.call(el('targets').querySelectorAll('.x'), function (b) {
      b.onclick = function () {
        var k = b.getAttribute('data-rm');
        settings().targets = settings().targets.filter(function (t) { return t.key !== k; });
        markDirty();
        renderTargets();
      };
    });
    Array.prototype.forEach.call(el('targets').querySelectorAll('.star'), function (b) {
      b.onclick = function () {
        var k = b.getAttribute('data-star');
        settings().targets.forEach(function (t) { if (t.key === k) t.priority = !t.priority; });
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
    if (added) { markDirty(); renderTargets(); fillColorSelect(); }
    return added;
  }

  function renderSettings() {
    var s = settings();
    el('interval').value = s.pollIntervalSeconds;
    el('hk-interval').value = s.hkIntervalSeconds != null ? s.hkIntervalSeconds : 5;
    el('pri-interval').value = s.priorityIntervalSeconds != null ? s.priorityIntervalSeconds : 20;
    el('rush-interval').value = s.rushPollIntervalSeconds != null ? s.rushPollIntervalSeconds : 15;
    el('rush-hk-interval').value = s.rushHkIntervalSeconds != null ? s.rushHkIntervalSeconds : 3;
    el('rush-pri-interval').value = s.rushPriorityIntervalSeconds != null ? s.rushPriorityIntervalSeconds : 8;
    el('rushEnabled').checked = s.rushEnabled !== false;
    el('rushStart').value = s.rushStart || '06:00';
    el('rushEnd').value = s.rushEnd || '09:00';
    el('priorityBoost').checked = s.priorityBoost !== false;
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
      smtp = '<div style="color:var(--green);margin-top:4px">✅ SMTP 连接正常' +
        (ms.checkedAt ? '（' + esc(ms.checkedAt) + ' 验证）' : '') + '</div>';
    } else if (ms.ok === false) {
      smtp = '<div style="color:var(--red);margin-top:4px">❌ SMTP 连接失败：' + esc(ms.error || '未知错误') +
        '<br>库存查询仍在运行，但通知发不出去。请检查授权码，然后点「发送测试邮件」重试。</div>';
    } else {
      smtp = '<div style="color:var(--faint);margin-top:4px">SMTP 尚未验证：点「发送测试邮件」可验证。</div>';
    }
    if (!m.configured) {
      el('mailbox').innerHTML = '<span style="color:var(--red)">邮箱尚未配置。</span> 请先运行配置向导（双击「重新配置邮箱.bat」）。' + smtp;
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
    var summary = el('summary');
    if (state.dirty) {
      dot.className = 'dot warn'; txt.textContent = '设置待保存';
      el('status-hint').textContent = '立即检查会先保存当前选择，再查询对应地区版本。';
      el('results').innerHTML = '<div class="empty">选择已变更，旧库存结果已隐藏。请点击「立即检查一次」。</div>';
      state.lastResKey = '';
      if (summary) summary.innerHTML = '';
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
      state.lastResKey = '';
      if (summary) summary.innerHTML = '';
      return;
    }
    renderResults(rs);
  }

  function priorityLabel() {
    var s = storeById(settings().priorityStore);
    return s ? (s.city + ' · ' + s.name) : '—';
  }

  /** 结果列表：内容没变就不重绘（状态每 5 秒刷新一次） */
  function renderResults(rs) {
    var key = JSON.stringify(rs);
    if (key === state.lastResKey) return;
    state.lastResKey = key;
    var nIn = 0, nOut = 0, nUnk = 0;
    var starred = {};
    (settings().targets || []).forEach(function (t) { if (t.priority) starred[t.key] = 1; });
    var html = rs.map(function (r) {
      if (r.stores && r.stores.length) nIn++; else if (r.availability === 'unavailable') nOut++; else nUnk++;
      var parts = [];
      for (var reg in (r.parts || {})) parts.push(regionShort(reg) + ' ' + r.parts[reg]);
      var regionRows = Object.keys(r.perRegion || {}).map(function (reg) {
        var d = r.perRegion[reg];
        var local = (r.stores || []).filter(function (id) { var s = storeById(id); return s && s.region === reg; });
        var names = local.map(function (id) { var s = storeById(id); return s.city + ' · ' + s.name; });
        var badge;
        if (d.ok === false) badge = d.pending ? '<span class="badge b-wait">等待下一轮</span>'
          : d.inProgress ? '<span class="badge b-wait">查询中</span>' : '<span class="badge b-unk">库存未知</span>';
        else badge = names.length ? '<span class="badge b-in">有货</span>' : '<span class="badge b-out">无货</span>';
        return '<div class="reg"><b>' + esc(regionShort(reg)) + '</b>' + badge +
          '<span class="stores">' + esc(names.join('、')) + '</span></div>';
      }).join('');
      if (!regionRows) {
        var stores = (r.storeLabels && r.storeLabels.length) ? r.storeLabels.join('、')
          : (r.complete === false ? '库存未知（查询未完成或失败）' : '无门店有货');
        regionRows = '<div class="reg">' + esc(stores) + '</div>';
      }
      return '<div class="res' + (r.atPriority ? ' hit' : '') + '"><div class="res-h"><div>' +
        '<div class="res-name">' + (starred[r.key] ? '★ ' : '') + esc(r.name) + '</div>' +
        '<div class="meta">' + esc(parts.join(' / ')) + (r.deliveryDate ? ' · 送货 ' + esc(r.deliveryDate) : '') + '</div></div>' +
        (r.atPriority ? '<span class="badge b-hit">优先门店有货</span>' : '') + '</div>' + regionRows + '</div>';
    }).join('');
    el('results').innerHTML = html;
    var sm = el('summary');
    if (sm) {
      sm.innerHTML = '<div class="summary">' +
        '<div class="s"><div class="n" style="color:var(--green)">' + nIn + '</div><div class="l">有货</div></div>' +
        '<div class="s"><div class="n">' + nOut + '</div><div class="l">无货</div></div>' +
        '<div class="s"><div class="n" style="color:var(--amber)">' + nUnk + '</div><div class="l">未知 / 等待</div></div></div>';
    }
  }

  /** 顶部模式标记 + 查询通道倒计时（每秒本地刷新，不请求服务器） */
  function renderSchedule() {
    var st = (state.boot && state.boot.status) || {};
    var sc = st.schedule;
    var chip = el('mode-chip');
    if (!state.boot.runsMonitor) {
      chip.className = 'chip normal'; chip.textContent = '未在监控';
    } else if (sc && sc.rush) {
      chip.className = 'chip rush'; chip.textContent = '⚡ 放货时段 ' + sc.rushWindow;
    } else {
      chip.className = 'chip normal';
      chip.textContent = sc && sc.rushEnabled ? '常规查询 · 放货 ' + sc.rushWindow : '常规查询';
    }
    var box = el('lanes');
    if (!sc || !sc.lanes || !sc.lanes.length) {
      box.innerHTML = '<div class="empty">' + (state.boot.runsMonitor ? '等待调度…' : '仅设置模式，没有运行查询。') + '</div>';
      el('sched-note').textContent = '';
      return;
    }
    var now = Date.now() + state.clockOffset;
    el('sched-note').textContent = sc.rush ? '高速' : '常规';
    box.innerHTML = sc.lanes.map(function (l) {
      var cls = 'st', text;
      if (l.cooldownUntil && l.cooldownUntil > now) {
        cls += ' cool'; text = '限流冷却 ' + Math.ceil((l.cooldownUntil - now) / 1000) + 's';
      } else if (l.running) {
        cls += ' run'; text = '查询中…';
      } else if (l.nextAt) {
        var left = Math.max(0, Math.ceil((l.nextAt - now) / 1000));
        text = left ? left + 's 后' : '即将查询';
      } else text = '即将查询';
      return '<div class="lane"><span class="nm">' + esc(l.label) + '</span><span class="iv">每 ' + esc(l.intervalSeconds) + ' 秒</span>' +
        '<span class="' + cls + '">' + text + '</span></div>';
    }).join('');
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
    if (state.logsPaused) return Promise.resolve();
    return api('/api/logs?lines=150').then(function (r) {
      if (r.ok) {
        var p = el('logs');
        var text = r.text || '（暂无日志）';
        if (text === state.lastLogs) return;
        state.lastLogs = text;
        var atBottom = p.scrollTop + p.clientHeight >= p.scrollHeight - 30;
        p.textContent = text;
        if (atBottom) p.scrollTop = p.scrollHeight;
      }
    });
  }

  function refreshStatus() {
    return api('/api/status').then(function (b) {
      state.boot.status = b.status;
      state.boot.mail = b.mail;
      if (b.now) state.clockOffset = b.now - Date.now();
      renderStatus(); renderMail(); renderSchedule();
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
      hkIntervalSeconds: Number(el('hk-interval').value),
      priorityIntervalSeconds: Number(el('pri-interval').value),
      rushPollIntervalSeconds: Number(el('rush-interval').value),
      rushHkIntervalSeconds: Number(el('rush-hk-interval').value),
      rushPriorityIntervalSeconds: Number(el('rush-pri-interval').value),
      rushEnabled: el('rushEnabled').checked,
      rushStart: el('rushStart').value,
      rushEnd: el('rushEnd').value,
      priorityBoost: el('priorityBoost').checked,
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
        btn.classList.remove('dirty');
        renderWatch(); refreshModelSelects(); renderTargets(); renderSettings();
        toast('已保存，监控即刻按新配置运行');
        return refreshStatus();
      }
      throw new Error('保存失败：' + (r.error || '未知错误'));
    }).finally(function () {
      btn.disabled = false; btn.textContent = '保存并生效';
    });
  }

  /** 页面可见时状态 5 秒、日志 10 秒刷新；切到后台就停，回来立即刷新 */
  function startPolling() {
    var tick = 0;
    setInterval(function () {
      if (document.hidden) return;
      tick++;
      renderSchedule();
      if (tick % 5 === 0) refreshStatus().catch(function () {});
      if (tick % 10 === 0) refreshLogs();
    }, 1000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { refreshStatus().catch(function () {}); refreshLogs(); }
    });
  }

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
      renderSchedule();
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

      el('m-family').onchange = function () { fillCapSelect(); fillColorSelect(); };
      el('m-cap').onchange = function () { fillColorSelect(); };
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

      // 设置项改动即标记为待保存
      ['interval', 'hk-interval', 'pri-interval', 'rush-interval', 'rush-hk-interval', 'rush-pri-interval',
        'rushEnabled', 'rushStart', 'rushEnd', 'priorityBoost', 'priorityOnly', 'repeat', 'soldOut'].forEach(function (id) {
        el(id).addEventListener('change', markDirty);
      });

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
            variantIndex = null;
            renderWarn(); refreshModelSelects(); renderTargets();
            toast('机型目录已更新：' + (r.catalog.variants || []).length + ' 个变体');
          } else { toast(r.error || '抓取失败'); }
        }).catch(function (e) { toast('抓取失败：' + e.message); })
          .finally(function () { b.disabled = false; b.textContent = '↻ 刷新机型目录'; });
      };
      el('btn-manual').onclick = function () {
        var pn = (el('manual-pn').value || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{4,12}[/][A-Z]{1,2}$/.test(pn)) { toast('料号格式看起来不对，例：MJXU4ZA/A'); return; }
        var mm = /^([A-Z0-9]{3,12})[/]/.exec(pn);
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
      el('manual-pn').addEventListener('keydown', function (e) { if (e.key === 'Enter') el('btn-manual').click(); });
      el('btn-logs').onclick = function () {
        state.logsPaused = !state.logsPaused;
        this.textContent = state.logsPaused ? '继续刷新' : '暂停滚动';
        if (!state.logsPaused) refreshLogs();
      };

      document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); el('btn-save').click(); }
      });
      window.addEventListener('beforeunload', function (e) {
        if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
      });
      el('save-hint').textContent = state.boot.version ? ('版本 ' + state.boot.version + ' · Ctrl+S 保存') : '';
      startPolling();
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
