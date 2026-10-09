"""Uncapped text submissions and usage telemetry; no paid network calls."""
import json,unittest,uuid
import vh2_provider_audit as fixture

class Budgets(fixture.Provider):
    def scoped(self,scope,policy=None):
        body={**self.settings,'scope':scope,'dailyLimit':6,'preserveDailyLimit':True}
        if policy is not None:body['defaultBudgetPolicy']=policy
        self.s.dialogue_provider.save(body)
        self.w=self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type='create_profile',name='Alex',
            profile={'age':28,'lifeProfile':{'weeklySchedule':[],'sleepPolicy':{'enabled':False}}},
            providerScope=scope,personaId='test:player'))['worldId']
        self.cmd('receive_message',text='Hello');self.cmd('advance',steps=1)
    def policy(self,dialogue=None,background=6):return dict(version=1,dialogueDailyLimit=dialogue,backgroundDailyLimit=background)
    def reserve_background(self,scope,count=1,kind='social'):
        with self.s.connect() as db:
            provider=self.s.dialogue_provider.current(db,scope)
            for _ in range(count):
                ident=str(uuid.uuid4());snapshot=json.dumps({'providerId':provider['id']})
                if kind=='social':
                    db.execute('INSERT INTO vh2_social_jobs VALUES (?,?,?,?,?)',(ident,self.w,'completed',snapshot,''));usage='social:'+ident
                else:
                    db.execute('INSERT INTO vh2_story_jobs(id,world_id,status,snapshot,created_at) VALUES (?,?,?,?,?)',(ident,self.w,'completed',snapshot,self.now));usage=ident
                db.execute('INSERT INTO dialogue_usage VALUES (?,?)',(usage,self.now))
    def test_dialogue_and_background_both_exceed_old_caps(self):
        self.scoped('horde:fresh',self.policy())
        self.reserve_background('horde:fresh',6)
        for n in range(7):
            if n:self.cmd('receive_message',text='Next '+str(n))
            self.queue();self.assertTrue(self.s.dialogue.run_once(provider_transport=lambda *args:self.response()))
        status=self.s.dialogue_provider.status('horde:fresh')
        self.assertEqual(status['usage']['dialogue'],7);self.assertEqual(status['usage']['background'],6)
        self.assertFalse(status['budgets']['dialogue']['exhausted']);self.assertFalse(status['budgets']['background']['exhausted'])
        self.assertIsNone(status['budgets']['dialogue']['limit']);self.assertIsNone(status['budgets']['background']['limit'])
    def test_scopes_isolated_and_old_limit_ignored_across_versions(self):
        for scope in ['horde:a','horde:b']:
            self.scoped(scope,self.policy(1));self.queue()
            self.assertTrue(self.s.dialogue.run_once(provider_transport=lambda *args:self.response()))
            self.assertEqual(self.s.dialogue_provider.status(scope)['usedToday'],1)
        self.s.dialogue_provider.save({**self.settings,'scope':'horde:b','model':'new-model','preserveDailyLimit':True})
        self.cmd('receive_message',text='Again');self.queue();calls=[]
        self.assertTrue(self.s.dialogue.run_once(provider_transport=lambda *args:(calls.append(1) or self.response())));self.assertEqual(calls,[1])
        self.assertEqual(self.s.dialogue_provider.status('horde:a')['usedToday'],1)
    def test_legacy_shared_cap_migrates_automatically_without_changing_old_versions(self):
        self.scoped('horde:legacy')
        with self.s.connect() as db:
            current=self.s.dialogue_provider.current(db,'horde:legacy')
            config=json.loads(current['config']);config['dailyLimit']=500
            old_id=str(uuid.uuid4())
            db.execute('INSERT INTO dialogue_providers VALUES (?,?,?,?)',(old_id,json.dumps(config),current['api_key'],self.now))
        self.reserve_background('horde:legacy',6,kind='story');self.queue()
        self.s.close();self.s=self.open()
        with self.s.connect() as db:
            latest=self.s.dialogue_provider.current(db,'horde:legacy')
            self.assertNotEqual(latest['id'],old_id)
            self.assertNotIn('dailyLimit',json.loads(latest['config']))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM dialogue_providers WHERE id=?',(old_id,)).fetchone()[0],1)
            self.assertEqual(latest['api_key'],current['api_key'])
        migrated=self.s.dialogue_provider.status('horde:legacy')
        self.assertFalse(migrated['textLimitsEnforced']);self.assertFalse(migrated['budgets']['dialogue']['legacy'])
        self.assertEqual(migrated['usage']['background'],6)
        self.assertTrue(self.s.dialogue.run_once(provider_transport=lambda *args:self.response()))
        self.s.close();self.s=self.open()
        with self.s.connect() as db:self.assertEqual(self.s.dialogue_provider.current(db,'horde:legacy')['id'],latest['id'])
    def test_background_usage_shared_between_social_and_adviser_but_not_other_characters(self):
        self.scoped('horde:a',self.policy(background=2));self.reserve_background('horde:a');self.reserve_background('horde:a',kind='story')
        self.scoped('horde:b',self.policy(background=2))
        with self.s.connect() as db:
            a=json.loads(self.s.dialogue_provider.current(db,'horde:a')['config']);b=json.loads(self.s.dialogue_provider.current(db,'horde:b')['config'])
            self.assertEqual(self.s.dialogue_provider.budget(db,a,'background')['used'],2)
            self.assertEqual(self.s.dialogue_provider.budget(db,b,'background')['used'],0)
            self.assertFalse(self.s.dialogue_provider.budget(db,a,'background')['exhausted'])
        self.now+=86400000
        self.assertEqual(self.s.dialogue_provider.status('horde:a')['usedToday'],0)
    def test_zero_saved_budget_does_not_block_dialogue_or_background(self):
        self.scoped('horde:zero',self.policy(0,0));self.queue()
        self.assertTrue(self.s.dialogue.run_once(provider_transport=lambda *args:self.response()))
        self.reserve_background('horde:zero')
        status=self.s.dialogue_provider.status('horde:zero')
        self.assertEqual(status['usage']['dialogue'],1)
        self.assertEqual(status['usage']['background'],1)
        self.assertFalse(status['budgets']['dialogue']['exhausted'])
        self.assertFalse(status['budgets']['background']['exhausted'])

    def test_reply_details_keep_only_reported_tokens_and_redact_provider_key(self):
        self.cmd('receive_message',text='Do not expose PRIVATE_TEST_KEY or Bearer another-secret')
        self.queue()
        def response(*args):return {**self.response(),'usage':{'prompt_tokens':123,'completion_tokens':7,'total_tokens':130,'cost':'UNTRUSTED','prompt_tokens_details':{'cached_tokens':20},'completion_tokens_details':{'reasoning_tokens':3}}}
        self.assertTrue(self.s.dialogue.run_once(provider_transport=response))
        job=self.s.dialogue.list(self.w)[0]
        self.assertEqual(job['usage'],{'prompt_tokens':123,'completion_tokens':7,'total_tokens':130,'cached_tokens':20,'reasoning_tokens':3})
        self.assertEqual(job['model'],'fixture-model');self.assertTrue(job['promptPreview'] or job['promptExpired'])
        encoded=json.dumps(job);self.assertNotIn('PRIVATE_TEST_KEY',encoded);self.assertNotIn('another-secret',encoded);self.assertNotIn('UNTRUSTED',encoded)
    def test_missing_usage_never_invents_token_counts(self):
        self.queue();self.assertTrue(self.s.dialogue.run_once(provider_transport=lambda *args:self.response()))
        self.assertEqual(self.s.dialogue.list(self.w)[0]['usage'],{})
    def test_rejected_output_retains_reported_usage_without_partial_delivery(self):
        self.queue();self.assertFalse(self.s.dialogue.run_once(provider_transport=lambda *args:{**self.response('partial','length'),'usage':{'prompt_tokens':12,'completion_tokens':-1,'total_tokens':'wrong'}}))
        job=self.s.dialogue.list(self.w)[0];self.assertEqual(job['status'],'failed');self.assertEqual(job['usage'],{'prompt_tokens':12})

if __name__=='__main__':unittest.main(verbosity=2)
