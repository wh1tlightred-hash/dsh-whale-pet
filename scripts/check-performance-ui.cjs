const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(() => {
      window.rectReports=0;
      window.whale={onState(fn){window.receiveFixture=fn;},onEdgeHint(fn){window.hintFixture=fn;},setExpanded(){},setInteractive(){},reportPetRect(){window.rectReports++;}};
    });
    await page.goto(pathToFileURL(path.resolve(__dirname,'../ui/index.html')).href);
    await page.evaluate(() => {
      window.fixture={connected:true,forceExpanded:true,projects:Array.from({length:20},(_,i)=>({id:'p'+i,name:'Project '+i,status:'idle',detail:'Ready',updatedAt:1})),approvals:[],questions:[]};
      window.receiveFixture(window.fixture);
    });
    const measure = mode => page.evaluate(mode => {
      const list=document.getElementById('projects');
      const observer=new MutationObserver(()=>{}); observer.observe(list,{childList:true,subtree:true,attributes:true,characterData:true});
      const getRect=Element.prototype.getBoundingClientRect;
      let rectReads=0; Element.prototype.getBoundingClientRect=function(){rectReads++;return getRect.call(this);};
      const before=window.rectReports, started=performance.now();
      for(let i=0;i<200;i++) {
        if(mode==='state')window.receiveFixture(structuredClone(window.fixture));
        else window.hintFixture({side:'left',strength:.25 + (i%100)*.0075});
      }
      const elapsed=performance.now()-started;
      const mutations=observer.takeRecords().length;observer.disconnect();Element.prototype.getBoundingClientRect=getRect;
      return {mutations,rectReads,rectReports:window.rectReports-before,elapsedMs:Math.round(elapsed)};
    },mode);
    const stats={state:await measure('state'),drag:await measure('drag')};
    console.log(JSON.stringify(stats));
    if(!process.argv.includes('--baseline')) {
      assert.equal(stats.state.mutations,0,'identical state must reuse project DOM');
      assert.equal(stats.drag.mutations,0,'drag hints must not rebuild cards');
      assert.equal(stats.drag.rectReads,0,'drag pose must not force geometry reads');
      assert.equal(stats.state.rectReports,0,'unchanged geometry must not be resent');
      assert.equal(stats.drag.rectReports,0);
    }
    await page.evaluate(() => window.hintFixture(null));
    // Completion acknowledgement must use the latest stamp even when displayed strings do not change.
    await page.evaluate(() => {
      window.fixture.projects[0]={...window.fixture.projects[0],status:'completed',updatedAt:2};
      window.receiveFixture(structuredClone(window.fixture));
      window.fixture.projects[0].updatedAt=3;
      window.receiveFixture(structuredClone(window.fixture));
    });
    await page.locator('.project').first().evaluate(el => el.click());
    assert.equal(await page.locator('.project').first().getAttribute('data-status'),'idle');
    await page.evaluate(() => {
      window.fixture.projects[0].name='Renamed';
      window.fixture.projects[0].status='working';
      window.fixture.projects[0].detail='New progress';
      window.fixture.projects.reverse();window.receiveFixture(structuredClone(window.fixture));
    });
    assert.equal(await page.locator('.project-name').last().textContent(),'Renamed');
    assert.equal(await page.locator('.project-state').last().textContent(),'New progress');
    await page.evaluate(() => {window.fixture.projects=window.fixture.projects.slice(0,2);window.receiveFixture(structuredClone(window.fixture));});
    assert.equal(await page.locator('.project').count(),2);
    assert.deepEqual(errors,[]);
    console.log('PASS: renderer workload, latest completion stamp, rename, reorder and removal');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
