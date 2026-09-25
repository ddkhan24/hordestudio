'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();

(async()=>{
 const server=spawn('python3',['scratch/vh2_browser_server.py'],{stdio:['ignore','pipe','pipe']});let browser,releaseCatalog;
 try{
  const port=await new Promise((resolve,reject)=>{server.stdout.once('data',data=>resolve(Number(String(data).trim())));server.stderr.on('data',data=>process.stderr.write(data));server.once('exit',code=>reject(Error('server '+code)));});
  browser=await chromium.launch(launchOptions);
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let catalogPending=false;
  const catalogGate=new Promise(resolve=>{releaseCatalog=resolve;});
  await page.route('**/assets/bundled/humans.json',async route=>{
   catalogPending=true;
   await catalogGate;
   catalogPending=false;
   await route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Number.isFinite(window.__hordeStartup?.readyMs));
  await page.waitForFunction(()=>document.getElementById('library-view')&&!document.getElementById('library-view').classList.contains('hidden'));
  await page.waitForTimeout(50);
  assert.equal(catalogPending,true,'the deliberately stalled optional catalog should still be pending');
  assert.equal(await page.locator('#video-world-grid').evaluate(node=>node.childElementCount),0,'hidden Video Adventures must not render at startup');
  const timing=await page.evaluate(()=>window.__hordeStartup.readyMs);
  releaseCatalog();
  await page.waitForFunction(()=>Number.isFinite(window.__hordeStartup?.background?.bundledHumans));
  await page.evaluate(()=>{hideGlobalSettings();switchView('videoWorlds');});
  await page.waitForFunction(()=>document.getElementById('video-world-grid').childElementCount>0);
  // Request interception disables Chromium's HTTP cache. Remove it and use
  // one reload to populate the normal cache before measuring revalidation.
  await page.unroute('**/assets/bundled/humans.json');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Number.isFinite(window.__hordeStartup?.readyMs));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Number.isFinite(window.__hordeStartup?.readyMs));
  const reloadTransfer=await page.evaluate(()=>performance.getEntriesByType('resource')
   .reduce((total,entry)=>total+(entry.transferSize||0),0));
  assert(reloadTransfer<1024*1024,`unchanged reload retransmitted ${reloadTransfer} bytes`);
  assert.deepEqual(errors,[]);
  console.log(`PASS: library interactive in ${Math.round(timing)} ms while optional catalog was stalled; hidden Video Adventures rendered only on demand; warm reload transferred ${reloadTransfer} bytes`);
 }finally{releaseCatalog?.();if(browser)await browser.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
