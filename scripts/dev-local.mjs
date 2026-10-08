import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const python=path.join(root,'backend','.venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python');
if(!existsSync(python)){console.error('Create the backend virtual environment first. See README.md.');process.exit(1);}
const token=randomBytes(32).toString('hex');
const env={...process.env,ADMIN_TOKEN:process.env.ADMIN_TOKEN||token,INTERNAL_ADMIN_TOKEN:process.env.ADMIN_TOKEN||token,MIRROR_LOCAL_DEMO:'1',ALLOW_DEMO_ADMIN:'false',INTERNAL_API_URL:'http://127.0.0.1:8000',NEXT_TELEMETRY_DISABLED:'1'};
const children=[
 spawn(python,['-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000'],{cwd:path.join(root,'backend'),env,stdio:'inherit',windowsHide:true}),
 spawn(process.execPath,[path.join(root,'frontend','node_modules','next','dist','bin','next'),'dev','--hostname','127.0.0.1','--port','3000'],{cwd:path.join(root,'frontend'),env,stdio:'inherit',windowsHide:true})
];
console.log('AI Smart Mirror: http://localhost:3000 · Dashboard: http://localhost:3000/admin');
console.log('Local admin authorization is generated in memory; camera frames stay on this device.');
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children){if(process.platform==='win32'&&child.pid)spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();}setTimeout(()=>process.exit(code),600).unref();}
for(const child of children){child.on('error',error=>{console.error(error.message);stop(1);});child.on('exit',code=>{if(!stopping)stop(code||0);});}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
