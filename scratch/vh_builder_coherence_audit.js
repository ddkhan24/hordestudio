'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),{buildContext}=require('./app_source');
const c=buildContext(vm,['companionLifePolicyProblem','companionLifeSectionNeedsGeneration','vhBuilderDossier','vhLifeCoherenceFindings','vhBuilderLifeDesign','companionBuilderSystemPrompt','companionLifeBuilderSystemPrompt','parseCompanionBuilderObject'],{getActiveCompanionTimeline:()=>null,companionSexualSystemActive:p=>p.libidoEnabled===true});
const plain=x=>JSON.parse(JSON.stringify(x));
for(const profile of [
 {name:'Leela',occupation:'Runs a small sewing business from home',socialWorld:'Lives alone. No siblings. Her friend lives in another city.',values:'Independence and careful craft',relationshipStyle:'Slow to trust',emotionExpression:'guarded',ruminationStyle:'high'},
 {name:'Miles',occupation:'Retired farmer',socialWorld:'Widowed, with one adult son who lives far away.',values:'Keeping promises, practical care',relationshipStyle:'Affection through small practical acts',emotionExpression:'masked',ruminationStyle:'low'},
 {name:'Nadia',occupation:'Freelance video editor',socialWorld:'Enjoys a few colleagues but wants evenings alone.',values:'Private time and creative freedom',relationshipStyle:'Direct boundaries',emotionExpression:'transparent',ruminationStyle:'normal'}
]){
 const person={id:profile.name,age:31,timezone:'UTC',...profile,personalPreferences:{privacyPreference:90,boundaries:'No public relationship details'},socialWritingStyle:'Occasional observations; no private messages',libidoEnabled:false,lifeProfile:{world:{secretRuntime:'must not be sent'},places:[{id:'home'}],socialCircle:[],personalCalendar:[{id:'birthday'}]},lifeSetupPolicies:{autonomy:{enabled:false}},lifeRuntime:{secret:'must not be sent'}};
 const before=JSON.stringify(person),d=plain(c.vhBuilderDossier(person,{direction:'Keep the existing family exactly. No sister.',lifeDesign:{premise:'A private life with meaningful choices',motivations:[{want:'A little connection',opportunity:'An optional call',friction:'Both people may be busy'}]}}));
 for(const key of ['relationshipStyle','emotionExpression','ruminationStyle','values','socialWorld','personalPreferences','socialWritingStyle'])assert.deepEqual(d[key],person[key]);
 assert.equal(d.currentLifeSetup.autonomy.enabled,false);assert.equal(d.lifeDesign.motivations.length,1);assert.equal(d.libidoEnabled,false);assert(!JSON.stringify(d).includes('secretRuntime'));assert(!JSON.stringify(d).includes('must not be sent'));assert.equal(JSON.stringify(person),before);
}
const check=patch=>plain(c.vhLifeCoherenceFindings(patch));
assert(check({finance:{enabled:true,incomePerHour:10,workPlaceIds:[]}}).some(i=>i.section==='finance'));
assert(check({finance:{enabled:true,incomePerHour:10,workPlaceIds:['office']},weeklySchedule:[]}).some(i=>i.section==='weeklySchedule'));
assert.equal(check({finance:{enabled:true,incomePerHour:0,dailyIncome:80,workPlaceIds:[]}}).length,0);
assert.equal(check({finance:{enabled:true,incomePerHour:10,workPlaceIds:['office']},weeklySchedule:[{placeId:'office',activity:'Paid editing shift'}]}).length,0);
assert(check({activityOptions:[{id:'call',kind:'contact',participantId:'parent'}],socialCircle:[]}).some(i=>i.section==='activityOptions'));
assert(check({activityOptions:[{id:'call',kind:'contact',participantId:'parent'}],socialCircle:[{id:'parent',name:'Parent'}]}).some(i=>i.section==='socialCircle'));
assert.equal(check({activityOptions:[{id:'call',kind:'contact',participantId:'parent'}],socialCircle:[{id:'parent',contactWindows:[{days:[0],startMinute:600,endMinute:660}]}]}).length,0);
assert(check({activityOptions:[{id:'meal',kind:'meal',requiredPlaceId:'home'}],geography:{places:[{placeId:'home',capabilities:{}}]}}).some(i=>i.section==='geography'));
assert(check({autonomy:{enabled:true},geography:{enabled:false},socialPolicy:{introductionsEnabled:false},population:{enabled:true}}).length===2);
assert.equal(check({socialCircle:[],peopleLives:[],weeklySchedule:[],activityOptions:[{kind:'leisure',label:'Listen to a favorite record'}]}).length,0,'Chosen solitude is not a missing friend quota');
const p=c.companionLifeBuilderSystemPrompt();assert(!p.includes('4-10 supporting people'));assert(p.includes('MOTIVE -> OPPORTUNITY -> FRICTION'));assert(p.includes('incomePerHour needs actual paid workPlaceIds'));assert(p.includes('exploration interests/curiosity help them notice world reports'));assert(p.includes('Do not emit a supplies section'));assert(c.companionBuilderSystemPrompt('max').includes('lifeDesign'));
assert.equal(c.parseCompanionBuilderObject({choices:[{message:{content:[{type:'text',text:'{"name":"Structured response"}'}]}}]}).name,'Structured response');
assert.equal(c.parseCompanionBuilderObject({choices:[{message:{tool_calls:[{function:{arguments:'{"name":"Tool response"}'}}]}}]}).name,'Tool response');
console.log('PASS complete personality handoff across three distinct lives, explicit absences, no runtime leakage, functional income/contact/food links, chosen solitude and provider-neutral parsing.');

const setupSource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../vh-setup-ui.js'),'utf8');
vm.runInContext(setupSource.slice(setupSource.indexOf('function vhProposalDependencyIssues('),setupSource.indexOf('function vhProposalDependencies(')),c);
const rule={id:'course-attendance',label:'Course attendance',scheduleId:'course',minimumAttendance:.7,fee:0,missedStress:2};
assert.equal(c.companionLifePolicyProblem('institutions',[rule]),'');
assert.equal(c.companionLifeSectionNeedsGeneration('institutions',[]),false);
assert(c.companionLifePolicyProblem('institutions',[{...rule,minimumAttendance:NaN}]));
assert(c.companionLifePolicyProblem('institutions',[rule,{...rule,id:'second'}]));
assert(check({institutions:[rule],weeklySchedule:[]}).some(x=>x.section==='institutions'));
assert.equal(check({institutions:[rule],weeklySchedule:[{id:'course'}]}).length,0);
assert.equal(c.vhProposalDependencyIssues({}, {}, {institutions:[rule]})[0].section,'weeklySchedule');
assert.equal(c.vhProposalDependencyIssues({}, {weeklySchedule:[{id:'course'}]}, {institutions:[rule]}).length,0);
assert(p.includes('institutions is an optional array'));
console.log('PASS attendance rule schema, optional absence, commitment dependencies and AI engine guide');
