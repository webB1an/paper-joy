import { api, getConfig } from './lib/api';
App({onLaunch(){getConfig().catch(()=>{});},globalData:{api}});
