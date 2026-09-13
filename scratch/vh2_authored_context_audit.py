"""Authored private life survives creation without becoming public/contact truth."""
import copy,json,sys,tempfile,unittest,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from test_runtime import node_executable
from vh2_runtime import WorldService
import vh2_profile,vh2_story

FIELDS={'privateLife':'Privately worried about an academic warning. Has not told family.',
        'routine':'Usually studies late, but this is a tendency, not a schedule.',
        'playerKnowledge':'The original contact said they lived in York.',
        'initialMotive':'Curious about this original contact.',
        'connectionAuthenticity':'mixed','startingScenario':'The original contact replies to a public post.'}

class AuthoredContext(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'fixture.sqlite'
        self.s=WorldService(self.path,node_executable(ROOT),ROOT,clock=lambda:1789200000000)
        self.w=self.create(FIELDS)
        self.primary=self.s.projection(self.w)['state']['communication']['personaId']
    def tearDown(self):self.s.close();self.tmp.cleanup()
    def create(self,fields):
        return self.s.command({'schemaVersion':1,'key':str(uuid.uuid4()),'type':'create_profile','name':'Authored fixture',
            'profile':{'age':28,**fields,'lifeProfile':{'places':[{'id':'home','label':'Home','kind':'home'}],'weeklySchedule':[],'sleepPolicy':{'enabled':False}}},
            'providerScope':'horde:authored-fixture','personaId':'primary'})['worldId']
    def cmd(self,kind,persona=None,**fields):
        return self.s.command({'schemaVersion':1,'key':str(uuid.uuid4()),'worldId':self.w,'expectedRevision':self.s.projection(self.w)['revision'],
            'type':kind,**({'conversationPersonaId':persona} if persona else {}),**fields})
    def state(self,persona=None):return self.s.projection(self.w,persona)['state']
    def snapshot(self,persona=None):
        p=self.s.projection(self.w,persona);return self.s.dialogue.snapshot(self.w,p['revision'],p['state'])[0]
    def test_creation_preserves_private_facts_and_distinguishes_disclosure(self):
        before=self.state();request=self.snapshot();context=request['context']
        self.assertEqual({k:before['truth']['companion'][k] for k in FIELDS},FIELDS)
        self.assertEqual(context['authoredLifeBackground']['privateLife'],FIELDS['privateLife'])
        self.assertIn('not shared history',context['authoredLifeBackground']['disclosure'])
        self.assertIn('not today',context['authoredLifeBackground']['scope'])
        self.assertEqual(context['knownPlayerFacts'],[]);self.assertEqual(before,self.state())
        self.assertEqual(context['authoredConnection']['opening']['phase'],'first_exchange')
        self.assertIn('does not supply',context['authoredConnection']['knowledgeScope'])
        self.assertEqual(before,self.s.replay(self.w))
    def test_contact_background_does_not_transfer_to_another_persona(self):
        self.cmd('open_conversation',personaId='new',profile={'templateId':'new','name':'New contact','text':'A different person.'})
        other=self.snapshot('new')['context'];primary=self.snapshot()['context']
        for key in ('playerKnowledge','initialMotive','connectionAuthenticity'):
            self.assertEqual(other['authoredConnection'][key],'');self.assertEqual(primary['authoredConnection'][key],FIELDS[key])
        self.assertNotIn('opening',other['authoredConnection'])
        self.assertEqual(other['authoredLifeBackground'],primary['authoredLifeBackground'])
        self.cmd('configure_expression_profile','new',fields={'playerKnowledge':'This contact said they lived in Perth.','initialMotive':'Study partners only.','connectionAuthenticity':'genuine'})
        self.assertEqual(self.snapshot()['context']['authoredConnection']['playerKnowledge'],FIELDS['playerKnowledge'])
        self.assertIn('Perth',self.snapshot('new')['context']['authoredConnection']['playerKnowledge'])
        self.assertEqual(self.state(),self.s.replay(self.w))
    def test_opening_becomes_background_after_reply_and_never_restarts_on_clear(self):
        self.cmd('receive_message',text='hey');self.cmd('advance',steps=1)
        self.cmd('queue_dialogue',text='hello');job=self.s.dialogue.claim()
        self.assertEqual(job['snapshot']['context']['authoredConnection']['opening']['phase'],'first_exchange')
        self.assertTrue(self.s.dialogue.finish(job['id'],job['token'],'hello'))
        self.assertEqual(self.snapshot()['context']['authoredConnection']['opening']['phase'],'past_setup')
        self.cmd('manage_conversation',action='clear')
        self.assertEqual(self.state()['communication']['messages'],[])
        self.assertEqual(self.snapshot()['context']['authoredConnection']['opening']['phase'],'past_setup')
        self.assertEqual(self.state(),self.s.replay(self.w))
    def test_edit_invalidates_old_reply_but_preserves_body_relationship_and_history(self):
        self.cmd('receive_message',text='How are classes?');self.cmd('advance',steps=1)
        self.cmd('queue_dialogue',text='A stale reply');before=self.state()
        self.cmd('configure_expression_profile',fields={'privateLife':'The warning was resolved; a new concern is a lost notebook.'})
        self.assertIsNone(self.s.dialogue.claim());self.assertEqual(self.s.dialogue.list(self.w)[0]['status'],'superseded')
        after=self.state()
        for key in ('humanDynamics','relationshipDynamics','lifeRuntime'):
            self.assertEqual(before['truth']['companion'][key],after['truth']['companion'][key])
        self.assertEqual(before['communication']['messages'],after['communication']['messages'])
        self.assertIn('lost notebook',self.snapshot()['context']['authoredLifeBackground']['privateLife'])
    def test_daily_adviser_can_consider_unspoken_pressure_without_a_fake_event(self):
        before=self.state();frozen=vh2_story.snapshot(self.s,self.w,self.s.projection(self.w)['revision'],before)
        payload=json.loads(frozen['messages'][1]['content']);profile=next(e for e in payload['evidence'] if e['id']=='authored_profile')
        self.assertEqual(profile['data']['privateLife'],FIELDS['privateLife'])
        self.assertEqual(profile['data']['routine'],FIELDS['routine']);self.assertEqual(profile['scope'],'authored_background')
        self.assertNotIn('playerKnowledge',profile['data']);self.assertEqual(before,self.state())
    def test_bounds_and_enum_apply_to_creation_and_edit_without_partial_updates(self):
        before=self.state()
        for field,limit in vh2_profile.AUTHORED_TEXT_LIMITS.items():
            bad={field:'x'*(limit+1)}
            with self.subTest(field=field):
                with self.assertRaises(ValueError):self.create(bad)
                with self.assertRaises(ValueError):self.cmd('configure_expression_profile',fields=bad)
        for bad in ({'privateLife':{}},{'routine':False},{'connectionAuthenticity':'secretly_a_robot'}):
            with self.assertRaises(ValueError):self.create(bad)
            with self.assertRaises(ValueError):self.cmd('configure_expression_profile',fields=bad)
        self.assertEqual(before,self.state())

if __name__=='__main__':unittest.main(verbosity=2)
