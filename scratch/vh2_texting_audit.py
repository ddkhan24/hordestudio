"""Offline texting contracts using the actual queue and durable transcript.

No provider is contacted. These scenarios verify mechanics and provenance,
not whether a particular live model will produce believable dialogue.
"""
import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import vh2_conversation
import vh2_dialogue_audit as fixtures
import vh2_transcript


class Texting(unittest.TestCase):
    setUp=fixtures.Dialogue.setUp
    tearDown=fixtures.Dialogue.tearDown
    open=fixtures.Dialogue.open
    cmd=fixtures.Dialogue.cmd
    state=fixtures.Dialogue.state
    queue=fixtures.Dialogue.queue

    def snapshot(self,state=None):
        return self.s.dialogue.snapshot(self.w,self.s.projection(self.w)['revision'],state or self.state())[0]

    def test_authored_social_world_reaches_dialogue_without_changing_life(self):
        before=self.state();old=self.s.dialogue.snapshot(self.w,1,before)[1]
        background='Three roommates have separate bedrooms. Jordan studies nursing; no sister is authored.'
        self.cmd('configure_expression_profile',fields={'socialWorld':background})
        after=self.state();request,digest=self.s.dialogue.snapshot(self.w,2,after)
        self.assertEqual(request['context']['identity']['socialWorld'],background)
        self.assertIn('authored starting household',request['messages'][0]['content'])
        self.assertNotEqual(digest,old)
        for field in ('humanDynamics','relationshipDynamics','lifeRuntime','vh2People'):
            self.assertEqual(after['truth']['companion'][field],before['truth']['companion'][field])
        self.assertEqual(after,self.s.replay(self.w))
        for invalid in ({'socialWorld':{}},{'socialWorld':'x'*4001}):
            with self.assertRaises(ValueError):self.cmd('configure_expression_profile',fields=invalid)
        self.assertEqual(after,self.state())

    def test_new_profile_keeps_social_world_and_edit_supersedes_old_reply(self):
        self.w=self.s.command({'schemaVersion':1,'key':'household-fixture','type':'create_profile','name':'Household fixture',
            'providerScope':'horde:household-fixture','personaId':'test:contact',
            'profile':{'socialWorld':'Lives with a roommate in separate bedrooms.','age':28,
                'lifeProfile':{'places':[{'id':'home','kind':'home','label':'Home'}],'weeklySchedule':[],'sleepPolicy':{'enabled':False}}}})['worldId']
        self.assertEqual(self.snapshot()['context']['identity']['socialWorld'],'Lives with a roommate in separate bedrooms.')
        self.cmd('receive_message',text='Who do you live with?');self.cmd('advance',steps=1);self.queue()
        self.cmd('configure_expression_profile',fields={'socialWorld':'Lives alone following a recorded move.'})
        self.assertIsNone(self.s.dialogue.claim())
        self.assertEqual(self.s.dialogue.list(self.w)[0]['status'],'superseded')

    def test_one_atomic_job_delivers_optional_text_burst_and_replays(self):
        self.queue();job=self.s.dialogue.claim()
        before=self.state()['truth']['companion']['relationshipDynamics']
        parts=['oh london','i get why you miss it 💕']
        output=json.dumps({'reply':parts,'conversationMove':'acknowledge'})
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
        state=self.state();messages=state['communication']['messages']
        self.assertEqual([m['text'] for m in messages if m['role']=='assistant'],parts)
        self.assertEqual(len({m['id'] for m in messages}),len(messages))
        self.assertEqual(len({m['timestamp'] for m in messages[-2:]}),1)
        self.assertTrue(all(m['sourceMessageIds']==job['snapshot']['context']['readyMessageIds'] for m in messages[-2:]))
        self.assertEqual(before,state['truth']['companion']['relationshipDynamics'])
        self.assertFalse(messages[0]['awaitingReply'])
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],output))
        events=[e for e in self.s.events(self.w) if e['kind']=='REPLY_DELIVERED']
        self.assertEqual(len(events),1)
        self.assertEqual(events[0]['payload']['details']['messageIds'],[m['id'] for m in messages[-2:]])
        self.assertEqual(state,self.s.replay(self.w))
        self.s.close();self.s=self.open()
        self.assertEqual(state,self.state())
        self.assertEqual([m['text'] for m in vh2_transcript.page(self.s,self.w)['messages']][-2:],parts)

    def test_malformed_burst_is_never_partially_delivered(self):
        for reply in ([],['ok',' '],['ok',{'secret':'not text'}],['ok']*5,['ok','<think>private</think>']):
            with self.subTest(reply=reply):
                self.queue();job=self.s.dialogue.claim()
                self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],json.dumps({'reply':reply})))
                self.assertFalse(any(m['role']=='assistant' for m in self.state()['communication']['messages']))

    def test_appraisal_applies_once_for_a_burst(self):
        self.queue();job=self.s.dialogue.claim();source=job['snapshot']['context']['readyMessageIds'][0]
        output={'reply':['ohh','got it'],'appraisals':[{'sourceMessageId':source,'evidence':"I'm from London.",'interpretation':'enjoyment','confidence':1}]}
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],json.dumps(output)))
        episodes=self.state()['truth']['companion']['vh2Psychology']['episodes']
        self.assertEqual(len([e for e in episodes if e['kind']=='conversation_appraisal']),1)

    def test_burst_is_delivered_only_to_its_original_persona(self):
        self.cmd('open_conversation',personaId='friend',profile={'templateId':'friend','name':'Friend','text':'A separate person'})
        self.cmd('receive_message',conversationPersonaId='friend',text='hey');self.cmd('advance',steps=1)
        self.cmd('queue_dialogue',conversationPersonaId='friend',text='fixture')
        job=self.s.dialogue.claim();self.assertEqual(job['snapshot']['context']['personaId'],'friend')
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],json.dumps({'reply':['heyy','how did it go?']})))
        self.assertFalse(any(m['role']=='assistant' for m in self.state()['communication']['messages']))
        other=self.s.projection(self.w,'friend')['state']['communication']['messages']
        self.assertEqual([m['text'] for m in other if m['role']=='assistant'],['heyy','how did it go?'])
        self.assertTrue(all(m['playerPersonaId']=='friend' for m in other))
        self.assertEqual(self.state(),self.s.replay(self.w))

    def test_call_is_one_spoken_turn_even_if_model_returns_text_burst(self):
        self.queue();self.assertTrue(self.s.dialogue.run_once())
        self.w=self.s.command({'schemaVersion':1,'key':'call-fixture','type':'create_profile','name':'Available caller',
            'providerScope':'horde:caller','personaId':'test:contact','profile':{'age':28,'lifeProfile':{
                'places':[{'id':'home','kind':'home','label':'Home'}],'weeklySchedule':[],'sleepPolicy':{'enabled':False}}}})['worldId']
        self.cmd('set_running',running=True)
        self.cmd('start_call',callId='test-call')
        self.queue();job=self.s.dialogue.claim();self.assertIsNotNone(job)
        self.assertIn('one string',job['snapshot']['messages'][0]['content'])
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],json.dumps({'reply':['Hey.','Can you hear me?']})))
        replies=[m for m in self.state()['communication']['messages'] if m.get('channel')=='call' and m['role']=='assistant']
        self.assertEqual(len(replies),1);self.assertEqual(replies[0]['text'],'Hey. Can you hear me?')
        self.assertEqual(replies[0]['callId'],'test-call')

    def test_grounded_reentry_timing_and_fatigue_preserve_relationship(self):
        state=copy.deepcopy(self.state());now=state['simAt']
        state['communication']['messages'].insert(0,{'id':'earlier','role':'assistant','text':'talk later','timestamp':now-86400000,'deliveredAt':now-86400000,'deliveryState':'delivered'})
        state['truth']['companion']['humanDynamics'].update(energy=20,stress=80,sleep={'stage':'waking','pressure':20,'debtHours':3,'irritability':30})
        before=copy.deepcopy(state);context=self.snapshot(state)['context']
        self.assertEqual(context['exchangeTiming']['lastReplyAt'],now-86400000)
        self.assertGreater(context['exchangeTiming']['gapBeforeMessageMs'],20*3600000)
        self.assertTrue(any('recorded gap' in hint for hint in context['conversationBrief']['cueHints']))
        self.assertEqual(context['current']['body']['stage'],'waking')
        self.assertIn('low energy',context['conversationBandwidth']['factors'])
        self.assertIn('under stress',context['conversationBandwidth']['factors'])
        self.assertEqual(state,before)
        self.assertTrue(all('timestamp' in m for m in context['conversation']))

    def archive_fixture(self):
        self.cmd('open_conversation',personaId='other',profile={'templateId':'other','name':'Other','text':'A separate contact'})
        with self.s.connect() as db:
            revision,before=self.s.read(db,self.w);after=copy.deepcopy(before);now=after['simAt']
            def message(ident,text,offset=0,**kwargs):
                return {'id':ident,'role':'user','text':text,'timestamp':now-100000+offset,'readAt':now-100000+offset,
                        'awaitingReply':False,'attention':{'stage':'answered'},**kwargs}
            after['communication']['messages']=[message('old-claim','My hometown is Faro.'),
                message('old-correction','Actually, Tavira is my hometown. Faro was where I stayed.',1),
                message('old-unread','Secret hometown never opened',2,readAt=0),
                message('old-draft','Unpublished hometown draft',3,role='assistant',deliveryState='pending'),
                message('old-accented','The café was in São Paulo.',4)]
            after['communication']['messages'] += [message('filler-'+str(i),'A separate conversation topic '+str(i),10+i) for i in range(230)]
            after['conversations']['other']['roots']['communication']['messages']=[message('other-claim','My hometown is PRIVATE OTHER PERSON.')]
            self.s.commit_event(db,self.w,revision,before,after,'TEST_ARCHIVE')
        self.assertNotIn('old-claim',{m['id'] for m in self.state()['communication']['messages']})
        self.cmd('receive_message',text='Do you remember my hometown?');self.cmd('advance',steps=1)

    def test_recall_beyond_active_inbox_keeps_correction_and_persona_scope(self):
        self.archive_fixture()
        context=self.snapshot()['context'];recalled=context['conversationBrief']['memoryEvidence']['pastConversation']
        ids={m['id'] for m in recalled}
        self.assertIn('old-claim',ids);self.assertIn('old-correction',ids)
        self.assertNotIn('old-unread',ids);self.assertNotIn('old-draft',ids);self.assertNotIn('other-claim',ids)
        self.assertTrue(all(m['truthScope']=='quoted_conversation' for m in recalled))
        self.assertNotIn('PRIVATE OTHER PERSON',json.dumps(context))
        self.s.close();self.s=self.open()
        self.assertEqual(recalled,self.snapshot()['context']['conversationBrief']['memoryEvidence']['pastConversation'])

    def test_cleared_transcript_is_not_resurrected_by_archive_recall(self):
        self.archive_fixture();self.cmd('manage_conversation',action='clear')
        self.cmd('receive_message',text='Do you remember my hometown?');self.cmd('advance',steps=1)
        self.assertNotIn('Tavira',json.dumps(self.snapshot()))
        self.assertEqual(self.state(),self.s.replay(self.w))

    def test_archive_lookup_handles_accents_and_case(self):
        self.archive_fixture()
        self.cmd('receive_message',text='Was that CAFE in SAO PAULO?');self.cmd('advance',steps=1)
        recalled=self.snapshot()['context']['conversationBrief']['memoryEvidence']['pastConversation']
        self.assertIn('old-accented',{m['id'] for m in recalled})

    def test_learned_fact_survives_inbox_compaction_and_same_time_correction(self):
        self.assertEqual(self.snapshot()['context']['knownPlayerFacts'][0]['value'],'London')
        with self.s.connect() as db:
            revision,before=self.s.read(db,self.w);after=copy.deepcopy(before)
            after['communication']['messages'] += [{'id':'later-'+str(i),'role':'assistant','text':'Another exchange',
                'timestamp':after['simAt'],'deliveredAt':after['simAt'],'deliveryState':'delivered'} for i in range(210)]
            # Mark the old user input answered so the bounded inbox may compact it.
            after['communication']['messages'][0]['awaitingReply']=False
            self.s.commit_event(db,self.w,revision,before,after,'TEST_COMPACTION')
        self.cmd('advance',steps=1)
        self.assertEqual(self.snapshot()['context']['knownPlayerFacts'][0]['value'],'London')
        self.cmd('receive_message',text="I'm from Bristol.")
        self.cmd('receive_message',text="I'm from York.")
        self.cmd('advance',steps=1)
        facts=self.snapshot()['context']['knownPlayerFacts']
        self.assertEqual(len(facts),1);self.assertEqual(facts[0]['value'],'York')
        self.cmd('manage_conversation',action='clear');self.cmd('advance',steps=1)
        self.assertEqual(self.snapshot()['context']['knownPlayerFacts'][0]['value'],'York')
        self.cmd('manage_conversation',action='reset');self.cmd('advance',steps=1)
        self.assertEqual(self.snapshot()['context']['knownPlayerFacts'],[])
        self.assertEqual(self.state(),self.s.replay(self.w))

    def test_template_voice_is_bounded_optional_and_reaches_provider(self):
        c=json.loads((fixtures.ROOT/'assets/bundled/aslyn-v18/character.json').read_text())['companion']
        fields={k:c[k] for k in ('textingStyle','conversationStyle','chatExamples','chatAvoid','chatLength')}
        fields['voice']=c['lifeProfile']['world']['voice']
        self.cmd('configure_expression_profile',fields=fields)
        request=self.snapshot();model=json.loads(request['messages'][1]['content'])
        self.assertEqual(model['identity']['textingStyle'],c['textingStyle'])
        self.assertEqual(model['voice']['affection'],fields['voice']['affection'])
        self.assertEqual(model['conversationBrief']['lengthPreference'],'brief')
        self.assertIn('optionally be an array',request['messages'][0]['content'])
        self.assertNotIn('always fragments',c['chatAvoid'])
        self.assertIn('phrasing only',request['messages'][0]['content'])


if __name__=='__main__':unittest.main(verbosity=2)
