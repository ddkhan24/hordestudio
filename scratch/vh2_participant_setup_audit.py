"""Fresh exports reconstruct known people and unintroduced residents atomically."""
import copy,unittest
from vh2_complete_builder_audit import CompleteBuilder

class ParticipantSetup(CompleteBuilder):
 def graph(self):
  draft=self.draft();p=draft['proposal']
  p['population']={'enabled':True,'openness':65,'residents':[{'id':'resident','name':'Taylor','placeId':'cafe','homePlaceId':'away','initialPlaceId':'away','days':[0,1,2,3,4,5,6],'start':540,'end':1320,'openness':70,'age':27}]}
  actor=copy.deepcopy(p['peopleLives'][0]);actor.update(personId='resident',startingBalance=123.45,initialPlaceId='cafe');actor['policy'].update(ownsCar=True,modes=['WALK','DRIVE'])
  p['peopleLives'].append(actor);p['socialPolicy']['dispositions']['resident']={'sociability':73}
  return draft
 def test_population_and_lives_form_one_fresh_graph(self):
  self.cmd('apply_life_proposal',**self.graph());s=self.state();c=s['truth']['companion'];a=c['vh2People']['actors']['resident']
  self.assertEqual(a['balance'],123.45);self.assertEqual(a['placeId'],'cafe');self.assertTrue(a['policy']['ownsCar'])
  self.assertEqual(c['vh2People']['network']['dispositions']['resident']['sociability'],73)
  self.assertNotIn('resident',{p['id'] for p in c['lifeProfile']['socialCircle']});self.assertIsNone(c['vh2Population']['residents'][0]['introducedAt'])
  self.assertFalse(any(r.get('status')=='pending_configuration' for r in c['vh2People']['setup'].values()));self.assertEqual(s,self.s.replay(self.w))
 def test_invalid_resident_rolls_back_pending_people_and_every_section(self):
  before=self.state();draft=self.graph();draft['proposal']['population']['residents'][0]['placeId']='not-a-place'
  with self.assertRaises(ValueError):self.cmd('apply_life_proposal',**draft)
  self.assertEqual(before,self.state())
 def test_unregistered_actor_cannot_be_smuggled_into_a_life(self):
  before=self.state();draft=self.graph();draft['proposal']['peopleLives'][1]['personId']='not-a-person'
  with self.assertRaises(ValueError):self.cmd('apply_life_proposal',**draft)
  self.assertEqual(before,self.state())
 def test_large_existing_catalog_roundtrips_and_new_defaults_remain_bounded(self):
  draft=self.graph();p=draft['proposal'];venues=['venue_'+str(n) for n in range(49)]
  p['places'] += [{'id':ident,'label':ident,'kind':'social','encounterScope':'nearby'} for ident in venues]
  p['peopleLives'][1]['policy']['leisurePlaceIds']=venues
  p['population']['residents'].append({'id':'resident-default','name':'Sam','placeId':venues[-1],'homePlaceId':'away','initialPlaceId':'away','days':[0,1,2,3,4,5,6],'start':540,'end':1320,'openness':70,'age':28})
  p['routes'] += [{'from':a,'to':b,'mode':'WALK','minutes':5,'cost':0} for a,b in [('away',venues[-1]),(venues[-1],'away')]]
  self.cmd('apply_life_proposal',**draft);c=self.state()['truth']['companion']
  self.assertEqual(c['vh2People']['actors']['resident']['policy']['leisurePlaceIds'],venues,'legacy auto-generated 49-place catalogs remain portable')
  defaults=c['vh2People']['actors']['resident-default']['policy']['leisurePlaceIds']
  self.assertLessEqual(len(defaults),48);self.assertIn(venues[-1],defaults,'the preferred venue belongs inside the bounded list')

if __name__=='__main__':unittest.main(verbosity=2)
