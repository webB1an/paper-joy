import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
rmSync('dist',{recursive:true,force:true});
execFileSync(process.execPath,[resolve('../../node_modules/typescript/bin/tsc'),'-p','tsconfig.json'],{stdio:'inherit'});
function copy(dir,dest){mkdirSync(dest,{recursive:true});for(const e of readdirSync(dir,{withFileTypes:true})){const a=join(dir,e.name),b=join(dest,e.name);if(e.isDirectory())copy(a,b);else if(!e.name.endsWith('.ts'))copyFileSync(a,b)}}copy('src','dist');
