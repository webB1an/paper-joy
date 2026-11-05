import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const one={id:'one',title:'Local favorite'},two={id:'two',title:'Remote favorite'};
const tick=()=>new Promise(setImmediate);
function harness({saved=new Map(),request=async()=>[]}={}){
 const calls=[],toasts=[];
 const wx={getStorageSync:key=>saved.get(key),setStorageSync:(key,value)=>saved.set(key,structuredClone(value)),showToast:value=>toasts.push(value),login:({success})=>success({code:'wechat-code'})};
 const exported={};
 const js=ts.transpileModule(readFileSync(new URL('../src/lib/store.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText;
 vm.runInNewContext(js,{exports:exported,require:()=>({uid:()=> 'id',api:async(path,method='GET',data)=>{calls.push({path,method,data});return request(path,method,data);}}),wx,Date,Math,Promise,Map,Set,Error});
 return {store:exported,saved,calls,toasts,wx};
}
function ids(resources){return Array.from(resources,r=>r.id).sort();}
test('login merges local and cloud favorites and queues only missing local resources',async()=>{
 const h=harness({saved:new Map([['favorites',[one]]]),request:async(path,method)=>path==='/user/login'?{token:'token'}:method==='GET'?[two]:{ok:true}});
 await h.store.login();assert.deepEqual(ids(h.store.favorites()),['one','two']);assert.equal(h.saved.get('token'),'token');
 assert.deepEqual(h.calls.filter(c=>c.method==='PUT').map(c=>c.path),['/user/favorites/one']);assert.equal(h.saved.get('favoriteSyncQueue').length,0);
});
test('offline removal survives application restart and a stale cloud snapshot',async()=>{
 const saved=new Map([['token','token'],['favorites',[one]],['favoriteSyncInitialized',true]]);
 const offline=harness({saved,request:async()=>{throw Error('offline');}});
 assert.equal(await offline.store.toggleFavorite(one),false);assert.deepEqual(ids(offline.store.favorites()),[]);assert.equal(saved.get('favoriteSyncQueue')[0].method,'DELETE');
 const online=harness({saved,request:async(_path,method)=>method==='GET'?[one]:{ok:true}});
 assert.equal(await online.store.syncFavorites(),true);assert.deepEqual(ids(online.store.favorites()),[]);assert.equal(saved.get('favoriteSyncQueue').length,0);
 assert.equal(online.calls.some(c=>c.method==='DELETE'&&c.path==='/user/favorites/one'),true);
});
test('failed add stays local and retries later without losing remote favorites',async()=>{
 let fail=true;const remote=[two];
 const h=harness({saved:new Map([['token','token'],['favoriteSyncInitialized',true]]),request:async(_path,method)=>{if(method==='GET')return remote.slice();if(fail)throw Error('upload failed');remote.push(one);return {ok:true};}});
 assert.equal(await h.store.toggleFavorite(one),true);assert.deepEqual(ids(h.store.favorites()),['one','two']);assert.equal(h.saved.get('favoriteSyncQueue').length,1);
 fail=false;assert.equal(await h.store.syncFavorites(),true);assert.equal(h.saved.get('favoriteSyncQueue').length,0);assert.deepEqual(ids(h.store.favorites()),['one','two']);
});
test('new removal while an add is in flight is not acknowledged by the old add response',async()=>{
 let finishPut;const methods=[];
 const h=harness({saved:new Map([['token','token'],['favoriteSyncInitialized',true]]),request:async(_path,method)=>{methods.push(method);if(method==='GET')return [];if(method==='PUT')await new Promise(resolve=>{finishPut=resolve;});return {ok:true};}});
 const add=h.store.toggleFavorite(one);await tick();assert.equal(typeof finishPut,'function');
 const remove=h.store.toggleFavorite(one);assert.deepEqual(ids(h.store.favorites()),[]);assert.equal(h.saved.get('favoriteSyncQueue')[0].method,'DELETE');
 finishPut();assert.equal(await add,false);assert.equal(await remove,false);assert.deepEqual(methods,['GET','PUT','DELETE']);assert.equal(h.saved.get('favoriteSyncQueue').length,0);
});
test('mutation during remote fetch overlays the returned cloud snapshot',async()=>{
 let finishGet;const h=harness({saved:new Map([['token','token'],['favorites',[one]],['favoriteSyncInitialized',true]]),request:async(_path,method)=>method==='GET'?new Promise(resolve=>{finishGet=resolve;}):{ok:true}});
 const refresh=h.store.syncFavorites();const removed=h.store.toggleFavorite(one);finishGet([one,two]);await refresh;await removed;assert.deepEqual(ids(h.store.favorites()),['two']);
});
test('anonymous operations remain local and are synced after login, including removals',async()=>{
 const h=harness({request:async(path,method)=>path==='/user/login'?{token:'token'}:method==='GET'?[one]:{ok:true}});
 await h.store.toggleFavorite(one);await h.store.toggleFavorite(one);await h.store.toggleFavorite(two);assert.equal(h.calls.length,0);
 await h.store.login();assert.deepEqual(ids(h.store.favorites()),['two']);assert.deepEqual(h.calls.filter(c=>['PUT','DELETE'].includes(c.method)).map(c=>[c.path,c.method]),[['/user/favorites/one','DELETE'],['/user/favorites/two','PUT']]);
});
test('login preserves token, local data and queue when cloud sync is unavailable',async()=>{
 const h=harness({saved:new Map([['favorites',[one]]]),request:async path=>{if(path==='/user/login')return {token:'token'};throw Error('offline');}});
 await assert.rejects(h.store.login(),/已登录/);assert.equal(h.saved.get('token'),'token');assert.deepEqual(ids(h.store.favorites()),['one']);assert.equal(h.saved.get('favoriteSyncQueue').length,1);assert.equal(await h.store.syncFavorites(),false);
});
test('favorites page shows local immediately, refreshes cloud onShow, and catches offline failures',async()=>{
 let remote=[two];const h=harness({saved:new Map([['token','token'],['favorites',[one]],['favoriteSyncInitialized',true]]),request:async()=>remote});let definition;
 const js=ts.transpileModule(readFileSync(new URL('../src/pages/favorites/index.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText;
 vm.runInNewContext(js,{exports:{},Page:value=>definition=value,require:name=>name.endsWith('/store')?h.store:{resourceView:r=>r},wx:h.wx,Promise});
 const page={...definition,data:{items:[]},getTabBar:()=>undefined,setData(value){Object.assign(this.data,value);}};
 page.onShow();assert.deepEqual(ids(page.data.items),['one']);await tick();assert.deepEqual(ids(page.data.items),['two']);
 remote=[one,two];page.onShow();await tick();assert.deepEqual(ids(page.data.items),['one','two']);
 assert.equal(h.calls.filter(c=>c.path==='/user/favorites').length,2);
 h.store.syncFavorites=()=>Promise.reject(Error('background failure'));page.onShow();await tick();assert.deepEqual(ids(page.data.items),['one','two']);
});
test('favorites page does not update a hidden page after refresh completes',async()=>{
 let finish,definition;const wx={getStorageSync:()=> 'token'};
 const js=ts.transpileModule(readFileSync(new URL('../src/pages/favorites/index.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText;
 vm.runInNewContext(js,{exports:{},Page:value=>definition=value,require:name=>name.endsWith('/store')?{favorites:()=>[one],syncFavorites:()=>new Promise(resolve=>{finish=resolve;})}:{resourceView:r=>r},wx,Promise});
 let updates=0;const page={...definition,getTabBar:()=>undefined,setData(){updates++;}};page.onShow();page.onHide();finish(true);await tick();assert.equal(updates,1);
});
test('one failed favorite does not block independent queued mutations',async()=>{
 const h=harness({request:async(_path,method)=>{if(method==='GET')return [];if(_path.endsWith('/one'))throw Error('resource unavailable');return {ok:true};}});
 await h.store.toggleFavorite(one);await h.store.toggleFavorite(two);h.saved.set('token','token');assert.equal(await h.store.syncFavorites(),false);
 assert.deepEqual(ids(h.store.favorites()),['one','two']);assert.equal(h.saved.get('favoriteSyncQueue').length,1);assert.equal(h.saved.get('favoriteSyncQueue')[0].resourceId,'one');assert.equal(h.calls.some(c=>c.method==='PUT'&&c.path==='/user/favorites/two'),true);
});
