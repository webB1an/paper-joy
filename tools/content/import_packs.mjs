import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const base=(process.env.PAPERJOY_API_URL || 'http://127.0.0.1:4001/api').replace(/\/$/,'');
if(!process.env.PAPERJOY_ADMIN_TOKEN) throw Error('Set PAPERJOY_ADMIN_TOKEN privately; it will not be printed');
const token=process.env.PAPERJOY_ADMIN_TOKEN;
async function request(path,options={}) {
 const response=await fetch(base+path,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers}});
 const body=await response.json();if(!response.ok)throw Error(JSON.stringify({path,status:response.status,message:body.message}));return body;
}
const categories=await request('/admin/categories');
for(const slug of ['nature-coloring','graded-mazes','pencil-rewards']) {
 const dir=resolve('output/pdf',slug),manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
 const category=categories.find(c=>c.slug===manifest.resource.categoryId);
 if(!category)throw Error('Missing category '+manifest.resource.categoryId);
 manifest.resource.categoryId=category.id;
 delete manifest.resource.version;
 const form=new FormData();form.set('manifest',JSON.stringify(manifest));
 form.set('source',new Blob([await readFile(join(dir,'source.pdf'))],{type:'application/pdf'}),`${slug}.pdf`);
 for(const name of manifest.previews)form.append('previews',new Blob([await readFile(join(dir,name))],{type:'image/jpeg'}),name);
 const result=await request('/admin/imports',{method:'POST',body:form});
 console.log(JSON.stringify({pack:slug,...result}));
}
