import {API_BASE, DEMO_ENABLED} from './config';
import {demoResources} from './demo';
import {Config} from './types';
export function uid(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12)}
let visitor = wx.getStorageSync('visitor'); if(!visitor){visitor=uid();wx.setStorageSync('visitor',visitor)}
export function asset(url:string){return url && url.startsWith('/') ? API_BASE.replace(/\/api$/,'')+url : url}
export function api<T>(path:string,method:'GET'|'POST'|'PUT'|'DELETE'='GET',data?:unknown):Promise<T>{
 if(DEMO_ENABLED && wx.getAccountInfoSync().miniProgram.envVersion==='develop' && path.startsWith('/resources') && method==='GET')return Promise.resolve((path.includes('?')?{items:demoResources,total:demoResources.length,page:1,pageSize:12}:demoResources.find(x=>x.id===path.split('/')[2])) as T);
 return new Promise((resolve,reject)=>wx.request({url:API_BASE+path,method,data:data as any,timeout:15000,header:{'Content-Type':'application/json','X-Visitor-Id':visitor,...(wx.getStorageSync('token')?{Authorization:'Bearer '+wx.getStorageSync('token')}:{})},success:r=>{if(r.statusCode>=200&&r.statusCode<300)resolve(r.data as T);else{if(r.statusCode===401)wx.removeStorageSync('token');const d=r.data as {message?:string|string[]};reject(new Error(Array.isArray(d?.message)?d.message.join('；'):d?.message||'服务暂时不可用，请重试'))}},fail:()=>reject(new Error('网络连接失败，请检查网络后重试'))}));
}
let config:Config|undefined;
export async function getConfig(){if(!config)config=await api<Config>('/config');return config}
export function errorText(e:unknown){return e instanceof Error?e.message:'操作失败，请重试'}
export function toast(e:unknown){wx.showToast({title:errorText(e),icon:'none',duration:2500})}
export function resourceView(r:any){return {...r,coverUrl:asset(r.coverUrl),previewUrls:(r.previewUrls||[]).map(asset)}}
