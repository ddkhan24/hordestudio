const assert = require('node:assert/strict');
const vm = require('node:vm');
const {buildContext} = require('./app_source');
const catalog = {higgsfield:[], magnific:[]};
const ctx = {console, companionMcpToolCatalog:catalog, buildCompanionPhotoPrompt:(_c,s)=>s};
buildContext(vm,['companionMcpImageTools','companionMcpGenerationArguments','companionMcpDiscoverModels'],ctx);
const tool = {name:'generate_image',inputSchema:{properties:{params:{type:'object',required:['model'],properties:{model:{type:'string'},prompt:{type:'string'},medias:{type:'array'},count:{type:'integer',minimum:1,maximum:4}}}}}};
catalog.higgsfield=[tool];
const c={imageSource:'higgsfield',mcpImageTool:'generate_image',mcpImageArguments:{model:'fixture'},basePhoto:'data:image/png;base64,aGVsbG8='};
let r=ctx.companionMcpGenerationArguments(c,'Tea');
assert.equal(r.args.params.model,'fixture');assert.equal(r.args.params.prompt,'Tea');assert.equal(r.args.params.medias[0].value,c.basePhoto);
assert.equal(r.args.params.medias[0].role,'image');
assert.throws(()=>ctx.companionMcpGenerationArguments({...c,mcpImageArguments:{}},'Tea'),/model/);
assert.throws(()=>ctx.companionMcpGenerationArguments({...c,mcpImageArguments:{model:'fixture',count:8}},'Tea'),/Invalid number/);
catalog.magnific=[{name:'images_generate',inputSchema:{properties:{prompt:{type:'string'},references:{type:'array',items:{type:'object',required:['url'],properties:{url:{type:'string'}}}}}}}];
r=ctx.companionMcpGenerationArguments({...c,imageSource:'magnific',mcpImageTool:'images_generate'},'Tea');
assert.equal(r.args.references[0].url,c.basePhoto);
delete catalog.magnific[0].inputSchema.properties.references;
assert.throws(()=>ctx.companionMcpGenerationArguments({...c,imageSource:'magnific',mcpImageTool:'images_generate'},'Tea'),/does not advertise reference/);
const names=ctx.companionMcpImageTools([tool,{name:'images_crop',description:'generate image prompt',inputSchema:{properties:{prompt:{}}}},{name:'flows_show',description:'generate image',inputSchema:{properties:{prompt:{}}}}]);
assert.equal(names.length,1);
console.log('PASS nested arguments, object references, missing-reference rejection, explicit model, numeric constraints and utility exclusion');
(async()=>{
 let calls=[];ctx.mcpBridgeRequest=async(_url,opts)=>{calls.push(opts.body.arguments);return {result:{structuredContent:calls.length===1?{items:[{id:'one'}],next_page_token:'next'}:{items:[{id:'two'}]}}};};
 const models=await ctx.companionMcpDiscoverModels('higgsfield',[{name:'models_list',inputSchema:{properties:{type:{},limit:{},after:{}}}}]);
 assert.equal(models.length,2);assert.equal(calls[1].after,'next');
 console.log('PASS read-only model catalog pagination');
})().catch(e=>{console.error(e);process.exitCode=1;});

const fixture = require('./fixtures/magnific-image-contract.json');
const magnificModels = ctx.companionMagnificModels(fixture.catalog);
assert.equal(magnificModels.length,48);
assert.equal(magnificModels.find(m => m.id === 'imagen-nano-banana-2-flash').name, 'Google Nano Banana 2');
assert.equal(magnificModels.find(m => m.id === 'imagen-nano-banana-2').name, 'Google Nano Banana Pro');
catalog.magnific = [{...fixture.tool, _models:magnificModels}];
const mc = {...c,imageSource:'magnific',mcpImageTool:'images_generate',mcpImageArguments:{mode:'imagen-nano-banana-2-flash',resolution:'2k'}};
const mapped = ctx.companionMcpGenerationArguments(mc,'Tea');
assert.equal(mapped.args.mode,'imagen-nano-banana-2-flash');
assert.equal(mapped.args.references[0].type,'image');
assert.equal(mapped.args.references[0].identifier,c.basePhoto);
assert.throws(()=>ctx.companionMcpGenerationArguments({...mc,mcpImageArguments:{mode:'flux-realism'}},'Tea'),/does not accept photo references/);
console.log('PASS actual Magnific TOON catalog, mode slugs, reference identifier mapping and unsupported-model preflight');
(async () => {
    const {functionSource} = require('./app_source');
    const calls=[];
    let updated=false;
    const runtime={
        safeJsonClone:value=>JSON.parse(JSON.stringify(value)),
        companionMcpTool:()=>({name:'images_generate'}),
        companionMcpGenerationArguments:()=>({tool:{name:'images_generate'},args:{prompt:'Synthetic'}}),
        mcpBridgeRequest:async(path)=>{calls.push(path);return path==='/health' ? {capabilities:updated?{magnificReferenceImport:1}:{}} : {image:'synthetic-image'};}
    };
    vm.createContext(runtime);vm.runInContext(functionSource('generateCompanionMcpPhoto'),runtime);
    await assert.rejects(runtime.generateCompanionMcpPhoto({imageSource:'magnific'},'Synthetic'),/running local bridge/);
    assert.deepEqual(calls,['/health']);
    updated=true;calls.length=0;
    assert.equal(await runtime.generateCompanionMcpPhoto({imageSource:'magnific'},'Synthetic'),'synthetic-image');
    assert.deepEqual(calls,['/health','/providers/magnific/generate']);
    console.log('PASS stale bridges blocked before generation; compatible bridge submits exactly once');
})().catch(error=>{console.error(error);process.exitCode=1;});
// The Reference Library model must override a stale MCP tool model for reference jobs.
const referenceModelArgs=ctx.companionMcpGenerationArguments({...c,referenceImageSource:'higgsfield',imageModel:'selected-reference-model'},'Portrait',{photoContext:{referenceStudy:'front_face'}});
assert.equal(referenceModelArgs.args.params.model,'selected-reference-model');
console.log('PASS Reference Library model reaches the advertised MCP model field');
