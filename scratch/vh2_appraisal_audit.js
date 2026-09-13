'use strict';
const assert=require('node:assert/strict');
const p=require('../vh2-psychology-engine');
const make=()=>({mood:{valence:0},emotionState:{felt:{joy:0,fear:10,anger:0,sadness:0,anticipation:0,surprise:0}},relationshipDynamics:{trust:5,attraction:0},lifeRuntime:{activities:{events:[],goals:[]},world:{events:[]}}});
const message={id:'m',role:'user',text:'I am here for you',readAt:100};
const proposal={sourceMessageId:'m',evidence:'here for you',interpretation:'support',confidence:1};
for(const patch of [{sourceMessageId:'missing'},{confidence:.3},{confidence:NaN},{interpretation:'love'},{trust:100},{evidence:'invented'}]){
 const c=make();assert.equal(p.appraiseConversation(c,{messages:[message],proposals:[{...proposal,...patch}]},100).length,0);assert.equal(c.mood.valence,0);
}
for(const readAt of [0,101])assert.equal(p.appraiseConversation(make(),{messages:[{...message,readAt}],proposals:[proposal]},100).length,0);
const disabled=make();p.ensure(disabled).conversationPolicy.enabled=false;assert.equal(p.appraiseConversation(disabled,{messages:[message],proposals:[proposal]},100).length,0);
const c=make(),input={messages:[message],proposals:[proposal,proposal]};
assert.equal(p.appraiseConversation(c,input,100).length,1);assert.equal(c.mood.valence,.6);
const restored=JSON.parse(JSON.stringify(c));assert.equal(p.appraiseConversation(restored,input,100).length,0);
p.advance(restored,100+3*3600000);assert.ok(Math.abs(restored.mood.valence-.3)<1e-8);
console.log('Conversation appraisal: evidence, bounds, unread, disabled, duplicate, reload and decay passed.');

const bounded=make();p.ensure(bounded).relationshipPolicy.enabled=false;p.ensure(bounded).conversationPolicy={enabled:true,emotionalImpact:3,minConfidence:.8,maxEmotionChange:1};
const messages=[1,2,3].map(n=>({...message,id:'m'+n})),proposals=messages.map(m=>({...proposal,sourceMessageId:m.id,interpretation:'hostility'}));
const batch=p.appraiseConversation(bounded,{messages,proposals},100);
assert.equal(batch.length,3);assert.ok(bounded.emotionState.felt.anger<=1);assert.ok(bounded.emotionState.felt.fear<=11);
assert.deepEqual(bounded.relationshipDynamics,{trust:5,attraction:0});
const relieved=make();p.appraiseConversation(relieved,{messages:[message],proposals:[{...proposal,interpretation:'relief'}]},100);
assert.equal(relieved.emotionState.felt.fear,8);assert.equal(relieved.emotionState.felt.joy,1);
const separate=make();p.ensure(separate).policy.enabled=false;
assert.equal(p.appraiseConversation(separate,input,100).length,1);
console.log('Specific emotions, batch limits, relationship isolation and separate controls passed.');
