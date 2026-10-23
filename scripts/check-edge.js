import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startCompanion} from '../lib/transport.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'.local/edge-smoke-result.json');
if(fs.existsSync(out))fs.unlinkSync(out);
const bridge=await startCompanion({hidden:true,entry:path.join(root,'desktop/edge-smoke.cjs'),getState:()=>({connected:true,projects:[],approvals:[],questions:[],notice:null}),onDecision(){},onDisconnect(){}});
try{
  const deadline=Date.now()+25000;
  while(!fs.existsSync(out)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,200));
  if(!fs.existsSync(out))throw new Error('Edge smoke timed out');
  const result=JSON.parse(fs.readFileSync(out,'utf8'));console.log(result);
  if(!result.ok)process.exitCode=1;
}finally{bridge.close();}
