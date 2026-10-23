const {app,screen}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const main=require('./main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const out=path.resolve(__dirname,'../.local/edge-smoke-result.json');
(async()=>{
  await app.whenReady();
  let win;
  for(let i=0;i<100;i++){win=main.getWindow();if(win&&main.getState().connected)break;await wait(100);}
  assert.ok(win&&main.getState().connected);
  await wait(400);
  const read=()=>win.webContents.executeJavaScript(`(()=>{const r=document.getElementById('character-wrap').getBoundingClientRect();const c=document.getElementById('character');return {x:r.x,y:r.y,width:r.width,height:r.height,ih:innerHeight,edge:document.getElementById('app').dataset.edge,src:c.src,ready:c.complete&&c.naturalWidth>0,transform:getComputedStyle(c).transform}})()`);
  const area=screen.getPrimaryDisplay().workArea;
  for(const side of ['left','right']){
    if(side==='left') { await win.webContents.executeJavaScript("document.getElementById('summary').click()"); await wait(200); }
    const r=await read();const b=win.getBounds();
    win.setPosition(Math.round(side==='left'?area.x-r.x:area.x+area.width-r.x-r.width),b.y);
    main.dockAtEdge();await wait(350);
    const peek=await read();assert.equal(peek.edge,side);assert.match(peek.src,/peek-left.png$/);assert.ok(peek.ready);
    assert.equal(await win.webContents.executeJavaScript("document.getElementById('panel').hidden"),true);
    if(side==='right')assert.match(peek.transform,/-1/);
    const dock=win.getBounds();assert.ok(dock.x+peek.x+peek.width>area.x&&dock.x+peek.x<area.x+area.width);
    await wait(500);assert.deepEqual(win.getBounds(),dock,'dock must not oscillate through resize IPC');
    main.revealEdge();await wait(250);assert.equal((await read()).edge,'');
    const visible=win.getBounds(),pet=await read();assert.ok(visible.x+pet.x+pet.width<=area.x+area.width+1&&visible.x+pet.x>=area.x-1,JSON.stringify({side,visible,pet,area}));
  }
  // Released close above the bottom edge she stands on it (feet on the edge) and stays there; far above it she stays put.
  const {ipcMain}=require('electron');
  const release=()=>{ipcMain.emit('whale:drag',{sender:win.webContents},'start');ipcMain.emit('whale:drag',{sender:win.webContents},'end');};
  // Measured from the bottom: under display scaling the page and window heights may differ by a pixel or two.
  const feet=async()=>{const r=await read();const b=win.getBounds();return b.y+b.height-(r.ih-r.y-r.height*0.84);};
  const dropAt=async gap=>{const r=await read();const b=win.getBounds();win.setPosition(Math.round(area.x+area.width/2-r.x-r.width/2),Math.round(area.y+area.height-gap-r.y-r.height*0.84));await wait(100);release();await wait(300);};
  await dropAt(30);
  assert.ok(Math.abs(await feet()-(area.y+area.height))<=2,'released near the bottom she should stand on it: '+JSON.stringify({feet:await feet(),area}));
  await wait(600);await win.webContents.executeJavaScript("document.getElementById('summary').click()");await wait(400);
  assert.ok(Math.abs(await feet()-(area.y+area.height))<=2,'she should keep standing on the bottom edge: '+JSON.stringify({feet:await feet(),bounds:win.getBounds(),pet:await read(),area}));
  // Standing, the composer at her feet is lifted above the screen's bottom edge (expanded: the bar; collapsed: the icon).
  const lowest=async id=>{const r=await win.webContents.executeJavaScript(`(()=>{const e=document.getElementById('${id}').getBoundingClientRect();return {bottom:e.bottom,ih:innerHeight}})()`);const b=win.getBounds();return b.y+b.height-(r.ih-r.bottom);};
  const floor=area.y+area.height;
  assert.ok(await lowest('composer-form')<=floor,'the composer bar must stay above the bottom edge: '+JSON.stringify({bar:await lowest('composer-form'),floor}));
  await win.webContents.executeJavaScript("document.getElementById('summary').click()");await wait(300);
  assert.ok(await lowest('composer-icon')<=floor,'the compose icon must stay above the bottom edge: '+JSON.stringify({icon:await lowest('composer-icon'),floor}));
  await dropAt(200);
  assert.ok(Math.abs(await feet()-(area.y+area.height-200))<=2,'far above the bottom she should stay where she was dropped');
  fs.writeFileSync(out,JSON.stringify({ok:true,checks:['left/right docking','peek image loaded','mirroring','stable bounds','restore on screen','stand on bottom edge','composer above bottom edge']}));
})().catch(error=>fs.writeFileSync(out,JSON.stringify({ok:false,error:error.stack}))).finally(()=>main.quit());
