"""Offline message/attention/delivery acceptance against temporary SQLite worlds."""
from test_runtime import node_executable
import sys, tempfile, unittest, uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService, Conflict, QUANTUM, encode
ROOT=Path(__file__).resolve().parents[1]
class Communication(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.now=1788764400000
        self.service=self.open()
        self.w=self.service.command({'schemaVersion':1,'key':'fixture','type':'create','name':'Alex'})
    def open(self):return WorldService(Path(self.tmp.name)/'a.sqlite',node_executable(ROOT),ROOT,clock=lambda:self.now)
    def tearDown(self):self.service.close();self.tmp.cleanup()
    def command(self,kind,**kw):
        p=self.service.projection(self.w['worldId'])
        body={'schemaVersion':1,'key':str(uuid.uuid4()),'type':kind,'worldId':self.w['worldId'],'expectedRevision':p['revision'],**kw}
        result=self.service.command(body);return body,result
    def state(self):return self.service.projection(self.w['worldId'])['state']
    def context(self):return self.service.context(self.w['worldId'])
    def ready(self):
        for _ in range(24):
            if self.context()['readyMessageIds']:return
            self.command('advance',steps=1)
        self.fail('Never ready')
    def test_receipt_read_restart_claims_and_delivery(self):
        body,receipt=self.command('receive_message',text="I'm from London.")
        self.assertEqual(receipt,self.service.command(body))
        self.assertEqual([],self.context()['conversation']);self.assertEqual([],self.context()['knownPlayerFacts'])
        self.assertLess(self.state()['communication']['nextAt']-self.state()['simAt'],60000)
        self.service.close();self.service=self.open();self.ready()
        self.assertEqual('London',self.context()['knownPlayerFacts'][0]['value'])
        self.assertEqual('player_claim',self.context()['knownPlayerFacts'][0]['truthScope'])
        ready=self.context()['readyMessageIds'];self.command('stage_reply',text='Oh, nice.',sourceMessageIds=ready)
        self.assertEqual(1,len(self.context()['conversation']));self.assertEqual([],self.state()['playerKnowledge'])
        draft=self.state()['communication']['draft']
        body,result=self.command('deliver_reply',draftId=draft['id'])
        self.assertEqual(result,self.service.command(body));self.assertEqual(2,len(self.context()['conversation']))
        self.assertEqual(1,len(self.state()['playerKnowledge']))
        self.assertEqual('answered',self.state()['communication']['messages'][0]['attention']['stage'])
        self.assertEqual(self.state(),self.service.replay(self.w['worldId']))
        self.command('receive_message',text='Hi again')
        self.assertEqual('ready',self.state()['communication']['messages'][-1]['attention']['stage'],'engaged exchanges do not pay initial notice delay again')
    def test_stale_draft_and_same_time_claim_correction(self):
        self.command('receive_message',text='I live in London.');self.ready()
        self.command('stage_reply',text='Hi',sourceMessageIds=self.context()['readyMessageIds'])
        draft=self.state()['communication']['draft']
        self.command('receive_message',text='I live in Bristol.')
        with self.assertRaises(Conflict):self.command('deliver_reply',draftId=draft['id'])
        self.assertEqual([],self.state()['playerKnowledge'])
        self.command('advance',steps=1)
        self.assertEqual('Bristol',self.context()['knownPlayerFacts'][0]['value'])
    def test_sleep_unread_isolation_and_other_world(self):
        # Seed an explicitly asleep fixture through a ledger event; never alter a real save.
        with self.service.connect() as db:
            rev,before=self.service.read(db,self.w['worldId']);after=__import__('json').loads(encode(before))
            after['truth']['companion']['humanDynamics']['sleep']={}
            sleep=after['truth']['companion']['humanDynamics']['sleep']
            sleep.update(stage='asleep',sleepStartedAt=after['simAt'],lastAt=after['simAt'],pressure=80,nap=False)
            self.service.commit_event(db,self.w['worldId'],rev,before,after,'TEST_SLEEP')
        self.command('receive_message',text='My name is Secret.')
        self.assertEqual([],self.context()['conversation']);self.assertEqual([],self.context()['knownPlayerFacts'])
        self.command('advance',steps=1)
        self.assertEqual([],self.context()['conversation'])
        other=self.service.command({'schemaVersion':1,'key':'other','type':'create','name':'Other'})
        self.assertEqual([],self.service.context(other['worldId'])['conversation'])
        self.assertNotEqual(self.context()['personaId'],self.service.context(other['worldId'])['personaId'])
    def test_receipt_is_not_backdated_and_restart_catchup(self):
        self.command('set_running',running=True)
        old=self.state()['simAt'];self.now+=17000
        self.command('receive_message',text='Hi')
        self.assertEqual(old+17000,self.state()['communication']['messages'][0]['timestamp'])
        self.service.close();self.service=self.open();self.now+=QUANTUM;self.service.tick()
        self.assertTrue(self.context()['readyMessageIds'])
        self.assertEqual(self.state(),self.service.replay(self.w['worldId']))
        self.now+=2*60*60000
        with self.assertRaises(Conflict):self.command('receive_message',text='Backdated?')
        self.assertEqual(1,len(self.state()['communication']['messages']))
    def test_equal_timestamp_correction_and_unobserved_draft(self):
        self.command('receive_message',text='Hi');self.ready()
        self.command('stage_reply',text='Hello',sourceMessageIds=self.context()['readyMessageIds'])
        self.command('deliver_reply',draftId=self.state()['communication']['draft']['id'])
        self.command('receive_message',text='I live in London.')
        self.command('receive_message',text='I live in Bristol.')
        self.assertEqual('Bristol',self.context()['knownPlayerFacts'][0]['value'])
        self.assertEqual(self.state()['communication']['messages'][-1]['timestamp'],self.state()['communication']['messages'][-2]['timestamp'])
        self.command('stage_reply',text='Undelivered secret',sourceMessageIds=self.context()['readyMessageIds'])
        self.assertNotIn('Undelivered secret',encode(self.context()))
        self.service.close();self.service=self.open()
        self.assertNotIn('Undelivered secret',encode(self.context()))
        self.assertEqual('Bristol',self.context()['knownPlayerFacts'][0]['value'])
    def test_attention_does_not_postpone_life_boundary(self):
        wake=self.state()['truth']['nextWake']
        self.command('receive_message',text='Hi')
        self.assertEqual(wake,self.state()['truth']['nextWake'])
        attention=self.state()['communication']['nextAt']
        with self.service.connect() as db:
            rev,state=self.service.read(db,self.w['worldId'])
            self.service.advance_until(db,self.w['worldId'],rev,state,attention)
        self.assertEqual(attention,self.state()['simAt'])
        self.assertEqual(wake,self.state()['truth']['nextWake'])
        self.assertTrue(self.context()['readyMessageIds'])
    def test_private_activity_does_not_open_notifications(self):
        with self.service.connect() as db:
            rev,before=self.service.read(db,self.w['worldId']);after=__import__('json').loads(encode(before))
            # Wildcards were retired. Seed an actual private commitment in the
            # authoritative calendar so this verifies today's attention path.
            life=after['truth']['companion']['lifeProfile']
            minute=(after['simAt']//60000)%1440
            life['weeklySchedule']=[{'id':'private-appointment','days':list(range(7)),
                'startMinute':minute,'endMinute':min(1440,minute+10),
                'activity':'Private appointment','availability':'private','placeId':'home','breakAllowed':False}]
            after['truth']['companion']['lifeProfile']=self.service.kernel({'normalizeLife':life,'now':after['simAt']})['lifeProfile']
            self.service.commit_event(db,self.w['worldId'],rev,before,after,'TEST_PRIVATE')
        self.command('receive_message',text='My name is Secret.')
        self.assertEqual([],self.context()['conversation'])
        self.assertEqual('deferred',self.state()['communication']['messages'][0]['attention']['stage'])
        self.command('advance',steps=1)
        self.assertEqual([],self.context()['conversation'])
    def test_validation_and_failed_worker_are_atomic(self):
        before=self.service.projection(self.w['worldId'])
        with self.assertRaises(ValueError):self.command('receive_message',text=' ')
        kernel=self.service.kernel
        def fail(_):raise RuntimeError('offline failure')
        self.service.kernel=fail
        with self.assertRaises(RuntimeError):self.command('receive_message',text='Hi')
        self.service.kernel=kernel
        self.assertEqual(before,self.service.projection(self.w['worldId']))
if __name__=='__main__':unittest.main(verbosity=2)
