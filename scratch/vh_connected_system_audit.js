const assert = require('node:assert/strict');
const vm = require('node:vm');
const {buildContext} = require('./app_source');
const conversation = require('../virtual_humans/engine/vh-conversation-engine');
const activity = require('../virtual_humans/engine/vh-activity-engine');
const worker = require('../virtual_humans/engine/vh-host-worker');
const ctx = { console, state: { globalSettings: {}, personas: [], companions: [], companionTimelines: {}, companionThreads: {} } };
buildContext(vm, ['normalizeCompanion','advanceCompanionLife','advanceCompanionHumanDynamics','advanceCompanionEmotionState',
    'advanceCompanionMessageAttention','companionAlwaysOnSnapshot','companionCompactPrompt','buildCompanionMessages',
    'companionToolsFor','companionChatStyleDescription','materializeCompanionStartingSocialPosts'],ctx);
const t = Date.UTC(2026,8,7,12);
const person = () => ctx.normalizeCompanion({ id:'connected',name:'Ada',age:28,locationMode:'custom',timezoneOffsetMinutes:0,
    sleepArchetype:'normal',libidoEnabled:false,lifeWildcardsEnabled:false,lifeWeatherEnabled:false,
    lifeProfile:{initializedAt:t-86400000,weeklySchedule:[{id:'home',days:[1],startMinute:420,endMinute:1440,
        activity:'Home',availability:'available',withIds:[],effects:{energyPerHour:-1,stressTarget:15}}]},
    humanDynamics:{energy:70,stress:20,hunger:60,lastUpdated:t},mood:{lastUpdated:t},emotionState:{lastUpdated:t},
    lifeRuntime:{lastSimulatedAt:t,activities:{lastAdvancedAt:t}},continuityRuntime:{lastAdvancedAt:t} });
function check(name, fn) { fn(); console.log('PASS '+name); }
check('shared browser and host physics, activities, attention and reload agree',()=>{
    const a=person(), b=JSON.parse(JSON.stringify(a));
    const experience={realTimeLife:true,replyDelays:true,allowNoReply:true};
    const messages=[{id:'u',role:'user',type:'text',text:'How are you?',timestamp:t,deliveredAt:t,awaitingReply:true}];
    const browserMessages=JSON.parse(JSON.stringify(messages));
    let host={companion:b,messages:JSON.parse(JSON.stringify(messages)),experience};
    for(let minute=0;minute<=130;minute++) {
        const at=t+minute*60000;
        ctx.advanceCompanionLife(a,at);ctx.advanceCompanionHumanDynamics(a,at);ctx.advanceCompanionEmotionState(a,at);
        browserMessages.forEach(m=>ctx.advanceCompanionMessageAttention(a,m,at,experience,browserMessages));
        host={...worker.run({...host,now:at}),experience};
        if(minute===55) host=JSON.parse(JSON.stringify(host));
    }
    for(const field of ['humanDynamics','emotionState','lifeRuntime']) assert.deepEqual(JSON.parse(JSON.stringify(a[field])),host.companion[field],field);
    assert.deepEqual(JSON.parse(JSON.stringify(browserMessages)),host.messages);
    assert(a.lifeRuntime.activities.goals.some(g=>g.kind==='meal'&&g.status==='completed'));
});
check('renaming an activity cannot change physiology; explicit effects can',()=>{
    const run=(label,effects)=>{
        const c=person();c.lifeProfile.weeklySchedule[0].activity=label;
        if(effects)c.lifeProfile.weeklySchedule[0].effects=effects;
        ctx.advanceCompanionHumanDynamics(c,t+3600000);return JSON.stringify(c.humanDynamics);
    };
    assert.equal(run('working'),run('resting'));assert.notEqual(run('working'),run('working',{energyPerHour:-8,stressTarget:80}));
});
check('small requests budget tools and output while retaining the final question/answer',()=>{
    const c=person(); c.contextSize=4096;c.backstory='Large biography. '.repeat(900);
    const history=[{role:'companion',type:'text',text:'Earlier topic',timestamp:t-10000},
        {role:'companion',type:'text',text:'Cafe or park?',timestamp:t-1000},
        {role:'user',type:'text',text:'Cafe',timestamp:t,readAt:t}];
    const result=conversation.fitRequest({messages:ctx.buildCompanionMessages(c,history,t,{performanceOnly:true}),
        tools:ctx.companionToolsFor(c,true,true),max_tokens:1400},
        {contextSize:4096,compactSystem:ctx.companionCompactPrompt(c,history,t)});
    assert(result.audit.estimatedInputTokens+result.audit.outputReserve+result.audit.margin<=4096);
    assert(result.body.messages.some(m=>m.content.includes('Cafe or park?')));
    assert(result.body.messages.at(-1).content.endsWith('Cafe'));
    assert.throws(()=>conversation.fitRequest({messages:[{role:'system',content:'x'.repeat(100000)},{role:'user',content:'hi'}]}, {contextSize:1024}),e=>e.code==='VH_CONTEXT_TOO_SMALL');
});
check('conversation continuation and chat style survive normalization without becoming memories',()=>{
    const c=person(); c.chatExamples='EXAMPLE_ONLY: cafe before adventures';c.conversationStyle='Offers opinions';c.chatAvoid='therapy language';
    c.continuityRuntime.conversation=conversation.update({}, {topic:'Weekend plans',openQuestion:'Which cafe?',status:'paused',resumeAfter:t+60000,resumeReason:'Continue after lunch'},t);
    const saved=ctx.normalizeCompanion(JSON.parse(JSON.stringify(c)));
    assert.equal(saved.continuityRuntime.conversation.openQuestion,'Which cafe?');
    assert(ctx.companionChatStyleDescription(saved).includes('EXAMPLE_ONLY'));
    assert(!saved.memory.longTerm.some(m=>m.text.includes('EXAMPLE_ONLY')));
    assert.equal(conversation.update(saved.continuityRuntime.conversation,{status:'closed'},t+120000).openQuestion,'');
});
check('blank social drafts survive reload but never materialize as published posts',()=>{
    const c=person();c.startingSocialPosts=[{id:'draft',kind:'photo',text:'',scene:''}];
    const saved=ctx.normalizeCompanion(JSON.parse(JSON.stringify(c)));
    assert.equal(saved.startingSocialPosts.length,1);assert.equal(ctx.materializeCompanionStartingSocialPosts(saved,t).length,0);
});
