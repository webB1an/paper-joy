import {favorites,syncFavorites} from '../../lib/store';
import {resourceView} from '../../lib/api';
Page({
 data:{items:[] as any[]},
 refreshVersion:0,
 onShow(){
  const version=++this.refreshVersion;
  this.getTabBar()?.setData({selected:2});
  this.setData({items:favorites().map(resourceView)});
  if(wx.getStorageSync('token')){
   void syncFavorites().then(()=>{if(this.refreshVersion===version)this.setData({items:favorites().map(resourceView)});}).catch(()=>undefined);
  }
 },
 onHide(){this.refreshVersion++;},
 onUnload(){this.refreshVersion++;},
 discover(){wx.switchTab({url:'/pages/discover/index'})}
});
