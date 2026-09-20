const assert=require('node:assert/strict');
const engine=require('../virtual_humans/engine/vh-conversation-engine');
const now=10000;
const line="don't let it go to your head";
const messages=[
 {id:'u',role:'user',text:line,timestamp:1},
 {id:'a',role:'companion',type:'text',text:line,responseGroupId:'one',timestamp:2},
 {id:'b',role:'companion',type:'text',text:line,responseGroupId:'one',timestamp:3},
 {id:'c',role:'companion',type:'text',text:'yes. '+line,responseGroupId:'two',timestamp:4},
 {id:'d',role:'companion',text:'future phrase must stay private',timestamp:now+1},
 {id:'e',role:'companion',text:'future phrase must stay private',timestamp:now+2},
 {id:'f',role:'companion',text:line,invalidated:true,timestamp:5}
];
const saved=JSON.stringify(messages);
const patterns=engine.dialoguePatterns(messages,now);
assert.equal(patterns.turnCount,2);
assert.equal(patterns.recurring[0].phrase,line);
assert.equal(patterns.recurring[0].count,2);
assert(!engine.dialogueGuidance(messages,now).includes('future phrase'));
assert.equal(engine.assessDialogue('okay. '+line,messages,now).repeatedFragments.length,1);
assert.equal(engine.assessDialogue('yeah, i like talking to you',messages,now).repeatedFragments.length,0);
assert.equal(engine.assessDialogue(line,messages,now).advisoryOnly,true);
assert.equal(JSON.stringify(messages),saved);
assert.equal(engine.dialoguePatterns(messages.slice(0,3),now).recurring.length,0);
assert.equal(engine.dialoguePatterns([{role:'user',text:line},{role:'user',text:line}],now).recurring.length,0);
console.log('PASS repetition counts exchanges rather than bubbles; excludes user/future/invalidated text; advisory diagnostics preserve dialogue');
const fs=require('node:fs');
const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const {functionSource}=require('./app_source');
for(const fn of ['buildCompanionPerformancePrompt','buildCompanionSystemPrompt','companionCompactPrompt']) assert(functionSource(fn).includes('VHConversationEngine.dialogueGuidance(messages, nowMs, companion'),fn);
assert(!functionSource('buildCompanionPerformancePrompt').includes('longer replies must be earned'));
assert(!engine.dialogueGuidance([],now).includes(line),'no global canned-phrase blacklist');
assert(functionSource('companionBehaviorSignature').includes('without using sarcasm'));
console.log('PASS shared conversation guidance in full, performance and compact paths; authored expressive length is not overridden');

// Voice examples and sentiment must not manufacture shared relationship history.
const firstContact=engine.relationshipGrounding({connectionType:'stranger',knownBeforeDays:0},[
 {role:'user',text:'First time trying this',timestamp:1},
 {role:'user',text:'unread',timestamp:2,awaitingReply:true},
 {role:'user',text:'deleted',timestamp:3,invalidated:true},
 {role:'user',text:'future',timestamp:now+1}
],now);
assert.match(firstContact,/1 player messages across 1 UTC calendar days/);
assert.match(firstContact,/None supplied/);
assert.match(firstContact,/first occurrence stays a first occurrence/);
assert.match(firstContact,/current event alone is insufficient/);
assert.match(firstContact,/not evidence of attachment/);
const partner=engine.dialogueGuidance([],now,{connectionType:'partner',knownBeforeDays:500,relationshipContext:'Married for a year; met in London.'});
assert.match(partner,/Married for a year; met in London/);
assert.match(partner,/500 days/);
assert.match(partner,/missing older history is unknown/);
assert.match(partner,/without imposing a mandatory slow courtship/);
console.log('PASS relationship grounding separates voice, current attraction and evidenced shared history; respects authored partners and excludes unseen input');
assert.equal(engine.stripPrivateChannels('<|channel>thought <channel|>yeah'),'yeah');
assert.equal(engine.stripPrivateChannels('<|channel>thought private reasoning<channel|>ok'),'ok');
assert.equal(engine.stripPrivateChannels('<think>private reasoning</think>yep'),'yep');
assert.equal(engine.stripPrivateChannels('<think>unfinished private reasoning'),'');
assert.equal(engine.stripPrivateChannels('<|channel|>analysis private<|channel|>final<|message>sure'),'sure');
assert.equal(engine.stripPrivateChannels('I thought you meant tomorrow'),'I thought you meant tomorrow');
assert.match(engine.dialogueGuidance([],now),/single word/);
console.log('PASS private channel envelopes are removed without exposing reasoning or padding short replies');
