'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('virtual_humans/frontend/vh2-horde-integration.js','utf8');
const calls=[];const ctx={state:{globalSettings:{defaultModel:'fixture',companionAlwaysOnEnabled:false,companionAlwaysOnDailyLimit:6}},companionTextProviderId:()=> 'local',providerAuthHeaders:()=>({Authorization:'Bearer fixture'}),providerApiBase:()=> 'http://127.0.0.1:1234/v1',providerHasCredentials:()=>true,companionProviderOutputBudget:()=>512,mcpBridgeRequest:async(path,options)=>{calls.push(options.body);return {};}};
vm.createContext(ctx);vm.runInContext('const vh2ProviderSignatures=new Map();'+source.slice(source.indexOf('function vh2TextBudgetSummary('),source.indexOf('const vh2EnqueueLocks=')),ctx);
(async()=>{
 const c={id:'one',model:'fixture',alwaysOnEnabled:false};await ctx.vh2SyncProvider(c);
 assert.equal(calls[0].defaultBudgetPolicy.dialogueDailyLimit,null);assert.equal(calls[0].defaultBudgetPolicy.backgroundDailyLimit,6);assert.equal(calls[0].preserveDailyLimit,true);
 ctx.state.globalSettings.companionAlwaysOnDailyLimit=1;await ctx.vh2SyncProvider(c,{updateDailyLimit:true});assert(!calls.at(-1).updateBackgroundDailyLimit,'Disabled Always On never adjusts an existing allowance');
 c.alwaysOnEnabled=true;ctx.state.globalSettings.companionAlwaysOnEnabled=true;await ctx.vh2SyncProvider(c,{updateDailyLimit:true});assert.equal(calls.at(-1).updateBackgroundDailyLimit,1);assert.equal(calls.at(-1).defaultBudgetPolicy.dialogueDailyLimit,null);
 await ctx.vh2SyncProvider(c,{budgetPolicy:{version:1,dialogueDailyLimit:3,backgroundDailyLimit:0}});assert.equal(calls.at(-1).budgetPolicy.dialogueDailyLimit,3);
 const legacy=ctx.vh2TextBudgetSummary({budgets:{dialogue:{legacy:true,used:6,limit:6}}});assert.match(legacy,/Legacy shared text cap: 6 \/ 6/);assert.match(legacy,/midnight UTC/);assert.match(legacy,/Review or remove/);
 const separate=ctx.vh2TextBudgetSummary({budgets:{dialogue:{legacy:false,used:7,limit:null},background:{used:2,limit:6}}});assert.match(separate,/7 today · local daily cap off/);assert.match(separate,/Per character/);
 console.log('PASS disabled Always On isolation, explicit background controls, dialogue policy sync, visible counts/scope/reset/legacy migration.');
})().catch(e=>{console.error(e);process.exitCode=1;});
