const assert=require('node:assert/strict'),vm=require('node:vm'),{buildContext}=require('./app_source');
(async()=>{
 const calls=[],ctx={companionPhotoReferences:()=>['/assets/face.png','blob:room'],companionPhotoReferenceSources:()=>['Character portrait / FaceID','Saved place: Room'],companionComfyReferencePlan:()=>({selected:['/assets/face.png'],attached:['Character portrait / FaceID'],omitted:['Saved place: Room'],capacity:1,identityAttached:true,previousAttached:false}),vh2PhotoData:async s=>'data:image/png;base64,'+Buffer.from(s).toString('base64'),vh2Linked:()=>false,buildCompanionPhotoPrompt:()=> 'Scene',mcpBridgeRequest:async(path,{body})=>{calls.push({path,body});return {image:'result'};},generateCompanionLocalPhoto:async(c,s,o)=>{assert(o.resolvedReferences.every(r=>r.startsWith('data:image/')));assert.deepEqual(Array.from(o.referenceSources),['Character portrait / FaceID']);assert.deepEqual(Array.from(o.attachedReferences),['/assets/face.png']);return 'local';}};
 buildContext(vm,['generateCompanionPhoto'],ctx);
 assert.equal(await ctx.generateCompanionPhoto({id:'person',imageSource:'gemini',imageModel:'image-model'},'scene'),'result');
 assert.equal(calls[0].body.references.length,2);assert(calls[0].body.references.every(r=>r.startsWith('data:image/')));
 let selection;assert.equal(await ctx.generateCompanionPhoto({imageSource:'comfyui'},'scene',{onReferenceSelection:value=>selection=value}),'local');
 assert.deepEqual(Array.from(selection.omitted),['Saved place: Room']);
 console.log('PASS shared local/blob reference resolution and direct Google image request');
})().catch(e=>{console.error(e);process.exitCode=1});
