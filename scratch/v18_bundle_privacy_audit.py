"""Fresh bundled IDs preserve authored links without retaining private-life namespaces."""
import copy
import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bundle_privacy',ROOT/'scripts/build-bundled-human.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
A='11111111-1111-4111-8111-111111111111'
B='22222222-2222-4222-8222-222222222222'
class BundledPrivacy(unittest.TestCase):
 def fixture(self):
  ident='garment:'+A+':human:blue-top'
  return {'id':'bundled_character','name':'Fictional person','backstory':ident,
   'lifeProfile':{'seed':A+':human','world':{'items':[{'id':ident,'name':'Blue top','photo':'assets/top.png','incompatible':[ident]}]},'activityOptions':[{'id':'dress','itemIds':[ident]}]},
   'lifeSetupPolicies':{'possessions':[{'id':ident,'description':'Blue cotton','photo':'assets/top.png'}],'referencePlan':[{'role':'garment','entityId':ident}]},
   'startingReferences':[{'id':'public-reference','role':'garment','entityId':ident,'image':'assets/top.png'}],
   'startingSocialPosts':[{'id':'authored-post','text':ident,'photo':'assets/day.png'}]}
 def test_exact_id_links_are_rewritten_together_and_input_unchanged(self):
  before=self.fixture();saved=copy.deepcopy(before);out=builder.sanitize_bundled_item_namespaces(before,[A])
  self.assertEqual(before,saved)
  ident=out['lifeProfile']['world']['items'][0]['id']
  self.assertNotIn(A,ident);self.assertIn('bundled_character',ident)
  self.assertEqual(out['lifeSetupPolicies']['possessions'][0]['id'],ident)
  self.assertEqual(out['startingReferences'][0]['entityId'],ident)
  self.assertEqual(out['lifeSetupPolicies']['referencePlan'][0]['entityId'],ident)
  self.assertEqual(out['lifeProfile']['world']['items'][0]['incompatible'],[ident])
  self.assertEqual(out['lifeProfile']['activityOptions'][0]['itemIds'],[ident])
  self.assertEqual(out['lifeProfile']['seed'],'bundled_character')
  self.assertEqual(out['backstory'],before['backstory'])
  self.assertEqual(out['startingSocialPosts'],before['startingSocialPosts'])
  self.assertEqual(out['startingReferences'][0]['image'],'assets/top.png')
 def test_idempotent_and_independent_of_source_world_order(self):
  c=self.fixture()
  a=builder.sanitize_bundled_item_namespaces(c,[A,B])
  self.assertEqual(a,builder.sanitize_bundled_item_namespaces(c,[B,A]))
  self.assertEqual(a,builder.sanitize_bundled_item_namespaces(a,[A,B]))
 def test_collisions_fail_without_mutating_input(self):
  c=self.fixture();other=copy.deepcopy(c['lifeProfile']['world']['items'][0]);other['id']=other['id'].replace(A,B);c['lifeProfile']['world']['items'].append(other);saved=copy.deepcopy(c)
  with self.assertRaises(ValueError):builder.sanitize_bundled_item_namespaces(c,[A,B])
  self.assertEqual(c,saved)
 def test_unrelated_authored_ids_and_media_paths_remain_identical(self):
  c=self.fixture();item={'id':'custom-blue-shoes','name':'Authored shoes','photo':'assets/'+A+'.png'};c['lifeProfile']['world']['items'].append(item)
  out=builder.sanitize_bundled_item_namespaces(c,[A])
  self.assertEqual(out['lifeProfile']['world']['items'][1],item)
if __name__=='__main__':unittest.main(verbosity=2)
