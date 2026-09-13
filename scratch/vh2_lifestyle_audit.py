"""Place clocks, relocation preconditions and unified owned garment creation."""
from test_runtime import node_executable
import sys,tempfile,unittest,uuid,json,platform,shutil
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService,Conflict
ROOT=Path(__file__).resolve().parents[1]
NODE=node_executable(ROOT)
class Lifestyle(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=WorldService(Path(self.tmp.name)/'x.sqlite',NODE,ROOT,clock=lambda:1788764400000)
  self.w=self.s.command(dict(schemaVersion=1,key='create',type='create_profile',name='Alex',profile={'age':28,'lifeProfile':{'places':[{'id':'home','kind':'home','label':'Home'},{'id':'away','kind':'home','label':'Other home'}],'sleepPolicy':{'enabled':False},'weeklySchedule':[],'world':{'transport':{'enabled':True}}}},providerScope='horde:alex',personaId='player:alex'))['worldId']
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def cmd(self,kind,**kw):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kw))
 def test_place_context_and_no_relocation_teleport(self):
  self.cmd('configure_place_context',placeId='away',timeZone='Asia/Karachi',city='Karachi',country='Pakistan');self.cmd('set_hometown',placeId='away')
  with self.assertRaises(Conflict):self.cmd('set_residence',placeId='away')
  self.cmd('configure_place_context',placeId='home',timeZone='Europe/London',city='London',country='UK');self.assertEqual(self.state()['truth']['companion']['vh2Travel']['currentContext']['city'],'London');self.assertEqual(self.state(),self.s.replay(self.w))
 def test_closet_styles_create_owned_items_without_spending(self):
  self.cmd('add_closet_style',name='Everyday',context='any',tags=['casual'],warmth=1,pieces={'top':['White cotton tee','Blue cotton tee'],'bottom':['Dark jeans','Khaki shorts']});self.cmd('configure_closet',enabled=True,repetitionPenalty=12)
  before=self.state()['truth']['companion']['lifeRuntime']['world']['balance'];self.cmd('advance',steps=2);c=self.state()['truth']['companion'];self.assertEqual(len(c['lifeProfile']['world']['items']),2);self.assertTrue(all(i['owned'] for i in c['lifeProfile']['world']['items']));self.assertEqual(c['lifeRuntime']['world']['balance'],before);self.assertEqual(len(c['lifeRuntime']['world']['outfit']['ids']),2);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_procedural_colors_survive_reload_without_duplicate_items(self):
  self.cmd('add_closet_style',name='Everyday',context='any',tags=['casual'],warmth=1,pieces={'top':['cotton tee'],'bottom':['linen shorts']})
  self.cmd('configure_closet',enabled=True,repetitionPenalty=12,outfitMode='items')
  self.cmd('advance',steps=2)
  c=self.state()['truth']['companion'];items=c['lifeProfile']['world']['items'];names=[i['name'] for i in items]
  self.assertEqual(len(items),2);self.assertNotIn('cotton tee',names);self.assertNotIn('linen shorts',names)
  self.cmd('advance',steps=3);c=self.state()['truth']['companion']
  self.assertEqual([i['name'] for i in c['lifeProfile']['world']['items']],names)
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_style_draft_does_not_override_authored_outfits(self):
  self.cmd('configure_closet',enabled=False,repetitionPenalty=12,outfitMode='presets')
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=self.state()['truth']['companion'].get('vh2SetupVersion',0),proposal={'wardrobe':[{'id':'sage','label':'Home look','context':'home','items':'Sage linen shirt, dark indigo jeans, tan leather sandals','notes':''}], 'styleProfiles':[{'id':'style','name':'Options','context':'any','tags':[],'warmth':1,'pieces':{'top':['crop top'],'bottom':['mini skirt']}}]})
  self.cmd('advance',steps=2)
  c=self.state()['truth']['companion']
  self.assertEqual(c['lifeProfile']['world']['closet']['mode'],'presets')
  self.assertFalse(c['vh2Closet']['enabled'])
  self.assertEqual(c['lifeRuntime']['world']['outfit']['label'],'Sage linen shirt, dark indigo jeans, tan leather sandals')
  self.assertEqual(c['lifeRuntime']['world']['outfit']['presetId'],'sage')
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_live_routing_policy_is_saved_and_replayable(self):
  self.cmd('configure_live_routing',enabled=True)
  self.assertTrue(self.state()['truth']['companion']['lifeProfile']['world']['transport']['liveRouting'])
  self.cmd('configure_live_routing',enabled=False)
  self.assertFalse(self.state()['truth']['companion']['lifeProfile']['world']['transport']['liveRouting'])
  self.assertEqual(self.state(),self.s.replay(self.w))
  with self.assertRaises(ValueError):self.cmd('configure_live_routing',enabled='false')
 def test_saved_places_routes_and_arrival_before_residence_change(self):
  self.cmd('upsert_place',place={'id':'visit','label':'New residence','kind':'home','longitude':67,'latitude':24.9})
  self.cmd('configure_place_context',placeId='visit',timeZone='Asia/Karachi',city='Karachi',country='Pakistan')
  self.cmd('record_route',**{'from':'home','to':'visit','mode':'WALK','minutes':1,'cost':0})
  self.cmd('plan_trip',label='Move',stops=[{'placeId':'visit','stayMinutes':60}]);self.cmd('advance',steps=2)
  self.cmd('set_residence',placeId='visit');c=self.state()['truth']['companion']
  self.assertEqual(c['lifeRuntime']['world']['placeId'],'visit');self.assertEqual(c['vh2Travel']['residenceId'],'visit');self.assertEqual(c['vh2Travel']['currentContext']['timeZone'],'Asia/Karachi');self.assertEqual(self.state(),self.s.replay(self.w))
 def seed_debt(self):
  projection=self.s.projection(self.w);before=projection['state'];after=json.loads(json.dumps(before));c=after['truth']['companion'];c['lifeRuntime']['world']['balance']=80;c['vh2Finance']['unpaid']=100;c['vh2Finance']['trackedBalance']=80
  with self.s.connect() as db:self.s.commit_event(db,self.w,projection['revision'],before,after,'FIXTURE_DEBT')
 def test_debt_payment_is_exact_idempotent_and_replayable(self):
  self.seed_debt();body=dict(schemaVersion=1,key='pay-once',type='settle_expenses',worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],amount=25.25,currency='USD')
  self.s.command(body);self.s.command(body);c=self.state()['truth']['companion'];self.assertEqual(c['lifeRuntime']['world']['balance'],54.75);self.assertEqual(c['vh2Finance']['unpaid'],74.75);self.assertEqual(c['vh2Finance']['ledger'][-1]['amountMinor'],-2525);self.assertEqual(self.state(),self.s.replay(self.w));self.assertEqual(self.s.context(self.w)['ownFinances']['unpaidExpenses'],74.75)
 def test_debt_cannot_be_overpaid_or_relabelled(self):
  self.seed_debt();before=self.state()
  for amount in (-1,0,0.001,81,float('nan'),True):
   with self.assertRaises(ValueError):self.cmd('settle_expenses',amount=amount,currency='USD')
  with self.assertRaises(ValueError):self.cmd('settle_expenses',amount=1,currency='GBP')
  with self.assertRaises(Conflict):self.cmd('configure_gifts',currency='GBP',policy=before['truth']['companion']['lifeProfile']['world']['gifts'])
  self.assertEqual(self.state(),before)
 def test_finance_configuration_cannot_reset_cash(self):
  self.cmd('configure_finances',policy={'enabled':True,'incomePerHour':15,'dailyIncome':0,'dailyExpense':25,'workPlaceIds':['home']});self.cmd('advance',steps=2);c=self.state()['truth']['companion'];self.assertFalse(any(e['kind']=='earned_income' for e in c['vh2Finance']['ledger']));self.assertEqual(self.state(),self.s.replay(self.w))
 def test_wardrobe_save_during_journey_preserves_travel(self):
  p=self.s.projection(self.w);before=p['state'];after=json.loads(json.dumps(before));journey={'from':'home','to':'away','mode':'WALK','startedAt':1788764400000,'endsAt':1788768000000}
  after['truth']['companion']['lifeRuntime']['world']['journey']=journey
  with self.s.connect() as db:self.s.commit_event(db,self.w,p['revision'],before,after,'FIXTURE_JOURNEY')
  version=self.state()['truth']['companion'].get('vh2SetupVersion',0)
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=version,proposal={'wardrobe':[{'id':'saved_on_walk','label':'Linen outfit','context':'social','items':'Blue linen shirt and cream trousers'}]})
  c=self.state()['truth']['companion'];self.assertTrue(any(x['id']=='saved_on_walk' for x in c['lifeProfile']['wardrobe']));self.assertEqual(c['lifeRuntime']['world']['journey'],journey)
  with self.assertRaises(Conflict):self.cmd('apply_life_proposal',version=2,baseSetupVersion=c['vh2SetupVersion'],proposal={'places':[{'id':'home','mapCoordinates':[5,5]}]})
  self.assertEqual(self.state(),self.s.replay(self.w))
if __name__=='__main__':unittest.main(verbosity=2)
