/* JSON-in/JSON-out adapter. No provider access; Python owns I/O and leases. */
const fs = require('node:fs');
global.VHWorldEngine = require('./vh-world-engine');
global.VHActivityEngine = require('./vh-activity-engine');
global.VHConversationEngine = require('./vh-conversation-engine');
const core = require('./vh-simulation-core');
function run(input) {
    if (input.request) return VHConversationEngine.fitRequest(input.request, { contextSize: input.contextSize });
    const c = input.companion;
    const messages = input.messages || [];
    const now = Number(input.now);
    if (!c?.id || !Number.isFinite(now)) throw new Error('Invalid simulation snapshot');
    if(input.routeResult)VHWorldEngine.applyRoute(c,input.routeResult.id,input.routeResult.result,now);
    core.advanceCompanionLife(c, now);
    core.advanceCompanionHumanDynamics(c, now);
    core.advanceCompanionEmotionState(c, now);
    const experience = input.experience || { realTimeLife: true, replyDelays: true, allowNoReply: true };
    messages.forEach(message => core.advanceCompanionMessageAttention(c, message, now, experience, messages));
    const pending = messages.filter(message => message.role === 'user' && !message.invalidated && message.awaitingReply);
    const ready = pending.filter(message => message.deliveredAt <= now && message.readAt > 0 && message.readAt <= now);
    // Attachments require the browser's modality-aware reply pipeline.
    const blockedMedia = pending.some(message => ['photo', 'audio', 'video'].includes(message.type));
    const due = VHWorldEngine.connected(c) && !blockedMedia && ready.some(message => message.replyDueAt > 0 && message.replyDueAt <= now);
    VHConversationEngine.learnPlayerFacts(c.continuityRuntime,messages,c.continuityRuntime.playerPersonaId,now);
    const life = core.companionLifeState(c, now);
    const transition=experience.realTimeLife?core.companionConversationTransition(c,messages,now):null;
    const handoff=c.initiativeMode!=='off'&&VHWorldEngine.connected(c)&&!pending.length&&life.availability==='available'&&transition?.engaged&&transition.upcoming&&transition.upcoming.at>now&&transition.upcoming.key!==c.continuityRuntime.lastHandoffKey&&now-c.continuityRuntime.lastHandoffAttemptAt>60000?transition.upcoming:null;
    const continuation=c.continuityRuntime.conversation;
    const resume=c.initiativeMode!=='off'&&continuation?.status==='paused'&&continuation.resumeAfter>0&&continuation.resumeAfter<=now&&continuation.resumeReason;
    const affectCommitted = VHConversationEngine.hasAffect(input.commit?.state);
    if (input.commit?.state) {
        if (affectCommitted) core.applyCompanionMoodUpdate(c, input.commit.state, now);
        c.continuityRuntime.revision++;
        c.continuityRuntime.lastExchangeAt = now;
        c.continuityRuntime.conversation = VHConversationEngine.receive(c.continuityRuntime.conversation, input.commit.state.conversation, ready, now);
        VHWorldEngine.acknowledge(c,input.commit.state.conversation?.followThrough,input.commit.text||'',now);
        VHWorldEngine.consent(c,input.commit.state.conversation?.giftConsent,ready,now);
        VHConversationEngine.enactChoice(c,input.commit.state.conversation?.choice,ready,now,{...life.situation,availability:life.availability},VHActivityEngine);
    }
    if(input.commit?.text&&handoff&&input.commit.handoffKey===handoff.key){c.continuityRuntime.lastHandoffKey=handoff.key;c.continuityRuntime.lastHandoffAttemptAt=now;if(c.continuityRuntime.conversation.status!=='closed')c.continuityRuntime.conversation.status='paused';}
    const opening=c.lifeProfile?.world?.frame?.openerMode==='vh_first'&&c.initiativeMode!=='off'&&VHWorldEngine.connected(c)&&!c.continuityRuntime.originScenarioConsumedAt&&!messages.some(m=>!m.invalidated&&['user','companion'].includes(m.role));
    if(opening&&!c.lifeRuntime.world.openingAt)c.lifeRuntime.world.openingAt=now+(c.lifeProfile.world.frame.openingDelayMinutes??1)*60000;
    if(opening&&input.commit?.text)c.continuityRuntime.originScenarioConsumedAt=now;
    if(resume&&input.commit?.text&&c.continuityRuntime.conversation.resumeAfter<=now){c.continuityRuntime.conversation.resumeAfter=0;if(c.continuityRuntime.conversation.status==='paused')c.continuityRuntime.conversation.status='active';}
    const followup=VHWorldEngine.pendingFollowup(c,now);
    if(input.commit?.text&&followup)followup.dueAt=now+3600000;
    return { handoff:!input.commit?.text?handoff:null, openingDueAt:opening&&!input.commit?.text?c.lifeRuntime.world.openingAt:0, followupDueAt: resume&&!input.commit?.text?continuation.resumeAfter:c.initiativeMode!=='off'&&followup&&followup.dueAt<=now?followup.dueAt:0, routeRequest: VHWorldEngine.routeRequest(c,now), companion: c, messages, affectCommitted, pendingIds: pending.map(message => message.id), replyIds: ready.map(message => message.id), due,
        available: VHWorldEngine.connected(c) && (!experience.realTimeLife || life.availability === 'available'),
        dialogueGuidance: (handoff?VHConversationEngine.handoffBrief(handoff)+'\n':'')+(resume?`Return to the unfinished conversation if still relevant: ${continuation.topic}. ${continuation.openQuestion||''} Reason to return: ${continuation.resumeReason}.\n`:'')+(opening?'Initiate the first conversation without invented shared history. Authored opening: '+(c.lifeProfile.world.frame.openerScenario||c.startingScenario||'A natural introduction based on the public profile.')+'\n':'')+VHConversationEngine.playerFactsBrief(c.continuityRuntime,c.continuityRuntime.playerPersonaId)+'\n'+VHWorldEngine.brief(c) + '\n' + VHConversationEngine.dialogueGuidance(messages, now, c) + "\n" + VHConversationEngine.decisionBrief(VHConversationEngine.decisionContext(c,messages,now,{...life.situation,availability:life.availability})),
        present: { projects: c.lifeRuntime?.activities?.projects || [], learning: c.lifeRuntime?.activities?.learning || [], activity: life.label, availability: life.availability, situation: life.situation,
            receptiveness: VHConversationEngine.receptiveness(c, { ...life.situation, availability: life.availability, now }),
            lingeringReaction: VHConversationEngine.reactionContext(c.continuityRuntime.conversation, now) },
        feeling: { mood: c.mood, dynamics: c.humanDynamics } };
}
if (require.main === module) {
    try { process.stdout.write(JSON.stringify(run(JSON.parse(fs.readFileSync(0, 'utf8'))))); }
    catch (error) { process.stderr.write(String(error.message)); process.exitCode = 1; }
}
module.exports = { run };
