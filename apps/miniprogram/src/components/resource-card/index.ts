Component({properties:{item:{type:Object,value:{}}},methods:{open(){wx.navigateTo({url:'/pages/detail/index?id='+encodeURIComponent((this.data.item as {id:string}).id)})}}});
