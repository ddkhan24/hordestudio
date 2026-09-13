'use strict';
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
(async()=>{
 const server=spawn('python3',['scratch/vh2_browser_server.py'],{stdio:['ignore','pipe','pipe']});let browser;
 try{
  const port=await new Promise((resolve,reject)=>{server.stdout.once('data',d=>resolve(+String(d).trim()));server.stderr.on('data',d=>process.stderr.write(d));server.once('exit',code=>reject(Error('Fixture server '+code)));});const base='http://127.0.0.1:'+port;
  browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(base)||r.request().url().startsWith('blob:')?r.continue():r.abort());
  await page.goto(base+'/index.html');await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
  await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'});
  await page.evaluate(base=>{
   clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);mcpBridgeBase=()=>base;
   state.globalSettings.localBaseUrl=base+'/test';state.globalSettings.localApiKey='LOCAL_TEST_KEY';state.globalSettings.apiProvider='local';state.globalSettings.defaultModel='browser-fixture';
   state.personas=[{id:'lena',name:'Lena',text:'A longtime friend.'},{id:'noah',name:'Noah',text:'A new acquaintance.'}];state.activePersonaId='lena';
   const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
   const c=normalizeCompanion({id:'shared-life-fixture',name:'Alex',age:27,textProvider:'local',model:'browser-fixture',imageSource:'comfyui',startingSocialPosts:[{id:'starter-photo',kind:'photo',text:'A day out before we met.',photo:image,seedAgeDays:3}],startingReferences:[{id:'identity-fixture',role:'identity',entityId:'self',label:'Identity',tags:['front_face'],status:'approved',image}]});
   state.companions=[c];state.activeCompanionId=c.id;state.companionTimelines={};state.companionThreads={};ensureCompanionTimelineStore(c.id);
   hideGlobalSettings();switchView('companionStudio');openCompanionStudio(c.id);activateCompanionStudioTab('cs-social');
  },base);
  // Fixed 64x64 VP8 pattern: 20 alternating-color frames over ~2 seconds.
  // Recording for a 500ms wall-clock window could yield no usable frame when
  // other headless browsers competed for capture time. Decode the same bytes
  // every run; no ffmpeg, capture timer, network or user media dependency.
  const media=Buffer.from('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','base64');
  await page.evaluate(()=>{
    window.verifyPackageClipPlayback=async video=>{
      video.muted=true;video.currentTime=0;
      const deadline=performance.now()+15000;
      await Promise.race([video.play(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Fixture video did not start playback')),15000))]);
      await new Promise((resolve,reject)=>{function check(){
        if(video.error)return reject(Error('Video decode error '+video.error.code+': '+video.error.message));
        if(video.videoWidth===64&&video.videoHeight===64&&video.readyState>=2&&video.currentTime>=0.2&&video.getVideoPlaybackQuality().totalVideoFrames>=2)return resolve();
        if(performance.now()>deadline)return reject(Error('Video did not decode and advance: '+JSON.stringify({width:video.videoWidth,height:video.videoHeight,readyState:video.readyState,currentTime:video.currentTime,frames:video.getVideoPlaybackQuality().totalVideoFrames})));
        setTimeout(check,20);
      }check();});
      video.pause();return {width:video.videoWidth,height:video.videoHeight,frames:video.getVideoPlaybackQuality().totalVideoFrames};
    };
  });
  await page.locator('#cs-starter-clips [data-file]').setInputFiles({name:'starter.webm',mimeType:'video/webm',buffer:media});
  await page.getByText('Starter clip saved.',{exact:true}).waitFor();
  const uploadedPlayback=await page.locator('#cs-starter-clips video').evaluate(video=>window.verifyPackageClipPlayback(video));
  await page.locator('#cs-starter-clips textarea').fill('An old weekend clip.');await page.locator('#cs-starter-clips textarea').blur();
  const started=await page.evaluate(async()=>{const c=getCompanion('shared-life-fixture');await vh2CreateTimeline(c);const t=getActiveCompanionTimeline(c.id);await vhUiCommand(t,'set_running',{running:false});state.activeCompanionId=c.id;switchView('companionChat');renderCompanionThread();return {worldId:t.vh2.worldId,posts:t.vh2.socialPosts.length,clips:c.videoJobs.length,refs:t.vh2.bible.entries.length,sessions:ensureCompanionTimelineStore(c.id).sessions.length};});

  const result=await page.evaluate(async()=>{
    const c=getCompanion('shared-life-fixture'),payload=await buildCompanionArchivePayload(c,'portable-human',Date.now(),true);
    if(!(payload.media.videos[0].data instanceof Blob))throw Error('Video was base64 encoded');
    if(!(payload.vh2ServiceArchives[0].data instanceof Blob))throw Error('Life was base64 encoded');
    const blob=await HordeHumanPackage.pack(payload),archive=await HordeHumanPackage.unpack(blob);
    const encodeOriginal=blobToDataUrl,requestOriginal=mcpBridgeRequest;let binaryRestore=false;
    blobToDataUrl=async value=>{if(value===archive.vh2ServiceArchives[0].data)throw Error('Saved life was converted back into a base64 string');return encodeOriginal(value);};
    mcpBridgeRequest=async(path,options)=>{if(path==='/vh2/character/restore'){if(!(options.body instanceof Blob)||options.body.type!=='application/zip')throw Error('Saved life restore is not a binary request');binaryRestore=true;}return requestOriginal(path,options);};
    const imported=await importCompanionArchiveData(archive),asset=await HordeDB.get('companionVideoAsset:'+imported.videoJobs[0].assetId);
    blobToDataUrl=encodeOriginal;mcpBridgeRequest=requestOriginal;if(!binaryRestore)throw Error('Saved life restore was not requested');
    if(!(asset instanceof Blob)||!asset.size)throw Error('Imported video is missing');
    const video=document.createElement('video'),url=URL.createObjectURL(asset);video.src=url;document.body.append(video);
    let restoredPlayback;try{restoredPlayback=await window.verifyPackageClipPlayback(video);}finally{video.remove();URL.revokeObjectURL(url);}
    const videoSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');
    const t=getActiveCompanionTimeline(imported.id);await vh2Poll(imported,t,{force:true,throwOnError:true});
    if(t.vh2.worldId===getActiveCompanionTimeline(c.id).vh2.worldId)throw Error('Import did not create a separate life');
    return {zipBytes:blob.size,videoBytes:asset.size,videoSha256,restoredPlayback,posts:t.vh2.socialPosts.length,refs:t.vh2.bible.entries.length};
  });
  await page.evaluate(()=>{
    const c=normalizeCompanion({id:'long-character-id-for-session-collision-regression',name:'Casey'});state.companions.push(c);
    const first=normalizeCompanionTimeline({id:'old-truncated-id',name:'First',messages:[{id:'first-message',role:'user',text:'First history.'}]},c);
    const second=normalizeCompanionTimeline({id:'old-truncated-id',name:'Second',messages:[{id:'second-message',role:'user',text:'Second history.',turnSnapshot:{preserved:true}}]},c);
    state.companionTimelines[c.id]={activeSessionId:first.id,sessions:[first,second]};
    const store=ensureCompanionTimelineStore(c.id),ids=store.sessions.map(t=>t.id);
    if(new Set(ids).size!==2||ids[0]!=='old-truncated-id'||getActiveCompanionTimeline(c.id)!==first)throw Error('Duplicate session repair lost the original active chat.');
    if(second.messages[0].id!=='second-message'||!second.messages[0].turnSnapshot.preserved)throw Error('Collision repair lost history.');
    activateCompanionTimeline(c.id,ids[1]);if(getActiveCompanionTimeline(c.id)!==second)throw Error('Repaired chat remains inaccessible.');
    if(ensureCompanionTimelineStore(c.id).sessions[1].id!==ids[1])throw Error('Collision repair changed twice.');
    if(normalizeCompanionTimeline({},c).id===normalizeCompanionTimeline({},c).id)throw Error('New timeline IDs collided.');
  });
  const aliasBinding=await page.evaluate(async()=>{
    const c=getCompanion('shared-life-fixture'),original=getActiveCompanionTimeline(c.id).vh2.worldId;
    const archive=await buildCompanionArchivePayload(c,'portable-human',Date.now(),true),request=mcpBridgeRequest;let archived;
    // Client contract fixture: the service supplies a canonical binding distinct
    // from the retained archive row. Python tests verify the actual merge graph.
    mcpBridgeRequest=async(path,options)=>{const value=await request(path,options);if(path==='/vh2/character/restore'){archived=value.worlds[0].worldId;value.worlds[0].canonicalWorldId=original;}return value;};
    let imported;try{imported=await importCompanionArchiveData(archive);}finally{mcpBridgeRequest=request;}
    const t=getActiveCompanionTimeline(imported.id);if(t.vh2.worldId!==original||t.vh2.archiveWorldId!==archived)throw Error('Canonical chat and retained archive were conflated.');
    const exported=await buildCompanionArchivePayload(imported,'portable-human',Date.now(),true);
    const ids=exported.vh2ServiceArchives.map(a=>a.worldId);if(!ids.includes(original)||!ids.includes(archived))throw Error('Re-export lost a merged history.');
    const incomplete={...exported,vh2ServiceArchives:exported.vh2ServiceArchives.filter(a=>a.worldId!==archived)};
    let rejected=false;try{validateCompanionArchiveData(incomplete);}catch(error){rejected=/missing its saved VH2 life/.test(error.message);}if(!rejected)throw Error('Missing retained archive must fail clearly.');
    return {canonicalBinding:true,archivedWorldRetained:true,reexportArchives:ids.length};
  });
  assert.equal(result.videoSha256,'7a39894d6e3bdb6c47b415d33820ce22573a1e4ba601dc143fdd227addfe9818');assert.equal(uploadedPlayback.width,64);assert.equal(result.restoredPlayback.width,64);
  assert.equal(result.posts,1);assert.equal(result.refs,1);assert(result.videoBytes>0);assert.deepEqual(errors,[]);
  console.log('PASS browser ZIP export/import: binary clips and life, social post, references, separate life, no errors.',result,aliasBinding);
 }finally{await browser?.close();server.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
