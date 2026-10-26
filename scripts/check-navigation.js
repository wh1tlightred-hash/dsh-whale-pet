import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {startCompanion} from '../lib/transport.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'.local/navigation-smoke-result.json');
if(fs.existsSync(out))fs.unlinkSync(out);
// A fixture must never bring the user's live DSH window forward.
delete process.env.DSH_WHALE_DSH_EXE;
const calls=[];
const bridge=await startCompanion({hidden:true,entry:path.join(root,'desktop/navigation-smoke.cjs'),
 getState:()=>({connected:true,projects:[{id:'nav-one',name:'First',status:'idle'},{id:'nav-two',name:'Second',status:'working'}],approvals:[],questions:[],notice:null}),
 onOpenSession:id=>{calls.push(id);return id==='nav-one'?{ok:true}:{ok:false,error:'fixture client unavailable'};},onDecision(){},onDisconnect(){}});
try {
 const deadline=Date.now()+20000;
 while(!fs.existsSync(out)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
 if(!fs.existsSync(out))throw new Error('Navigation smoke timed out');
 const result=JSON.parse(fs.readFileSync(out,'utf8'));console.log(result);
 assert.equal(result.ok,true,result.error);assert.deepEqual(calls,['nav-one','nav-two']);
} finally {bridge.close();}
