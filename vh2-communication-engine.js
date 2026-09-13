/* Durable communication projection. No provider calls or invented dialogue. */
'use strict';
function advance(core, conversation, c, communication, now) {
    const experience={realTimeLife:true,replyDelays:true,allowNoReply:true};
    const messages=communication.messages;
    const changes=[];
    const life=core.companionAttentionContext(c,now,experience);
    for(const message of messages) {
        if(message.role!=='user'||!message.awaitingReply)continue;
        const oldStage=message.attention?.stage, oldRead=message.readAt||0;
        // Private activities do not afford opening a phone, even after a timeout.
        if(message.channel==='call'&&communication.call?.id===message.callId&&communication.call.status==='active'&&communication.call.expiresAt>now&&life.availability==='available'){
            message.readAt ||= now;
            message.attention={...core.normalizeCompanionAttention(message.attention),version:1,stage:'ready',nextCheckAt:0,reason:'Listening during the connected call.'};
        } else if(life.availability==='private') {
            message.attention={...core.normalizeCompanionAttention(message.attention),version:1,
                stage:'deferred',nextCheckAt:now+60000,reason:'Phone unavailable during a private activity.'};
        } else core.advanceCompanionMessageAttention(c,message,now,experience,messages);
        if(!oldRead&&message.readAt)changes.push({kind:'MESSAGE_READ',messageId:message.id,at:now});
        if(oldStage!==message.attention?.stage)changes.push({kind:'ATTENTION_CHANGED',messageId:message.id,
            stage:message.attention?.stage,reason:message.attention?.reason,at:now});
    }
    // First-person claims are learned only from messages actually opened by this person.
    // Rebuild the visible batch newest-first for same-timestamp corrections,
    // while retaining already learned facts beyond the bounded inbox window.
    // continuityRuntime belongs to this contact; reset clears it explicitly.
    c.continuityRuntime ||= {};
    const remembered=(c.continuityRuntime.playerFacts||[]).filter(f=>f.personaId===communication.personaId);
    c.continuityRuntime.playerFacts=[];
    const fresh=conversation.learnPlayerFacts(c.continuityRuntime,[...messages].reverse(),communication.personaId,now);
    const keys=new Set(fresh.map(f=>f.key));
    const claims=[...remembered.filter(f=>!keys.has(f.key)),...fresh].slice(-160);
    c.continuityRuntime.playerFacts=claims;
    const due=messages.filter(m=>m.role==='user'&&m.awaitingReply&&m.attention?.stage!=='ready')
        .map(m=>m.attention?.nextCheckAt).filter(at=>Number.isFinite(at)&&at>now);
    return {...communication,claims,changes,nextAt:due.length?Math.ceil(Math.min(...due)):null};
}
module.exports={advance};
