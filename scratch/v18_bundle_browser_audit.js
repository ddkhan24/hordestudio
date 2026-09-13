'use strict';
const {spawn}=require('node:child_process'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const output=path.resolve('scratch/v18-release-results');fs.mkdirSync(output,{recursive:true});
async function decodeClip(card){
 await card.scrollIntoViewIfNeeded();
 return card.locator('video').evaluate(async video=>{
  const waitFor=(predicate,label)=>new Promise((resolve,reject)=>{
   const end=performance.now()+20000;
   const check=()=>{if(video.error)return reject(Error(label+': '+video.error.message));if(predicate())return resolve();if(performance.now()>end)return reject(Error('Timed out: '+label));requestAnimationFrame(check);};check();
  });
  video.muted=true;video.preload='auto';
  await waitFor(()=>video.readyState>=2&&video.videoWidth>0&&Number.isFinite(video.duration)&&video.duration>0,'decoded clip data');
  const target=Math.min(1,video.duration/3);video.currentTime=target;
  await waitFor(()=>!video.seeking&&Math.abs(video.currentTime-target)<.1,'clip seek');
  await video.play();
  await waitFor(()=>video.currentTime>=target+.12,'actual clip playback');
  if(typeof video.requestVideoFrameCallback==='function')await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No decoded video frame')),10000);video.requestVideoFrameCallback(()=>{clearTimeout(timer);resolve();});});
  video.pause();
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=18;const context=canvas.getContext('2d');context.drawImage(video,0,0,32,18);
  const rgba=context.getImageData(0,0,32,18).data;let brightness=0,min=255,max=0;
  for(let i=0;i<rgba.length;i+=4){const value=(rgba[i]+rgba[i+1]+rgba[i+2])/3;brightness+=value;min=Math.min(min,value);max=Math.max(max,value);}
  const frames=video.getVideoPlaybackQuality?.().totalVideoFrames??video.webkitDecodedFrameCount;
  if(frames!==undefined&&frames<1)throw Error('No video frames decoded');
  if(brightness/(32*18)<3||max-min<5)throw Error('Clip rendered an empty/black frame');
  return {duration:video.duration,currentTime:video.currentTime,width:video.videoWidth,height:video.videoHeight,decodedFrames:frames,meanBrightness:brightness/(32*18)};
 });
}
(async()=>{
 const server=spawn(process.env.PYTHON||'python3',['scratch/vh2_browser_server.py'],{stdio:['ignore','pipe','pipe']});let browser;
 try{
  const port=await new Promise((resolve,reject)=>{server.stdout.once('data',d=>resolve(+String(d).trim()));server.stderr.on('data',d=>process.stderr.write(d));server.once('exit',c=>reject(Error('Fixture server '+c)));});const base='http://127.0.0.1:'+port;
  browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(base)||r.request().url().startsWith('blob:')?r.continue():r.abort());
  await page.goto(base+'/index.html');await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
  const installed=await page.evaluate(async base=>{
   clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);mcpBridgeBase=()=>base;hideGlobalSettings();
   const c=state.companions.find(c=>c.bundledId==='aslyn-jonas-v18');if(!c)throw Error('Default Aslyn missing');
   const initialSessions=state.companionTimelines?.[c.id]?.sessions||[];
   if(initialSessions.some(t=>t.messages?.length||t.vh2?.worldId)||(state.companionThreads?.[c.id]||[]).length)throw Error('Included character carried an existing chat or saved life');
   if(c.priorContact!=='never_spoken'||c.knownBeforeDays!==0||c.startingRelationship!==0||c.relationshipContext)throw Error('Included character carried a player relationship');
   const count=state.companions.length;await installBundledHumans();if(state.companions.length!==count)throw Error('Duplicate bundled character');
   return {id:c.id,posts:c.startingSocialPosts.length,refs:c.startingReferences.length,gallery:c.startingGallery.length,clips:c.startingVideoClips.length,sources:c.startingVideoClips.map(j=>j.bundledSrc)};
  },base);assert.deepEqual({posts:installed.posts,refs:installed.refs,gallery:installed.gallery,clips:installed.clips},{posts:28,refs:62,gallery:2,clips:5});
  const ranges=[];
  for(const source of installed.sources){
   const response=await page.request.get(new URL(source,base).href,{headers:{Range:'bytes=0-1023'}});
   assert.equal(response.status(),206,'bundled clips must support byte-range seeking');assert.match(response.headers()['content-range']||'',/^bytes 0-1023\//);assert.equal((await response.body()).length,1024);ranges.push({status:response.status(),contentRange:response.headers()['content-range']});
  }
  const imports=await page.evaluate(async()=>{
   const c=getCompanion('aslyn_jonas_v18');state.globalSettings.localBaseUrl=mcpBridgeBase()+'/test';state.globalSettings.localApiKey='LOCAL_TEST_KEY';state.globalSettings.apiProvider='local';state.globalSettings.defaultModel='browser-fixture';c.textProvider='local';c.model='browser-fixture';state.activeCompanionId=c.id;state.activePersonaId=null;
   ensureCompanionTimelineStore(c.id);await vh2CreateTimeline(c);const t=getActiveCompanionTimeline(c.id);await vhUiCommand(t,'set_running',{running:false});
   const projection=await(await fetch(mcpBridgeBase()+'/vh2/projection?worldId='+encodeURIComponent(t.vh2.worldId))).json(),s=projection.state;
   if(s.communication.messages.length||Object.values(s.conversations||{}).some(r=>r.roots?.communication?.messages?.length)||s.memories.length)throw Error('Fresh life contains messages or private memories');
   if(s.communication.generation>0||s.truth.companion.startingRelationship!==0||s.truth.companion.knownBeforeDays!==0)throw Error('Fresh life reused a previous player relationship');
   window.aslynFreshLifePrivacy={installedPrivateSessions:0,messages:s.communication.messages.length,memories:s.memories.length,priorPlayerRelationship:false};
   const counts=()=>({world:t.vh2.worldId,posts:t.vh2.socialPosts.filter(p=>p.status==='published').length,clips:c.videoJobs.filter(j=>!j.deletedAt).length,refs:t.vh2.bible.entries.length,approvedRefs:t.vh2.bible.entries.filter(r=>r.status==='approved').length,roomRefs:t.vh2.bible.entries.filter(r=>r.role==='zone'&&r.status==='approved').length,rooms:t.vh2.visual.zones.length,photos:t.vh2.photos.filter(p=>p.destination==='gallery').length});
   const snapshots=[counts()];for(let retry=0;retry<2;retry++){await vh2ImportStarterProfile(c);snapshots.push(counts());}return snapshots;
  });
  assert.deepEqual(imports[1],imports[0],'first repeated import must preserve counts');assert.deepEqual(imports[2],imports[0],'second repeated import must preserve counts');
  const life=imports[0];assert.deepEqual({...life,world:undefined},{world:undefined,posts:28,clips:5,refs:62,approvedRefs:62,roomRefs:6,rooms:6,photos:2});
  await page.evaluate(()=>{switchView('companionChat');renderCompanionThread();const c=getCompanion('aslyn_jonas_v18');companionSocialTab='clips';companionSocialPanelVisibility.set(companionSocialPanelKey(c),true);renderCompanionSocialPanel(c);});
  await page.waitForFunction(()=>document.querySelectorAll('.companion-clip-stage video').length===5);
  const cards=page.locator('.companion-clip-card.ready'),playback=[];
  for(let i=0;i<5;i++)playback.push(await decodeClip(cards.nth(i)));
  await decodeClip(cards.first());
  for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
   await page.setViewportSize({width,height});
   await page.evaluate(()=>{document.querySelector('#companion-social-content').scrollTop=0;document.activeElement?.blur();});
   await page.waitForFunction(()=>!document.querySelector('.companion-clip-card.ready').classList.contains('is-buffering'));
   const layout=await page.evaluate(()=>{
    const content=document.querySelector('#companion-social-content'),card=document.querySelector('.companion-clip-card.ready'),video=card.querySelector('video');
    const p=content.getBoundingClientRect(),r=card.getBoundingClientRect(),v=video.getBoundingClientRect();
    return {leftInset:r.left-p.left,rightInset:p.right-r.right,overflow:content.scrollWidth>content.clientWidth,ratio:v.width/v.height,nativeRatio:video.videoWidth/video.videoHeight};
   });
   assert(layout.leftInset>=11&&layout.rightInset>=11,name+' needs drawer inset');assert.equal(layout.overflow,false,name+' overflow');assert(Math.abs(layout.ratio-layout.nativeRatio)<.01,name+' clip cropped');
   await page.screenshot({path:path.join(output,'aslyn-clips-'+name+'.png')});
  }
  const freshLifePrivacy=await page.evaluate(()=>window.aslynFreshLifePrivacy);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'aslyn-bundle-browser.json'),JSON.stringify({installed,imports,ranges,playback,freshLifePrivacy,errors},null,2));
  console.log('PASS real bundled Aslyn: once-only installation, complete fresh life, two repeat imports,62 approved references/6 room references, all five decoded/seeked/played videos, uncropped desktop/mobile.',life);
 }finally{await browser?.close();server.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
