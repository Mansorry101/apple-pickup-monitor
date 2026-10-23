import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplePickupClient, httpKeepAliveEnabled } from '../src/apple.js';
import { REGIONS } from '../src/stores.js';
import { decideAlerts, acknowledgeAlerts } from '../src/alerts.js';
import { deliverAlerts } from '../src/notifications.js';
import { buildReferenceMail } from '../src/mailer.js';

const product = {key:'P',name:'测试机',parts:{HK:'TEST1ZP/A',CN:'TEST1CH/A'},buyUrls:{}};
const cfg = {products:[product],watchRegions:['HK','CN'],watchStores:['R499','R401'],
  priorityStore:'R499',priorityStoreRegion:'HK',priorityStoreFor:{HK:'R499',CN:'R401'},
  priorityOnly:false,soldOutNotify:true,repeatAlertMinutes:0,maxRetries:1,sessionRefreshMinutes:30};
const result = (stores, more={}) => ({key:'P',product,parts:product.parts,stores,
  atPriority:stores.includes('R499'),ok:true,complete:true,priorityKnown:true,...more});
const planItems = (p) => [...p.priorityItems,...p.otherItems,...p.soldOut];
const confirm = (results,state,c=cfg,now=1000) => {
  const p=decideAlerts(results,state,c,now); acknowledgeAlerts(planItems(p),state,now);return p;
};

test('SMTP失败先持久化待发送，重启后重试，成功后停止重复通知', async()=>{
  let state={parts:{}}, disk, attempts=0;
  const options={persist:()=>{disk=JSON.stringify(state);},send:async()=>{
    attempts++;assert.ok(JSON.parse(disk).parts.P.pending);throw new Error('SMTP timeout');
  }};
  assert.equal((await deliverAlerts([result(['R499'])],state,cfg,options)).length,1);
  assert.equal(state.parts.P.lastAlertAt,undefined);
  state=JSON.parse(disk);
  await deliverAlerts([result(['R499'])],state,cfg,{...options,send:async()=>{attempts++;}});
  assert.equal(attempts,2);assert.equal(state.parts.P.pending,undefined);
  assert.equal(planItems(decideAlerts([result(['R499'])],state,cfg)).length,0);
});

test('优先邮件失败不会阻止备选及售罄邮件；售罄失败可重试',async()=>{
  const state={parts:{gone:{role:'priority'}}};
  const rows=[result(['R499']),result(['R401'],{key:'other'}),result([],{key:'gone'})];
  const subjects=[];
  await deliverAlerts(rows,state,cfg,{persist:()=>{},send:async(mail)=>{
    subjects.push(mail.subject);if(!mail.subject.includes('其他门店'))throw new Error('fail');
  }});
  assert.equal(subjects.length,3);assert.ok(state.parts.P.pending);assert.ok(state.parts.gone.pending);
  assert.equal(state.parts.other.pending,undefined);
  const again=decideAlerts(rows,state,cfg);assert.equal(again.soldOut.length,1);assert.equal(again.otherItems.length,0);
});

test('dry-run 不修改观测或通知状态，不写磁盘，不发送',async()=>{
  const state={parts:{}};
  await deliverAlerts([result(['R499'])],state,cfg,{dryRun:true,
    persist:()=>assert.fail('persist'),send:()=>assert.fail('send')});
  assert.deepEqual(state,{parts:{}});
});

test('持久化失败禁止发送；SMTP部分拒收保留待发送事件',async()=>{
  await assert.rejects(deliverAlerts([result(['R499'])],{parts:{}},cfg,{
    persist:()=>{throw new Error('disk full');},send:()=>assert.fail('send')}),/disk full/);
  const state={parts:{}};
  await deliverAlerts([result(['R499'])],state,cfg,{persist:()=>{},send:async()=>({rejected:['test@example.invalid']})});
  assert.ok(state.parts.P.pending);
});

test('unknown不改变状态或误报售罄，库存消失后不补发过期有货提醒',()=>{
  const state={parts:{}};
  decideAlerts([result(['R499'])],state,cfg);
  const before=JSON.stringify(state);
  assert.equal(planItems(decideAlerts([result([],{ok:false,complete:false})],state,cfg)).length,0);
  assert.equal(JSON.stringify(state),before);
  const gone=decideAlerts([result([])],state,cfg);
  assert.equal(gone.priorityItems.length,0);assert.equal(gone.soldOut.length,1);
});

test('部分地区失败：正向库存可通知，未知优先门店不降级，也不宣称无货',()=>{
  const state={parts:{}};
  const partial=result(['R401'],{complete:false,priorityKnown:false});
  assert.equal(decideAlerts([partial],state,cfg).otherItems.length,1);
  assert.match(buildReferenceMail([partial],cfg).subject,/尚未确认/);
  confirm([result(['R499'])],state);
  const before=JSON.stringify(state);
  assert.equal(planItems(decideAlerts([partial],state,cfg)).length,0);
  assert.equal(JSON.stringify(state),before);
  assert.equal(planItems(decideAlerts([result([],{complete:false})],state,cfg)).length,0);
});

test('成功提醒遵循间隔，失败提醒不更新时间；旧状态可加载',()=>{
  const c={...cfg,repeatAlertMinutes:15},state={parts:{P:{role:'priority',lastAlertAt:new Date(1000).toISOString()}}};
  assert.equal(decideAlerts([result(['R499'])],state,c,2000).priorityItems.length,0);
  const p=decideAlerts([result(['R499'])],state,c,902000);
  assert.equal(p.isReminder,true);assert.equal(p.priorityItems.length,1);
  assert.equal(decideAlerts([result(['R499'])],state,c,903000).priorityItems.length,1);
});

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const regional=(region,stores)=>({P:{partNumber:product.parts[region],stores,ok:true}});
test('香港有货在大陆请求结束前发布；大陆失败后仍保留香港结果',async()=>{
  const client=new ApplePickupClient(cfg,()=>{}),gate=deferred(),updated=deferred();
  client.checkRegion=async(region)=>{if(region==='HK')return regional(region,['R499']);await gate.promise;throw new Error('CN timeout');};
  const updates=[];
  const task=client.checkAvailability({onUpdate:async(rows)=>{updates.push(rows);updated.resolve();}});
  await updated.promise;
  assert.equal(updates[0][0].atPriority,true);assert.equal(updates[0][0].complete,false);
  gate.resolve();const rows=await task;
  assert.equal(rows[0].atPriority,true);assert.equal(rows[0].perRegion.CN.ok,false);
  assert.match(rows[0].perRegion.CN.error,/timeout/);
});

test('所有地区失败返回unknown；恢复全量成功才可以判定无货',async()=>{
  const client=new ApplePickupClient(cfg,()=>{});
  client.checkRegion=async()=>{throw new Error('offline');};
  let rows=await client.checkAvailability();assert.equal(rows[0].availability,'unknown');assert.equal(rows[0].ok,false);
  client.checkRegion=async(region)=>regional(region,[]);
  rows=await client.checkAvailability();assert.equal(rows[0].availability,'unavailable');assert.equal(rows[0].complete,true);
});

test('同一客户端手动和自动检查排队，不交错修改地区会话',async()=>{
  const client=new ApplePickupClient({...cfg,watchRegions:['HK'],watchStores:['R499']},()=>{}),gate=deferred(),entered=deferred();
  let count=0;
  client.checkRegion=async(region)=>{count++;if(count===1){entered.resolve();await gate.promise;}return regional(region,[]);};
  const first=client.checkAvailability();await entered.promise;
  const second=client.checkAvailability();await Promise.resolve();assert.equal(count,1);
  gate.resolve();await Promise.all([first,second]);assert.equal(count,2);
});

