"""Offline context/reference matrix, not a language or visual-quality rating."""
import sys,json,copy,unittest,itertools
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import vh2_workers
import vh2_ecosystem_audit as fixtures
class Matrix(unittest.TestCase):
 setUp=fixtures.Ecosystem.setUp
 tearDown=fixtures.Ecosystem.tearDown
 state=fixtures.Ecosystem.state
 def test_context_authority_across_needs_and_availability(self):
  original=self.state()
  for energy,stress,availability in itertools.product((10,80),(5,90),('available','busy','asleep')):
   with self.subTest(energy=energy,stress=stress,availability=availability):
    state=copy.deepcopy(original);c=state['truth']['companion'];c['humanDynamics'].update(energy=energy,stress=stress);state['truth']['present']['availability']=availability
    c['vh2People']={'network':{'events':[{'secret':'Private NPC encounter'}]}}
    c['vh2Signals']={'signals':[{'title':'Unnoticed secret match'}],'known':[]}
    c['vh2Institutions']={'events':[{'institution':'Seminar','status':'missed'}]}
    request,_=self.s.dialogue.snapshot(self.w,self.s.projection(self.w)['revision'],state);ctx=request['context'];wire=json.dumps(request)
    self.assertEqual(ctx['current']['needs']['energy'],energy);self.assertEqual(ctx['current']['availability'],availability)
    self.assertEqual(ctx['institutionOutcomes'][0]['status'],'missed');self.assertNotIn('Private NPC encounter',wire);self.assertNotIn('Unnoticed secret match',wire)
 def test_reference_continuity_matrix(self):
  ctx={'atMs':10000000,'placeId':'home','zoneId':'room','zoneRevision':1,'outfitRevision':1,'outfit':'Blue dress','garmentIds':['dress']}
  base={'companion':{'age':28,'personality':'Playful'},'photoContext':ctx,'destination':'chat','captureType':'mirror_selfie','scene':'Wave to the mirror','referenceAssets':[{'role':'identity','assetId':'identity','label':'Canonical person'},{'role':'place','assetId':'room','label':'Room'}]}
  prior={'assetId':'previous','destination':'chat','at':9990000,'photoContext':{**ctx,'atMs':9990000}}
  for field,change in [('none',None),('placeId','gym'),('zoneId','bath'),('zoneRevision',2),('outfitRevision',2),('outfit','Red coat'),('garmentIds',['coat'])]:
   with self.subTest(change=field):
    snapshot=copy.deepcopy(base)
    if change is not None:snapshot['photoContext'][field]=change
    with patch('vh2_workers.asset_data',side_effect=lambda db,w,i:'data:image/png;base64,'+i):
     body,hashes,ids=vh2_workers.compile_image(None,self.w,{'photos':[prior]},snapshot,{'model':'offline-fixture','maxReferences':4})
    self.assertEqual(ids[0],'identity');self.assertIn('room',ids)
    self.assertEqual('previous' in ids,field=='none');self.assertIn('28-year-old',body['prompt']);self.assertEqual(body['provider']['allow_fallbacks'],False)
  with patch('vh2_workers.asset_data',side_effect=lambda db,w,i:i):
   with self.assertRaises(ValueError):vh2_workers.compile_image(None,self.w,{'photos':[prior]},base,{'model':'fixture','maxReferences':1})
if __name__=='__main__':unittest.main()
