import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
function load(name,{wx={},api={},store={}}={}){const exports={};const js=ts.transpileModule(readFileSync(new URL('../src/lib/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText;vm.runInNewContext(js,{exports,require:n=>n==='./api'?api:n==='./store'?store:{},wx,console,Date,Math,Promise,Map,Error});return exports}
function rewardHarness(){let close,fail;const events=[],off=[];const ad={onClose:f=>close=f,onError:f=>fail=f,offClose:f=>off.push(f),offError:f=>off.push(f),load:async()=>{events.push('load')},show:async()=>{events.push('show')}};const api={uid:()=> 'request',api:async(path,method,data)=>{events.push(path);return {id:'session'}}};const lib=load('reward',{wx:{createRewardedVideoAd:()=>ad},api});return {lib,events,off,close:r=>close(r),error:()=>fail(),ad}}
const resource={id:'stable',accessMode:'REWARDED'},config={adsEnabled:true,rewardedAdUnitId:'unit'};
test('disabled ads are free and do not create reward session',async()=>{const h=rewardHarness();assert.equal(await h.lib.watchReward(resource,{adsEnabled:false}),undefined);assert.deepEqual(h.events,[]) });
test('full ad completion is required before completion endpoint, handlers removed',async()=>{const h=rewardHarness();const result=h.lib.watchReward(resource,config);await new Promise(setImmediate);assert.deepEqual(h.events,['/rewards/sessions','load','show']);h.close({isEnded:true});assert.equal(await result,'session');assert.equal(h.events.at(-1),'/rewards/sessions/session/complete');assert.equal(h.off.length,2)});
test('cancelled ad never completes session',async()=>{const h=rewardHarness();const result=h.lib.watchReward(resource,config);await new Promise(setImmediate);h.close({isEnded:false});await assert.rejects(result,/未完整观看/);assert.equal(h.events.some(x=>x.endsWith('/complete')),false);assert.equal(h.off.length,2)});
test('unloading page detaches both ad handlers and cancels promise',async()=>{const h=rewardHarness();let cancel;const result=h.lib.watchReward(resource,config,f=>cancel=f);await new Promise(setImmediate);cancel();await assert.rejects(result,/已关闭/);assert.equal(h.off.length,2)});
test('ad load failure cleans listeners and offers free alternatives',async()=>{const h=rewardHarness();h.ad.load=async()=>{throw Error('offline')};await assert.rejects(h.lib.watchReward(resource,config),/免费素材/);assert.equal(h.off.length,2);assert.equal(h.events.some(x=>x.endsWith('/complete')),false)});
test('favorites persist locally without requiring login',async()=>{const data=new Map();const wx={getStorageSync:k=>data.get(k),setStorageSync:(k,v)=>data.set(k,v)};let requests=0;const lib=load('store',{wx,api:{api:async()=>{requests++}}});assert.equal(await lib.toggleFavorite({id:'one'}),true);assert.equal(lib.favorites().length,1);assert.equal(await lib.toggleFavorite({id:'one'}),false);assert.equal(lib.favorites().length,0);assert.equal(requests,0)});

test('page disposed while reward session loads never starts video',async()=>{const h=rewardHarness();await assert.rejects(h.lib.watchReward(resource,config,cancel=>cancel()),/已关闭/);assert.deepEqual(h.events,['/rewards/sessions']);assert.equal(h.off.length,2)});

test('unload during pending ad.load never shows video after load resolves',async()=>{
 const h=rewardHarness();let resolveLoad,cancel;
 h.ad.load=()=>new Promise(resolve=>{resolveLoad=resolve});
 const result=h.lib.watchReward(resource,config,f=>cancel=f);
 await new Promise(setImmediate);
 const rejected=assert.rejects(result,/已关闭/);
 cancel();resolveLoad();await rejected;await new Promise(setImmediate);
 assert.equal(h.events.includes('show'),false);
 assert.equal(h.events.some(x=>x.endsWith('/complete')),false);
 assert.equal(h.off.length,2);
});

test('each claim page visit starts a fresh id and reward lifecycle',()=>{
 let registered,sequence=0;
 const js=ts.transpileModule(readFileSync(new URL('../src/pages/claim/index.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText;
 vm.runInNewContext(js,{exports:{},Page:p=>registered=p,require:n=>n.endsWith('/api')?{uid:()=>`request-${++sequence}`}:{},wx:{}});
 const page={...registered,data:{...registered.data},setData(d){Object.assign(this.data,d)},load(){}};
 page.onLoad({id:'first'});const first=page.requestId;
 page.disposed=true;page.sessionId='old-session';page.onLoad({id:'first'});
 assert.notEqual(page.requestId,first);assert.equal(page.disposed,false);assert.equal(page.sessionId,undefined);
});