function mockSession(products=[product]) {
  const client=new ApplePickupClient({...cfg,watchRegions:['HK'],watchStores:['R499'],products},()=>{});
  const s=client.session('HK');s.ready=true;s.createdAt=Date.now();s.warmedKey='';
  return {client,s};
}
const item=(pn,count=0)=>({partNumber:pn,partAvailableStoresCount:count,eligibleStores:count?'R499':'',storeId:'R499'});
test('哨兵正常但目标缺失，不能被判成无货',async()=>{
  const {client,s}=mockSession();s.queryParts=async()=>[item(REGIONS.HK.canaryPart,1)];
  const [r]=await client.checkAvailability();assert.equal(r.availability,'unknown');assert.match(r.perRegion.HK.error,/缺失/);
});

test('每批都带哨兵：第二批缺失或哨兵异常不能通过校验',async()=>{
  const products=Array.from({length:12},(_,i)=>({...product,key:'P'+i,parts:{HK:'TEST'+i+'ZP/A'}}));
  for(const mode of ['missing','canary']) {
    const {client,s}=mockSession(products);let batch=0;
    s.queryParts=async(parts)=>{assert.ok(parts.includes(REGIONS.HK.canaryPart));batch++;
      return parts.filter(p=>batch===1 || (mode==='missing'?p===REGIONS.HK.canaryPart:p!==REGIONS.HK.canaryPart)).map(p=>item(p,1));};
    const rows=await client.checkAvailability();assert.equal(batch,2);assert.ok(rows.every(r=>r.availability==='unknown'));
  }
});

test('正常的零库存、数字字符串及哨兵作为目标可通过；畸形库存不通过',async()=>{
  for(const count of [0,'0',null,undefined,'',-1,true]) {
    const {client,s}=mockSession();s.queryParts=async(parts)=>parts.map(p=>p===REGIONS.HK.canaryPart?item(p,1):({...item(p),partAvailableStoresCount:count}));
    const [r]=await client.checkAvailability();assert.equal(r.availability,(count===0||count==='0')?'unavailable':'unknown');
  }
  const p={...product,parts:{HK:REGIONS.HK.canaryPart}};
  const {client,s}=mockSession([p]);s.queryParts=async(parts)=>{assert.equal(parts.length,1);return parts.map(p=>item(p,1));};
  assert.equal((await client.checkAvailability())[0].atPriority,true);
});

test('发信成功但写盘失败时，内存仍保留待发送事件',async()=>{
  const state={parts:{}};let writes=0;
  const errors=await deliverAlerts([result(['R499'])],state,cfg,{
    persist:()=>{if(++writes===2)throw new Error('disk full after send');},send:async()=>({accepted:['test@example.invalid']})});
  assert.equal(errors.length,1);assert.ok(state.parts.P.pending);assert.equal(state.parts.P.lastAlertAt,undefined);
});

test('独立城市会话的空库存不会混入送达日期',async()=>{
  const client=new ApplePickupClient({...cfg,watchRegions:['CN'],watchStores:['R401','R320'],maxRetries:2},()=>{});
  for (const city of ['CN:上海', 'CN:北京']) {
    const s=client.session('CN', city);
    s.ready=true;s.createdAt=Date.now();s.warmedKey=city;
    s.setLocation=async()=>{};s.warmUp=async()=>true;
    s.queryParts=async(parts)=>parts.map(p=>({...item(p,0)}));
  }
  const data=await client.checkRegion('CN',[product]);
  assert.deepEqual(data.P.stores,[]);assert.equal(data.P.deliveryDate,null);
});

test('响应结构缺失及矛盾库存不能转换为无货',async()=>{
  const {s}=mockSession();s.request=async()=>({status:200,text:'{"body":{}}'});
  await assert.rejects(s.queryParts(['P'],'R499'),/content/);
  for(const invalid of [
    {partAvailableStoresCount:1,eligibleStores:' , '},
    {partAvailableStoresCount:0,eligibleStores:'R499'},
    {partAvailableStoresCount:' ',eligibleStores:''},
  ]) {
    const {client,s}=mockSession();s.queryParts=async(parts)=>parts.map(p=>p===REGIONS.HK.canaryPart?item(p,1):({...item(p),...invalid}));
    assert.equal((await client.checkAvailability())[0].availability,'unknown');
  }
});

test('大陆城市会话按地区和城市隔离，并在后续轮询复用已热身会话',async()=>{
  const client=new ApplePickupClient({...cfg,watchStores:['R401','R320']},()=>{});
  const sh=client.session('CN','CN:上海'),bj=client.session('CN','CN:北京');
  assert.notEqual(sh,bj);
  let warmups=0,queries=0;
  for(const session of [sh,bj]) {
    session.ready=true;session.createdAt=Date.now();session.locationKey=null;
    session.setLocation=async(city)=>{session.locationKey=city.key;};
    session.warmUp=async()=>{warmups++;return true;};
    session.queryParts=async(parts)=>{queries++;return parts.map(p=>({...item(p,0),storeId:'R401'}));};
  }
  await client.checkRegion('CN',[product]);
  await client.checkRegion('CN',[product]);
  assert.equal(warmups,2);assert.equal(queries,4);
  assert.equal(client.session('CN','CN:上海'),sh);assert.equal(client.session('CN','CN:北京'),bj);
});

test('各地区按自己的到期时间调度：香港 5 秒、大陆 60 秒互不影响',async()=>{
  const { dueRegions, msUntilNextDue, nextDueAt, pollJitterMs } = await import('../src/scheduler.js');
  const t0=1_000_000;
  // 开始到开始：到期时间从「这一轮开始」算，检查本身的耗时不算进去
  const dueAt={HK:nextDueAt(t0,5_000),CN:nextDueAt(t0,60_000)};
  assert.equal(dueAt.HK-t0,5_000);
  assert.deepEqual(dueRegions(dueAt,['HK','CN'],t0+4_000),[],'都还没到点');
  assert.deepEqual(dueRegions(dueAt,['HK','CN'],t0+5_000),['HK'],'只有香港到点');
  assert.deepEqual(dueRegions(dueAt,['HK','CN'],t0+60_000),['HK','CN']);
  assert.equal(msUntilNextDue(dueAt,['HK','CN'],t0+1_000),4_000);
  // 抖动只让下一轮提前，绝不推后：5 秒的间隔永远在 4–5 秒之间到点
  for (const j of [0,300,999,1_000]) {
    assert.ok(nextDueAt(t0,5_000,j)<=t0+5_000,`抖动 ${j} 不该把香港的下一轮推到 5 秒之后`);
    assert.ok(nextDueAt(t0,5_000,j)>=t0+4_000);
  }
  assert.equal(nextDueAt(t0,5_000,99_999),t0,'抖动再大也不会算成负数');
  assert.ok(pollJitterMs(5_000,()=>0.999)<=1_000);
  assert.ok(pollJitterMs(3_000,()=>0.999)<=600,'抖动不超过间隔的 20%');
  // 从未查过的地区视为立即到期；没有地区时不至于算出负数
  assert.deepEqual(dueRegions({},['HK'],t0),['HK']);
  assert.equal(msUntilNextDue({},[],t0),0);
});

