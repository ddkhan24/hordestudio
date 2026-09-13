"""Coordinate corrections invalidate future evidence without moving people or rewriting history."""
import copy,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import vh2_lifestyle_audit as fixture
from vh2_runtime import Conflict
import vh2_weather

class CoordinateEdits(unittest.TestCase):
 setUp=fixture.Lifestyle.setUp
 tearDown=fixture.Lifestyle.tearDown
 state=fixture.Lifestyle.state
 cmd=fixture.Lifestyle.cmd
 def seed(self,change):
  p=self.s.projection(self.w);before=p['state'];after=copy.deepcopy(before);change(after)
  with self.s.connect() as db:self.s.commit_event(db,self.w,p['revision'],before,after,'FIXTURE_GEOGRAPHY')
 def c(self):return self.state()['truth']['companion']
 def place(self,ident='home',**extra):
  original=next(p for p in self.c()['lifeProfile']['places'] if p['id']==ident)
  return {'id':ident,'label':original['label'],'kind':original['kind'],**extra}
 def graph(self):
  def change(s):
   c=s['truth']['companion'];c['lifeProfile']['places']=[{'id':i,'label':i.title(),'kind':'home' if i=='home' else 'social','mapCoordinates':xy,'googlePlaceId':'google_'+i} for i,xy in [('home',[0,0]),('away',[1,1]),('third',[2,2]),('fourth',[3,3])]]
   c['lifeProfile']['travelLegs']=[{'from':'home','to':'away','mode':'WALK','minutes':10,'cost':0,'source':'authored_duration'},{'from':'away','to':'third','mode':'WALK','minutes':10,'cost':0,'source':'fixture'}]
  self.seed(change)
 def test_noop_and_label_save_preserve_routes_even_during_journey(self):
  self.graph();self.seed(lambda s:s['truth']['companion']['lifeRuntime']['world'].update(journey={'id':'actual','from':'home','to':'away','departedAt':s['simAt'],'arrivesAt':s['simAt']+60000}))
  before=copy.deepcopy(self.c()['lifeProfile']['travelLegs'])
  self.cmd('upsert_place',place=self.place(longitude=0,latitude=0,label='Renamed home'))
  self.assertEqual(before,self.c()['lifeProfile']['travelLegs']);self.assertNotIn('lastRouteInvalidation',self.c()['vh2Geography'])
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_provider_label_correction_preserves_real_routes_and_weather_in_flight(self):
  self.graph()
  def change(s):
   c=s['truth']['companion'];c['lifeRuntime']['world']['journey']={'id':'actual','from':'home','to':'away'}
   c['vh2People']['actors']['friend']={'id':'friend','journey':{'from':'third','to':'home'},'remaining':[{'from':'home','to':'away'}]}
   c['lifeRuntime']['environment']={'temperature':29};s['worldData']={'weather':{'temperature':29}}
  self.seed(change);before=self.state()
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=self.c().get('vh2SetupVersion',0),proposal={'places':[{'id':'home','label':'Fictional nearby apartment','googlePlaceId':''}]})
  after=self.state();c=self.c()
  self.assertEqual(c['lifeProfile']['travelLegs'],before['truth']['companion']['lifeProfile']['travelLegs'])
  for field in ('lifeRuntime','vh2People'):self.assertEqual(c[field],before['truth']['companion'][field])
  self.assertEqual(after['worldData'],before['worldData']);self.assertNotIn('lastRouteInvalidation',c['vh2Geography'])
  home=next(p for p in c['lifeProfile']['places'] if p['id']=='home');self.assertEqual(home['mapCoordinates'],[0,0]);self.assertEqual(home['googlePlaceId'],'')
  self.cmd('upsert_place',place=self.place(googlePlaceId='verified_corrected_listing',longitude=0,latitude=0))
  self.assertEqual(self.c()['lifeProfile']['travelLegs'],c['lifeProfile']['travelLegs'])
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_provider_label_removal_without_known_coordinates_retains_endpoint_guard(self):
  self.graph()
  def change(s):
   c=s['truth']['companion'];next(p for p in c['lifeProfile']['places'] if p['id']=='home')['mapCoordinates']=None
   c['lifeRuntime']['world']['journey']={'from':'home','to':'away'}
  self.seed(change);before=self.state()
  with self.assertRaisesRegex(Conflict,'arrives'):self.cmd('apply_life_proposal',version=2,baseSetupVersion=self.c().get('vh2SetupVersion',0),proposal={'places':[{'id':'home','googlePlaceId':''}]})
  self.assertEqual(before,self.state())
 def test_correction_keeps_unrelated_and_already_matching_geometry(self):
  self.graph()
  def extra(s):
   legs=s['truth']['companion']['lifeProfile']['travelLegs']
   legs.extend([{'from':'home','to':'away','mode':'BICYCLE','minutes':5,'cost':0,'source':'google','geometry':[[.01,.01],[1,1]]},{'from':'away','to':'home','mode':'WALK','minutes':10,'cost':0,'source':'osm','geometry':[[1,1],[0,0]]}])
  self.seed(extra);self.cmd('upsert_place',place=self.place(longitude=.01,latitude=.01))
  routes=self.c()['lifeProfile']['travelLegs']
  self.assertEqual([(r['from'],r['to'],r['mode']) for r in routes],[('away','third','WALK'),('home','away','BICYCLE')])
  receipt=self.c()['vh2Geography']['lastRouteInvalidation'];self.assertEqual(receipt['removedRouteCount'],2);self.assertEqual(receipt['placeIds'],['home'])
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_provider_identity_change_without_coordinate_proof_invalidates(self):
  self.graph();self.cmd('upsert_place',place=self.place(googlePlaceId='different_home'))
  self.assertEqual(len(self.c()['lifeProfile']['travelLegs']),1)
  self.assertEqual(self.c()['vh2Geography']['lastRouteInvalidation']['removedRouteCount'],1)
  self.assertIsNone(next(p for p in self.c()['lifeProfile']['places'] if p['id']=='home').get('mapCoordinates'))
 def test_current_main_endpoint_edit_is_atomic(self):
  self.graph();self.seed(lambda s:s['truth']['companion']['lifeRuntime']['world'].update(journey={'from':'home','to':'away'}));before=self.state()
  with self.assertRaisesRegex(Conflict,'arrives'):self.cmd('upsert_place',place=self.place(longitude=5,latitude=5))
  self.assertEqual(self.state(),before)
 def test_supporting_actor_endpoint_guard_applies_to_upsert_and_builder(self):
  self.graph();self.seed(lambda s:s['truth']['companion']['vh2People']['actors'].update({'friend':{'id':'friend','journey':{'from':'third','to':'away'}}}));before=self.state()
  with self.assertRaisesRegex(Conflict,'friend'):self.cmd('upsert_place',place=self.place('away',longitude=5,latitude=5))
  with self.assertRaisesRegex(Conflict,'friend'):self.cmd('apply_life_proposal',version=2,baseSetupVersion=self.c().get('vh2SetupVersion',0),proposal={'places':[{'id':'away','mapCoordinates':[5,5]}]})
  self.assertEqual(self.state(),before)
 def test_future_actor_route_clears_without_interrupting_unaffected_journey(self):
  self.graph();journey={'from':'third','to':'fourth','departedAt':self.state()['simAt'],'arrivesAt':self.state()['simAt']+60000};leg={'from':'fourth','to':'home','mode':'WALK','minutes':20}
  self.seed(lambda s:s['truth']['companion']['vh2People']['actors'].update({'friend':{'id':'friend','journey':copy.deepcopy(journey),'remaining':[leg],'pending':{'placeId':'home','path':[leg]},'presenceHistory':[{'placeId':'third'}]}}))
  self.cmd('upsert_place',place=self.place(longitude=5,latitude=5));a=self.c()['vh2People']['actors']['friend']
  self.assertEqual(a['journey'],journey);self.assertEqual(a['remaining'],[]);self.assertIsNone(a['pending']);self.assertEqual(a['presenceHistory'],[{'placeId':'third'}])
 def test_future_trip_cancels_after_actual_arrival_preserving_history_and_photo(self):
  self.graph()
  def change(s):
   c=s['truth']['companion'];c['lifeRuntime']['world']['journey']={'from':'third','to':'fourth','id':'actual'}
   c['vh2Travel'].update(activeId='ongoing',trips=[{'id':'historic','status':'completed','legs':[{'from':'home','to':'away'}]},{'id':'ongoing','status':'travelling','stopIndex':0,'legs':[{'from':'fourth','to':'home'}],'lastLeg':{'from':'third','to':'fourth'}}])
   s['photos']=[{'id':'frozen','references':[{'placeId':'home','coordinates':[0,0]}]}]
  self.seed(change);before=self.state();self.cmd('upsert_place',place=self.place(longitude=5,latitude=5));after=self.state();c=after['truth']['companion'];trips=c['vh2Travel']['trips']
  self.assertTrue(trips[1]['cancelAfterArrival']);self.assertEqual(trips[1]['legs'],[]);self.assertEqual(trips[1]['lastLeg'],{'from':'third','to':'fourth'})
  self.assertEqual(trips[0],before['truth']['companion']['vh2Travel']['trips'][0]);self.assertEqual(after['photos'],before['photos']);self.assertEqual(c['lifeRuntime']['world']['journey'],before['truth']['companion']['lifeRuntime']['world']['journey'])
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_waiting_trip_invalidates_before_departure(self):
  self.graph();self.seed(lambda s:s['truth']['companion']['vh2Travel'].update(activeId='waiting',trips=[{'id':'waiting','status':'waiting','stopIndex':1,'legs':[{'from':'third','to':'home'}]}]))
  self.cmd('upsert_place',place=self.place(longitude=5,latitude=5));t=self.c()['vh2Travel']['trips'][0]
  self.assertEqual(t['status'],'blocked');self.assertEqual(t['recoveryTargetIndex'],1);self.assertEqual(t['legs'],[])
 def test_builder_uses_same_route_and_weather_invalidation(self):
  self.graph()
  def change(s):
   c=s['truth']['companion'];c['lifeRuntime']['environment']={'temperature':44,'coordinates':[0,0]};c['lifeRuntime']['world']['placeId']='home'
   s['truth']['present'].update(placeId='home',position={'coordinates':[0,0]});s['worldData']={'weather':{'temperature':44},'weatherAttemptPoint':[0,0],'weatherAttemptAt':s['simAt'],'other':'preserved'}
  self.seed(change)
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=self.c().get('vh2SetupVersion',0),proposal={'places':[{'id':'home','mapCoordinates':[5,5]}]})
  state=self.state();self.assertEqual(len(self.c()['lifeProfile']['travelLegs']),1);self.assertIsNone(self.c()['lifeRuntime']['environment']);self.assertEqual(state['worldData'],{'other':'preserved'});self.assertEqual(vh2_weather.location(state),[5,5]);self.assertTrue(self.c()['vh2Geography']['lastRouteInvalidation']['weatherInvalidated'])
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_bad_coordinates_never_partially_invalidate(self):
  self.graph();before=self.state()
  for lon,lat in [(181,0),(0,91),(True,1),(1,None),(float('inf'),0),(float('nan'),0)]:
   with self.assertRaises(ValueError):self.cmd('upsert_place',place=self.place(longitude=lon,latitude=lat))
  self.assertEqual(self.state(),before)
 def test_builder_new_listing_without_position_cannot_reuse_old_pin_or_weather(self):
  self.graph();self.seed(lambda s:s['truth']['companion'].update(locationLongitude=0,locationLatitude=0))
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=self.c().get('vh2SetupVersion',0),proposal={'places':[{'id':'home','googlePlaceId':'another_listing'}]})
  home=next(p for p in self.c()['lifeProfile']['places'] if p['id']=='home');self.assertIsNone(home['mapCoordinates']);self.assertIsNone(vh2_weather.location(self.state()));self.assertEqual(self.state(),self.s.replay(self.w))

if __name__=='__main__':unittest.main(verbosity=2)
