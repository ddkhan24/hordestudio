import ast,base64,json,re,secrets,time,urllib.parse,unittest
from pathlib import Path
from unittest.mock import Mock
ROOT=Path(__file__).resolve().parents[1]
class References(unittest.TestCase):
 def setup(self):
  names={'comfy_generate','multipart_image','set_workflow_input','detect_workflow_input'}
  tree=ast.parse((ROOT/'horde_mcp_bridge.py').read_text())
  module=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0)]+[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names],type_ignores=[])
  calls=[]
  def request(url,method='GET',**kw):
   if url.endswith('/prompt'):calls.append(kw['payload']);return 200,{}, {'prompt_id':'job'}
   return 200,{}, {'job':{'outputs':{'out':{'images':[{'filename':'out.png'}]}}}}
  env=dict(base64=base64,json=json,re=re,secrets=secrets,time=Mock(time=time.time,sleep=lambda _:None),urllib=urllib,loopback_base_url=lambda *a:'http://localhost:8188',json_request=request,http_request=Mock(side_effect=[(200,{},b'{"name":"a.png","subfolder":"refs"}'),(200,{},b'{"name":"b.png"}')]),download_image=lambda _: 'result')
  exec(compile(ast.fix_missing_locations(module),'bridge','exec'),env)
  workflow={'1':{'class_type':'CLIPTextEncode','inputs':{'text':''}},'2':{'class_type':'LoadImage','inputs':{'image':''}},'3':{'class_type':'LoadImage','inputs':{'image':''}}}
  return env,calls,dict(workflow=workflow,prompt='test',references=['data:image/png;base64,aGVsbG8=']*2)
 def test_two_references(self):
  e,c,b=self.setup();self.assertEqual(e['comfy_generate'](b),'result');self.assertEqual(c[0]['prompt']['2']['inputs']['image'],'refs/a.png');self.assertEqual(c[0]['prompt']['3']['inputs']['image'],'b.png')
 def test_one_input_faceid_request(self):
  e,c,b=self.setup();b['mapping']={'referenceNode':'2'};b['references']=b['references'][:1];b['referenceSources']=['Character portrait / FaceID']
  self.assertEqual(e['comfy_generate'](b),'result');self.assertEqual(e['http_request'].call_count,1);self.assertEqual(c[0]['prompt']['2']['inputs']['image'],'refs/a.png')
 def test_capacity_before_upload(self):
  e,c,b=self.setup();b['mapping']={'referenceNode':'2'}
  b['referenceSources']=['Character portrait / FaceID','Previous generated photo from this conversation']
  with self.assertRaisesRegex(ValueError,'1. Character portrait / FaceID; 2. Previous generated photo from this conversation'):e['comfy_generate'](b)
  e['http_request'].assert_not_called();self.assertEqual(c,[])
 def test_untrusted_reference_label_is_not_echoed_as_an_image(self):
  e,c,b=self.setup();b['mapping']={'referenceNode':'2'};b['referenceSources']=['data:image/png;base64,SECRET','Saved place: Bedroom']
  with self.assertRaisesRegex(ValueError,'1. source not recorded; 2. Saved place: Bedroom') as caught:e['comfy_generate'](b)
  self.assertNotIn('SECRET',str(caught.exception))
 def test_invalid_data_before_upload(self):
  e,c,b=self.setup();b['references'][1]='assets/photo.png'
  with self.assertRaisesRegex(ValueError,'base64'):e['comfy_generate'](b)
  e['http_request'].assert_not_called()
if __name__=='__main__':unittest.main()
