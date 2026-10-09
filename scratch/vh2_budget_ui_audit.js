'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('virtual_humans/frontend/vh2-horde-integration.js','utf8');
const calls=[];const ctx={state:{globalSettings:{defaultModel:'fixture',companionAlwaysOnEnabled:false,companionAlwaysOnDailyLimit:6}},companionTextProviderId:()=> 'local',providerAuthHeaders:()=>({Authorization:'Bearer fixture'}),providerApiBase:()=> 'http://127.0.0.1:1234/v1',providerHasCredentials:()=>true,companionProviderOutputBudget:()=>512,getActiveCompanionTimeline:()=>({}),vh2Request:async(timeline,path,options)=>{calls.push(options.body);return {};}};
vm.createContext(ctx);vm.runInContext('const vh2ProviderSignatures=new Map();'+source.slice(source.indexOf('function vh2TextBudgetSummary('),source.indexOf('const vh2EnqueueLocks=')),ctx);
(async()=>{
 const c={id:'one',model:'fixture',alwaysOnEnabled:false};await ctx.vh2SyncProvider(c);
 assert.equal(calls.length,1);
 for(const field of ['dailyLimit','preserveDailyLimit','defaultBudgetPolicy','budgetPolicy','updateBackgroundDailyLimit'])assert.equal(calls[0][field],undefined,field+' must not reintroduce a VH2 text cap');
 ctx.state.globalSettings.companionAlwaysOnDailyLimit=1;c.alwaysOnEnabled=true;ctx.state.globalSettings.companionAlwaysOnEnabled=true;
 await ctx.vh2SyncProvider(c,{updateDailyLimit:true});assert.equal(calls.length,1,'Always On limit changes do not sync a VH2 text cap');
 const usage=ctx.vh2TextBudgetSummary({textLimitsEnforced:false,usage:{dialogue:7,background:2}});
 assert.match(usage,/chat & calls 7; background posts & adviser 2/);assert.match(usage,/no daily text-request limit/);assert.match(usage,/provider may still charge/);assert.match(usage,/Automatic background posts and adviser reviews can incur charges/);assert.match(usage,/midnight UTC/);
 assert.match(ctx.vh2TextBudgetSummary({configured:false,textLimitsEnforced:false}),/No text provider is configured/);
 assert.match(ctx.vh2TextBudgetSummary({budgets:{dialogue:{legacy:true,used:1,limit:500}}}),/older VH2 service/);
 console.log('PASS VH2 provider sync omits text caps, displays usage and provider-spend warning, and flags older servers.');
})().catch(e=>{console.error(e);process.exitCode=1;});