test('只查香港的那一轮不碰大陆会话，大陆标成「等待下一轮」而不是失败',async()=>{
  const client=new ApplePickupClient(cfg,()=>{});
  const seen=[];
  client.checkRegion=async(region)=>{seen.push(region);return regional(region,[]);};
  const rows=await client.checkAvailability({only:['HK']});
  assert.deepEqual(seen,['HK'],'这一轮只该查香港');
  assert.equal(rows[0].perRegion.HK.ok,true);
  assert.equal(rows[0].perRegion.CN.pending,true,'大陆本轮没查 → pending');
  assert.equal(rows[0].complete,false,'大陆没查过，不能算完整结果');
  assert.equal(rows[0].availability,'unknown','不完整时不能宣称无货');
});

test('大陆没轮到的那些轮次，不会因为香港没货就发出「售罄」邮件',async()=>{
  const state={parts:{}};
  // 第一轮：两地都查过，优先门店（香港 R499）有货 → 发过一封有货邮件
  const both={...result(['R499']),perRegion:{
    HK:{partNumber:product.parts.HK,stores:['R499'],ok:true},
    CN:{partNumber:product.parts.CN,stores:['R401'],ok:true}}};
  acknowledgeAlerts(planItems(decideAlerts([both],state,cfg)),state);
  assert.equal(state.parts.P.role,'priority');
  // 第二轮：只轮到香港，香港这轮没货；大陆没查过
  const hkOnly={...result([],{complete:false}),perRegion:{
    HK:{partNumber:product.parts.HK,stores:[],ok:true},
    CN:{partNumber:product.parts.CN,stores:[],ok:false,pending:true,error:'本轮未查询'}}};
  assert.equal(hkOnly.complete,false,'只查一个地区时结果不完整');
  const plan=decideAlerts([hkOnly],state,cfg);
  assert.equal(planItems(plan).length,0,'拿不到大陆新数据时不能下「售罄」结论');
  assert.equal(state.parts.P.role,'priority','旧观测应当原样保留');
});

test('库存没变化时不重复写盘（香港每 5 秒一轮也不会狂写状态文件）',async()=>{
  const state={parts:{}};
  let writes=0;
  const persist=()=>{writes++;};
  const send=async()=>({accepted:['test@example.invalid']});
  await deliverAlerts([result(['R499'])],state,cfg,{persist,send});
  assert.equal(writes,2,'首次有货：发送前 + 确认后各写一次');
  await deliverAlerts([result(['R499'])],state,cfg,{persist,send});
  assert.equal(writes,2,'库存没变化 → 不写盘');
  await deliverAlerts([result([])],state,cfg,{persist,send});
  assert.ok(writes>2,'库存消失属于状态变化，应当写盘');
});

// 门店地区决定版本，目录与保存目标保留完整映射。
import { scopeProductsByStores } from '../src/settings.js';
import { regionalMailItems } from '../src/mailer.js';
import { STORE_BY_ID } from '../src/stores.js';
import vm from 'node:vm';
import fs from 'node:fs';
import { PAGE } from '../src/webui-page.js';
import { VERSION } from '../src/constants.js';

test('单地区仅保留对应版本，切换门店可恢复另一地区料号和链接',()=>{
  const p={...product,buyUrls:{CN:'https://www.apple.com.cn/cn-product',HK:'https://www.apple.com/hk-product'},prices:{CN:100,HK:200}};
  const before=JSON.stringify(p);
  for(const [store,region] of [['R401','CN'],['R499','HK']]) {
    const [scoped]=scopeProductsByStores([p],[store]);
    assert.deepEqual(scoped.parts,{[region]:p.parts[region]});
    assert.deepEqual(scoped.buyUrls,{[region]:p.buyUrls[region]});
    assert.deepEqual(scoped.prices,{[region]:p.prices[region]});
    assert.equal(scoped.partNumber,p.parts[region]);assert.equal(scoped.buyUrl,p.buyUrls[region]);
  }
  assert.equal(JSON.stringify(p),before);
  const [both]=scopeProductsByStores([p],['R401','R499']);assert.equal(Object.keys(both.parts).length,2);
  const [missing]=scopeProductsByStores([{...p,parts:{HK:p.parts.HK}}],['R401']);
  assert.deepEqual(missing.parts,{});assert.equal(missing.partNumber,undefined);
});

test('实际查询批次只使用门店地区的料号与哨兵，不受过期watchRegions影响',async()=>{
  for(const stores of [['R401'],['R499'],['R401','R499']]) {
    const regions=[...new Set(stores.map(id=>STORE_BY_ID[id].region))];
    const client=new ApplePickupClient({...cfg,watchStores:stores,watchRegions:['HK','CN']},()=>{});
    const requests=[];
    for(const region of regions) {
      const cityKey = region === 'CN' ? 'CN:上海' : '';
      const s=client.session(region, cityKey);s.ready=true;s.createdAt=Date.now();s.warmedKey=cityKey;
      s.setLocation=async()=>{};s.warmUp=async()=>true;
      s.queryParts=async(parts,store)=>{
        requests.push(region);
        assert.equal(STORE_BY_ID[store].region,region);
        assert.deepEqual(new Set(parts),new Set([REGIONS[region].canaryPart,product.parts[region]]));
        return parts.map(p=>({...item(p,1),eligibleStores:stores.find(id=>STORE_BY_ID[id].region===region)}));
      };
    }
    const [r]=await client.checkAvailability();
    assert.deepEqual(new Set(requests),new Set(regions));
    assert.deepEqual(new Set(Object.keys(r.parts)),new Set(regions));
    assert.deepEqual(new Set(r.stores),new Set(stores));
  }
});

test('无当地版本时不会拿另一地区料号替代请求',async()=>{
  const client=new ApplePickupClient({...cfg,watchStores:['R401'],products:[{...product,parts:{HK:product.parts.HK}}]},()=>{});
  client.checkRegion=()=>assert.fail('不应查询香港版本');
  await assert.rejects(client.checkAvailability(),/没有可查询的地区/);
});

test('两地有货邮件分行对应当地料号、门店和购买链接，缺链接不跳到另一地区',()=>{
  const r=result(['R499','R401'],{product:{...product,buyUrls:{CN:'https://www.apple.com.cn/cn-product',HK:'https://www.apple.com/hk-product'}}});
  const rows=regionalMailItems([r]);assert.equal(rows.length,2);
  for(const row of rows) {
    const region=STORE_BY_ID[row.stores[0]].region;
    assert.deepEqual(row.parts,{[region]:product.parts[region]});
    assert.deepEqual(Object.keys(row.product.buyUrls),[region]);
    assert.ok(row.stores.every(id=>STORE_BY_ID[id].region===region));
  }
  r.stores=['R499'];delete r.product.buyUrls.HK;
  const [hk]=regionalMailItems([r]);assert.deepEqual(hk.product.buyUrls,{});assert.equal(hk.product.buyUrl,'');
});

test('已选机型展示随门店地区切换，缺当地料号显示提示；页面脚本可解析',()=>{
  const script=[...PAGE.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1];new vm.Script(script);
  const helpers=script.slice(script.indexOf('  function selectedRegions()'),script.indexOf('  function variantName('));
  const render=script.slice(script.indexOf('  function renderTargets()'),script.indexOf('  function addKeys('));
  const settings={watchStores:['R401'],priorityStore:'R401',targets:[product]};
  const dom={innerHTML:'',querySelectorAll:()=>[]};
  const context={settings:()=>settings,storeById:id=>STORE_BY_ID[id],regionShort:r=>r,
    regionCurrency:r=>r,money:n=>String(n),variantByKey:()=>null,esc:s=>s,el:()=>dom};
  vm.runInNewContext(helpers+render+'\nrenderTargets();',context);
  assert.ok(dom.innerHTML.includes(product.parts.CN));assert.ok(!dom.innerHTML.includes(product.parts.HK));
  settings.watchStores=['R499'];settings.priorityStore='R499';vm.runInNewContext(helpers+render+'\nrenderTargets();',context);
  assert.ok(dom.innerHTML.includes(product.parts.HK));assert.ok(!dom.innerHTML.includes(product.parts.CN));
  settings.targets=[{...product,parts:{CN:product.parts.CN}}];vm.runInNewContext(helpers+render+'\nrenderTargets();',context);
  assert.match(dom.innerHTML,/没有对应料号/);
});

