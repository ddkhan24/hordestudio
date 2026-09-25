"""Focused audit for bounded, private VH2 provider work records."""
import json
import sqlite3
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from test_runtime import node_executable
from virtual_humans.backend.vh2_runtime import WorldService,decode_event_payload
from virtual_humans.backend import vh2_backup,vh2_dialogue,vh2_workers

ROOT=Path(__file__).resolve().parents[1]


class JobRetention(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.now=1788764400000
        self.s=WorldService(Path(self.tmp.name)/'life.sqlite',node_executable(ROOT),ROOT,clock=lambda:self.now)
        self.w=self.s.command({'schemaVersion':1,'key':'create','type':'create','name':'Alex'})['worldId']

    def tearDown(self):
        self.s.close();self.tmp.cleanup()

    def cmd(self,kind,**values):
        body={'schemaVersion':1,'key':str(uuid.uuid4()),'type':kind,'worldId':self.w,
              'expectedRevision':self.s.projection(self.w)['revision'],**values}
        return self.s.command(body)

    def pending(self,text):
        self.cmd('receive_message',text=text);self.cmd('advance',steps=1)

    def queue(self,reply='Got it.'):
        return self.cmd('queue_dialogue',text=reply)['jobId']

    def test_terminal_dialogue_keeps_audit_not_prompt_or_duplicate_reply(self):
        secret='PRIVATE-PENDING-TEXT-'+'x'*7000
        reply='PRIVATE-REPLY-TEXT'
        self.pending(secret);job_id=self.queue(reply)
        with self.s.connect() as db:
            active=db.execute('SELECT snapshot,fixture FROM dialogue_jobs WHERE id=?',(job_id,)).fetchone()
            self.assertIn(secret,active['snapshot']);self.assertEqual(active['fixture'],reply)
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("UPDATE dialogue_jobs SET snapshot='{}' WHERE id=?",(job_id,))
        self.assertTrue(self.s.dialogue.run_once())
        with self.s.connect() as db:
            row=db.execute('SELECT snapshot,fixture,result FROM dialogue_jobs WHERE id=?',(job_id,)).fetchone()
            snapshot=json.loads(row['snapshot'])
            event=db.execute("SELECT payload FROM events WHERE world_id=? AND kind='DIALOGUE_QUEUED' ORDER BY seq DESC LIMIT 1",(self.w,)).fetchone()
            transcript=' '.join(json.loads(item[0])['text'] for item in db.execute(
                'SELECT data FROM transcript_messages WHERE world_id=? ORDER BY position,id',(self.w,)))
        self.assertEqual(snapshot['retentionVersion'],1)
        self.assertNotIn(secret,row['snapshot']);self.assertNotIn(reply,row['snapshot'])
        self.assertEqual((row['fixture'],row['result']),('',None))
        self.assertIn(secret,transcript);self.assertIn(reply,transcript)
        details=decode_event_payload(event['payload'])['details']
        self.assertNotIn('snapshot',details);self.assertNotIn(secret,json.dumps(details))
        activity=self.s.dialogue.list(self.w)[0]
        self.assertTrue(activity['promptExpired']);self.assertEqual(activity['promptPreview'],[])
        self.assertGreater(activity['promptSummary']['snapshotBytes'],8000)
        self.assertEqual(self.s.projection(self.w)['state'],self.s.replay(self.w))

    def test_clear_scrubs_unresolved_job_for_selected_conversation(self):
        secret='CLEAR-THIS-CONVERSATION-'+('private words '*100)
        self.pending(secret);job_id=self.queue('late reply')
        with self.s.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute("UPDATE dialogue_jobs SET status='unknown',reason='Outcome unknown.' WHERE id=?",(job_id,))
            self.assertIn(secret.strip(),db.execute('SELECT snapshot FROM dialogue_jobs WHERE id=?',(job_id,)).fetchone()[0])
        self.cmd('manage_conversation',action='clear')
        with self.s.connect() as db:
            row=db.execute('SELECT status,snapshot,fixture,result FROM dialogue_jobs WHERE id=?',(job_id,)).fetchone()
            transcript=db.execute('SELECT COUNT(*) FROM transcript_messages WHERE world_id=?',(self.w,)).fetchone()[0]
        self.assertEqual(row['status'],'abandoned');self.assertEqual(json.loads(row['snapshot'])['retentionVersion'],1)
        self.assertNotIn(secret,row['snapshot']);self.assertEqual((row['fixture'],row['result']),('',None))
        self.assertEqual(transcript,0)

    def test_terminal_dialogue_rows_are_capped_without_weakening_today_budget(self):
        full=json.dumps({'context':{'personaId':'p','readyMessageIds':['m'],'conversation':[{'text':'secret'}]},
                         'provider':{'version':'provider','scope':'horde:test','model':'model'},'messages':[{'content':'secret'}]})
        with self.s.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for index in range(205):
                ident='old:'+str(index)
                db.execute('INSERT INTO dialogue_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (ident,self.w,full,'digest','chat_completions','secret','delivered',1,None,None,index,'',None))
                db.execute('INSERT INTO dialogue_receipts VALUES (?,?)',(ident,'{}'))
            db.execute('INSERT INTO dialogue_usage VALUES (?,?)',('old:0',self.now))
            self.assertEqual(vh2_dialogue.prune_terminal_jobs(db,self.w,self.now),4)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM dialogue_jobs WHERE world_id=?',(self.w,)).fetchone()[0],201)
            self.assertIsNotNone(db.execute("SELECT 1 FROM dialogue_jobs WHERE id='old:0'").fetchone())
            self.assertEqual(vh2_dialogue.prune_terminal_jobs(db,self.w,self.now+86400000),1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM dialogue_jobs WHERE world_id=?',(self.w,)).fetchone()[0],200)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM dialogue_receipts r LEFT JOIN dialogue_jobs j ON j.id=r.job_id WHERE j.id IS NULL').fetchone()[0],0)

    def test_provider_terminal_record_drops_prompt_and_orphan_output_but_keeps_budget_fields(self):
        secret='PRIVATE-IMAGE-PROMPT-'+'z'*4000
        snapshot=json.dumps({'scope':'horde:test','providerId':'provider','photoId':'photo','personaId':'persona',
            'request':{'model':'image/model','prompt':secret},'referenceAssetIds':['asset'],
            'automatic':True,'purpose':'dialogue'})
        with self.s.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT INTO vh2_provider_jobs VALUES (?,?,?,?,?,?,?,?,?,?)',
                       ('provider-job',self.w,'image','queued',snapshot,None,'',self.now,None,None))
            db.execute('INSERT INTO vh2_provider_outputs VALUES (?,?)',('provider-job','data:image/png;base64,'+'A'*10000))
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("UPDATE vh2_provider_jobs SET snapshot='{}' WHERE id='provider-job'")
            db.execute("UPDATE vh2_provider_jobs SET status='succeeded',result=? WHERE id='provider-job'",
                       (json.dumps({'imported':True,'providerAccepted':True,'providerJobIds':['remote-1'],'private':secret}),))
            row=db.execute("SELECT snapshot,result FROM vh2_provider_jobs WHERE id='provider-job'").fetchone()
            outputs=db.execute("SELECT COUNT(*) FROM vh2_provider_outputs WHERE job_id='provider-job'").fetchone()[0]
            budget=vh2_workers.autonomous_budget(db,'horde:test',{'dailyLimit':2},self.now)
        compact=json.loads(row['snapshot']);receipt=json.loads(row['result'])
        self.assertEqual(compact['retentionVersion'],1);self.assertNotIn(secret,row['snapshot']+row['result'])
        self.assertEqual((compact['scope'],compact['photoId'],compact['automatic']),('horde:test','photo',1))
        self.assertEqual(receipt,{'imported':True,'providerAccepted':True,'providerJobIds':['remote-1'],'referenceProgress':None})
        self.assertEqual(outputs,0);self.assertEqual(budget['used'],1)

    def test_portable_history_is_bounded_and_never_revives_terminal_text(self):
        full=json.dumps({'context':{'personaId':'p','readyMessageIds':['m'],'conversation':[{'text':'secret'}]},
                         'provider':{'version':'v','scope':'s','model':'m'},'messages':[{'content':'secret'}]})
        rows=[]
        for index in range(205):
            rows.append({'id':'t'+str(index),'world_id':self.w,'snapshot':full,'context_digest':'d','adapter':'a',
                         'fixture':'secret','status':'delivered','attempt':1,'token':None,'lease_until':None,
                         'created_at':index,'reason':'','result':'secret'})
        rows.append({**rows[0],'id':'uncertain','status':'unknown','created_at':999})
        portable=vh2_backup.portable_dialogue_rows(rows)
        self.assertEqual(len(portable),201)
        uncertain=next(row for row in portable if row['id']=='uncertain')
        self.assertIn('secret',uncertain['snapshot'])
        for row in portable:
            if row['status']=='unknown':continue
            self.assertNotIn('secret',row['snapshot']);self.assertEqual((row['fixture'],row['result']),('',None))

    def test_terminal_social_and_story_prompts_collapse_without_losing_spend_scope(self):
        secret='PRIVATE-BACKGROUND-CONTEXT-'+'b'*6000
        config=json.dumps({'scope':'horde:test'})
        social=json.dumps({'providerId':'provider-v1','candidateId':'photo','messages':[{'content':secret}]})
        story=json.dumps({'providerId':'provider-v1','scope':'horde:test','simAt':self.now,'setupVersion':1,
                          'kernelVersion':'kernel','evidenceIds':['e1'],'messages':[{'content':secret}]})
        with self.s.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT INTO dialogue_providers VALUES (?,?,?,?)',('provider-v1',config,'',self.now))
            db.execute('INSERT INTO vh2_social_jobs VALUES (?,?,?,?,?)',('social-job',self.w,'submitted',social,''))
            db.execute('INSERT INTO vh2_story_jobs VALUES (?,?,?,?,?,?,?)',('story-job',self.w,'submitted',story,None,'',self.now))
            db.execute('INSERT INTO dialogue_usage VALUES (?,?)',('social:social-job',self.now))
            db.execute('INSERT INTO dialogue_usage VALUES (?,?)',('story-job',self.now))
            db.execute("UPDATE vh2_social_jobs SET status='completed' WHERE id='social-job'")
            db.execute("UPDATE vh2_story_jobs SET status='completed',result=? WHERE id='story-job'",(json.dumps({'direction':secret}),))
            social_row=db.execute("SELECT snapshot FROM vh2_social_jobs WHERE id='social-job'").fetchone()[0]
            story_row=db.execute("SELECT snapshot,result FROM vh2_story_jobs WHERE id='story-job'").fetchone()
            usage=self.s.dialogue_provider.usage(db,'horde:test')
        self.assertEqual(json.loads(social_row)['retentionVersion'],1);self.assertNotIn(secret,social_row)
        self.assertEqual(json.loads(story_row['snapshot'])['retentionVersion'],1);self.assertNotIn(secret,story_row['snapshot'])
        self.assertIsNone(story_row['result']);self.assertEqual(usage['background'],2)


if __name__=='__main__':unittest.main(verbosity=2)
