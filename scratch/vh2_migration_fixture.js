/* Build synthetic golden archives using the real VH1 normalization/capture code. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {buildContext}=require('./app_source');
const now=1788764400000;
class FixedDate extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
const ctx={console,Date:FixedDate,state:{globalSettings:{},activePersonaId:'',personas:[],companions:[],companionTimelines:{},companionThreads:{}}};
buildContext(vm,['normalizeCompanion','captureCompanionRuntime','normalizeCompanionTimeline'],ctx);
const c=ctx.normalizeCompanion({id:'fixture-human',name:'Alex',age:28,createdAt:now,locationMode:'custom',timezone:'Europe/London',timezoneOffsetMinutes:0,
 lifeProfile:{initializedAt:now,seed:'fixture',places:[{id:'home',label:'Home',kind:'home',photo:'data:image/png;base64,fixture'},{id:'work',label:'Office',kind:'work'}],
 weeklySchedule:[{id:'work-block',days:[1],startMinute:540,endMinute:1020,placeId:'work',activity:'Work',availability:'busy'}],world:{items:[{id:'coat',name:'Blue coat',category:'outerwear',owned:true}],gifts:{enabled:true}},wardrobe:[{id:'casual',label:'Casual',description:'Jeans and a shirt'}]},
 lifeRuntime:{lastSimulatedAt:now,world:{inventory:['coat'],gifts:[{id:'money-1',kind:'cash',value:10,status:'received'}]}},
 continuityRuntime:{playerPersonaId:'persona-london'},memory:{longTerm:['The player is from London.']}});
function timeline(id,personaId,city){const runtime=ctx.captureCompanionRuntime(c);runtime.memory.longTerm=[`The player is from ${city}.`];runtime.continuityRuntime.playerPersonaId=personaId;return ctx.normalizeCompanionTimeline({id,name:id,createdAt:now,updatedAt:now,personaId,personaPinned:true,runtime,messages:[{id:'msg-'+id,role:'user',type:'text',text:`I live in ${city}.`,timestamp:now}]},c);}
const sessions=[timeline('london-thread','persona-london','London'),timeline('tokyo-thread','persona-tokyo','Tokyo')];
const archive={_format:'horde-studio-virtual-human',_version:3,_kind:'portable-human',_exportedAt:new Date(now).toISOString(),companion:c,timelines:{activeSessionId:sessions[0].id,sessions}};
const inventory={version:1,source:'VH1 normalizeCompanion / captureCompanionRuntime / normalizeCompanionTimeline',
 companionFields:Object.keys(c).sort(),runtimeFields:Object.keys(sessions[0].runtime).sort(),timelineFields:Object.keys(sessions[0]).sort(),
 lifeProfileFields:Object.keys(c.lifeProfile).sort(),worldConfigFields:Object.keys(c.lifeProfile.world).sort()};
const files=[['scratch/fixtures/vh2/portable-v3.json',archive],['vh2-vh1-fields.json',inventory]];
for(const [path,value] of files){const text=JSON.stringify(value,null,2)+'\n';if(process.argv.includes('--write'))fs.writeFileSync(path,text);else assert.deepEqual(JSON.parse(fs.readFileSync(path)),JSON.parse(text),`VH1 schema fixture drift: ${path}; review before regenerating`);}
console.log('PASS synthetic portable archive and VH1 field inventory match current exporter contracts');
