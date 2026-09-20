/* Native VH2 visit/co-presence mechanism inspired by Patterns of Life concepts.
 * No third-party source copied. Shared place is not proof of conversation.
 */
'use strict';
function ensure(c){return c.vh2Presence ||= {sequence:0,visit:null,visits:[],contacts:{},events:[],lastAt:0};}
function emit(r,c,kind,now,details,summary){
    const id=`presence:${c.id}:${++r.sequence}`;
    r.events.push({id,kind,at:now,...details,summary});r.events=r.events.slice(-100);return id;
}
function nearby(c,now){
    const world=c.lifeRuntime?.world;
    if(!world?.placeId||world.journey)return [];
    return (c.lifeProfile.socialCircle||[]).flatMap(person=>{
        const p=world.people?.[person.id];
        // Do not keep stale routine positions alive through missing updates.
        if(!p||p.placeId!==world.placeId||p.lastAt!==now||p.restUntil>now)return [];
        return [{id:person.id,name:person.name,placeId:p.placeId,source:p.positionSource||'simulated_routine'}];
    }).sort((a,b)=>a.id.localeCompare(b.id));
}
function advance(c,now,availability){
    const r=ensure(c),world=c.lifeRuntime?.world;
    if(now<r.lastAt)throw Error('Presence cannot advance backwards');
    const place=world&&!world.journey?c.lifeProfile.places.find(p=>p.id===world.placeId):null;
    if(r.visit&&r.visit.placeId!==place?.id){
        r.visit.departedAt=now;
        emit(r,c,'place_departed',now,{visitId:r.visit.id,placeId:r.visit.placeId},`Left ${r.visit.placeLabel}.`);
        r.visits.push(r.visit);r.visits=r.visits.slice(-100);r.visit=null;
    }
    if(place&&!r.visit){
        const id=emit(r,c,'place_entered',now,{placeId:place.id},`Recorded presence at ${place.label}.`);
        r.visit={id,placeId:place.id,placeLabel:place.label,arrivedAt:now,source:'simulation_position'};
    }
    const people=nearby(c,now),ids=new Set(people.map(p=>p.id));
    for(const [id,contact] of Object.entries(r.contacts)){
        if(!ids.has(id)||contact.visitId!==r.visit?.id){
            emit(r,c,'co_presence_ended',now,{personId:id,visitId:contact.visitId,placeId:contact.placeId,startedAt:contact.startedAt},`No longer sharing the recorded place with ${contact.name}.`);
            delete r.contacts[id];
        }
    }
    for(const person of people){
        if(!r.contacts[person.id]){
            r.contacts[person.id]={...person,visitId:r.visit.id,startedAt:now,noticedAt:null};
            emit(r,c,'co_presence_started',now,{personId:person.id,placeId:person.placeId,visitId:r.visit.id,source:person.source},`${person.name} is also at ${place.label}; interaction is not established.`);
        }
        const contact=r.contacts[person.id];
        // Routine co-presence is only a coarse place-level fact. A small place,
        // sustained overlap and available attention can support noticing.
        const intimatePlace=(place.encounterScope||(place.kind==='home'?'nearby':'area'))==='nearby';
        const dwell=Math.max(0,Math.min(120,Number(place.noticeMinutes??2)))*60000;
        if(contact.noticedAt===null&&intimatePlace&&availability==='available'&&now-contact.startedAt>=dwell){
            contact.noticedAt=now;
            emit(r,c,'encounter',now,{personId:person.id,placeId:place.id,visitId:r.visit.id,source:'procedural_notice',presenceSource:person.source},`Noticed ${person.name} at ${place.label}. No conversation or shared activity is established.`);
        }
    }
    r.lastAt=now;return r;
}
function observed(c){return Object.values(c.vh2Presence?.contacts||{}).filter(p=>p.noticedAt!==null).map(p=>({id:p.id,name:p.name,placeId:p.placeId,noticedAt:p.noticedAt,source:p.source}));}
module.exports={ensure,advance,nearby,observed};
