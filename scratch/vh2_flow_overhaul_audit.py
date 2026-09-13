"""Canonical-state acceptance for reviewed setup and typed possessions."""
from test_runtime import node_executable
import json,sys,tempfile,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService,Conflict
ROOT=Path(__file__).resolve().parents[1]
class Flow(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=WorldService(Path(self.tmp.name)/'s.sqlite',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
  self.w=self.s.command(dict(schemaVersion=1,key='create',type='create_profile',name='Alex',profile={'age':28,'lifeProfile':{'places':[{'id':'home','label':'Home','kind':'home'}],'sleepPolicy':{'enabled':False},'weeklySchedule':[],'world':{'transport':{'enabled':True}}}},providerScope='horde:test',personaId='p'))['worldId']
 def test_legacy_duplicate_schedule_ids_repaired_without_dropping_rows(self):
  with self.s.connect() as db:
   rev,before=self.s.read(db,self.w);after=json.loads(json.dumps(before))
   after['truth']['companion']['lifeProfile']['weeklySchedule']=[{'id':'shift','days':[1],'startMinute':540,'endMinute':600,'activity':'Monday shift','placeId':'home'},{'id':'shift','days':[2],'startMinute':540,'endMinute':600,'activity':'Tuesday shift','placeId':'home'}]
   self.s.commit_event(db,self.w,rev,before,after,'LEGACY_FIXTURE')
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=0,proposal={'weeklySchedule':[{'id':'shift','activity':'Updated Monday shift'}]})
  rows=self.c()['lifeProfile']['weeklySchedule'];self.assertEqual(len(rows),2);self.assertEqual(rows[0]['id'],'shift');self.assertNotEqual(rows[1]['id'],'shift');self.assertEqual(rows[1]['activity'],'Tuesday shift')
  ids=[r['id'] for r in rows]
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=1,proposal={'weeklySchedule':[]})
  self.assertEqual([r['id'] for r in self.c()['lifeProfile']['weeklySchedule']],ids)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def c(self):return self.state()['truth']['companion']
 def cmd(self,kind,**kwargs):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kwargs))
 def add(self,category,**details):
  self.cmd('add_owned_item',name='Test '+category,category=category,possession=details);return self.c()['lifeProfile']['world']['items'][-1]['id']
 def test_reviewed_setup_preserves_life_and_rejects_stale_or_dangling_changes(self):
  before=self.state();self.cmd('apply_life_proposal',version=1,baseSetupVersion=0,proposal={'places':[{'id':'cafe','label':'New cafe','kind':'social'}]});after=self.state()
  self.assertEqual(len(self.c()['lifeProfile']['places']),2)
  for k in ('memories','beliefs','communication'):self.assertEqual(before.get(k),after.get(k))
  self.assertEqual(before['truth']['companion']['lifeRuntime'],self.c()['lifeRuntime'])
  with self.assertRaises(Conflict):self.cmd('apply_life_proposal',version=1,baseSetupVersion=0,proposal={'fashionSense':'different'})
  with self.assertRaises(ValueError):self.cmd('apply_life_proposal',version=1,baseSetupVersion=1,proposal={'weeklySchedule':[{'id':'oops','placeId':'missing'}]})
  self.assertEqual(after,self.state());self.assertEqual(after,self.s.replay(self.w))
 def test_style_proposal_feeds_same_owned_closet(self):
  self.cmd('configure_closet',enabled=True,repetitionPenalty=25,outfitMode='items')
  self.cmd('apply_life_proposal',version=1,baseSetupVersion=self.c().get('vh2SetupVersion',0),proposal={'styleProfiles':[{'id':'home_style','name':'At home','context':'any','pieces':{'top':['Blue tee'],'bottom':['Black shorts']},'tags':['cozy'],'warmth':1}]})
  self.cmd('advance',steps=2);self.assertEqual(len(self.c()['lifeProfile']['world']['items']),2);self.assertTrue(all(i['owned'] for i in self.c()['lifeProfile']['world']['items']))
 def test_owned_food_has_real_consumption_and_no_wardrobe_entry(self):
  ident=self.add('food',servings=1,hungerRelief=20,expiresAt=self.state()['simAt']+3600000,dietaryTags=['vegetarian'])
  hunger=self.c()['humanDynamics']['hunger'];self.cmd('use_possession',itemId=ident);self.assertEqual(self.c()['humanDynamics']['hunger'],max(0,hunger-20));self.assertEqual(self.c()['lifeProfile']['world']['items'][-1]['possession']['servings'],0)
  with self.assertRaises(ValueError):self.cmd('use_possession',itemId=ident)
  self.cmd('advance',steps=1);self.assertEqual(self.c()['lifeProfile']['world']['items'][-1]['category'],'food');self.assertEqual(self.state(),self.s.replay(self.w))
 def test_ticket_requires_location_and_event_time(self):
  now=self.state()['simAt'];ident=self.add('ticket',placeId='home',eventName='Test event',startsAt=now+60000,endsAt=now+86400000)
  with self.assertRaises(ValueError):self.cmd('use_possession',itemId=ident)
  self.cmd('advance',steps=2);self.cmd('use_possession',itemId=ident)
  with self.assertRaises(ValueError):self.cmd('use_possession',itemId=ident)
 def test_vehicle_access_requires_established_ability(self):
  ident=self.add('vehicle',placeId='home',vehicleType='car',canOperate=False)
  with self.assertRaises(ValueError):self.cmd('use_possession',itemId=ident)
  ident=self.add('vehicle',placeId='home',vehicleType='car',canOperate=True);self.assertFalse(self.c()['lifeProfile']['world']['transport']['car']);self.cmd('use_possession',itemId=ident);self.assertTrue(self.c()['lifeProfile']['world']['transport']['car'])
 def test_gift_food_cannot_be_consumed_before_receipt(self):
  self.cmd('add_gift_item',name='Dinner',category='food',possession={'servings':2,'hungerRelief':20,'expiresAt':self.state()['simAt']+3600000})
  ident=self.c()['lifeProfile']['world']['items'][-1]['id']
  with self.assertRaises(ValueError):self.cmd('use_possession',itemId=ident)
  self.assertEqual(self.s.context(self.w)['possessions'],[])
 def test_explicit_clothing_mode_survives_advance(self):
  self.cmd('configure_closet',enabled=False,outfitMode='presets',repetitionPenalty=12)
  self.cmd('advance',steps=1);self.assertEqual(self.c()['lifeProfile']['world']['closet']['mode'],'presets')
  self.cmd('configure_closet',enabled=True,outfitMode='items',repetitionPenalty=12)
  self.cmd('advance',steps=1);self.assertEqual(self.c()['lifeProfile']['world']['closet']['mode'],'items')
  with self.assertRaises(ValueError):self.cmd('configure_closet',enabled=True,outfitMode='presets',repetitionPenalty=12)
 def test_owned_garment_edit_and_archive_are_persistent(self):
  ident=self.add('top');self.cmd('update_owned_item',itemId=ident,name='Linen shirt',category='top',tags=['casual'],photo='')
  item=self.c()['lifeProfile']['world']['items'][-1];self.assertEqual(item['name'],'Linen shirt');self.assertTrue(item['owned'])
  self.cmd('archive_owned_item',itemId=ident);self.cmd('advance',steps=1)
  self.assertTrue(self.c()['lifeProfile']['world']['items'][-1]['archived']);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_remove_routine_preserves_history_and_checks_version(self):
  self.cmd('apply_life_proposal',version=1,baseSetupVersion=0,proposal={'weeklySchedule':[{'id':'shift','activity':'Morning work','days':[1],'startMinute':540,'endMinute':600,'placeId':'home'}]})
  before=self.c()['lifeRuntime']
  with self.assertRaises(Conflict):self.cmd('remove_life_entry',section='weeklySchedule',entryId='shift',baseSetupVersion=0)
  self.cmd('remove_life_entry',section='weeklySchedule',entryId='shift',baseSetupVersion=1)
  self.assertEqual(self.c()['lifeProfile']['weeklySchedule'],[]);self.assertEqual(before,self.c()['lifeRuntime']);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_room_reference_generation_is_owned_by_room(self):
  self.cmd('save_place_zone',placeId='home',label='Bedroom',description='Blue walls');zone=self.c()['vh2Visual']['zones'][0]
  self.cmd('capture_reference',role='zone',entityId=zone['id'],view='establishing',description='Blue bedroom')
  self.assertEqual(self.state()['photos'][-1]['photoContext']['assetStudy']['entityId'],zone['id'])
 def test_executable_builder_bundle_and_replay(self):
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=0,proposal={'finance':{'enabled':True,'incomePerHour':5,'dailyIncome':10,'dailyExpense':3,'workPlaceIds':['home']},'sleepPolicy':{'enabled':True,'sleepNeedHours':9},'breakPolicy':{'enabled':True,'foodAvailable':False},'rooms':[{'id':'bedroom','placeId':'home','label':'Bedroom','description':'Blue walls'}],'referencePlan':[{'id':'room_view','role':'zone','entityId':'bedroom','view':'establishing','label':'Bedroom view','description':'Blue walls, neutral daylight'}]})
  self.assertEqual(self.c()['vh2Finance']['policy']['dailyIncome'],10)
  self.assertEqual(self.c()['lifeProfile']['sleepPolicy']['sleepNeedHours'],9)
  self.assertEqual(self.c()['vh2ReferencePlan'][0]['entityId'],'bedroom')
  self.cmd('advance',steps=2)
  self.assertEqual(self.c()['vh2ReferencePlan'][0]['id'],'room_view')
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_builder_independent_person_and_exploration(self):
  from vh2_people_service_audit import POLICY
  policy={**POLICY,'leisurePlaceIds':['home']}
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=0,proposal={'socialCircle':[{'id':'sam','name':'Sam'}],'peopleLives':[{'personId':'sam','policy':policy,'initialPlaceId':'home','startingBalance':40}],'exploration':{'enabled':True,'interests':[],'curiosity':50,'sociability':50,'minEnergy':40,'maxHunger':70,'maxStress':80,'cooldownHours':4,'maxTravelMinutes':30,'stayMinutes':45,'threshold':20}})
  self.assertEqual(self.c()['vh2People']['actors']['sam']['policy']['curiosity'],90)
  self.assertTrue(self.c()['vh2Exploration']['policy']['enabled'])
  self.cmd('advance',steps=2);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_invalid_last_builder_section_rolls_back_everything(self):
  before=self.s.projection(self.w)
  with self.assertRaises(ValueError):self.cmd('apply_life_proposal',version=2,baseSetupVersion=0,proposal={'sleepPolicy':{'sleepNeedHours':9},'finance':{'enabled':True,'incomePerHour':5,'dailyIncome':10,'dailyExpense':3,'workPlaceIds':['home']},'rooms':[{'id':'bedroom','placeId':'home','label':'Bedroom','description':'Blue'}],'referencePlan':[{'id':'bad','role':'zone','entityId':'missing','view':'establishing','label':'Bad','description':'Bad'}]})
  self.assertEqual(before,self.s.projection(self.w));self.assertEqual(self.state(),self.s.replay(self.w))
if __name__=='__main__':unittest.main(verbosity=2)
