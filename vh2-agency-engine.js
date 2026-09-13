/* Procedural expression from recorded experiences. No language or provider calls. */
'use strict';
const {random}=require('./vh2-decision-engine');
const plans=require('./vh2-plans-engine');
const DEFAULTS={enabled:false,captureInterest:55,sharingInterest:45,sociability:55,noveltyWeight:25,
    minEnergy:30,maxStress:75,captureThreshold:65,shareThreshold:65,invitationThreshold:65,
    captureCooldownMinutes:90,postCooldownMinutes:180,inviteCooldownMinutes:360,maxPendingCaptures:4};
const BOUNDS={captureInterest:[0,100],sharingInterest:[0,100],sociability:[0,100],noveltyWeight:[0,50],
    minEnergy:[0,100],maxStress:[0,100],captureThreshold:[0,200],shareThreshold:[0,200],invitationThreshold:[0,200],
    captureCooldownMinutes:[5,1440],postCooldownMinutes:[5,1440],inviteCooldownMinutes:[10,10080],maxPendingCaptures:[1,12]};
function ensure(c){const r=c.vh2Agency ||= {policy:{...DEFAULTS},processed:[],captures:[],decisions:[],lastCaptureAt:null,lastPostAt:null,lastInviteAt:null,sequence:0};r.policy={...DEFAULTS,...r.policy};return r;}
function ready(c,now,availability){const p=ensure(c).policy,d=c.humanDynamics;return !c.vh2AutonomyPaused&&(p.enabled||c.socialFeedEnabled===true)&&availability==='available'&&!c.lifeRuntime.world.journey&&d.energy>=p.minEnergy&&d.stress<=p.maxStress&&!(c.lifeRuntime.activities.conversationUntil>now);}
function trace(r,kind,sourceId,at,components,threshold,eligible=true){const score=Object.values(components).reduce((n,x)=>n+x,0),accepted=eligible&&score>=threshold;const d={kind,sourceId,at,components,score,threshold,accepted};r.decisions.push(d);r.decisions=r.decisions.slice(-60);return d;}
function advance(c,now,availability,events){
    const r=ensure(c),p=r.policy,seen=new Set(r.processed),fresh=events.filter(e=>!seen.has(e.id)&&e.at===now);
    // Enabling a policy cannot retroactively create photos of old experiences.
    r.processed=events.map(e=>e.id).slice(-600);
    if(!ready(c,now,availability))return r;
    const w=c.lifeRuntime.world,d=c.humanDynamics;
    for(const e of fresh){
        const meaningful=e.kind==='encounter'||e.kind==='arrival'||e.kind==='shared_plan'&&['started','completed'].includes(e.phase||e.id.split(':').at(-1))&&(e.participantIds||[c.id]).includes(c.id)||e.kind==='completed';
        if(!meaningful)continue;
        if(p.enabled&&e.kind==='encounter'&&r.lastInviteAt!==now&&(r.lastInviteAt===null||now-r.lastInviteAt>=p.inviteCooldownMinutes*60000)&&!plans.conflicts(c,c.id,now,now+40*60000)){
            const person=c.lifeProfile.socialCircle.find(x=>x.id===e.personId);
            if(person){
                const components={socialInterest:p.sociability*.5,need:d.socialNeed*.35,relationship:(c.vh2SocialBonds?.pairs?.[person.id]?.self.warmth??person.closeness)*.15,tension:-person.tension*.3,energy:(d.energy-50)*.15,variation:(random(c.id+'|invite|'+e.id)-.5)*20};
                const decision=trace(r,'invite',e.id,now,components,p.invitationThreshold);
                if(decision.accepted){
                    const ident=`agency:${c.id}:${++r.sequence}`;
                    const personIds=[person.id,...(c.vh2Presence?.contacts?Object.keys(c.vh2Presence.contacts):[]).filter(id=>id!==person.id&&c.vh2People?.actors?.[id]?.placeId===w.placeId&&c.lifeProfile.socialCircle.some(p=>p.id===id&&p.closeness>=50))].slice(0,4);
                    plans.command(c,{type:'propose_plan',planId:ident,personId:person.id,personIds,placeId:w.placeId,label:`Spend time with ${person.name}`,startsAt:now+10*60000,endsAt:now+40*60000,durationMinutes:10},now);
                    const plan=c.vh2Plans.plans.find(x=>x.id===ident);plan.origin='autonomous';plan.sourceEventId=e.id;r.lastInviteAt=now;
                }
            }
        }
        if(c.allowPhotos===false||(!p.enabled&&c.socialFeedImages===false))continue;
        if(r.captures.filter(x=>x.status==='pending').length>=p.maxPendingCaptures||r.lastCaptureAt!==null&&now-r.lastCaptureAt<p.captureCooldownMinutes*60000)continue;
        const previous=(c.vh2Presence?.visits||[]).filter(v=>v.placeId===w.placeId).length;
        const components={interest:p.captureInterest*.65,novelty:p.noveltyWeight/(1+previous),occasion:e.kind==='shared_plan'?20:e.kind==='encounter'?15:5,
            mood:Math.max(-10,Math.min(10,Number(c.mood?.valence)||0)),fatigue:-Math.max(0,50-d.energy)*.3,stress:-d.stress*.12,
            variation:(random(c.id+'|capture|'+e.id)-.5)*20};
        const decision=trace(r,'capture',e.id,now,components,p.captureThreshold);
        if(decision.accepted){
            const id=`agency:${c.id}:${++r.sequence}`;
            r.captures.push({id,sourceEventId:e.id,at:now,placeId:w.placeId,status:'pending',captureType:'front_camera_selfie',destination:'gallery',scene:'A spontaneous front-camera selfie from this recorded moment.',reason:e.summary});
            r.lastCaptureAt=now;
        }
    }
    const pending=r.captures.filter(x=>x.status==='pending');
    const settled=r.captures.filter(x=>x.status!=='pending'&&x.at>=now-86400000).slice(-100);
    r.captures=[...pending,...settled];
    return r;
}
function publications(c,now,availability,photos,posts){
    if(c.socialFeedEnabled===false||c.socialPostFrequency==='manual')return [];
    const r=ensure(c),p=r.policy;
    if(!ready(c,now,availability)||r.lastPostAt!==null&&now-r.lastPostAt<p.postCooldownMinutes*60000)return [];
    const existing=new Set(posts.map(x=>x.photoId));
    const candidates=photos.filter(x=>x.origin==='autonomous'&&x.destination==='gallery'&&x.status==='stored'&&!x.shareDecision&&!existing.has(x.id)&&x.deliveredAt<now);
    const chosen=[];
    for(const photo of candidates){
        // One evaluation per rendered photo. Time supplies an opportunity, not a posting lottery.
        const components={interest:p.sharingInterest*.7,socialNeed:c.humanDynamics.socialNeed*.2,occasion:photo.sourceKind==='shared_plan'?20:5,
            stress:-c.humanDynamics.stress*.15,age:-Math.min(30,(now-photo.at)/86400000*15),variation:(random(c.id+'|share|'+photo.id)-.5)*20};
        const decision=trace(r,'publish',photo.id,now,components,p.shareThreshold);
        chosen.push({photoId:photo.id,publish:decision.accepted,decision});
        if(decision.accepted){r.lastPostAt=now;break;}
    }
    return chosen;
}
module.exports={DEFAULTS,BOUNDS,ensure,advance,publications,ready};
