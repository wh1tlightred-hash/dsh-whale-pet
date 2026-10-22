import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCompanion } from '../lib/transport.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const state = {connected:true,demo:true,projects:[{id:'s1',name:'桌宠项目 · 接口联调',status:'approval',detail:'等待批准'},{id:'s2',name:'文档项目 · 更新说明',status:'thinking',detail:'思考中'}],approvals:[{id:'approve-1',projectId:'s1',projectName:'桌宠项目 · 接口联调',tool:'测试工具',reason:'仅测试桌宠的审批链路，不执行实际操作。',operation:'npm test\n<img id="xss-test" src=x onerror="alert(1)">'}],notice:null};
const out = path.join(root,'.local','smoke-result.json');
if (fs.existsSync(out)) fs.unlinkSync(out);
let approved = false;
const chats = [];
const bridge = await startCompanion({ hidden:true, entry:path.join(root,'desktop','smoke.cjs'), getState:()=>state,
  onDecision({id,decision}, reply) {
    if (id !== 'approve-1' || decision !== 'allowed-once' || approved) return reply({ok:false,error:'旧请求'});
    approved = true;
    state.approvals=[]; state.projects[0].status='completed'; state.projects[0].detail='任务完成';
    state.notice={id:'done-1',kind:'completed',title:'任务完成啦',body:'桌宠项目 · 接口联调'};
    reply({ok:true}); bridge.send(state);
  },
  onChat(text) { chats.push(text); return { ok: true, sessionId: 'smoke-session' }; },
  onDisconnect() { setTimeout(()=>bridge.close(),20); }
});
const deadline = Date.now()+25000;
while (!fs.existsSync(out) && Date.now()<deadline) await new Promise(r=>setTimeout(r,200));
bridge.close();
if (!fs.existsSync(out)) throw new Error('Electron smoke test timed out; inspect .local/desktop.log');
const result = JSON.parse(fs.readFileSync(out,'utf8'));
console.log(JSON.stringify({...result,approved,chats},null,2));
if (!result.ok || !approved || chats.join() !== '帮我写一份周报') process.exitCode=1;
