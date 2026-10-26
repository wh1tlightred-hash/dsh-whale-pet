const {chromium}=require('playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.opened=[];window.openResult={ok:true};
      window.whale={onState(fn){window.receiveFixture=fn;},setExpanded(){},setInteractive(){},
        openSession:async id=>{window.opened.push(id);if(window.hold)return new Promise(resolve=>{window.finishOpen=resolve;});return window.openResult;}};
    });
    await page.goto(pathToFileURL(path.resolve(__dirname,'../ui/index.html')).href);
    await page.evaluate(()=>{
      window.fixture={connected:true,forceExpanded:true,projects:[
        {id:'first',name:'已完成的任务',status:'completed',updatedAt:1},
        {id:'second',name:'正在运行的任务',status:'working',updatedAt:2}
      ],notice:{id:'done',sessionId:'first',kind:'completed',title:'任务完成'}};
      window.receiveFixture(window.fixture);
    });
    const first=page.locator('.project').nth(0),second=page.locator('.project').nth(1);
    await first.click();
    assert.deepEqual(await page.evaluate(()=>window.opened),[],'single click must not navigate');
    assert.equal(await first.getAttribute('data-status'),'idle','single click still acknowledges completion');
    assert.equal(await first.getAttribute('aria-pressed'),'true');
    await second.dblclick();
    assert.deepEqual(await page.evaluate(()=>window.opened),['second']);
    assert.equal(await second.getAttribute('aria-pressed'),'true','double click keeps the clicked target selected');
    await first.dblclick();
    assert.deepEqual(await page.evaluate(()=>window.opened),['second','first']);
    assert.equal(await first.getAttribute('aria-pressed'),'true');
    await page.evaluate(()=>{window.hold=true;});
    await second.dblclick();await second.dblclick();
    assert.deepEqual(await page.evaluate(()=>window.opened),['second','first','second'],'in-flight duplicate is ignored');
    await page.evaluate(()=>{window.finishOpen({ok:false,error:'dsh 对话窗口尚未就绪，请稍后重试'});window.hold=false;});
    await page.locator('#composer-status').filter({hasText:'尚未就绪'}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS: real single/double clicks, completion acknowledgement, exact target, in-flight deduplication, failure feedback');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
