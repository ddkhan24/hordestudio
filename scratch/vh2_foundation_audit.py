"""Offline service acceptance: no browser, no user saves, no provider calls."""
from test_runtime import node_executable
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import sqlite3
import tempfile
import threading
import unittest
from vh2_runtime import WorldService, Conflict, QUANTUM

ROOT=Path(__file__).resolve().parents[1]
NODE=node_executable(ROOT)

class Foundation(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.now=1788764400000
        self.service=self.open('a')
    def open(self,name):
        return WorldService(Path(self.tmp.name)/(name+'.sqlite'),NODE,ROOT,clock=lambda:self.now)
    def tearDown(self):
        self.service.close()
        self.tmp.cleanup()
    def create(self,service=None):
        return (service or self.service).command({'schemaVersion':1,'key':'fixture','type':'create','name':'Alex'})
    def command(self,world,kind,key,**params):
        return self.service.command({'schemaVersion':1,'key':key,'worldId':world['worldId'],
            'expectedRevision':world['revision'],'type':kind,**params})
    def test_replay_and_idempotency(self):
        w=self.create()
        self.assertEqual(w,self.create())
        with self.assertRaises(Conflict):
            self.service.command({'schemaVersion':1,'key':'fixture','type':'create','name':'Other'})
        advanced=self.command(w,'advance','step',steps=12)
        self.assertEqual(advanced,self.command(w,'advance','step',steps=12))
        with self.assertRaises(Conflict):
            self.command(w,'advance','stale',steps=1)
        self.assertEqual(self.service.replay(w['worldId']),self.service.projection(w['worldId'])['state'])
        self.assertEqual(len(self.service.events(w['worldId'])),advanced['revision'])
    def test_closed_browser_restart_and_catchup(self):
        reference=self.open('reference')
        w=self.create(); r=self.create(reference)
        running=self.command(w,'set_running','run',running=True)
        reference.command({'schemaVersion':1,'key':'run','worldId':r['worldId'],'expectedRevision':r['revision'],'type':'set_running','running':True})
        for _ in range(24):
            self.now+=QUANTUM
            reference.tick()
        # Reconstruct the entire service; no browser reconciliation or provider credentials.
        self.service.close();self.service=self.open('a')
        self.service.tick();self.service.tick()
        a=self.service.projection(w['worldId']); b=reference.projection(r['worldId'])
        self.assertEqual(a,b)
        self.assertEqual(a['state'],self.service.replay(w['worldId']))
        self.assertGreater(a['revision'],running['revision'])
        self.assertNotEqual(a['state']['truth']['present']['needs']['hunger'],30)
        reference.close()
    def test_atomic_failure(self):
        w=self.create(); initial=self.service.projection(w['worldId'])
        original=self.service.kernel
        count=0
        def failing(payload):
            nonlocal count
            count+=1
            if count==2: raise RuntimeError('Simulated worker crash')
            return original(payload)
        self.service.kernel=failing
        with self.assertRaises(RuntimeError):self.command(w,'advance','crash',steps=3)
        self.assertEqual(initial,self.service.projection(w['worldId']))
        self.assertEqual(len(self.service.events(w['worldId'])),1)
        self.service.kernel=original
        self.command(w,'advance','crash',steps=3)
    def test_two_writers(self):
        w=self.create(); results=[]
        def write(key):
            try:results.append(self.command(w,'advance',key,steps=1))
            except Conflict:results.append('conflict')
        threads=[threading.Thread(target=write,args=(str(i),)) for i in range(2)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(results.count('conflict'),1)
        self.assertGreater(self.service.projection(w['worldId'])['revision'],1)
    def test_full_day_survives_sleep_and_completion(self):
        w=self.create();stages=set();completed=set()
        for hour in range(24):
            w=self.command(w,'advance','hour-'+str(hour),steps=12)
            state=self.service.projection(w['worldId'])['state']
            stages.add(state['truth']['present']['needs']['sleep']['stage'])
            completed.update(m['id'] for m in state['memories'])
        self.assertIn('asleep',stages)
        self.assertTrue(completed)
        self.assertEqual(state,self.service.replay(w['worldId']))

    def test_knowledge_and_append_only(self):
        w=self.create()
        self.command(w,'advance','hour',steps=12)
        context=self.service.context(w['worldId'])
        self.assertTrue(context['recentExperiences'])
        self.assertEqual(context['sharedHistory'],[])
        self.assertNotIn('truth',context)
        self.assertNotIn('companion',context)
        sequences={e['seq'] for e in self.service.events(w['worldId'])}
        self.assertTrue(all(m['sourceSequence'] in sequences for m in context['recentExperiences']))
        with self.assertRaises(sqlite3.IntegrityError):
            with self.service.connect() as db:
                db.execute('DELETE FROM events WHERE world_id=?',(w['worldId'],))

    def test_changed_kernel_requires_migration(self):
        w=self.create()
        self.service.kernel_version='different-engine'
        with self.assertRaises(Conflict):self.command(w,'advance','upgrade',steps=1)
        self.assertEqual(self.service.projection(w['worldId'])['revision'],1)

    def test_failed_world_does_not_block_another(self):
        w=self.create()
        other=self.service.command({'schemaVersion':1,'key':'other','type':'create','name':'Other'})
        self.command(w,'set_running','run',running=True)
        self.command(other,'set_running','other-run',running=True)
        original=self.service.kernel
        def failing(payload):
            if payload.get('companion',{}).get('name')=='Alex':raise RuntimeError('Fixture fault')
            return original(payload)
        self.service.kernel=failing
        self.now+=QUANTUM
        self.service.tick()
        self.assertEqual(self.service.projection(w['worldId'])['revision'],2)
        self.assertGreater(self.service.projection(other['worldId'])['revision'],2)
        self.service.close();self.service=self.open('a')
        self.assertTrue(next(x for x in self.service.status()['worlds'] if x['worldId']==w['worldId'])['error'])

    def test_policy_and_explicit_upgrade_checkpoint(self):
        w=self.create();before=self.service.projection(w['worldId'])
        self.service.kernel_version+='-upgraded-fixture'
        upgraded=self.command(w,'upgrade_kernel','upgrade')
        self.assertEqual(self.service.kernel_checkpoint(upgraded['checkpointId']),{key:before[key] for key in ('worldId','revision','state')})
        self.assertFalse(self.service.projection(w['worldId'])['requiresMigration'])
        state=self.service.projection(w['worldId'])['state']
        self.assertFalse(state['running']);self.assertEqual(state['simAt'],before['state']['simAt'])
        policy=dict(temperature=8,exploration=.1,minHoldMinutes=3,reconsiderMinutes=8,urgentHunger=92,urgentEnergy=8)
        configured=self.command(upgraded,'configure_decisions','policy',policy=policy)
        self.assertEqual(self.service.projection(w['worldId'])['state']['truth']['companion']['vh2Decision']['policy'],policy)
        with self.assertRaises(ValueError):self.command(configured,'configure_decisions','bad-policy',policy={**policy,'temperature':100})
        self.assertEqual(self.service.projection(w['worldId'])['state'],self.service.replay(w['worldId']))

    def test_source_change_cannot_silently_advance(self):
        w=self.create();before=self.service.projection(w['worldId'])
        self.service.source_fingerprint='different-sources'
        with self.assertRaises(Conflict):self.command(w,'advance','changed-files',steps=1)
        self.assertEqual(before,self.service.projection(w['worldId']))

    def test_pause_and_isolation(self):
        w=self.create(); before=self.service.projection(w['worldId'])
        self.now+=24*3600000;self.service.tick()
        self.assertEqual(before,self.service.projection(w['worldId']))
        w=self.command(w,'set_running','run',running=True)
        self.assertEqual(self.service.projection(w['worldId'])['state']['simAnchor'],self.now)
        with self.assertRaises(Conflict):self.command(w,'advance','bad',steps=1)
        self.now+=QUANTUM;self.service.tick()
        state=self.service.projection(w['worldId'])
        # Resume catches up missed time in a bounded batch, without jumping a day.
        self.assertGreater(state['state']['simAt'],before['state']['simAt'])
        self.assertLessEqual(state['state']['simAt'],before['state']['simAt']+12*QUANTUM)
        self.assertLess(state['state']['simAt'],self.now)
        self.assertEqual(state['state']['playerKnowledge'],[])
        other=self.service.command({'schemaVersion':1,'key':'other','type':'create','name':'Other'})
        self.assertNotEqual(other['worldId'],w['worldId'])
        self.assertEqual(self.service.projection(other['worldId'])['revision'],1)

if __name__=='__main__':unittest.main(verbosity=2)
