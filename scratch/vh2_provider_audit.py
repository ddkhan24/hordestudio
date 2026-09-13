"""Mocked provider checks. Never makes a network request."""
from test_runtime import node_executable
import sys, tempfile, unittest, uuid, json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService, Conflict, encode
from vh2_dialogue import LEASE_MS
from vh2_provider import parse_response, RejectedOutput, NoRedirect
ROOT=Path(__file__).resolve().parents[1]
class Provider(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.now=1788764400000
        self.s=self.open();self.w=self.s.command({'schemaVersion':1,'key':'fixture','type':'create','name':'Alex'})['worldId']
        self.cmd('receive_message',text='Hi');self.cmd('advance',steps=1)
        self.settings=dict(baseUrl='https://example.invalid/v1',model='fixture-model',apiKey='PRIVATE_TEST_KEY',enabled=True,maxTokens=512,dailyLimit=5,temperature=.7)
        self.s.dialogue_provider.save(self.settings)
    def open(self):return WorldService(Path(self.tmp.name)/'a.sqlite',node_executable(ROOT),ROOT,clock=lambda:self.now)
    def tearDown(self):self.s.close();self.tmp.cleanup()
    def cmd(self,kind,**params):
        return self.s.command({'schemaVersion':1,'key':str(uuid.uuid4()),'type':kind,'worldId':self.w,'expectedRevision':self.s.projection(self.w)['revision'],**params})
    def queue(self):return self.cmd('queue_dialogue',adapter='chat_completions')['jobId']
    def status(self):return self.s.dialogue.list(self.w)[0]['status']
    @staticmethod
    def response(text='Hi',reason='stop'):return {'choices':[{'finish_reason':reason,'message':{'content':text}}]}
    def test_mock_delivery_and_secret_isolation(self):
        self.queue();calls=[]
        def mock(config,key,messages):
            calls.append(config);self.assertEqual(key,'PRIVATE_TEST_KEY');self.assertEqual(config['maxTokens'],512)
            self.assertNotIn('PRIVATE_TEST_KEY',encode(messages));return self.response('Yep')
        self.assertTrue(self.s.dialogue.run_once(provider_transport=mock));self.assertEqual(1,len(calls))
        self.assertEqual('model_worker',self.s.projection(self.w)['state']['communication']['messages'][-1]['origin'])
        for value in [self.s.dialogue_provider.status(),self.s.projection(self.w),self.s.events(self.w),self.s.dialogue.list(self.w)]:
            self.assertNotIn('PRIVATE_TEST_KEY',encode(value))
        self.assertEqual(1,self.s.dialogue_provider.status()['usedToday'])
    def test_snapshot_freezes_model_and_credential_version(self):
        self.queue();self.s.dialogue_provider.save({**self.settings,'model':'new-model','apiKey':'NEW_KEY'})
        def mock(config,key,messages):
            self.assertEqual(config['model'],'fixture-model');self.assertEqual(key,'PRIVATE_TEST_KEY');return self.response()
        self.assertTrue(self.s.dialogue.run_once(provider_transport=mock))
    def test_timeout_blocks_retry_until_explicit_acknowledgement(self):
        job_id=self.queue();calls=[]
        def timeout(*args):calls.append(1);raise TimeoutError('SECRET ERROR')
        self.assertFalse(self.s.dialogue.run_once(provider_transport=timeout));self.assertEqual('unknown',self.status())
        self.s.close();self.s=self.open();self.now+=LEASE_MS*2
        self.assertFalse(self.s.dialogue.run_once(provider_transport=timeout));self.assertEqual(1,len(calls))
        with self.assertRaises(Conflict):self.queue()
        self.cmd('dismiss_unknown_dialogue',jobId=job_id);self.assertEqual('abandoned',self.status())
        self.assertNotIn('SECRET ERROR',encode(self.s.events(self.w)))
        self.queue() # explicit new generation, never an automatic timeout retry
    def test_crash_after_submission_never_resubmits(self):
        self.queue();job=self.s.dialogue.claim();self.assertIsNotNone(self.s.dialogue.submit(job))
        self.s.close();self.s=self.open();self.now+=LEASE_MS+1
        self.assertIsNone(self.s.dialogue.claim());self.assertEqual('unknown',self.status())
        self.assertEqual(1,self.s.dialogue_provider.status()['usedToday'])
    def test_daily_budget_survives_configuration_changes(self):
        self.s.dialogue_provider.save({**self.settings,'dailyLimit':1})
        self.queue();self.assertTrue(self.s.dialogue.run_once(provider_transport=lambda *args:self.response()))
        self.cmd('receive_message',text='Again')
        self.s.dialogue_provider.save({**self.settings,'dailyLimit':1,'model':'other'})
        self.queue();called=[]
        self.assertFalse(self.s.dialogue.run_once(provider_transport=lambda *args:called.append(1)))
        self.assertEqual([],called);self.assertEqual('failed',self.status())
        self.assertEqual(1,self.s.dialogue_provider.status()['usedToday'])
    def test_disabling_stops_queued_submissions(self):
        self.queue();self.s.dialogue_provider.save({**self.settings,'enabled':False});called=[]
        self.assertFalse(self.s.dialogue.run_once(provider_transport=lambda *args:called.append(1)))
        self.assertEqual([],called);self.assertEqual(0,self.s.dialogue_provider.status()['usedToday'])
    def test_partial_or_reasoning_output_not_delivered(self):
        self.queue()
        self.assertFalse(self.s.dialogue.run_once(provider_transport=lambda *args:self.response('Half a sentence','length')))
        self.assertEqual('failed',self.status())
        self.queue()
        self.assertFalse(self.s.dialogue.run_once(provider_transport=lambda *args:self.response('<think>secret</think>Hello')))
        self.assertEqual([],self.s.projection(self.w)['state']['playerKnowledge'])
    def test_changed_context_before_submission_spends_nothing(self):
        self.queue();job=self.s.dialogue.claim();self.cmd('receive_message',text='Wait')
        self.assertIsNone(self.s.dialogue.submit(job));self.assertEqual('superseded',self.status())
        self.assertEqual(0,self.s.dialogue_provider.status()['usedToday'])
    def test_key_preservation_endpoint_change_and_url_validation(self):
        self.s.dialogue_provider.save({**self.settings,'apiKey':''});self.assertTrue(self.s.dialogue_provider.status()['hasKey'])
        self.s.dialogue_provider.save({**self.settings,'apiKey':'','baseUrl':'https://different.invalid/v1'})
        self.assertFalse(self.s.dialogue_provider.status()['hasKey'])
        for url in ['http://remote.invalid/v1','https://user:key@example.invalid/v1','https://example.invalid/v1?key=secret']:
            with self.assertRaises(ValueError):self.s.dialogue_provider.save({**self.settings,'baseUrl':url})
        self.s.dialogue_provider.save({**self.settings,'baseUrl':'http://127.0.0.1:1234/v1'})
        self.assertIsNone(NoRedirect().redirect_request(None,None,None,None,None,None))
    def test_response_contract(self):
        self.assertEqual('Hi',parse_response(self.response([{'type':'text','text':'Hi'}])))
        for value in [{},self.response('', 'stop'),self.response('cut','length'),self.response('call','tool_calls')]:
            with self.assertRaises(RejectedOutput):parse_response(value)
if __name__=='__main__':unittest.main(verbosity=2)