test('切换优先门店会替换旧主门店，保留明确添加的其他门店',()=>{
  const script=[...PAGE.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1];
  const begin=script.indexOf("      el('p-store').onchange = function () {");
  const end=script.indexOf("      el('w-city').onchange",begin);
  const s={priorityStore:'R499',watchStores:['R499','R320']};
  const control={value:'R401'};let dirty=0;
  vm.runInNewContext(script.slice(begin,end),{el:()=>control,settings:()=>s,markDirty:()=>dirty++,updateAddr:()=>{},renderWatch:()=>{}});
  control.onchange();
  assert.deepEqual([...s.watchStores],['R401','R320']);assert.equal(s.priorityStore,'R401');assert.equal(dirty,1);
  control.value='R499';control.onchange();assert.deepEqual([...s.watchStores],['R499','R320']);
});

test('立即检查先保存待修改选择；保存失败不会用旧配置查询',async()=>{
  const script=[...PAGE.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1];
  const begin=script.indexOf("      el('btn-check').onclick = function () {");
  const end=script.indexOf("      el('btn-testmail').onclick",begin);
  for(const fail of [false,true]) {
    const button={},calls=[];
    const context={el:()=>button,state:{dirty:true,boot:{}},save:async()=>{calls.push('save');if(fail)throw new Error('save failed');},
      post:async()=>{calls.push('check');return {status:{results:[]}};},renderStatus:()=>{},toast:()=>{},refreshLogs:()=>{}};
    vm.runInNewContext(script.slice(begin,end),context);await button.onclick();
    assert.deepEqual(calls,fail?['save']:['save','check']);assert.equal(button.disabled,false);
  }
});

test('修改选择后隐藏旧库存，不把之前地区的结果显示为当前结果',()=>{
  const script=[...PAGE.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1];
  const begin=script.indexOf('  function renderStatus()');const end=script.indexOf('  function priorityLabel()',begin);
  const dom=Object.fromEntries(['s-dot','s-text','status-hint','results'].map(id=>[id,{}]));
  vm.runInNewContext(script.slice(begin,end)+'\nrenderStatus();',{
    el:id=>dom[id],state:{dirty:true,boot:{status:{results:[{name:'旧地区结果'}]}}}});
  assert.equal(dom['s-text'].textContent,'设置待保存');assert.match(dom.results.innerHTML,/旧库存结果已隐藏/);
  assert.ok(!dom.results.innerHTML.includes('旧地区结果'));
});

test('邮箱连通性反映到界面：SMTP 失败变红写明原因，未验证时提示',()=>{
  const script=[...PAGE.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1];
  const mailAt=script.indexOf('  function renderMail()');
  const statusAt=script.indexOf('  function renderStatus()');
  const code=script.slice(mailAt,statusAt)+script.slice(statusAt,script.indexOf('  function priorityLabel()',statusAt));
  const dom=Object.fromEntries(['mailbox','s-dot','s-text','status-hint','results'].map(id=>[id,{}]));
  const render=(mail,status)=>vm.runInNewContext(code+'\nrenderMail();renderStatus();',{
    el:id=>dom[id],esc:s=>s,priorityLabel:()=>'P',
    state:{dirty:false,boot:{mail,status,runsMonitor:true}}});
  const boxes={from:'a@qq.com',to:['b@outlook.com'],configured:true};
  render(boxes,{lastCheckAt:'10:00',results:[],mail:{ok:false,error:'Invalid login: 535'}});
  assert.match(dom.mailbox.innerHTML,/SMTP 连接失败/);assert.match(dom.mailbox.innerHTML,/535/);
  assert.equal(dom['s-text'].textContent,'监控中 · 邮件发送异常');assert.equal(dom['s-dot'].className,'dot err');
  render(boxes,{lastCheckAt:'10:00',results:[],mail:{ok:true,checkedAt:'10:01'}});
  assert.match(dom.mailbox.innerHTML,/SMTP 连接正常/);assert.equal(dom['s-text'].textContent,'监控中 · 上次检查 10:00');
  render(boxes,{lastCheckAt:'10:00',results:[],mail:{ok:null}});
  assert.match(dom.mailbox.innerHTML,/尚未验证/);assert.equal(dom['s-dot'].className,'dot ok');
  render(boxes,{lastCheckAt:'10:00',results:[],mail:{ok:false,error:'x'}});
  assert.match(dom['status-hint'].textContent,/发不出去/);
});

test('版本号在 package.json 与代码常量间保持一致',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(fs.readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
  assert.equal(pkg.version,VERSION);
  assert.equal(lock.version,VERSION);assert.equal(lock.packages[''].version,VERSION);
});

// ---------- 查询速度相关 ----------
test('不同地区的查询不互相排队：大陆卡住时香港仍可完成',async()=>{
  const client=new ApplePickupClient(cfg,()=>{}),gate=deferred();
  client.checkRegion=async(region)=>{if(region==='CN')await gate.promise;return regional(region,region==='HK'?['R499']:[]);};
  const cn=client.checkAvailability({only:['CN']});
  const hk=await client.checkAvailability({only:['HK']});
  assert.equal(hk[0].perRegion.HK.ok,true);assert.equal(hk[0].atPriority,true);
  gate.resolve();await cn;
});

test('大陆重试只重查失败的城市，成功城市不重建会话',async()=>{
  const client=new ApplePickupClient({...cfg,watchRegions:['CN'],watchStores:['R401','R320'],maxRetries:3},()=>{});
  const calls={},rebuilt=[];
  for (const city of ['CN:上海','CN:北京']) {
    const s=client.session('CN',city);calls[city]=0;
    s.ready=true;s.createdAt=Date.now();s.warmedKey=city;s.setLocation=async()=>{};s.warmUp=async()=>true;
    s.ensureSession=async()=>{s.ready=true;s.createdAt=Date.now();rebuilt.push(city);};
    s.queryParts=async(parts)=>{calls[city]++;
      if(city==='CN:北京'&&calls[city]===1)throw new Error('boom');
      return parts.map(p=>item(p,city==='CN:上海'?0:1)).map(x=>x.partAvailableStoresCount?{...x,eligibleStores:'R320'}:x);};
  }
  const data=await client.checkRegion('CN',[product]);
  assert.equal(calls['CN:上海'],1,'成功的城市不重查');assert.equal(calls['CN:北京'],2);
  assert.deepEqual(data.P.stores,['R320']);
  assert.deepEqual(rebuilt,['CN:北京'],'只重建失败城市的会话');
});

test('同一城市的多个批次并发发出',async()=>{
  const products=Array.from({length:12},(_,i)=>({...product,key:'P'+i,parts:{HK:'TEST'+i+'ZP/A'}}));
  const {client,s}=mockSession(products);let inFlight=0,peak=0;
  s.queryParts=async(parts)=>{inFlight++;peak=Math.max(peak,inFlight);await new Promise(r=>setTimeout(r,10));inFlight--;return parts.map(p=>item(p,1));};
  const rows=await client.checkAvailability();
  assert.equal(peak,2);assert.ok(rows.every(r=>r.atPriority));
});

