import sys,pathlib,unittest,copy
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import vh2_ecosystem_audit as f
import vh2_world_packs
class Geography(unittest.TestCase):
 setUp=f.Ecosystem.setUp
 tearDown=f.Ecosystem.tearDown
 state=f.Ecosystem.state
 c=f.Ecosystem.c
 cmd=f.Ecosystem.cmd
 def test_enable_and_replay(self):
  before=copy.deepcopy(self.c()['lifeProfile']['weeklySchedule']);self.cmd('configure_geographic_life',enabled=True)
  self.assertTrue(self.c()['vh2Geography']['enabled']);self.assertEqual(before,self.c()['lifeProfile']['weeklySchedule']);self.assertEqual(self.state(),self.s.replay(self.w))
  self.cmd('configure_geographic_life',enabled=False);self.assertFalse(self.c()['vh2Geography']['enabled']);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_pack_and_invalid_atomic(self):
  pack={'version':1,'source':'offline test graph','license':'CC0','places':[{'id':'food','label':'Cafe','mapCoordinates':[1,2],'capabilities':{'capabilities':['food'],'mealCost':4}}],'routes':[{'from':'home','to':'food','mode':'WALK','minutes':5}]}
  self.cmd('import_world_pack',pack=pack);self.assertIn('food',[p['id'] for p in self.c()['lifeProfile']['places']]);self.assertNotIn('food',self.c()['vh2Geography']['knownPlaceIds']);self.assertEqual(self.state(),self.s.replay(self.w));before=self.state()
  with self.assertRaises(ValueError):self.cmd('import_world_pack',pack=pack)
  self.assertEqual(before,self.state())
 def test_capabilities_and_hours(self):
  self.cmd('set_place_capabilities',placeId='park',capabilities={'capabilities':['food'],'mealCost':3,'hours':[{'days':[1], 'start':600,'end':700}]})
  self.assertEqual(self.c()['vh2Geography']['places']['park']['mealCost'],3);before=self.state()
  with self.assertRaises(ValueError):self.cmd('set_place_capabilities',placeId='missing',capabilities={})
  self.assertEqual(before,self.state())
 def test_shared_library_deduplicates(self):
  pack={'version':1,'source':'fixture','license':'CC0','places':[{'id':'x','label':'X','mapCoordinates':[0,0]}],'routes':[]}
  a=vh2_world_packs.library(self.s,{'name':'Region','pack':pack});b=vh2_world_packs.library(self.s,{'name':'Region','pack':pack});self.assertEqual(a,b);self.assertEqual(len(b['packs']),1)
  self.cmd('import_world_pack',packId=b['packs'][0]['id']);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_binding_cannot_mix_saved_coordinates_and_different_pack_route_anchor(self):
  self.cmd('upsert_place',place={'id':'home','label':'Home','kind':'home','longitude':0,'latitude':0});before=self.state()
  pack={'version':1,'source':'fixture guard','license':'CC0','places':[{'id':'pack-home','label':'Map home','mapCoordinates':[1,1]}],'routes':[{'from':'pack-home','to':'park','mode':'WALK','minutes':5}]}
  with self.assertRaisesRegex(ValueError,'150 metres'):self.cmd('import_world_pack',pack=pack,bindings={'pack-home':'home'})
  self.assertEqual(self.state(),before)
 def test_binding_unknown_position_invalidates_prior_routes_and_requires_arrival(self):
  from vh2_runtime import Conflict
  pack={'version':1,'source':'fixture fill','license':'CC0','places':[{'id':'pack-home','label':'Map home','mapCoordinates':[1,1]}],'routes':[{'from':'pack-home','to':'park','mode':'WALK','minutes':5}]}
  self.cmd('import_world_pack',pack=pack,bindings={'pack-home':'home'})
  self.assertEqual(next(p for p in self.c()['lifeProfile']['places'] if p['id']=='home')['mapCoordinates'],[1,1]);self.assertEqual(len(self.c()['lifeProfile']['travelLegs']),1);self.assertEqual(self.c()['vh2Geography']['lastRouteInvalidation']['removedRouteCount'],2);self.assertEqual(self.state(),self.s.replay(self.w))
  projection=self.s.projection(self.w);before=projection['state'];after=copy.deepcopy(before);after['truth']['companion']['lifeRuntime']['world']['journey']={'from':'home','to':'park'}
  with self.s.connect() as db:self.s.commit_event(db,self.w,projection['revision'],before,after,'FIXTURE_TRAVEL')
  before=self.state();other={**pack,'source':'second fill','places':[{'id':'pack-park','label':'Map park','mapCoordinates':[2,2]}],'routes':[]}
  with self.assertRaises(Conflict):self.cmd('import_world_pack',pack=other,bindings={'pack-park':'park'})
  self.assertEqual(self.state(),before)
 def binding_pack(self):
  return {'version':1,'source':'immutable walking fixture','license':'CC0','bbox':[0,0,2,2],'places':[{'id':'map-home','label':'Map home','mapCoordinates':[0,0]},{'id':'map-new','label':'Correct home entrance','mapCoordinates':[.01,.01]},{'id':'map-park','label':'Map park','mapCoordinates':[1,1]}],'routes':[{'from':'map-home','to':'map-park','mode':'WALK','minutes':10,'geometry':[[0,0],[1,1]]},{'from':'map-new','to':'map-park','mode':'WALK','minutes':9,'geometry':[[.01,.01],[1,1]]}]}
 def seed(self,mutate):
  p=self.s.projection(self.w);before=p['state'];after=copy.deepcopy(before);mutate(after)
  with self.s.connect() as db:self.s.commit_event(db,self.w,p['revision'],before,after,'FIXTURE_PACK')
 def test_explicit_refresh_rebinds_same_pack_without_duplicate_routes_or_history(self):
  pack=self.binding_pack();self.cmd('import_world_pack',pack=pack,bindings={'map-home':'home','map-park':'park'})
  original=copy.deepcopy(self.c()['vh2Geography']['packs'][0]);known=copy.deepcopy(self.c()['vh2Geography']['knownPlaceIds'])
  self.seed(lambda s:s['truth']['companion']['lifeProfile']['travelLegs'].append({'from':'home','to':'park','mode':'DRIVE','minutes':4,'cost':0,'source':'authored_duration'}))
  self.cmd('upsert_place',place={'id':'home','label':'Home','kind':'home','longitude':.01,'latitude':.01})
  self.cmd('record_route',**{'from':'park','to':'map-new','mode':'BICYCLE','minutes':3})
  self.cmd('import_world_pack',pack=pack,refresh=True,bindings={'map-new':'home'})
  c=self.c();routes=copy.deepcopy(c['lifeProfile']['travelLegs']);receipt=c['vh2Geography']['packs'][0]
  self.assertEqual(receipt['importedAt'],original['importedAt']);self.assertEqual(receipt['bindings'],{'map-new':'home','map-park':'park'});self.assertEqual(len(c['vh2Geography']['packs']),1);self.assertEqual(c['vh2Geography']['knownPlaceIds'],known)
  self.assertTrue(any(r['from']=='home' and r['to']=='park' and r['geometry']==[[.01,.01],[1,1]] for r in routes));self.assertTrue(any(r['mode']=='BICYCLE' and r['source']=='authored_duration' for r in routes));self.assertIn('food',c['vh2Geography']['places']['home']['capabilities'])
  self.cmd('import_world_pack',pack=pack,refresh=True);self.assertEqual(self.c()['lifeProfile']['travelLegs'],routes);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_refresh_rejects_changed_pack_content_and_active_route_binding_atomically(self):
  from vh2_runtime import Conflict
  pack=self.binding_pack();self.cmd('import_world_pack',pack=pack,bindings={'map-home':'home','map-park':'park'});before=self.state()
  with self.assertRaisesRegex(ValueError,'immutable'):self.cmd('import_world_pack',pack={**pack,'license':'different content'},refresh=True)
  self.assertEqual(self.state(),before)
  # A same-location rebind changes identity even when no coordinate edit is needed.
  self.cmd('upsert_place',place={'id':'alternative','label':'Alternative anchor','kind':'other','longitude':0,'latitude':0})
  self.seed(lambda s:s['truth']['companion']['lifeRuntime']['world'].update(journey={'from':'home','to':'park','mode':'WALK','routeSource':pack['source']}));before=self.state()
  with self.assertRaises(Conflict):self.cmd('import_world_pack',pack=pack,refresh=True,bindings={'map-home':'alternative'})
  self.assertEqual(self.state(),before)
 def test_legacy_receipt_refresh_recovers_geometry_without_touching_unrelated_routes(self):
  pack=self.binding_pack();self.cmd('import_world_pack',pack=pack,bindings={'map-home':'home','map-park':'park'})
  def legacy(s):
   c=s['truth']['companion'];entry=c['vh2Geography']['packs'][0];entry.pop('bindings');entry.pop('contentHash')
   c['lifeProfile']['travelLegs'].append({'from':'home','to':'park','mode':'WALK','minutes':40,'cost':0,'source':pack['source'],'geometry':[[0,0],[2,2],[1,1]]})
  self.seed(legacy);self.cmd('import_world_pack',pack=pack,refresh=True,bindings={'map-home':'home','map-park':'park'})
  self.assertEqual(len(self.c()['lifeProfile']['travelLegs']),3);self.assertEqual(self.c()['lifeProfile']['travelLegs'][0]['minutes'],40);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_new_region_replaces_only_proven_routes_and_keeps_current_journey(self):
  old=self.binding_pack();library=vh2_world_packs.library(self.s,{'name':'Original','pack':old});old_id=library['packs'][0]['id']
  self.cmd('import_world_pack',packId=old_id,bindings={'map-home':'home','map-park':'park'})
  new=copy.deepcopy(old);new['source']='new verified pedestrian snapshot';new['routes'][0]['minutes']=12
  new['routes'].append({'from':'map-park','to':'map-home','mode':'WALK','minutes':12,'geometry':[[1,1],[0,0]]})
  def travelling(s):
   c=s['truth']['companion'];old_leg=copy.deepcopy(c['lifeProfile']['travelLegs'][0]);c['lifeRuntime']['world']['journey']={**old_leg,'departedAt':s['simAt'],'arrivesAt':s['simAt']+600000}
   c['lifeProfile']['travelLegs'].append({**old_leg,'minutes':40})
   c['lifeProfile']['travelLegs'].append({'from':'park','to':'home','mode':'BICYCLE','minutes':3,'source':'authored_duration'})
  self.seed(travelling);before=self.c();journey=copy.deepcopy(before['lifeRuntime']['world']['journey']);imported=before['vh2Geography']['packs'][0]['importedAt']
  self.cmd('import_world_pack',pack=new,replacePackId=old_id)
  c=self.c();self.assertEqual(c['lifeRuntime']['world']['journey'],journey,'Already-started travel retains its captured duration and geometry')
  self.assertEqual(len(c['vh2Geography']['packs']),1);receipt=c['vh2Geography']['packs'][0]
  self.assertEqual(receipt['source'],new['source']);self.assertEqual(receipt['importedAt'],imported);self.assertEqual(receipt['replacedFrom']['libraryId'],old_id)
  self.assertEqual(c['vh2Geography']['lastPackRefresh']['removedRouteCount'],2)
  self.assertTrue(any(r['minutes']==40 and r['source']==old['source'] for r in c['lifeProfile']['travelLegs']),'Custom route with same geometry but different travel evidence survives')
  self.assertTrue(any(r['mode']=='BICYCLE' for r in c['lifeProfile']['travelLegs']))
  self.assertTrue(any(r['from']=='park' and r['to']=='home' and r['source']==new['source'] for r in c['lifeProfile']['travelLegs']))
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_region_replacement_requires_matching_immutable_receipt(self):
  old=self.binding_pack();old_id=vh2_world_packs.library(self.s,{'name':'Original','pack':old})['packs'][0]['id']
  new={**old,'source':'replacement'};before=self.state()
  with self.assertRaisesRegex(ValueError,'not installed'):self.cmd('import_world_pack',pack=new,replacePackId=old_id)
  self.assertEqual(before,self.state());self.cmd('import_world_pack',packId=old_id)
  self.seed(lambda s:s['truth']['companion']['vh2Geography']['packs'][0].update(contentHash='not-the-installed-content'));before=self.state()
  with self.assertRaisesRegex(ValueError,'immutable'):self.cmd('import_world_pack',pack=new,replacePackId=old_id)
  self.assertEqual(before,self.state())
if __name__=='__main__':unittest.main()
