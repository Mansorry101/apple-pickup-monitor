import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplePickupClient } from '../src/apple.js';
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
  const products=Array.from({length:9},(_,i)=>({...product,key:'P'+i,parts:{HK:'TEST'+i+'ZP/A'}}));
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

test('前次失败的城市和送达日期不能混入重试结果',async()=>{
  const client=new ApplePickupClient({...cfg,watchRegions:['CN'],watchStores:['R401','R320'],maxRetries:2},()=>{});
  const s=client.session('CN');let attempt=0,city;
  s.ensureSession=async()=>{attempt++;s.ready=true;s.createdAt=Date.now();s.warmedKey=null;};
  s.setLocation=async(value)=>{city=value.city;};s.warmUp=async()=>true;
  s.queryParts=async(parts)=>{
    if(attempt===1 && city==='北京')throw new Error('Beijing timeout');
    return parts.map(p=>({...item(p,attempt===1?1:0),
      ...(attempt===1?{deliveryMessage:{deliveryOptions:[{date:'OLD-DATE'}]}}:{})}));
  };
  const data=await client.checkRegion('CN',[product]);
  assert.equal(attempt,2);assert.deepEqual(data.P.stores,[]);assert.equal(data.P.deliveryDate,null);
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
      const s=client.session(region);s.ready=true;s.createdAt=Date.now();s.warmedKey='';
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
