"""Provider-neutral background requests; exact reference mapping, no silent fallback."""
import copy,json,math,re,urllib.request,urllib.parse,urllib.error
from vh2_provider import NoRedirect,UnknownOutcome,RejectedOutput

def safe_error_detail(error,secrets=()):
 text=str(error)
 for secret in secrets:
  if isinstance(secret,str) and secret:text=text.replace(secret,'[redacted]')
 text=re.sub(r'data:[^\s,]+,[A-Za-z0-9+/=]+','[image data]',text,flags=re.I)
 text=re.sub(r'https?://[^\s<>\"\']+','[URL]',text,flags=re.I)
 text=re.sub(r'\bBearer\s+[^\s,;\"\']+','Bearer [redacted]',text,flags=re.I)
 text=re.sub(r'(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password)\b[\"\']?\s*[:=]\s*[\"\']?)[^\s,;\"\']+',r'\1[redacted]',text,flags=re.I)
 return re.sub(r'\s+',' ',text).strip()[:280] or 'No further provider details were returned.'

def _validate(value,descriptor,path):
 """Validate advertised primitive/container constraints before any paid call."""
 kind=descriptor.get('type')
 matches={'string':isinstance(value,str),'number':type(value) in (int,float) and math.isfinite(value),'integer':type(value) is int,'boolean':type(value) is bool,'object':isinstance(value,dict),'array':isinstance(value,list),'null':value is None}
 if kind and not any(matches.get(k,True) for k in (kind if isinstance(kind,list) else [kind])):raise RejectedOutput('Invalid MCP field type: '+path)
 if 'enum' in descriptor and value not in descriptor['enum']:raise RejectedOutput('Unsupported MCP field value: '+path)
 if type(value) in (int,float):
  if not math.isfinite(value) or 'minimum' in descriptor and value<descriptor['minimum'] or 'maximum' in descriptor and value>descriptor['maximum']:raise RejectedOutput('Invalid MCP number: '+path)
 if isinstance(value,str) and (len(value)<descriptor.get('minLength',0) or len(value)>descriptor.get('maxLength',float('inf'))):raise RejectedOutput('Invalid MCP text length: '+path)
 if isinstance(value,list):
  if len(value)<descriptor.get('minItems',0) or len(value)>descriptor.get('maxItems',float('inf')):raise RejectedOutput('Invalid MCP item count: '+path)
  for i,item in enumerate(value):_validate(item,descriptor.get('items',{}),path+'['+str(i)+']')
 if isinstance(value,dict):
  properties=descriptor.get('properties',{})
  for required in descriptor.get('required',[]):
   if required not in value:raise RejectedOutput('Configure required MCP field: '+path+'.'+required)
  for key,item in value.items():
   if descriptor.get('additionalProperties') is False and key not in properties:raise RejectedOutput('Unsupported MCP field: '+path+'.'+key)
   if key in properties:_validate(item,properties[key],path+'.'+key)

def mcp_arguments(config,body,tool):
 root=tool.get('inputSchema',{});nested=root.get('properties',{}).get('params',{});wrapper='params' if nested.get('properties') else '';schema=nested if wrapper else root;p=schema.get('properties',{})
 prompt=next((k for k in ('prompt','text','description','positive_prompt') if k in p),None)
 if not prompt:raise RejectedOutput('The selected tool has no supported prompt field.')
 args=copy.deepcopy(config.get('arguments',{}));args=args.get(wrapper,args) if wrapper else args
 model_field=next((k for k in ('model','model_id','modelId','model_name') if k in p),None)
 if not model_field and 'mode' in p and (tool.get('_models') or 'model' in p['mode'].get('description','').lower()):model_field='mode'
 if config.get('model') and config['model']!='provider default':
  if not model_field:raise RejectedOutput('The selected tool has no model field. Use its configured route default instead of a model ID.')
  args[model_field]=config['model']
 refs=[r['image_url']['url'] for r in body.get('input_references',[])]
 keys=('references','medias','image_urls','imageUrls','images','image_url','imageUrl','image','reference_images','referenceImage')
 for key in keys:args.pop(key,None)
 args[prompt]=body['prompt'];key=next((k for k in keys if k in p),None)
 if refs:
  if not key:raise RejectedOutput('The selected tool cannot accept frozen references.')
  d=p[key];array=d.get('type')=='array';item=d.get('items',{}) if array else d
  if len(refs)>d.get('maxItems',20) or not array and len(refs)>1:raise RejectedOutput('Tool reference capacity exceeded.')
  mapped=[]
  for value in refs:
   if key=='medias':entry={'role':'image','value':value}
   elif key=='references' and 'identifier' in item.get('properties',{}) and 'image' in item.get('properties',{}).get('type',{}).get('enum',[]):entry={'type':'image','identifier':value}
   elif item.get('type')=='object' or item.get('properties'):
    field=next((k for k in ('url','image_url','imageUrl','uri') if k in item.get('properties',{})),None)
    if not field:raise RejectedOutput('Unsupported reference object schema.')
    entry={field:value}
    for required in item.get('required',[]):
     if required==field:continue
     if 'default' not in item['properties'].get(required,{}):raise RejectedOutput('Reference requires an unmapped field.')
     entry[required]=item['properties'][required]['default']
   else:entry=value
   mapped.append(entry)
  args[key]=mapped if array else mapped[0]
 for key,d in p.items():
  if key not in args and 'default' in d:args[key]=d['default']
  if key in ('count','n','num_images','numImages'):args[key]=1
 if not schema.get('additionalProperties'):args={k:v for k,v in args.items() if k in p}
 for key in schema.get('required',[]):
  if args.get(key) is None or args.get(key)=='':raise RejectedOutput('Configure required MCP field: '+key)
 for key,value in args.items():
  _validate(value,p.get(key,{}),key)
 return {wrapper:args} if wrapper else args

def gemini(config,key,body):
 parts=[{'text':body['prompt']}]
 for ref in body.get('input_references',[]):
  header,data=ref['image_url']['url'].split(',',1);parts.append({'inlineData':{'mimeType':header[5:].split(';')[0],'data':data}})
 payload={'contents':[{'role':'user','parts':parts}],'generationConfig':{'responseModalities':['TEXT','IMAGE']}}
 url='https://generativelanguage.googleapis.com/v1beta/models/'+urllib.parse.quote(config['model'],safe='')+':generateContent'
 request=urllib.request.Request(url,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','x-goog-api-key':key},method='POST')
 try:
  with urllib.request.build_opener(NoRedirect()).open(request,timeout=180) as response:
   raw=response.read(16000001)
   if len(raw)>16000000:raise RejectedOutput('Image response is too large.')
   data=json.loads(raw)
  for candidate in data.get('candidates',[]):
   for part in candidate.get('content',{}).get('parts',[]):
    inline=part.get('inlineData',part.get('inline_data',{}));mime=inline.get('mimeType',inline.get('mime_type'))
    if mime in ('image/png','image/jpeg','image/webp') and isinstance(inline.get('data'),str):return 'data:'+mime+';base64,'+inline['data']
  raise RejectedOutput('Gemini returned no supported image.')
 except urllib.error.HTTPError as error:raise RejectedOutput('Gemini returned HTTP '+str(error.code)) from None
 except RejectedOutput:raise
 except Exception:raise UnknownOutcome('Gemini submission outcome is unknown; no automatic retry.') from None
