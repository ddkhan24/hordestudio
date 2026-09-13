"""Provider-free dialogue job recovery, concurrency and context acceptance."""
from test_runtime import node_executable
import sys, tempfile, unittest, uuid, json, threading, sqlite3
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService, Conflict, encode, QUANTUM
from vh2_dialogue import LEASE_MS
ROOT=Path(__file__).resolve().parents[1]
class Dialogue(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.now=1788764400000
        self.s=self.open()
        self.w=self.s.command({'schemaVersion':1,'key':'fixture','type':'create','name':'Alex'})['worldId']
        self.cmd('receive_message',text="I'm from London.")
        self.cmd('advance',steps=1)
    def open(self):return WorldService(Path(self.tmp.name)/'a.sqlite',node_executable(ROOT),ROOT,clock=lambda:self.now)
    def tearDown(self):self.s.close();self.tmp.cleanup()
    def cmd(self,kind,**args):
        body={'schemaVersion':1,'key':str(uuid.uuid4()),'type':kind,'worldId':self.w,'expectedRevision':self.s.projection(self.w)['revision'],**args}
        return body,self.s.command(body)
    def state(self):return self.s.projection(self.w)['state']
    def queue(self,text='Oh, nice.'):
        return self.cmd('queue_dialogue',text=text)[1]['jobId']
    def status(self):return self.s.dialogue.list(self.w)[0]['status']
    def make_check_in(self):
        self.cmd('receive_message',text="I'll text you in 20 minutes.")
        self.cmd('advance',steps=1)
        self.queue();job=self.s.dialogue.claim();source=job['snapshot']['context']['readyMessageIds'][-1]
        output=json.dumps({'reply':'Talk later','appraisals':[],'commitments':[{'sourceMessageId':source,'evidence':"I'll text you in 20 minutes.",'dueInMinutes':20,'confidence':1}]})
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
        return self.state()['truth']['companion']['vh2Psychology']['checkIns'][0]

    def test_location_context_is_explicit_and_does_not_default_home(self):
        state=json.loads(json.dumps(self.state()))
        state['truth']['present']['placeId']=None
        request,_=self.s.dialogue.snapshot(self.w,1,state)
        self.assertEqual(request['context']['current']['location'],{'status':'unknown'})
        self.assertIn('Missing or unknown location',request['messages'][0]['content'])
        state['truth']['companion']['lifeProfile']['places']=[{'id':'cafe','label':'Corner Cafe','kind':'social'}]
        state['truth']['present']['placeId']='cafe'
        request,_=self.s.dialogue.snapshot(self.w,1,state)
        self.assertEqual(request['context']['current']['location'],{'status':'established','id':'cafe','label':'Corner Cafe','kind':'social'})

    def test_markdown_wrapped_json_delivers_only_reply(self):
        self.queue();job=self.s.dialogue.claim()
        output='```json\n'+json.dumps({'reply':'Yep.','appraisals':[]})+'\n```'
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
        self.assertEqual(self.state()['communication']['messages'][-1]['text'],'Yep.')
        self.assertEqual(self.state(),self.s.replay(self.w))

    def test_wrapped_json_with_trailing_text_is_rejected(self):
        self.queue();job=self.s.dialogue.claim()
        output='```json\n'+json.dumps({'reply':'Yep.','appraisals':[]})+'\n```\nExtra commentary'
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],output))
        self.assertEqual(self.status(),'failed')

    def test_check_in_receipt_and_replay(self):
        item=self.make_check_in()
        self.cmd('advance',steps=3)
        self.cmd('receive_message',text='Back now!')
        self.cmd('advance',steps=2)
        state=self.state();outcome=state['truth']['companion']['vh2Psychology']['checkIns'][0]
        self.assertEqual(outcome['status'],'fulfilled')
        self.assertTrue(outcome['outcomeMessageId'])
        self.assertGreater(state['truth']['companion']['relationshipDynamics']['trust'],0)
        self.assertEqual(state,self.s.replay(self.w))
        self.s.close();self.s=self.open()
        self.assertEqual(state,self.state())
        self.assertEqual(item['id'],outcome['id'])

    def test_check_in_dismissal_is_persisted_and_has_no_penalty(self):
        item=self.make_check_in()
        self.cmd('dismiss_check_in',checkInId=item['id'])
        self.cmd('advance',steps=12)
        self.assertEqual(self.state()['truth']['companion']['vh2Psychology']['checkIns'][0]['status'],'dismissed')
        self.assertEqual(self.state()['truth']['companion']['relationshipDynamics']['trust'],0)
        self.assertEqual(self.state(),self.s.replay(self.w))

    def test_relationship_policy_validation_and_atomic_effects(self):
        policy=self.state()['truth']['companion']['vh2Psychology']['relationshipPolicy']
        for patch in ({'friendliness':101},{'minPositiveExchanges':1.5},{'trustOpenness':True}):
            with self.assertRaises(ValueError):self.cmd('configure_relationship_learning',policy={**policy,**patch})
        self.cmd('configure_relationship_learning',policy={**policy,'rejectionSensitivity':100})
        self.cmd('receive_message',text='You are useless and I hate talking to you.')
        self.cmd('advance',steps=1)
        self.queue();job=self.s.dialogue.claim();source=job['snapshot']['context']['readyMessageIds'][-1]
        self.assertEqual(job['snapshot']['context']['relationship']['policy']['rejectionSensitivity'],100)
        output=json.dumps({'reply':'That bothered me.','appraisals':[{'sourceMessageId':source,'evidence':'You are useless and I hate talking to you.','interpretation':'hostility','confidence':1}]})
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
        state=self.state();self.assertAlmostEqual(state['truth']['companion']['relationshipDynamics']['trust'],-.3)
        self.assertEqual(state['truth']['companion']['relationshipDynamics']['attraction'],0)
        self.assertEqual(state,self.s.replay(self.w))
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],output))

    def test_appraisal_configuration_is_validated_and_fences_old_job(self):
        policy={'enabled':True,'emotionalImpact':2,'minConfidence':.9,'maxEmotionChange':1}
        for patch in ({'emotionalImpact':99},{'enabled':1},{'minConfidence':False},{'maxEmotionChange':-1}):
            with self.assertRaises(ValueError):self.cmd('configure_conversation_appraisal',policy={**policy,**patch})
        self.queue();job=self.s.dialogue.claim()
        self.cmd('configure_conversation_appraisal',policy=policy)
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],'Old policy reply'))
        self.assertEqual('superseded',self.status())
        self.assertEqual(policy,self.state()['truth']['companion']['vh2Psychology']['conversationPolicy'])
        self.assertEqual(self.state(),self.s.replay(self.w))

    def test_disabled_appraisal_ignores_unsolicited_proposals(self):
        self.cmd('configure_conversation_appraisal',policy={'enabled':False,'emotionalImpact':1,'minConfidence':.8,'maxEmotionChange':4})
        self.queue();job=self.s.dialogue.claim();source=job['snapshot']['context']['readyMessageIds'][0]
        self.assertFalse(job['snapshot']['context']['appraisalEnabled'])
        output=json.dumps({'reply':'Okay','appraisals':[{'sourceMessageId':source,'evidence':"I'm from London.",'interpretation':'enjoyment','confidence':1}]})
        before=self.state()['truth']['companion']['mood']['valence']
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
        self.assertEqual(before,self.state()['truth']['companion']['mood']['valence'])
        self.assertFalse(any(e['kind']=='conversation_appraisal' for e in self.state()['truth']['companion']['vh2Psychology']['episodes']))

    def test_structured_appraisal_atomic_replay(self):
        self.queue();job=self.s.dialogue.claim()
        source=job['snapshot']['context']['readyMessageIds'][0]
        before=self.state()['truth']['companion']['mood']['valence']
        proposal={'sourceMessageId':source,'evidence':"I'm from London.",'interpretation':'enjoyment','confidence':.9}
        output=json.dumps({'reply':'London!','appraisals':[proposal,proposal]})
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],output))
        state=self.state();psy=state['truth']['companion']['vh2Psychology']
        self.assertEqual(1,len([e for e in psy['episodes'] if e['kind']=='conversation_appraisal']))
        self.assertAlmostEqual(before+.36,state['truth']['companion']['mood']['valence'])
        self.assertEqual('London!',state['communication']['messages'][-1]['text'])
        self.assertGreater(state['truth']['companion']['emotionState']['felt']['joy'],0)
        context=self.s.dialogue.snapshot(self.w,self.s.projection(self.w)['revision'],state)[0]['context']
        self.assertEqual(state['truth']['companion']['emotionState']['felt'],context['current']['emotions']['felt'])
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],output))
        self.assertEqual(state,self.s.replay(self.w))

    def test_unsupported_appraisal_does_not_change_mood(self):
        self.queue();job=self.s.dialogue.claim()
        source=job['snapshot']['context']['readyMessageIds'][0]
        before=self.state()['truth']['companion']['mood']['valence']
        proposals=[{'sourceMessageId':source,'evidence':'invented quotation','interpretation':'support','confidence':1},
                   {'sourceMessageId':source,'evidence':"I'm from London.",'interpretation':'support','confidence':1,'trust':100}]
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],json.dumps({'reply':'Oh nice','appraisals':proposals})))
        self.assertEqual(before,self.state()['truth']['companion']['mood']['valence'])

    def test_malformed_envelope_never_leaks(self):
        self.queue();job=self.s.dialogue.claim()
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],'{"reply":"hello","appraisals":null}'))
        self.assertEqual('failed',self.status())
        self.assertEqual(1,len(self.state()['communication']['messages']))

    def test_queued_restart_exactly_one_delivery(self):
        body,receipt=self.cmd('queue_dialogue',text='Hi')
        self.assertEqual(receipt,self.s.command(body))
        self.s.close();self.s=self.open()
        self.assertTrue(self.s.dialogue.run_once())
        self.assertFalse(self.s.dialogue.run_once())
        self.assertEqual('delivered',self.status())
        self.assertEqual(2,len(self.state()['communication']['messages']))
        self.assertEqual(self.state(),self.s.replay(self.w))
    def test_snapshot_is_immutable_and_scoped(self):
        job_id=self.queue();job=self.s.dialogue.claim()
        self.assertEqual('London',job['snapshot']['context']['knownPlayerFacts'][0]['value'])
        self.assertNotIn('truth',job['snapshot']['context'])
        with self.s.connect() as db:
            with self.assertRaises(sqlite3.IntegrityError):db.execute('UPDATE dialogue_jobs SET snapshot=? WHERE id=?',('{}',job_id))
        self.cmd('receive_message',text='An unread follow-up')
        self.assertNotIn('An unread follow-up',encode(job['snapshot']))
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],'Stale reply'))
        self.assertEqual('superseded',self.status())
        self.assertEqual([],self.state()['playerKnowledge'])
    def test_expired_worker_fenced_and_recovered(self):
        self.queue();first=self.s.dialogue.claim();self.now+=LEASE_MS+1
        self.s.close();self.s=self.open();second=self.s.dialogue.claim()
        self.assertNotEqual(first['token'],second['token'])
        self.assertEqual(2,second['attempt'])
        self.assertFalse(self.s.dialogue.finish(first['id'],first['token'],'Late'))
        self.assertTrue(self.s.dialogue.finish(second['id'],second['token'],'Recovered'))
        self.assertFalse(self.s.dialogue.finish(second['id'],second['token'],'Duplicate'))
        self.assertEqual(1,len(self.state()['playerKnowledge']))
    def test_one_worker_claim_and_one_active_job(self):
        self.queue()
        with self.assertRaises(Conflict):self.queue('Second')
        results=[]
        threads=[threading.Thread(target=lambda:results.append(self.s.dialogue.claim())) for _ in range(2)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(1,sum(r is not None for r in results))
    def test_unrelated_revision_does_not_discard_valid_reply(self):
        self.queue();job=self.s.dialogue.claim()
        simulation_start=self.state()['simAt']
        self.cmd('set_running',running=True)
        self.now+=3000
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],'Still valid'))
        self.assertEqual(simulation_start+3000,self.state()['communication']['messages'][-1]['deliveredAt'])
        self.assertTrue(self.state()['running'])
    def test_sleep_during_work_discards_reply(self):
        self.queue();job=self.s.dialogue.claim()
        with self.s.connect() as db:
            rev,before=self.s.read(db,self.w);after=json.loads(encode(before))
            after['truth']['companion']['humanDynamics']['sleep']={'stage':'asleep','lastAt':after['simAt'],
                'sleepStartedAt':after['simAt'],'pressure':80,'nap':False}
            self.s.commit_event(db,self.w,rev,before,after,'TEST_SLEEP')
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],'Awake?'))
        self.assertEqual('superseded',self.status())
        self.assertEqual([],self.state()['playerKnowledge'])
    def test_worker_runs_outside_writer_and_failure_isolated(self):
        self.queue()
        def executor(job):
            # A separate DB connection can write while expression is executing.
            self.cmd('set_running',running=True)
            raise RuntimeError('SECRET_PROVIDER_TOKEN')
        self.assertFalse(self.s.dialogue.run_once(executor))
        self.assertEqual('failed',self.status())
        self.assertNotIn('SECRET_PROVIDER_TOKEN',encode(self.s.dialogue.list(self.w)))
        self.now+=QUANTUM;self.assertEqual([],self.s.tick())
        self.assertGreater(self.state()['simAt'],1788764400000)
    def test_invalid_output_and_bounded_recovery(self):
        self.queue();job=self.s.dialogue.claim()
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],'<|channel>thought secret'))
        self.assertEqual('failed',self.status())
        self.queue()
        for _ in range(3):
            self.assertIsNotNone(self.s.dialogue.claim());self.now+=LEASE_MS+1
        self.assertIsNone(self.s.dialogue.claim());self.assertEqual('failed',self.status())
        self.assertEqual([],self.state()['playerKnowledge'])
    def test_delivery_failure_rolls_back_job_and_transcript(self):
        self.queue();job=self.s.dialogue.claim();before=self.s.projection(self.w)
        original=self.s.commit_event
        def fail(*args,**kwargs):
            if args[5]=='REPLY_DELIVERED':raise RuntimeError('Simulated commit failure')
            return original(*args,**kwargs)
        self.s.commit_event=fail
        with self.assertRaises(RuntimeError):self.s.dialogue.finish(job['id'],job['token'],'Hello')
        self.s.commit_event=original
        self.assertEqual('leased',self.status())
        self.assertEqual(before,self.s.projection(self.w))
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],'Hello'))
    def test_kernel_upgrade_invalidates_worker(self):
        self.queue();job=self.s.dialogue.claim();self.s.kernel_version+='-new-fixture'
        self.assertFalse(self.s.dialogue.finish(job['id'],job['token'],'Wrong kernel'))
        self.assertEqual('superseded',self.status())
        self.assertEqual([],self.state()['playerKnowledge'])
    def test_stale_queue_never_invokes_executor(self):
        self.queue();self.cmd('receive_message',text='Wait, different question')
        def must_not_run(job):self.fail('Stale work reached executor')
        self.assertFalse(self.s.dialogue.run_once(must_not_run))
        self.assertEqual('superseded',self.status())
if __name__=='__main__':unittest.main(verbosity=2)
