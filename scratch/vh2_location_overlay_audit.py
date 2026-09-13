"""Bounded authored-location corrections; isolated database, no live mutation."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from test_runtime import node_executable
from vh2_runtime import WorldService,Conflict
spec=importlib.util.spec_from_file_location('location_overlay',ROOT/'scripts/apply-bundled-location-overlay.py')
overlay=importlib.util.module_from_spec(spec);spec.loader.exec_module(overlay)


class LocationOverlay(unittest.TestCase):
    def setUp(self):
        self.o=json.loads((ROOT/'scripts/aslyn-v18-location-overlay.json').read_text())
        self.c=json.loads((ROOT/'assets/bundled/aslyn-v18/character.json').read_text())['companion']

    def test_bundle_patch_preserves_identity_media_geometry_and_other_authorship(self):
        before=copy.deepcopy(self.c);after,report=overlay.apply_overlay(self.c,self.o)
        self.assertEqual(before,self.c)
        places={p['id']:p for p in before['lifeProfile']['places']}
        for row in after['lifeProfile']['places']:
            self.assertEqual(row.get('mapCoordinates'),places[row['id']].get('mapCoordinates'))
        self.assertEqual({p['id'] for p in after['lifeProfile']['places']},set(places))
        self.assertEqual([(r['id'],r['placeId']) for r in before['lifeSetupPolicies']['rooms']],[(r['id'],r['placeId']) for r in after['lifeSetupPolicies']['rooms']])
        for key,value in before.items():
            if key not in ('lifeProfile','lifeSetupPolicies','socialWorld'):self.assertEqual(value,after[key],key)
        self.assertEqual(before['lifeProfile']['travelLegs'],after['lifeProfile']['travelLegs'])
        self.assertIn('private bedroom',after['socialWorld'])
        self.assertNotIn('two-bedroom',after['socialWorld'])
        self.assertIn('Mr. Potato',next(r['description'] for r in after['lifeSetupPolicies']['rooms'] if r['id']=='room_aslyn_jordan_bedroom'))
        twice,again=overlay.apply_overlay(after,self.o)
        self.assertEqual(after,twice);self.assertEqual(again['changedFields'],0)

    def test_wrong_identity_parent_and_nontext_mutations_are_rejected(self):
        variants=[]
        wrong=copy.deepcopy(self.o);wrong['characterName']='Somebody else';variants.append(wrong)
        wrong=copy.deepcopy(self.o);wrong['rooms'][0]['placeId']='elsewhere';variants.append(wrong)
        wrong=copy.deepcopy(self.o);wrong['places'][0]['id']='missing';variants.append(wrong)
        wrong=copy.deepcopy(self.o);wrong['places'][0]['set']['mapCoordinates']=[0,0];variants.append(wrong)
        wrong=copy.deepcopy(self.o);wrong['places'][0]['set']['googlePlaceId']='invented';variants.append(wrong)
        wrong=copy.deepcopy(self.o);wrong['places'][0]['set']['detail']='x'*501;variants.append(wrong)
        for wrong in variants:
            with self.subTest(wrong=wrong.get('characterName')):
                with self.assertRaises(ValueError):overlay.apply_overlay(self.c,wrong)

    def test_new_authored_changes_require_review_instead_of_broad_replacement(self):
        c=copy.deepcopy(self.c);c['socialWorld']='A different household the author just edited.'
        with self.assertRaisesRegex(ValueError,'Authored text changed'):overlay.apply_overlay(c,self.o)

    def test_existing_atomic_service_command_applies_and_replays(self):
        with tempfile.TemporaryDirectory() as directory:
            s=WorldService(Path(directory)/'fixture.sqlite',node_executable(ROOT),ROOT,clock=lambda:1789200000000)
            try:
                places=[p for p in self.c['lifeProfile']['places'] if p['id'] in {r['id'] for r in self.o['places']}]
                profile={'age':28,'socialWorld':self.c['socialWorld'],'lifeProfile':{'places':places,'weeklySchedule':[],'sleepPolicy':{'enabled':False}}}
                w=s.command({'schemaVersion':1,'key':'create','type':'create_profile','name':self.c['name'],'profile':profile,'providerScope':'horde:overlay-fixture','personaId':'fixture'})['worldId']
                def command(kind,**fields):return s.command({'schemaVersion':1,'key':kind,'type':kind,'worldId':w,'expectedRevision':s.projection(w)['revision'],**fields})
                command('apply_life_proposal',version=2,baseSetupVersion=0,proposal={'rooms':self.c['lifeSetupPolicies']['rooms']})
                before=s.projection(w);payload,report=overlay.prepare_command(before,self.o)
                self.assertEqual(before,s.projection(w))
                receipt=s.command(payload);after=s.projection(w)
                self.assertEqual(s.command(payload),receipt)
                c=after['state']['truth']['companion']
                self.assertEqual({r['id'] for r in c['vh2Visual']['zones']},{r['id'] for r in self.c['lifeSetupPolicies']['rooms']})
                for patch in self.o['places']:
                    row=next(p for p in c['lifeProfile']['places'] if p['id']==patch['id'])
                    for key,value in patch['set'].items():self.assertEqual(row[key],value)
                self.assertEqual(c['humanDynamics'],before['state']['truth']['companion']['humanDynamics'])
                self.assertEqual(after['state']['communication'],before['state']['communication'])
                request=s.dialogue.snapshot(w,after['revision'],after['state'])[0]
                self.assertEqual(request['context']['identity']['socialWorld'],c['socialWorld'])
                self.assertEqual(after['state'],s.replay(w))
                missing=copy.deepcopy(after);del missing['state']['truth']['companion']['socialWorld']
                with self.assertRaises(ValueError):overlay.prepare_command(missing,self.o)
                restored,restoration=overlay.prepare_command(missing,self.o,authored_template=self.c)
                self.assertEqual(restoration['restoredMissingAuthoredFields'],['socialWorld'])
                self.assertIn('private bedroom',restored['proposal']['expression']['socialWorld'])
                deliberately_empty=copy.deepcopy(after);deliberately_empty['state']['truth']['companion']['socialWorld']=''
                with self.assertRaises(ValueError):overlay.prepare_command(deliberately_empty,self.o,authored_template=self.c)
                stale=copy.deepcopy(payload);stale['key']='stale'
                with self.assertRaises(Conflict):s.command(stale)
                for merged in (False,True):
                    blocked=copy.deepcopy(after)
                    if merged:blocked['state']['mergedInto']='canonical'
                    else:blocked['state']['truth']['companion']['lifeRuntime']['world']['journey']={'from':'home','to':'target'}
                    with self.assertRaises(ValueError):overlay.prepare_command(blocked,self.o)
            finally:s.close()


if __name__=='__main__':unittest.main(verbosity=2)