test('并发轮次交替回调时，快照取每个地区最新结果；复用近期其他地区结果得到完整结论',async()=>{
  const client=new ApplePickupClient(cfg,()=>{});
  client.checkRegion=async(region)=>regional(region,[]);
  await client.checkAvailability({only:['HK']});
  const [r]=await client.checkAvailability({only:['CN'],reuseMaxAgeMs:60_000});
  assert.equal(r.complete,true,'香港刚查过，可并入大陆轮次');assert.equal(r.availability,'unavailable');
  const [r2]=await client.checkAvailability({only:['CN']});
  assert.equal(r2.perRegion.HK.pending,true,'默认不复用');
  client.checkRegion=async()=>{throw new Error('offline');};
  await client.checkAvailability({only:['HK']});
  const [r3]=await client.checkAvailability({only:['CN'],reuseMaxAgeMs:60_000});
  assert.equal(r3.perRegion.HK.ok,false,'较新的失败结果不能被旧的成功结果掩盖');assert.equal(r3.availability,'unknown');
});

test('只保留选中的门店：Apple 连带返回的附近门店被丢弃',async()=>{
  const client=new ApplePickupClient({...cfg,watchRegions:['CN'],watchStores:['R401']},()=>{});
  const s=client.session('CN','CN:上海');
  s.ready=true;s.createdAt=Date.now();s.warmedKey='CN:上海';s.setLocation=async()=>{};s.warmUp=async()=>true;
  // R320 不在监控列表里（附近城市的门店）
  s.queryParts=async(parts)=>parts.map(p=>({...item(p,2),eligibleStores:'R401,R320'}));
  const [r]=await client.checkAvailability();
  assert.deepEqual(r.stores,['R401']);assert.deepEqual(r.perRegion.CN.stores,['R401']);
  assert.equal(r.otherStores,undefined);
});

// ---------- 放货时段 / 优先通道 / 限流 ----------
const sched = await import('../src/scheduler.js');
const bj = (h, m=0) => Date.UTC(2026, 8, 30, h - 8, m); // 北京时间 → 时间戳

test('放货时段按北京时间判断，06:00 进入、09:00 退出，与机器时区无关',()=>{
  const start=sched.parseHHMM('06:00'),end=sched.parseHHMM('09:00');
  assert.equal(sched.inWindow(bj(5,59),start,end),false);
  assert.equal(sched.inWindow(bj(6,0),start,end),true);
  assert.equal(sched.inWindow(bj(8,59),start,end),true);
  assert.equal(sched.inWindow(bj(9,0),start,end),false);
  assert.equal(sched.msUntilWindowEdge(bj(5,30),start,end),30*60_000,'5:30 → 半小时后进入');
  assert.equal(sched.msUntilWindowEdge(bj(8,0),start,end),60*60_000,'8:00 → 一小时后退出');
  assert.equal(sched.msUntilWindowEdge(bj(10,0),start,end),20*3600_000,'10:00 → 次日 6:00');
  // 跨零点
  assert.equal(sched.inWindow(bj(23),sched.parseHHMM('22:00'),sched.parseHHMM('02:00')),true);
  assert.equal(sched.inWindow(bj(3),sched.parseHHMM('22:00'),sched.parseHHMM('02:00')),false);
  assert.equal(sched.parseHHMM('25:00'),null);
});

test('轮询计划：放货时段用高速间隔，关闭后始终常规',()=>{
  const c={rushEnabled:true,rushStart:'06:00',rushEnd:'09:00',intervalSeconds:60,hkIntervalSeconds:5,szIntervalSeconds:5,
    priorityIntervalSeconds:20,rushPollIntervalSeconds:15,rushHkIntervalSeconds:3,rushSzIntervalSeconds:3,
    rushPriorityIntervalSeconds:8};
  assert.deepEqual(sched.pollPlan(c,bj(7)),{rush:true,intervals:{CN:15000,HK:3000,SZ:3000,PRI:8000}});
  assert.deepEqual(sched.pollPlan(c,bj(10)),{rush:false,intervals:{CN:60000,HK:5000,SZ:5000,PRI:20000}});
  assert.equal(sched.pollPlan({...c,rushEnabled:false},bj(7)).rush,false);
  assert.equal(sched.throttleBackoffMs(1),60_000);assert.equal(sched.throttleBackoffMs(2),120_000);
  assert.equal(sched.throttleBackoffMs(9),300_000,'最长 5 分钟');
});

const cnCfg={...cfg,watchRegions:['CN'],watchStores:['R401','R320'],priorityStore:'R401',priorityStoreRegion:'CN',
  priorityStoreFor:{CN:'R401'}};
const twoProducts=[{...product,key:'A',parts:{CN:'AAA1CH/A'}},{...product,key:'B',parts:{CN:'BBB1CH/A'}}];
function cnSessions(client, handler) {
  const seen=[];
  for (const city of ['CN:上海','CN:北京']) {
    const s=client.session('CN',city);
    s.ready=true;s.createdAt=Date.now();s.warmedKey=city;s.setLocation=async()=>{};s.warmUp=async()=>true;
    s.queryParts=async(parts)=>{seen.push([city,parts]);return handler(city,parts);};
  }
  return seen;
}

test('优先通道只查优先门店所在城市的优先机型；未覆盖的城市不下「无货」结论',async()=>{
  const client=new ApplePickupClient({...cnCfg,products:twoProducts},()=>{});
  const seen=cnSessions(client,(city,parts)=>parts.map(p=>p===REGIONS.CN.canaryPart?{...item(p,1),eligibleStores:'R401'}:item(p,0)));
  const scope=client.priorityScope(['B']);
  assert.deepEqual(scope.keys,['B']);assert.equal(scope.city,'CN:上海');assert.deepEqual(scope.stores,['R401']);
  const rows=await client.checkPriority(['B']);
  assert.equal(seen.length,1,'只请求一个城市');assert.equal(seen[0][0],'CN:上海');
  assert.ok(seen[0][1].includes('BBB1CH/A')&&!seen[0][1].includes('AAA1CH/A'),'只查优先机型');
  assert.equal(rows.length,1);assert.equal(rows[0].complete,false,'北京没查，不算完整');
  assert.equal(rows[0].availability,'unknown');
  // 没标优先机型 → 全部机型
  assert.deepEqual(client.priorityScope([]).keys,['A','B']);
});

test('优先通道：优先门店有货立即发急件；无货（不完整）不会发售罄',async()=>{
  const client=new ApplePickupClient({...cnCfg,products:twoProducts},()=>{});
  let stock='R401,R320';
  cnSessions(client,(city,parts)=>parts.map(p=>({...item(p,stock?2:0),eligibleStores:stock})));
  const c={...cnCfg,soldOutNotify:true};const state={parts:{}};
  let rows=await client.checkPriority(['A']);
  assert.deepEqual(rows[0].stores,['R401'],'北京门店不在本通道范围内，不计入');
  let plan=decideAlerts(rows,state,c);assert.equal(plan.priorityItems.length,1);
  acknowledgeAlerts(planItems(plan),state);
  stock='';rows=await client.checkPriority(['A']);
  plan=decideAlerts(rows,state,c);assert.equal(planItems(plan).length,0,'局部数据不能下售罄结论');
  assert.equal(state.parts.A.role,'priority');
});

