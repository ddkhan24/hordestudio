const assert=require('node:assert/strict'),vm=require('node:vm'),{buildContext}=require('./app_source');
(async()=>{
 const calls=[],ctx={companionPhotoReferences:()=>['/assets/face.png','blob:room'],vh2PhotoData:async s=>'data:image/png;base64,'+Buffer.from(s).toString('base64'),vh2Linked:()=>false,buildCompanionPhotoPrompt:()=> 'Scene',mcpBridgeRequest:async(path,{body})=>{calls.push({path,body});return {image:'result'};},generateCompanionLocalPhoto:async(c,s,o)=>{assert(o.resolvedReferences.every(r=>r.startsWith('data:image/')));return 'local';}};
 buildContext(vm,['generateCompanionPhoto'],ctx);
 assert.equal(await ctx.generateCompanionPhoto({id:'person',imageSource:'gemini',imageModel:'image-model'},'scene'),'result');
 assert.equal(calls[0].body.references.length,2);assert(calls[0].body.references.every(r=>r.startsWith('data:image/')));
 assert.equal(await ctx.generateCompanionPhoto({imageSource:'comfyui'},'scene'),'local');
 console.log('PASS shared local/blob reference resolution and direct Google image request');
})().catch(e=>{console.error(e);process.exitCode=1});
