import {api,uid} from './api';
import {Config,Resource} from './types';
export function needsReward(r:Resource,c:Config){return r.accessMode==='REWARDED'&&c.adsEnabled}
export async function watchReward(r:Resource,c:Config,registerCleanup:(cancel:()=>void)=>void = ()=>{}):Promise<string|undefined>{
 if(!needsReward(r,c))return undefined;
 if(!c.rewardedAdUnitId||!wx.createRewardedVideoAd)throw new Error('广告暂不可用，可返回发现页选择免费素材');
 const session=await api<{id:string}>('/rewards/sessions','POST',{resourceId:r.id,requestId:uid()});
 const ad=wx.createRewardedVideoAd({adUnitId:c.rewardedAdUnitId});
 await new Promise<void>((resolve,reject)=>{let settled=false;const cleanup=()=>{ad.offClose(close);ad.offError(fail)};const finish=(err?:Error)=>{if(settled)return;settled=true;cleanup();err?reject(err):resolve()};const close=(res:{isEnded?:boolean})=>{res?.isEnded===true?finish():finish(new Error('未完整观看，本次未解锁；也可以选择免费素材'))};const fail=()=>finish(new Error('广告加载失败，请重试或选择免费素材'));registerCleanup(()=>finish(new Error('领取页面已关闭')));if(settled)return;ad.onClose(close);ad.onError(fail);ad.load().then(()=>{if(!settled)return ad.show()}).catch(fail)});
 await api('/rewards/sessions/'+encodeURIComponent(session.id)+'/complete','POST',{completed:true});return session.id;
}