test('展示合并：优先通道只替换覆盖范围内的门店，其他城市沿用完整结果',async()=>{
  const client=new ApplePickupClient({...cnCfg,products:twoProducts},()=>{});
  cnSessions(client,(city,parts)=>parts.map(p=>({...item(p,1),eligibleStores:city==='CN:上海'?'R401':'R320'})));
  const [full]=await client.checkAvailability();
  assert.deepEqual(new Set(full.stores),new Set(['R401','R320']));
  cnSessions(client,(city,parts)=>parts.map(p=>p===REGIONS.CN.canaryPart?{...item(p,1),eligibleStores:'R401'}:item(p,0)));
  const [lane]=await client.checkPriority(['A']);
  const merged=client.mergeLaneRow(full,lane);
  assert.deepEqual(merged.stores,['R320'],'上海的新数据（无货）替换，北京沿用');
  assert.equal(merged.atPriority,false);assert.equal(merged.complete,true);assert.equal(merged.perRegion.CN.ok,true);
});

test('Apple 限流（429）：本轮不重试，地区进入冷却，成功后清零',async()=>{
  const {client,s}=mockSession();let calls=0;
  s.request=async()=>{calls++;const e=new Error('HK：Apple 限制了查询频率 (HTTP 429)');e.throttled=true;throw e;};
  const [r]=await client.checkAvailability();
  assert.equal(r.availability,'unknown');assert.match(r.perRegion.HK.error,/限制了查询频率.*暂停/);
  assert.equal(calls,1,'限流时不在本轮反复重试');
  assert.ok(client.cooldownUntil('HK')>Date.now()+50_000);
  s.ready=true;s.request=undefined;delete s.request;
  s.queryParts=async(parts)=>parts.map(p=>item(p,1));
  await client.checkAvailability();
  assert.equal(client.cooldownUntil('HK'),0,'成功一次即解除冷却');
});

// ---------- 通道选择（深圳快车道 / 优先通道去重） ----------
const SZ_STORES=['R484','R761','R793'];
const szScope = { region: 'CN', city: 'CN:深圳', stores: [...SZ_STORES], coversRegion: true };
const bjScope = { region: 'CN', city: 'CN:北京', stores: ['R320'], coversRegion: false };
const szPriScope = { ...szScope, keys: ['A'] };
const normalInts = { CN: 60_000, HK: 5_000, SZ: 5_000, PRI: 20_000 };

test('通道选择：深圳通道比大陆整轮更勤时才开，否则不重复请求',()=>{
  const on=sched.selectLanes({ active:['CN'], intervals:normalInts, szScope });
  assert.deepEqual(on.lanes.map((l) => l.id),['CN','SZ']);
  const sz=on.lanes.find((l) => l.id==='SZ');
  assert.deepEqual(sz.cities,{CN:['CN:深圳']});
  assert.equal(sz.interval,5_000);assert.equal(sz.covers,true);

  // 深圳间隔不比大陆整轮短 → 不开（否则只是重复请求同一批门店）
  const off=sched.selectLanes({ active:['CN'], intervals:{...normalInts,SZ:90_000}, szScope });
  assert.deepEqual(off.lanes.map((l) => l.id),['CN']);
  // 没有深圳门店 / 深圳不在本轮地区里 → 也不开
  assert.deepEqual(sched.selectLanes({ active:['CN'], intervals:normalInts, szScope:null }).lanes.map((l) => l.id),['CN']);
  assert.deepEqual(sched.selectLanes({ active:['HK'], intervals:normalInts, szScope }).lanes.map((l) => l.id),['HK']);
});

test('通道选择：优先通道和深圳通道查同一城市时自动去重，界面能看到原因',()=>{
  const r=sched.selectLanes({ active:['CN'], intervals:normalInts, szScope, priorityScope:szPriScope });
  assert.deepEqual(r.lanes.map((l) => l.id),['CN','SZ'],'优先通道不重复查深圳');
  assert.equal(r.coveredBySz,true);
  assert.equal(r.priorityScope.city,'CN:深圳','返回范围供界面说明「已被深圳通道覆盖」');

  // 优先门店不在深圳（例如北京）：两条通道各查各的城市，都要跑
  const both=sched.selectLanes({ active:['CN'], intervals:normalInts, szScope, priorityScope:bjScope });
  assert.deepEqual(both.lanes.map((l) => l.id),['CN','SZ','PRI']);
  assert.equal(both.coveredBySz,false);

  // 优先通道比深圳通道更勤：保留优先通道（它确实更勤，不是重复）
  const faster=sched.selectLanes({ active:['CN'], intervals:{...normalInts,PRI:3_000}, szScope, priorityScope:szPriScope });
  assert.deepEqual(faster.lanes.map((l) => l.id),['CN','SZ','PRI']);
  assert.equal(faster.coveredBySz,false);
});

test('通道选择：深圳专属模式只派发深圳通道（大陆整轮 / 香港 / 优先都不跑）',()=>{
  const r=sched.selectLanes({ active:['CN','HK'], intervals:normalInts, szScope, priorityScope:szPriScope, szOnly:true });
  assert.deepEqual(r.lanes.map((l) => l.id),['SZ'],'专属模式下只有深圳通道');
  assert.equal(r.lanes[0].interval,5_000,'间隔跟香港同速');
  assert.deepEqual(r.lanes[0].cities,{CN:['CN:深圳']});
  assert.equal(r.coveredBySz,false,'专属模式不需要再解释优先通道被谁覆盖');

  // 即使深圳间隔比大陆整轮更长，专属模式下也必须保留它，否则就没有通道可跑
  const slow=sched.selectLanes({ active:['CN'], intervals:{...normalInts,SZ:90_000}, szScope, szOnly:true });
  assert.deepEqual(slow.lanes.map((l) => l.id),['SZ']);
  assert.equal(slow.lanes[0].interval,90_000);

  // 没有深圳门店 → 没有通道，交给调用方报错，绝不回退到大陆整轮
  assert.deepEqual(
    sched.selectLanes({ active:['CN','HK'], intervals:normalInts, szScope:null, szOnly:true }).lanes,
    [],
    '不能悄悄退回大陆整轮',
  );
});

test('通道选择：只有到期的通道会被派发（深圳每一轮不该顺带跑一遍大陆整轮）',()=>{
  const { lanes } = sched.selectLanes({ active:['CN'], intervals:normalInts, szScope });
  assert.deepEqual(lanes.map((l) => [l.id, l.interval]),[['CN',60_000],['SZ',5_000]]);
  const t0=1_000_000,regions=['CN','SZ'];
  const dueAt={};
  const dispatch = (at) => {
    const due=sched.dueRegions(dueAt,regions,at);
    for (const l of lanes.filter((x) => due.includes(x.id))) dueAt[l.id]=sched.nextDueAt(at,l.interval,0);
    return due;
  };
  // 第一轮：两条通道都没查过 → 都到期
  assert.deepEqual(dispatch(t0),['CN','SZ']);
  // 之后每 5 秒只有深圳到点，大陆整轮在 60 秒内都不该被派发
  for (const at of [t0+5_000,t0+10_000,t0+30_000,t0+59_000]) {
    assert.deepEqual(dispatch(at),['SZ'],`t+${(at-t0)/1000}s 只该跑深圳通道`);
  }
  // 深圳上一轮是 t+59，下一轮到 t+64；大陆整轮刚在 t+60 跑过，之后一直不该再被派发
  assert.deepEqual(dispatch(t0+60_000),['CN'],'60 秒整只有大陆整轮到期');
  assert.deepEqual(dispatch(t0+64_000),['SZ'],'深圳按自己的 5 秒间隔到点');
  for (const at of [t0+69_000,t0+90_000,t0+119_000]) {
    assert.deepEqual(dispatch(at),['SZ'],'5 秒级通道继续到点，大陆整轮不参与');
  }
});

