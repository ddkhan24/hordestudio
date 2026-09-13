"""Offline migration/rebuild checks; synthetic sources only."""
from test_runtime import node_executable
import copy
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_migration import inspect_archive
from vh2_runtime import WorldService,Conflict
ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'scratch/fixtures/vh2/portable-v3.json').read_text()

class Migration(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.service=WorldService(Path(self.tmp.name)/'world.sqlite',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
    def tearDown(self):self.service.close();self.tmp.cleanup()
    def report(self,mutate):
        value=json.loads(SOURCE);mutate(value);return inspect_archive(json.dumps(value))
    def test_two_personas_and_exact_checkpoint(self):
        report=inspect_archive(SOURCE)
        self.assertEqual([s['personaId'] for s in report['timelines']],['persona-london','persona-tokyo'])
        self.assertEqual(report['counts'],{'timelines':2,'places':2,'items':1})
        self.assertFalse(report['canActivate'])
        self.assertEqual(sum(i['code']=='unknown_currency' for i in report['issues']),2)
        self.service.checkpoint(SOURCE,report['archiveDigest'])
        self.service.checkpoint(SOURCE,report['archiveDigest'])
        self.assertEqual(self.service.checkpoint_source(report['archiveDigest']),SOURCE)
        self.assertEqual(len(self.service.checkpoints()),1)
        self.assertEqual(self.service.status()['worlds'],[])
        with self.assertRaises(Conflict):self.service.checkpoint(SOURCE+' ',report['archiveDigest'])
        with self.assertRaises(sqlite3.IntegrityError):
            with self.service.connect() as db:db.execute("UPDATE checkpoints SET source_text='{}'")
    def test_unknown_fields_preserved(self):
        value=json.loads(SOURCE);value['companion']['futureSubsystem']={'nested':['keep','all','of','this']}
        text=json.dumps(value);report=inspect_archive(text)
        self.assertTrue(any(i['code']=='unmapped_field' for i in report['issues']))
        self.service.checkpoint(text,report['archiveDigest'])
        self.assertEqual(json.loads(self.service.checkpoint_source(report['archiveDigest'])),value)
    def test_broken_links_and_owner(self):
        def change(v):
            v['timelines']['activeSessionId']='missing'
            v['timelines']['sessions'][0]['runtime']['continuityRuntime']['playerPersonaId']='wrong'
            v['timelines']['sessions'][1]['id']=v['timelines']['sessions'][0]['id']
            v['companion']['lifeProfile']['weeklySchedule'][0]['placeId']='missing'
            v['timelines']['sessions'][0]['runtime']['lifeRuntime']['world']['inventory']=['missing']
        codes={i['code'] for i in self.report(change)['issues']}
        self.assertTrue({'missing_active_timeline','persona_mismatch','duplicate_id','missing_place','missing_item'}<=codes)
    def test_credentials_never_saved_or_echoed(self):
        value=json.loads(SOURCE);value['companion']['apiKey']='test-secret-DO-NOT-PRINT';text=json.dumps(value)
        report=inspect_archive(text)
        self.assertFalse(report['canCheckpoint']);self.assertNotIn('test-secret-DO-NOT-PRINT',json.dumps(report))
        with self.assertRaises(ValueError):self.service.checkpoint(text,report['archiveDigest'])
        self.assertEqual(self.service.checkpoints(),[])
    def test_templates_cannot_smuggle_history(self):
        report=self.report(lambda v:v.update(_kind='character-template'))
        self.assertTrue(any(i['code']=='template_history' for i in report['issues']))
        self.assertFalse(report['canActivate'])
        legacy=json.loads(SOURCE);legacy['_version']=1;legacy.pop('_kind')
        self.assertEqual(inspect_archive(json.dumps(legacy))['kind'],'legacy-personal-archive')
    def test_reject_ambiguous_json_and_versions(self):
        with self.assertRaises(ValueError):inspect_archive('{"x":1,"x":2}')
        with self.assertRaises(ValueError):inspect_archive('{"x":NaN}')
        with self.assertRaises(ValueError):self.report(lambda v:v.update(_version=99))
    def test_entity_index_rebuild_and_domain_transitions(self):
        w=self.service.command({'schemaVersion':1,'key':'test','type':'create','name':'Alex'})
        initial=self.service.entity_projection(w['worldId'])
        self.assertTrue(any(e['kind']=='place' for e in initial['entities']))
        self.service.command({'schemaVersion':1,'key':'advance','type':'advance','worldId':w['worldId'],'expectedRevision':1,'steps':12})
        after=self.service.entity_projection(w['worldId'])
        self.assertGreater(after['revision'],1)
        self.assertTrue(any(e['kind']=='action' and e['data']['status']=='completed' for e in after['entities']))
        events=self.service.events(w['worldId'])
        self.assertTrue(any(change['type']=='ACTION_STATE_CHANGED' for e in events for change in e['payload']['details']['entityChanges']))
        with self.service.connect() as db:db.execute('DELETE FROM entity_views')
        self.assertEqual(self.service.entity_projection(w['worldId']),after)
        self.assertEqual(self.service.replay(w['worldId']),self.service.projection(w['worldId'])['state'])
    def test_database_v1_upgrade_preserves_ledger(self):
        w=self.service.command({'schemaVersion':1,'key':'test','type':'create','name':'Alex'})
        before=self.service.projection(w['worldId']);events=self.service.events(w['worldId'])
        with self.service.connect() as db:
            db.execute('DROP TABLE entity_views');db.execute('DROP TABLE checkpoints');db.execute('PRAGMA user_version=1')
        self.service.close()
        self.service=WorldService(Path(self.tmp.name)/'world.sqlite',node_executable(ROOT),ROOT)
        self.assertEqual(self.service.projection(w['worldId']),before)
        self.assertEqual(self.service.events(w['worldId']),events)
        self.assertTrue(self.service.entity_projection(w['worldId'])['entities'])

if __name__=='__main__':unittest.main(verbosity=2)
