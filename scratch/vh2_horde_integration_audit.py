"""Integrated text timeline acceptance. Synthetic profiles and mocked transport only."""
from test_runtime import node_executable
import sys,tempfile,unittest,uuid,json,subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService,encode
ROOT=Path(__file__).resolve().parents[1];NODE=node_executable(ROOT)
class Integrated(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.now=1788764400000;self.s=self.open()
        self.profile=json.loads(subprocess.check_output([NODE,'-e',"process.stdout.write(JSON.stringify(require('./vh2-kernel-worker').run({create:true,name:'Alex',entityId:'source',now:1788764400000}).companion))"],cwd=ROOT))
        self.profile.update(personality='Quiet and curious',chatExamples='yep\nwait, really?',apiKey='NEVER_IMPORT')
        self.settings=dict(scope='horde:alex',baseUrl='https://example.invalid/v1',model='model-a',apiKey='SECRET_A',enabled=True,maxTokens=512,dailyLimit=6,temperature=.7)
        self.s.dialogue_provider.save(self.settings)
        self.body=dict(schemaVersion=1,key='create-copy',type='create_profile',name='Alex',profile=self.profile,companionId='alex',providerScope='horde:alex',personaId='london-player')
        self.w=self.s.command(self.body)['worldId']
    def open(self):return WorldService(Path(self.tmp.name)/'world.sqlite',NODE,ROOT,clock=lambda:self.now)
    def tearDown(self):self.s.close();self.tmp.cleanup()
    def cmd(self,kind,**kw):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],type=kind,**kw))
    def ready(self):
        self.cmd('configure_auto_replies',enabled=True);self.cmd('receive_message',text='Hey, I live in London.')
        self.cmd('advance',steps=1);self.cmd('set_running',running=True)
    @staticmethod
    def reply(*args):return {'choices':[{'finish_reason':'stop','message':{'content':'oh, which part?'}}]}
    def test_profile_scope_auto_reply_and_dedup(self):
        self.assertEqual(self.s.command(self.body)['worldId'],self.w)
        self.ready();jobs=self.s.dialogue.list(self.w);self.assertEqual(len(jobs),1)
        for _ in range(4):self.s.tick()
        self.assertEqual(len(self.s.dialogue.list(self.w)),1)
        # Another character/provider cannot silently change this timeline's model or key.
        self.s.dialogue_provider.save({**self.settings,'scope':'horde:bob','model':'model-b','apiKey':'SECRET_B'})
        calls=[]
        def transport(config,key,messages):
            calls.append(1);self.assertEqual(config['model'],'model-a');self.assertEqual(key,'SECRET_A')
            self.assertIn('Quiet and curious',encode(messages));self.assertIn('wait, really?',encode(messages));return self.reply()
        self.assertTrue(self.s.dialogue.run_once(provider_transport=transport));self.assertEqual(calls,[1])
        self.assertFalse(self.s.dialogue.run_once(provider_transport=transport))
        snapshot=self.s.projection(self.w)['state'];self.assertEqual(snapshot['communication']['personaId'],'london-player')
        self.assertFalse(snapshot['communication']['messages'][0]['awaitingReply'])
        self.assertEqual(snapshot,self.s.replay(self.w))
        for secret in ['NEVER_IMPORT','SECRET_A','SECRET_B']:self.assertNotIn(secret,encode(self.s.events(self.w)))
    def test_pause_prevents_queued_provider_call(self):
        self.ready();self.cmd('set_running',running=False);calls=[]
        self.assertFalse(self.s.dialogue.run_once(provider_transport=lambda *a:calls.append(1)))
        self.assertEqual(calls,[]);self.assertEqual(self.s.dialogue.list(self.w)[0]['status'],'superseded')
    def test_unknown_stays_blocked_after_restart(self):
        self.ready();calls=[]
        def timeout(*args):calls.append(1);raise TimeoutError()
        self.s.dialogue.run_once(provider_transport=timeout)
        self.s.close();self.s=self.open();self.now+=120000
        for _ in range(3):self.s.tick();self.s.dialogue.run_once(provider_transport=timeout)
        self.assertEqual(calls,[1]);self.assertEqual(len(self.s.dialogue.list(self.w)),1)
        self.assertEqual(self.s.dialogue.list(self.w)[0]['status'],'unknown')
    def test_failed_batch_does_not_create_billing_loop(self):
        self.ready();self.s.dialogue.run_once(provider_transport=lambda *a:{'choices':[]})
        for _ in range(3):self.now+=60000;self.s.tick()
        self.assertEqual(len(self.s.dialogue.list(self.w)),1)
    def test_repeated_settings_sync_does_not_create_versions(self):
        self.s.dialogue_provider.save(self.settings)
        with self.s.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM dialogue_providers').fetchone()[0],1)
    def test_disabling_one_binding_does_not_disable_another(self):
        self.s.dialogue_provider.save({**self.settings,'scope':'horde:bob'})
        self.s.dialogue_provider.disable('horde:alex')
        self.assertFalse(self.s.dialogue_provider.status('horde:alex')['enabled'])
        self.assertTrue(self.s.dialogue_provider.status('horde:bob')['enabled'])

    def test_profile_copy_upgrade_preserves_checkpoint_and_pauses(self):
        self.cmd('receive_message',text='Remember the botanical garden.');self.cmd('advance',steps=1)
        before=self.s.projection(self.w)['state']
        self.s.kernel_version+='-test-upgrade'
        self.assertTrue(self.s.projection(self.w)['requiresMigration'])
        receipt=self.cmd('upgrade_kernel')
        checkpoint=self.s.kernel_checkpoint(receipt['checkpointId'])
        self.assertEqual(checkpoint['state'],before)
        after=self.s.projection(self.w)
        self.assertFalse(after['requiresMigration']);self.assertFalse(after['state']['running'])
        self.assertEqual(after['state']['communication']['messages'],before['communication']['messages'])

    def test_opt_in_required(self):
        self.cmd('receive_message',text='hello');self.cmd('advance',steps=1);self.cmd('set_running',running=True)
        self.assertEqual(self.s.dialogue.list(self.w),[])
if __name__=='__main__':unittest.main(verbosity=2)