// ---------- 深圳快车道：真实查询行为 ----------
const szCfg={...cfg,watchStores:SZ_STORES,priorityStore:'R484',priorityStoreFor:{CN:'R484'},szIntervalSeconds:5};
function szClient(extra={}) {
  const client=new ApplePickupClient({...szCfg,...extra},()=>{});
  // 深圳 3 家门店都算「深圳门店」，所以共用一个城市会话（大陆城市必须先提交定位）
  const s=client.session('CN','CN:深圳');
  s.ready=true;s.createdAt=Date.now();s.locationKey='CN:深圳';s.warmedKey='CN:深圳';
  s.ensureSession=async()=>{s.ready=true;s.createdAt=Date.now();};
  return {client,s};
}

test('深圳通道的范围只含深圳门店，且能确认全部监控门店时结果才算完整',()=>{
  const {client}=szClient();
  const scope=client.szScope();
  assert.equal(scope.region,'CN');assert.equal(scope.city,'CN:深圳');
  assert.deepEqual([...scope.stores].sort(),[...SZ_STORES].sort(),'范围内应只有深圳 3 家门店');
  assert.equal(scope.coversRegion,true,'只有深圳门店在监控列表里 → 该通道覆盖全部范围');

  // 同时监控深圳 + 北京：深圳通道只覆盖深圳，北京交给大陆整轮
  const mixed=new ApplePickupClient({...szCfg,watchStores:[...SZ_STORES,'R320']},()=>{});
  const mixedScope=mixed.szScope();
  assert.deepEqual([...mixedScope.stores].sort(),[...SZ_STORES].sort());
  assert.equal(mixedScope.coversRegion,false,'北京不在深圳通道范围内');

  // 没有深圳门店 → 不开这条通道
  assert.equal(new ApplePickupClient({...szCfg,watchStores:['R320']},()=>{}).szScope(),null);
});

test('同城高速通道适用于全国任意城市：北京 3 家门店 → 只开北京一条通道',()=>{
  const BJ=['R320','R448','R388'];
  const bj=new ApplePickupClient({...cfg,watchStores:BJ,priorityStore:'R320',priorityStoreFor:{CN:'R320'}},()=>{});
  const scope=bj.szScope();
  assert.equal(scope.region,'CN');assert.equal(scope.city,'CN:北京');
  assert.deepEqual([...scope.stores].sort(),[...BJ].sort());
  assert.equal(scope.coversRegion,true,'北京 3 家全在范围内');
  const r=sched.selectLanes({ active:['CN','HK'], intervals:normalInts, szScope:scope, cityOnly:true });
  assert.deepEqual(r.lanes.map((l) => l.id),['SZ'],'同城高速模式只跑城市通道');
  assert.deepEqual(r.lanes[0].cities,{CN:['CN:北京']});
  assert.equal(r.lanes[0].interval,5_000,'与香港同速');

  // 上海 + 北京（跨城市）：优先门店所在的上海走快车道，北京交给大陆整轮
  const mix=new ApplePickupClient({...cfg,watchStores:['R401','R320'],priorityStore:'R401',priorityStoreFor:{CN:'R401'}},()=>{});
  const ms=mix.szScope();
  assert.equal(ms.city,'CN:上海');assert.equal(ms.coversRegion,false);
  const lanes=sched.selectLanes({ active:['CN'], intervals:normalInts, szScope:ms }).lanes.map((l) => l.id);
  assert.deepEqual(lanes,['CN','SZ'],'跨城市时恢复大陆整轮 + 城市快车道');

  // 只盯香港：没有大陆城市，不开城市快车道
  assert.equal(new ApplePickupClient({...cfg,watchStores:['R499'],priorityStore:'R499'},()=>{}).szScope(),null);
});

test('深圳通道只提交深圳一处定位、只请求深圳门店，别的城市门店被丢弃',async()=>{
  const {client,s}=szClient();
  const located=[];let allowedStore='';
  s.setLocation=async(city)=>{located.push(city.key);s.locationKey=city.key;};
  s.warmUp=async()=>true;
  s.queryParts=async(parts,store)=>{allowedStore=store;assert.ok(parts.includes(REGIONS.CN.canaryPart),'每批都带大陆哨兵');
    // 接口会连带返回定位点附近的其他门店（东莞 / 广州…），本通道必须丢掉
    return parts.map(p=>p===REGIONS.CN.canaryPart
      ? {...item(p,1),eligibleStores:'R793',storeId:'R793'}
      : {...item(p,3),eligibleStores:'R484,R761,R888'});};
  const rows=await client.checkCityLane();
  assert.deepEqual(located,['CN:深圳'],'只提交深圳的定位（state/city/district）');
  assert.equal(allowedStore,'R484','触发器门店应当是本轮范围内的优先门店（R484）');
  assert.deepEqual([...rows[0].stores].sort(),['R484','R761'],'R888 不在监控列表里 → 丢弃');
  assert.equal(rows[0].lane,'SZ');assert.equal(rows[0].ok,true);
  assert.deepEqual(rows[0].scopeStores,[...SZ_STORES]);
});

test('深圳通道不覆盖的门店不会被下「无货」结论：完整轮次的结果不被局部结果覆盖',async()=>{
  const {client,s}=szClient();
  s.setLocation=async()=>{};s.warmUp=async()=>true;
  // 同时监控深圳 + 北京，深圳通道只覆盖深圳
  const mixed=new ApplePickupClient({...szCfg,watchStores:[...SZ_STORES,'R320'],priorityStoreFor:{CN:'R484'}},()=>{});
  const ms=mixed.session('CN','CN:深圳'),bs=mixed.session('CN','CN:北京');
  for(const [sess,store] of [[ms,'R484'],[bs,'R320']]) {
    sess.ready=true;sess.createdAt=Date.now();sess.warmedKey=sess.locationKey=null;
    sess.setLocation=async(city)=>{sess.locationKey=city.key;};sess.warmUp=async()=>true;
  }
  // 完整轮次：深圳没货、北京有货
  ms.queryParts=async(parts)=>parts.map(p=>p===REGIONS.CN.canaryPart?{...item(p,1),eligibleStores:'R484',storeId:'R484'}:item(p,0));
  bs.queryParts=async(parts)=>parts.map(p=>p===REGIONS.CN.canaryPart?{...item(p,1),eligibleStores:'R320',storeId:'R320'}
    :{...item(p,1),eligibleStores:'R320'});
  const [full]=await mixed.checkAvailability();
  assert.deepEqual(full.stores,['R320'],'完整轮次里北京有货');

  // 深圳通道随后只查深圳（深圳仍然没货）：只剩北京这一家门店没被本通道确认
  const [lane]=await mixed.checkCityLane();
  assert.deepEqual(lane.stores,[],'深圳通道只确认深圳');
  assert.equal(lane.complete,false,'北京不在通道范围内 → 不能算完整结论');
  assert.equal(lane.availability,'unknown','不完整时不能宣称无货');

  const merged=mixed.mergeLaneRow(full,lane);
  assert.deepEqual(merged.stores,['R320'],'北京的有货结论必须沿用完整轮次的数据');
  assert.equal(merged.complete,true);assert.equal(merged.perRegion.CN.ok,true);
});

