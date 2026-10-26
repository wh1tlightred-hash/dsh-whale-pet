const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const main=require('./main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const out=path.resolve(__dirname,'../.local/navigation-smoke-result.json');
(async()=>{
  await app.whenReady();let win;
  for(let i=0;i<100;i++){win=main.getWindow();if(win&&main.getState().projects.length===2)break;await wait(100);}
  assert.ok(win&&main.getState().projects.length===2);
  const invoke=id=>win.webContents.executeJavaScript(`window.whale.openSession(${JSON.stringify(id)})`);
  assert.equal((await invoke('not-listed')).ok,false);
  assert.equal((await invoke({id:'nav-one'})).ok,false);
  assert.deepEqual(await invoke('nav-one'),{ok:true});
  assert.deepEqual(await invoke('nav-two'),{ok:false,error:'fixture client unavailable'});
  fs.writeFileSync(out,JSON.stringify({ok:true,checks:['preload to main IPC','unknown target rejected','authenticated pipe request and reply','host failure returned']}));
})().catch(error=>fs.writeFileSync(out,JSON.stringify({ok:false,error:error.stack}))).finally(()=>main.quit());
