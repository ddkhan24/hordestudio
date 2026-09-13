"""Offline regression checks for visual versions, provider routing and workspace recovery."""
from test_runtime import node_executable
import sys,pathlib,tempfile,unittest,base64,json,uuid,copy
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService,Conflict
from vh2_provider import RejectedOutput
import vh2_backup,vh2_image_adapters,vh2_workers,vh2_visual
import io,zipfile,datetime
from unittest.mock import patch
import vh2_gtfs
ROOT=pathlib.Path(__file__).resolve().parents[1]
class Gaps(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=WorldService(pathlib.Path(self.tmp.name)/'a',node_executable(ROOT),ROOT,clock=lambda:1789030800000);self.w=self.s.command(dict(schemaVersion=1,key='create',type='create',name='Alex'))['worldId']
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def cmd(self,kind,**body):return self.s.command(dict(schemaVersion=1,key=str(uuid.uuid4()),type=kind,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**body))
 def test_zones_and_outfit_versions_are_stable_and_frozen(self):
  before=self.state()['truth']['companion']['vh2Visual']['outfitRevision'];self.cmd('configure_player_profile',profile={'name':'Sam','text':'Hello','templateId':''});self.assertEqual(self.state()['truth']['companion']['vh2Visual']['outfitRevision'],before)
  self.cmd('save_place_zone',placeId='home',label='Bedroom',description='Blue walls',zoneId='bed');self.cmd('enter_place_zone',zoneId='bed');pid=self.cmd('capture_photo',scene='A quiet room',destination='gallery')['photoId'];ctx=self.state()['photos'][0]['photoContext'];self.assertEqual(ctx['zoneId'],'bed');self.assertEqual(ctx['zoneRevision'],1)
  self.cmd('save_place_zone',placeId='home',label='Bedroom',description='New lamp',zoneId='bed');self.assertEqual(self.state()['photos'][0]['photoContext'],ctx);self.assertEqual(self.state(),self.s.replay(self.w))
 def test_mcp_reference_roles_and_no_silent_drop(self):
  tool={'inputSchema':{'properties':{'prompt':{'type':'string'},'references':{'type':'array','maxItems':2,'items':{'type':'object','properties':{'identifier':{'type':'string'},'type':{'enum':['image']}}}}},'required':['prompt']}}
  body={'prompt':'test','input_references':[{'image_url':{'url':'data:image/png;base64,AAAA'}}]};args=vh2_image_adapters.mcp_arguments({},body,tool);self.assertEqual(args['references'][0],{'type':'image','identifier':'data:image/png;base64,AAAA'})
  tool['inputSchema']['properties'].pop('references')
  with self.assertRaises(RejectedOutput):vh2_image_adapters.mcp_arguments({},body,tool)
 def test_provider_change_does_not_reuse_another_key(self):
  common={'scope':'horde:x','enabled':True,'model':'fixture','apiKey':'PRIVATE'};vh2_workers.settings(self.s,common)
  with self.assertRaises(ValueError):vh2_workers.settings(self.s,{**common,'provider':'gemini','apiKey':''})
  response=vh2_workers.settings(self.s,{**common,'provider':'magnific','apiKey':'','tool':'images_generate'});self.assertFalse(response['hasKey']);self.assertNotIn('PRIVATE',str(response))
 def test_selected_background_model_reaches_live_model_field(self):
  tool={'inputSchema':{'properties':{'prompt':{'type':'string'},'mode':{'type':'string','description':'Selected model slug'}}}}
  args=vh2_image_adapters.mcp_arguments({'model':'selected-model','arguments':{'mode':'old-model'}},{'prompt':'Room'},tool)
  self.assertEqual(args['mode'],'selected-model')
 def test_workspace_restore_rolls_back_whole_batch(self):
  encoded=base64.b64encode(vh2_backup.export(self.s,self.w)).decode();dest=WorldService(pathlib.Path(self.tmp.name)/'b',node_executable(ROOT),ROOT,clock=lambda:1789030800000)
  try:
   with self.assertRaises(Conflict):vh2_backup.restore_workspace(dest,[encoded,encoded])
   self.assertEqual(dest.status()['worlds'],[])
   result=vh2_backup.restore_workspace(dest,[encoded]);self.assertEqual(len(result['worlds']),1);self.assertFalse(dest.projection(self.w)['state']['running'])
  finally:dest.close()
 def seed_catalog(self):
  p=self.s.projection(self.w);after=copy.deepcopy(p['state']);c=after['truth']['companion'];c['lifeRuntime']['world']['balance']=100;c['vh2Finance']['trackedBalance']=100
  c['lifeProfile']['world']['items'].append({'id':'coat','name':'Blue coat','category':'outerwear','owned':False,'tags':['warm'],'photo':'','warmth':3,'incompatible':[]})
  c['lifeProfile']['wardrobe'].append({'id':'old-look','context':'casual','items':'White tee and jeans'})
  with self.s.connect() as db:self.s.commit_event(db,self.w,p['revision'],p['state'],after,'FIXTURE_CATALOG')
 def test_purchase_uses_recorded_fx_and_exact_ledger(self):
  self.seed_catalog()
  with patch('vh2_feeds.fetch',return_value=json.dumps({'base':'GBP','date':'2026-09-10','rates':{'USD':1.25}}).encode()):self.cmd('refresh_fx_rate',currency='GBP')
  self.cmd('purchase_item',itemId='coat',amount=12.34,currency='GBP');c=self.state()['truth']['companion']
  self.assertEqual(c['lifeRuntime']['world']['balance'],84.57);self.assertEqual(c['vh2Finance']['ledger'][-1]['amountMinor'],-1543);self.assertEqual(c['vh2Commerce']['purchases'][-1]['originalAmount'],12.34)
  with self.assertRaises(ValueError):self.cmd('purchase_item',itemId='coat',amount=12.34,currency='GBP')
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_purchase_and_conversion_fail_without_partial_mutation(self):
  self.seed_catalog();before=self.state()
  with self.assertRaises(ValueError):self.cmd('purchase_item',itemId='coat',amount=10,currency='GBP')
  with self.assertRaises(ValueError):self.cmd('convert_wardrobe_preset',presetId='old-look',pieces=[{'category':'top','name':'White tee'}])
  self.assertEqual(before,self.state());self.cmd('convert_wardrobe_preset',presetId='old-look',pieces=[{'category':'top','name':'White tee'},{'category':'bottom','name':'Jeans'}]);c=self.state()['truth']['companion']
  self.assertEqual(len([i for i in c['lifeProfile']['world']['items'] if i.get('sourcePresetId')=='old-look']),2)
  with self.assertRaises(ValueError):self.cmd('convert_wardrobe_preset',presetId='old-look',pieces=[{'category':'dress','name':'Dress'}])
  self.cmd('advance',steps=1);c=self.state()['truth']['companion'];conversion=c['vh2Commerce']['conversions'][0]
  self.assertEqual(conversion['presetId'],'old-look');self.assertTrue(set(conversion['itemIds'])<={i['id'] for i in c['lifeProfile']['world']['items']})
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_gtfs_service_day_calendar_and_explicit_mapping(self):
  buf=io.BytesIO()
  with zipfile.ZipFile(buf,'w') as z:
   for name,data in {'agency.txt':'agency_timezone\nEurope/London\n','routes.txt':'route_id,route_type,route_short_name\nr,2,Train\n','trips.txt':'route_id,service_id,trip_id\nr,s,t\n','calendar_dates.txt':'service_id,date,exception_type\ns,20260909,1\n','stop_times.txt':'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt,25:10:00,25:10:00,a,1\nt,25:40:00,25:40:00,b,2\n'}.items():z.writestr(name,data)
  now=int(datetime.datetime(2026,9,10,0,0,tzinfo=datetime.timezone.utc).timestamp()*1000);source={'id':'rail','url':'https://example.org/rail.zip','stopMappings':{'a':'station-a','b':'station-b'},'fare':4}
  services=vh2_gtfs.parse(buf.getvalue(),source,now);self.assertEqual(len(services),1);self.assertEqual(services[0]['departsAt'],now+10*60000);self.assertEqual(services[0]['arrivesAt'],now+40*60000);self.assertEqual(services[0]['from'],'station-a');self.assertEqual(services[0]['fareSource'],'authored_estimate')
  source['stopMappings']={'a':'station-a'};self.assertEqual(vh2_gtfs.parse(buf.getvalue(),source,now),[])
if __name__=='__main__':unittest.main(verbosity=2)
