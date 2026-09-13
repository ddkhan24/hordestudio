/* VH2 adapter: provider-free shared mechanics with seeded action selection.
 * Boundary scheduling retains the shared integrators; this is not a VH1 save migrator.
 */
'use strict';
const fs = require('node:fs');
global.VHWorldEngine = require('./vh-world-engine');
global.VHActivityEngine = require('./vh-activity-engine');
global.VHConversationEngine = require('./vh-conversation-engine');
const core = require('./vh-simulation-core');
const decisions=require('./vh2-decision-engine');
const communication=require('./vh2-communication-engine');
const psychology=require('./vh2-psychology-engine');
const health=require('./vh2-health-engine');
const story=require('./vh2-story-engine');
const followthrough=require('./vh2-followthrough-engine');
const presence=require('./vh2-presence-engine');
const agency=require('./vh2-agency-engine');
const npcTravel=require('./vh2-npc-travel');
const socialBonds=require('./vh2-social-bonds');
const population=require('./vh2-population-engine');
const people=require('./vh2-people-engine');
const exploration=require('./vh2-exploration-engine');
const episodes=require('./vh2-episodes-engine');
const relationships=require('./vh2-relationship-lifecycle');
global.VH2Institutions=require('./vh2-institutions-engine');
global.VH2Lifestyle=require('./vh2-lifestyle-engine');
global.VH2Travel=require('./vh2-travel-engine');
global.VH2Plans=require('./vh2-plans-engine');
global.VH2Geography=require('./vh2-geography-engine');
const VERSION = 'vh2-foundation-1';
function create(name, id, now) {
    const c = {id, name, age:28, locationMode:'custom', timezoneOffsetMinutes:0,
        sleepArchetype:'normal', libidoEnabled:false,
        lifeWeatherEnabled:false, initiativeMode:'off', lifeEvents:[],
        lifeProfile:core.normalizeCompanionLifeProfile({initializedAt:now,seed:id,
            places:[{id:'home',label:'Home',kind:'home'}],weeklySchedule:[],
            activityOptions:[{id:'read',kind:'leisure',label:'Read at home',startMinute:0,endMinute:1440}],
            sleepPolicy:{enabled:true}}),
        lifeRuntime:core.normalizeCompanionLifeRuntime({lastSimulatedAt:now,activities:{lastAdvancedAt:now}}),
        humanDynamics:core.normalizeCompanionHumanDynamics({energy:65,hunger:30,stress:15,lastUpdated:now},now),
        mood:{valence:0,arousal:0,dominance:0,lastUpdated:now},
        emotionState:core.normalizeCompanionEmotionState({lastUpdated:now},now),
        continuityRuntime:core.normalizeCompanionContinuityRuntime({})};
    return advance(c, now);
}
function advance(c, now) {
    psychology.ensure(c);VH2Geography.ensure(c);health.advance(c,now);
    // Retire the exact former auto-generated campus umbrella when authored
    // class sessions exist. It must not shadow them for the whole working day.
    const blocks=c.lifeProfile.weeklySchedule||[],starter=b=>b.activity==='classes, study and campus obligations';
    const detailed=blocks.filter(b=>!starter(b)&&/lecture|class|seminar|tutorial/i.test(b.activity)&&b.endMinute-b.startMinute<=180);
    const shadowed=blocks.filter(b=>starter(b)&&detailed.some(d=>d.placeId===b.placeId));
    if(shadowed.length){c.lifeProfile.weeklySchedule=blocks.filter(b=>!shadowed.includes(b));c.vh2SetupRepairs=[...(c.vh2SetupRepairs||[]),{at:now,kind:'retired_starter_campus_blocks',ids:shadowed.map(b=>b.id)}].slice(-30);}

    // Import authored placement once; schedules never remain movement controllers.
    const participantState=people.ensure(c);
    participantState.setup ||= {};
    const local=core.companionLocalMinuteInfo({...c,vh2Travel:null},now),minute=local.hour*60+local.minute;
    for(const person of c.lifeProfile.socialCircle||[]){
        if(participantState.actors[person.id]||participantState.setup[person.id]?.placementImported)continue;
        const record=participantState.setup[person.id] ||= {};
        const observed=c.vh2NpcTravel?.people?.[person.id]?.placeId||c.lifeRuntime.world?.people?.[person.id]?.placeId;
        const authored=(c.lifeProfile.world?.people||[]).find(p=>require('./vh-world-engine').activeOn(p,local.dateKey)&&p.personId===person.id&&p.days.includes(local.weekday)&&minute>=p.start&&minute<p.end);
        if(observed||authored?.placeId){record.initialPlaceId=observed||authored.placeId;record.source=observed?'migrated observed position':'authored initial placement';}
        record.placementImported=true;
    }
    if(!c.vh2AutonomyPaused)exploration.observe(c,now,core.companionLocalMinuteInfo,core.companionSituationAt(c,now).availability);
    c.vh2Decision ||= {policy:decisions.policy(),sequence:0,history:[]};
    people.advance(c,now,(person,at)=>core.companionLocalMinuteInfo({...person,vh2Travel:null},at));
    story.advance(c,now,core);
    VH2Plans.before(c,now,core);
    core.advanceCompanionActivities(c,now,{selectAction:(candidates,at,context,score)=>decisions.select(c.vh2Decision,candidates,at,context,goal=>{const base=score(goal),experience=psychology.experienceScore(c,goal),intention=VH2Geography.preference(c,goal),reflection=psychology.reflectionScore(c.vh2Psychology,goal.requiredPlaceId),healthPreference=health.preference(c,goal),storyPreference=story.preference(c,goal,at);return {...base,score:base.score+experience+intention+reflection+healthPreference+storyPreference,components:{...base.components,experience,intention,reflection,health:healthPreference,story:storyPreference}};})});
    if(!c.vh2AutonomyPaused)episodes.advance(c,now,core.companionLocalMinuteInfo,core.companionSituationAt(c,now).availability);
    core.advanceCompanionWorld(c,now);
    require('./vh2-network-engine').observe(c,now);
    // Every current supporting position belongs to the participant runtime.
    for(const [id,record] of Object.entries(c.lifeRuntime.world.people||{}))if(!c.vh2People?.actors?.[id]){record.placeId='';record.availability='unknown';record.activity='Life setup incomplete';record.positionSource='unplaced';}
    c.lifeRuntime.lastSimulatedAt=now;
    core.advanceCompanionHumanDynamics(c,now);
    core.advanceCompanionEmotionState(c,now);
    const situation=core.companionBaseSituationAt(c,now);
    if(situation.availability!=='available'||situation.source==='sleep_transition')
        VHActivityEngine.pauseForContext(c.lifeRuntime.activities,now,`Interrupted by ${situation.label||situation.availability}.`);
    population.advance(c,now,core.companionSituationAt(c,now).availability,core.companionLocalMinuteInfo,core.normalizeCompanionSocialPerson);
    presence.advance(c,now,core.companionSituationAt(c,now).availability);
    VH2Plans.after(c,now);
    socialBonds.advance(c,now);
    psychology.advance(c,now);story.finish(c,now);
    if(!c.vh2AutonomyPaused)agency.advance(c,now,core.companionSituationAt(c,now).availability,[...(c.lifeRuntime.activities.events||[]),...(c.lifeRuntime.world.events||[]),...(c.vh2Presence.events||[]),...(c.vh2Plans.events||[])]);
    return c;
}
function run(input) {
    if (!Number.isSafeInteger(input.now) || input.now<=0) throw Error('Invalid simulation time');
    // Any accidental unseeded clock/random dependency must fail in tests and production.
    const oldNow=Date.now, oldRandom=Math.random;
    Date.now=()=>input.now;
    Math.random=()=>{throw Error('Unseeded random source in VH2 kernel');};
    try {
        if(input.normalizeLife)return {kernelVersion:VERSION,lifeProfile:core.normalizeCompanionLifeProfile(input.normalizeLife)};
        let c=input.create?create(input.name,input.entityId,input.now):input.companion;
        if(input.create&&input.profile){
            const p=input.profile;
            // Explicit authored contract: never import provider secrets or old runtime authority.
            for(const key of ['appearance','photoStyle','photoDirection','age','pronouns','occupation','locationLabel','locationLatitude','locationLongitude','personality','behaviorExamples','description','backstory','chatStyle','textingStyle','conversationStyle','chatExamples','chatAvoid','chatLength','values','contradictions','vulnerabilities','relationshipStyle','habits','locationMode','location','timezone','timezoneOffsetMinutes','sleepArchetype','lifeWeatherEnabled','initiativeMode','moodBaseline','startingRelationship','knownBeforeDays','regulationProfile','conflictRecovery','emotionExpression','ruminationStyle','reactionTiming','emotionalGranularity']){if(p[key]!==undefined)c[key]=p[key];}
            for(const key of require('./vh2-profile-fields.json'))if(p[key]!==undefined)c[key]=p[key];
            c.lifeProfile=core.normalizeCompanionLifeProfile({...p.lifeProfile,initializedAt:input.now,seed:input.entityId});
            if(input.calendarAges)c.vh2Calendar=input.calendarAges;
            delete c.vh2Presence;
            delete c.vh2NpcTravel;
            c.lifeRuntime=core.normalizeCompanionLifeRuntime({lastSimulatedAt:input.now,activities:{lastAdvancedAt:input.now}});
            c=advance(c,input.now);
        }
        c.relationshipDynamics=core.normalizeCompanionRelationshipDimensions(c.relationshipDynamics,c.startingRelationship,c.knownBeforeDays);
        c.mood.relationship ??= core.livingClamp(Number(c.startingRelationship)||0,-100,100);
        psychology.ensure(c);health.ensure(c);agency.ensure(c);exploration.ensure(c);episodes.ensure(c);VH2Lifestyle.ensure(c);npcTravel.ensure(c);population.ensure(c);people.ensure(c);socialBonds.ensure(c,input.now);
        c.vh2Decision ||= {policy:decisions.policy(),sequence:0,history:[]};
        if(input.policy){c.vh2Decision.policy=decisions.policy(input.policy);c.vh2Decision.choice=null;}
        if(input.repairSleepInitialization&&c.lifeProfile.sleepPolicy?.enabled!==false){
            const local=core.companionLocalMinuteInfo(c,input.now),[,wake]=core.COMPANION_SLEEP_HOURS[c.sleepArchetype]||core.COMPANION_SLEEP_HOURS.normal,d=c.humanDynamics;
            d.sleep=VHActivityEngine.advanceSleep(null,input.now,{policy:c.lifeProfile.sleepPolicy,energy:d.energy,hunger:d.hunger,stress:d.stress,preferred:core.isCompanionAsleep(c.sleepArchetype,local.hour),hoursSinceWake:(local.hour+local.minute/60-wake+24)%24,wasAsleep:false});
        }

        if(input.giftCommand){
            const gifts=c.lifeRuntime.world.gifts;while(gifts.length>=100){const index=gifts.findIndex(g=>['received','declined'].includes(g.status));if(index<0)throw Error('Resolve pending gifts before offering another.');gifts.splice(index,1);}
            VHWorldEngine.offerGift(c,input.giftCommand,input.now);
            const gift=gifts.find(g=>g.id===input.giftCommand.id);if(gift){gift.currency=input.giftCommand.currency;gift.amountMinor=Math.round(gift.value*100);gift.label=gift.kind==='cash'?`${gift.currency} ${gift.value.toFixed(2)}`:gift.label;}
        }
        if(input.routeResult)VHWorldEngine.applyRoute(c,input.routeResult.id,input.routeResult.response,input.now);
        if(input.planCommand)VH2Plans.command(c,input.planCommand,input.now);
        if(!input.create&&!input.inspect)advance(c,input.now);
        if(input.mediaReview){
            const actions=agency.publications(c,input.now,core.companionSituationAt(c,input.now).availability,input.mediaReview.photos,input.mediaReview.posts);
            return {kernelVersion:VERSION,companion:c,actions};
        }
        if(input.appraisal){
            psychology.appraiseConversation(c,input.appraisal,input.now);
            followthrough.register(c,input.appraisal,input.now);
            c.emotionState.expressed=core.companionExpressedEmotionVector(c,c.emotionState);
        }
        const inbox=input.communication?communication.advance(core,VHConversationEngine,c,input.communication,input.now):null;
        if(inbox)followthrough.advance(c,inbox,input.now);
        const events=[...(c.vh2Story?.events||[]),...(c.vh2Health?.events||[]),...(c.vh2Signals?.events||[]),...(c.vh2Travel?.events||[]),...(c.lifeRuntime.activities?.events||[]),...(c.lifeRuntime.world?.events||[]),...(c.vh2Presence?.events||[]),...(c.vh2Plans?.events||[]),...(c.vh2NpcTravel?.events||[]),...(c.vh2Population?.events||[]),...relationships.visibleEvents(c)];
        const situation=core.companionSituationAt(c,input.now);
        if(health.temperatureAt(c,input.now)===null)situation.environment=null;
        const noticed=presence.observed(c);
        situation.withNames=(situation.withNames||[]).filter(name=>noticed.some(p=>p.name===name));
        return {...(input.tripStops?{tripRoutes:VH2Travel.itinerary(c,input.tripStops,input.tripStartsAt??input.now)}:{}),...(input.capture?{photoContext:{atMs:input.now,roomId:'',placeId:situation.placeId||'',placeLabel:situation.placeLabel||c.currentLocationDetail||'',outfit:situation.outfit||c.currentOutfit||'',garmentIds:[...(c.lifeRuntime?.world?.outfit?.ids||[])],environment:situation.environment||{},withNames:situation.withNames||[],personIds:noticed.filter(p=>(situation.withNames||[]).includes(p.name)).map(p=>p.id||p.personId)}}:{}),kernelVersion:VERSION,communication:inbox,companion:c,events,nextWake:decisions.nextWake(c,input.now),
            present:{observedPeople:noticed,visit:c.vh2Presence?.visit||null,activity:situation.label||situation.activity,placeId:situation.placeId||null,
                position:VHWorldEngine.position(c,input.now),
                availability:situation.availability,needs:c.humanDynamics,socialRelationships:socialBonds.known(c),introductions:population.known(c)}};
    } finally {Date.now=oldNow;Math.random=oldRandom;}
}
if(require.main===module){try{process.stdout.write(JSON.stringify(run(JSON.parse(fs.readFileSync(0,'utf8')))));}
catch(e){process.stderr.write(e.stack);process.exitCode=1;}}
module.exports={run,VERSION};