test('深圳通道没覆盖全部门店时，本地缓存不能被当作「该地区最新且完整」复用',async()=>{
  const mixedCfg={...szCfg,watchStores:[...SZ_STORES,'R499','R320'],priorityStoreFor:{CN:'R484',HK:'R499'}};
  const mixed=new ApplePickupClient(mixedCfg,()=>{});
  const setups=[];
  // HK 只监控一家门店，一次请求就覆盖全地区；大陆同时有深圳和北京
  const hk=mixed.session('HK');hk.ready=true;hk.createdAt=Date.now();hk.warmedKey='';
  hk.queryParts=async(parts)=>parts.map(p=>({...item(p,1),eligibleStores:'R499',storeId:'R499'}));
  for(const [city,store] of [['CN:深圳','R484'],['CN:北京','R320']]) {
    const s=mixed.session('CN',city);
    s.ready=true;s.createdAt=Date.now();s.warmedKey=city;s.setLocation=async()=>{};s.warmUp=async()=>true;
    setups.push(s);
    s.queryParts=async(parts)=>parts.map(p=>p===REGIONS.CN.canaryPart?{...item(p,1),eligibleStores:store,storeId:store}
      :store==='R320'?{...item(p,1),eligibleStores:'R320'}:item(p,0));
  }
  // 完整轮次：深圳没货、北京与香港有货
  const [full]=await mixed.checkAvailability();
  assert.deepEqual([...full.stores].sort(),['R320','R499'].sort());
  assert.equal(full.complete,true);
  // 只查深圳这一个城市（等价于深圳通道刚跑完）：本地缓存的范围随即缩到深圳
  const [szOnly]=await mixed.checkAvailability({only:['CN'],cities:{CN:['CN:深圳']}});
  assert.deepEqual(szOnly.stores,[],'深圳没货');
  assert.equal(szOnly.perRegion.CN.ok,true);
  // 香港这一轮不要重复请求大陆，改用近期结果：缓存只覆盖深圳，不能替北京下结论
  const [reused]=await mixed.checkAvailability({only:['HK'],reuseMaxAgeMs:60_000});
  assert.equal(reused.perRegion.CN.pending,true,'缓存没覆盖北京 → 只能标成「本轮未查询」');
  assert.equal(reused.perRegion.CN.ok,false);
  assert.equal(reused.complete,false);
  assert.deepEqual([...reused.stores],['R499'],'香港这轮有货的结果照常保留');
  // 覆盖全部监控门店的完整轮次结果才可以被复用
  await mixed.checkAvailability();
  const [ok]=await mixed.checkAvailability({only:['HK'],reuseMaxAgeMs:60_000});
  assert.notEqual(ok.perRegion.CN.pending,true,'完整轮次的结果可以被复用');
  assert.deepEqual([...ok.stores].sort(),['R320','R499'].sort());
  assert.equal(ok.complete,true);
  assert.equal(setups.length,2);
});

// ---------- 提速：长连接 / 后台换会话 / 短超时 ----------
const tick=()=>new Promise(r=>setTimeout(r,0));

test('已安装 undici 时查询走长连接',()=>{
  assert.equal(httpKeepAliveEnabled(),true);
});

test('网络超时 / 断连：保留会话快速重试，不重建会话',async()=>{
  const {client,s}=mockSession();client.cfg.maxRetries=3;
  let calls=0,rebuilt=0;
  s.ensureSession=async()=>{rebuilt++;};
  s.queryParts=async(parts)=>{calls++;
    if(calls===1){const e=new Error('HK：请求超时');e.transient=true;throw e;}
    return parts.map(p=>item(p,1));};
  const t0=Date.now();const [r]=await client.checkAvailability();
  assert.equal(r.atPriority,true);assert.equal(calls,2);
  assert.equal(rebuilt,0,'网络错误不作废会话');assert.equal(s.ready,true);
  assert.ok(Date.now()-t0<1000,'快速重试，而不是 1.5 秒起步的退避');
});

test('非网络错误（哨兵无数据）仍然作废会话并当场重建',async()=>{
  const {client,s}=mockSession();client.cfg.maxRetries=2;
  let calls=0,rebuilt=0;
  s.ensureSession=async()=>{rebuilt++;s.ready=true;s.createdAt=Date.now();};
  s.warmUp=async()=>true;
  s.queryParts=async(parts)=>{calls++;
    if(calls===1)return [];
    return parts.map(p=>item(p,1));};
  const [r]=await client.checkAvailability();
  assert.equal(r.atPriority,true);assert.equal(rebuilt,1);
});

test('库存请求用短超时；卡住的连接 / 网络错误报 transient',async()=>{
  const {client,s}=mockSession();
  client.cfg.queryTimeoutMs=50;client.cfg.requestTimeoutMs=25_000;
  const orig=globalThis.fetch;
  try{
    globalThis.fetch=(url,init)=>new Promise((_,rej)=>init.signal.addEventListener('abort',()=>rej(new DOMException('aborted','AbortError'))));
    const t0=Date.now();
    await assert.rejects(s.queryParts(['X'],'R499'),(e)=>e.transient===true&&/超时/.test(e.message));
    assert.ok(Date.now()-t0<2000,'不会等满 25 秒');
    globalThis.fetch=async()=>{const e=new TypeError('fetch failed');e.cause={code:'ECONNRESET'};throw e;};
    await assert.rejects(s.queryParts(['X'],'R499'),(e)=>e.transient===true&&/ECONNRESET/.test(e.message));
  }finally{globalThis.fetch=orig;}
});

test('会话过期：旧会话继续查询，新会话后台建好后下一轮换上，查询路径不重建',async()=>{
  const {client,s}=mockSession();
  const used=[];let inline=0,built=0;const gate=deferred();
  s.createdAt=Date.now()-31*60_000;
  s.ensureSession=async()=>{inline++;};
  s.queryParts=async(parts)=>{used.push('old');return parts.map(p=>item(p,1));};
  const origNew=client.newSession.bind(client);
  client.newSession=(r)=>{built++;const n=origNew(r);
    n.ensureSession=async()=>{await gate.promise;n.ready=true;n.createdAt=Date.now();};
    n.warmUp=async()=>true;
    n.queryParts=async(parts)=>{used.push('new');return parts.map(p=>item(p,1));};
    return n;};
  const [a]=await client.checkAvailability();
  const [b]=await client.checkAvailability();
  assert.ok(a.atPriority&&b.atPriority,'新会话建好之前，旧会话照常出结果');
  assert.equal(built,1,'只预建一个备用会话');
  gate.resolve();await tick();await tick();
  const [c]=await client.checkAvailability();
  assert.ok(c.atPriority);
  assert.deepEqual(used,['old','old','new']);
  assert.equal(inline,0,'查询路径里没有同步重建');
});

test('后台预建失败：记日志，旧会话继续用，冷却期内不反复重建',async()=>{
  const logs=[];
  const client=new ApplePickupClient({...cfg,watchRegions:['HK'],watchStores:['R499']},(m)=>logs.push(m));
  const s=client.session('HK');s.ready=true;s.createdAt=Date.now()-31*60_000;s.warmedKey='';
  s.queryParts=async(parts)=>parts.map(p=>item(p,1));
  let built=0;const origNew=client.newSession.bind(client);
  client.newSession=(r)=>{built++;const n=origNew(r);n.ensureSession=async()=>{throw new Error('init 503');};return n;};
  const [r1]=await client.checkAvailability();await tick();
  const [r2]=await client.checkAvailability();await tick();
  assert.ok(r1.atPriority&&r2.atPriority);
  assert.equal(built,1,'冷却期内不再预建');
  assert.ok(logs.some(m=>/后台预建新会话失败/.test(m)));
});
