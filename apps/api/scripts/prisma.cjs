const {config}=require('dotenv');
const {resolve}=require('node:path');
const {spawnSync}=require('node:child_process');
config({path:process.env.ENV_FILE||resolve(__dirname,'../../../.env')});
const run=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),...process.argv.slice(2)],{stdio:'inherit',cwd:resolve(__dirname,'..'),env:process.env});
if(run.error){console.error(run.error.message);process.exitCode=1;}else process.exitCode=run.status??1;
