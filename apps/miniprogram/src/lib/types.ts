export interface Resource {id:string;slug:string;title:string;summary:string;categoryId:string;topicIds:string[];tags:string[];ageMin:number;ageMax:number;difficulty:'EASY'|'MEDIUM'|'HARD';pageCount:number;paperSize:'A4';colorMode:'BW'|'COLOR';hasAnswers:boolean;materials:string[];instructions:string;coverUrl:string;previewUrls:string[];accessMode:'FREE'|'REWARDED';sources:{title:string;author:string;url:string;license:string}[];availableProviders:('baidu'|'quark')[]}
export interface Taxonomy{id:string;name:string;slug:string;description?:string;coverUrl?:string}
export interface Config{appName:string;appId:string;adsEnabled:boolean;rewardedAdUnitId:string;loginEnabled:boolean;supportContact:string;privacyVersion:string}
export interface Claim{claimId:string;links:{provider:'baidu'|'quark';url:string;extractionCode:string}[];claimedAt:string}
export interface History{id:string;resourceId:string;resourceTitle:string;createdAt:string}
