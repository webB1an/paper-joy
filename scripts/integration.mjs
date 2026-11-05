import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {fork} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import 'dotenv/config';

if(new URL(process.env.DATABASE_URL).pathname!=='/paper_joy_test')throw Error('Integration tests require the isolated paper_joy_test database');
const db=new PrismaClient();let base='';
const storage=await mkdtemp(join(tmpdir(),'paperjoy-test-'));
const server=fork(resolve('apps/api/dist/main.js'),[],{env:{...process.env,NODE_ENV:'test',PORT:'0',HOST:'127.0.0.1',STORAGE_ROOT:storage,DEV_WECHAT_MOCK:'false',DISABLE_STORAGE_WORKER:'true',BDPAN_PATH:'',QUARK_SKILL_DIR:''},stdio:['ignore','ignore','ignore','ipc']});
const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Isolated API startup timeout')),20000);server.once('error',e=>{clearTimeout(timer);reject(e)});server.once('exit',code=>{clearTimeout(timer);reject(Error('Isolated API exited '+code))});server.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve(m.port)}})});
let token='';const visitor='integration-'+randomUUID();const created=[];const categories=[];
async function req(path,method='GET',body,admin=false,expected=200,extra={}){
 const headers={...(admin?{Authorization:`Bearer ${token}`}:{'X-Visitor-Id':visitor}),...extra};
 if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';
 const response=await fetch(base+path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined,redirect:'manual'});
 const data=await response.json().catch(()=>null);
 assert.equal(response.status,expected,JSON.stringify({path,status:response.status,data}));return data;
}
try{
 base='http://127.0.0.1:'+await ready;
 await req('/health');
 await req('/api/admin/stats','GET',undefined,false,401);
 const login=await req('/api/admin/login','POST',{username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD});token=login.token;
 const tax=await req('/api/admin/categories','POST',{name:'集成测试分类',slug:'qa-'+randomUUID().slice(0,8),description:'temporary integration record'},true);categories.push(tax.id);
 const resource={slug:'qa-'+randomUUID().slice(0,8),title:'集成测试活动',summary:'isolated test only',categoryId:tax.id,topicIds:[],tags:['测试'],ageMin:4,ageMax:7,difficulty:'EASY',pageCount:12,paperSize:'A4',colorMode:'BW',hasAnswers:false,materials:['A4'],instructions:'实际大小打印',coverUrl:'/assets/previews/missing.jpg',previewUrls:[],accessMode:'FREE',status:'DRAFT',sources:[{title:'原创版式',author:'PaperJoy',url:'https://github.com/webB1an/paper-joy',license:'Original'}]};
 const r=await req('/api/admin/resources','POST',resource,true);created.push(r.id);
 await req(`/api/resources/${r.id}`,'GET',undefined,false,404);
 await req(`/api/admin/resources/${r.id}/publish`,'POST',{},true,400);
 const f=new FormData();f.set('file',new Blob([await readFile('output/pdf/pencil-rewards/preview-1.jpg')],{type:'image/jpeg'}),'preview.jpg');
 const preview=await req('/api/admin/uploads/preview','POST',f,true);
 await req(`/api/admin/resources/${r.id}`,'PATCH',{...resource,coverUrl:preview.url,previewUrls:[preview.url]},true);
 await req(`/api/admin/resources/${r.id}/links`,'PUT',{links:[{provider:'baidu',url:'https://pan.baidu.com.evil.example/s/fake'}]},true,400);
 // Synthetic links are used only in this isolated test record and are deleted below.
 await req(`/api/admin/resources/${r.id}/links`,'PUT',{links:[{provider:'baidu',url:'https://pan.baidu.com/s/QA_ONLY_NOT_REAL',extractionCode:'test'}]},true);
 await req(`/api/admin/resources/${r.id}/publish`,'POST',{},true);
 const detail=await req(`/api/resources/${r.id}`);assert(!('sourcePath'in detail));assert(!('links'in detail));
 const input={requestId:randomUUID()};const first=await req(`/api/resources/${r.id}/claim`,'POST',input);const second=await req(`/api/resources/${r.id}/claim`,'POST',input);assert.equal(first.claimId,second.claimId);assert.equal(first.links.length,1);
 await req('/api/user/favorites','GET',undefined,false,401,{'X-Openid':'forged'});
 const feedback=await req('/api/feedback','POST',{resourceId:r.id,type:'CONTENT',message:'Integration feedback'});
 await req(`/api/admin/feedback/${feedback.id}`,'PATCH',{status:'RESOLVED'},true);
 await db.feedback.delete({where:{id:feedback.id}});
 await req(`/api/admin/resources/${r.id}/archive`,'POST',{},true);await req(`/api/resources/${r.id}`,'GET',undefined,false,404);
 console.log('PASS: real MySQL auth, taxonomy, publication, preview upload, redirect validation, claims replay, private data, feedback and archive');
} finally {
 for(const id of created){await db.claim.deleteMany({where:{resourceId:id}});await db.event.deleteMany({where:{resourceId:id}});await db.resource.deleteMany({where:{id}})}
 for(const id of categories)await db.taxonomy.deleteMany({where:{id}});
 await db.$disconnect();
 server.kill();
 await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));
 await rm(storage,{recursive:true,force:true});
}
