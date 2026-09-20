/* Supporting-person positions persist independently of routine destinations. */
'use strict';
function ensure(c){return c.vh2NpcTravel ||= {people:{},events:[],sequence:0};}
function path(legs,from,to){
    const queue=[{place:from,minutes:0,legs:[]}],visited=new Set();
    while(queue.length){queue.sort((a,b)=>a.minutes-b.minutes||a.place.localeCompare(b.place));const node=queue.shift();if(visited.has(node.place))continue;visited.add(node.place);if(node.place===to)return node.legs;
        for(const l of legs)if(l.from===node.place&&!visited.has(l.to)&&l.mode==='WALK'&&!l.cost&&l.minutes>0)queue.push({place:l.to,minutes:node.minutes+l.minutes,legs:[...node.legs,l]});
    }return null;
}
function advance(c,now,localAt){
    const r=ensure(c),world=c.lifeRuntime.world,local=localAt(c,now),minute=local.hour*60+local.minute;
    const emit=(kind,id,details)=>{r.events.push({id:`npc-travel:${c.id}:${++r.sequence}`,kind,at:now,personId:id,...details});r.events=r.events.slice(-100);};
    for(const person of c.lifeProfile.socialCircle){
        if(Object.hasOwn(c.vh2People?.actors||{},person.id))continue;
        const runtime=world.people[person.id];if(!runtime)continue;
        const routine=c.lifeProfile.world.people.find(p=>p.personId===person.id&&p.days.includes(local.weekday)&&minute>=p.start&&minute<p.end);
        const destination=routine?.placeId||'';
        if(!Object.hasOwn(r.people,person.id))Object.defineProperty(r.people,person.id,{enumerable:true,writable:true,configurable:true,value:{placeId:runtime.placeId||destination,journey:null,lastAt:now,source:'initial_routine'}});
        const p=r.people[person.id],wasTravelling=!!p.journey,previousPlace=p.placeId;if(now<p.lastAt)throw Error('Supporting-person travel cannot advance backwards');
        if(p.journey&&now>=p.journey.arrivesAt){p.placeId=p.journey.to;emit('npc_arrived',person.id,{placeId:p.placeId,summary:`${person.name} reached a recorded destination.`});p.journey=null;}
        if(!p.journey&&destination&&destination!==p.placeId&&!(runtime.restUntil>now)){
            const route=path(c.lifeProfile.travelLegs,p.placeId,destination);
            if(route){const first=route[0];p.journey={from:p.placeId,to:first.to,departedAt:now,arrivesAt:now+first.minutes*60000,mode:'WALK',source:first.source||'authored_duration'};p.placeId='';p.blockedReason='';emit('npc_departed',person.id,{...p.journey,summary:`${person.name} started travelling between recorded places.`});}
            else p.blockedReason='No known walking route to the routine destination. Position is unchanged.';
        }
        if(p.journey){runtime.placeId='';runtime.activity='travelling';runtime.travel={...p.journey,progress:Math.min(1,(now-p.journey.departedAt)/(p.journey.arrivesAt-p.journey.departedAt))};}
        else{runtime.placeId=p.placeId;delete runtime.travel;if(destination!==p.placeId)runtime.activity=p.blockedReason?'travel unavailable':'between obligations';}
        // The coarse routine engine must not credit work at an unreached destination.
        const progressKeys=['goal','progress','goalCompleted'];
        if(p.goalState&&(wasTravelling||destination!==previousPlace||p.journey)){
            for(const key of progressKeys){if(Object.hasOwn(p.goalState,key))runtime[key]=p.goalState[key];else delete runtime[key];}
        }
        p.goalState=Object.fromEntries(progressKeys.filter(key=>Object.hasOwn(runtime,key)).map(key=>[key,runtime[key]]));
        runtime.positionSource='timed_npc_routes';p.lastAt=now;
    }
    return r;
}
module.exports={ensure,advance,path};
