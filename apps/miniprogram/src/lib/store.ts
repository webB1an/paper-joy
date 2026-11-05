import {Resource,History} from './types';
import {api,uid} from './api';

type FavoriteOperation={resourceId:string;method:'PUT'|'DELETE';revision:string;resource?:Resource};
const QUEUE_KEY='favoriteSyncQueue';
const INITIALIZED_KEY='favoriteSyncInitialized';
let revision=0;
let syncing:Promise<boolean>|undefined;
let syncingToken:string|undefined;

export function favorites():Resource[]{
 const saved=wx.getStorageSync('favorites');
 return Array.isArray(saved)?saved:[];
}
export function isFavorite(id:string){return favorites().some(x=>x.id===id)}
function pending():FavoriteOperation[]{
 const saved=wx.getStorageSync(QUEUE_KEY);
 return Array.isArray(saved)?saved.filter(x=>x&&typeof x.resourceId==='string'&&(x.method==='PUT'||x.method==='DELETE')&&typeof x.revision==='string'):[];
}
function enqueue(resource:Resource,method:'PUT'|'DELETE'){
 const operation:FavoriteOperation={resourceId:resource.id,method,revision:`${Date.now()}-${++revision}`,...(method==='PUT'?{resource}:{})};
 wx.setStorageSync(QUEUE_KEY,[...pending().filter(x=>x.resourceId!==resource.id),operation]);
}
function queueLocalMerge(){
 // Pending removals take precedence over both local and remote snapshots.
 const queued=new Set(pending().map(x=>x.resourceId));
 for(const resource of favorites())if(!queued.has(resource.id))enqueue(resource,'PUT');
 wx.setStorageSync(INITIALIZED_KEY,true);
}
function overlay(remote:Resource[],operations:FavoriteOperation[]){
 const merged=new Map(remote.map(resource=>[resource.id,resource]));
 const local=new Map(favorites().map(resource=>[resource.id,resource]));
 for(const operation of operations){
  if(operation.method==='DELETE')merged.delete(operation.resourceId);
  else {const resource=local.get(operation.resourceId)||operation.resource;if(resource)merged.set(operation.resourceId,resource);}
 }
 return [...merged.values()];
}
async function synchronize(token:string):Promise<boolean>{
 if(!wx.getStorageSync(INITIALIZED_KEY))queueLocalMerge();
 const remote=await api<Resource[]>('/user/favorites');
 if(wx.getStorageSync('token')!==token||!Array.isArray(remote))return false;
 // Read pending mutations after the request resolves: a user may have toggled
 // a favorite while the remote snapshot was being fetched.
 wx.setStorageSync('favorites',overlay(remote,pending()));
 const attempted=new Set<string>();
 while(true){
  if(wx.getStorageSync('token')!==token)return false;
  const operation=pending().find(x=>!attempted.has(x.resourceId+':'+x.revision));
  if(!operation)break;
  attempted.add(operation.resourceId+':'+operation.revision);
  try{await api('/user/favorites/'+encodeURIComponent(operation.resourceId),operation.method);}
  catch{if(wx.getStorageSync('token')!==token)return false;continue;}
  if(wx.getStorageSync('token')!==token)return false;
  // A response for an older PUT must never acknowledge a newer DELETE.
  wx.setStorageSync(QUEUE_KEY,pending().filter(x=>x.revision!==operation.revision||x.resourceId!==operation.resourceId));
 }
 return pending().length===0;
}
export function syncFavorites():Promise<boolean>{
 const token=wx.getStorageSync('token') as string|undefined;
 if(!token)return Promise.resolve(true);
 if(syncing){
  if(syncingToken===token)return syncing;
  return syncing.then(()=>syncFavorites());
 }
 syncingToken=token;
 syncing=synchronize(token).catch(()=>false).then(success=>{syncing=undefined;syncingToken=undefined;return success;});
 return syncing;
}
export async function toggleFavorite(resource:Resource){
 const exists=isFavorite(resource.id);
 // Persist the mutation before starting any network work, including deletions.
 enqueue(resource,exists?'DELETE':'PUT');
 wx.setStorageSync('favorites',exists?favorites().filter(x=>x.id!==resource.id):[resource,...favorites()]);
 if(wx.getStorageSync('token')&&!await syncFavorites())wx.showToast({title:'已保存到本机，联网后重试同步',icon:'none'});
 return isFavorite(resource.id);
}
export function history():History[]{return wx.getStorageSync('history')||[]}
export function recordClaim(r:Resource){wx.setStorageSync('history',[{id:uid(),resourceId:r.id,resourceTitle:r.title,createdAt:new Date().toISOString()},...history()].slice(0,100))}
export async function login(){
 const {code}=await new Promise<WechatMiniprogram.LoginSuccessCallbackResult>((resolve,reject)=>wx.login({success:resolve,fail:reject}));
 const result=await api<{token:string}>('/user/login','POST',{code});
 wx.setStorageSync('token',result.token);
 queueLocalMerge();
 if(!await syncFavorites())throw new Error('已登录，收藏已保存在本机，联网后可重试同步');
}
