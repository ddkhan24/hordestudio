"""Durable, bounded route and image jobs; no automatic paid resubmission."""
import base64,concurrent.futures,hashlib,json,math,re,urllib.request,urllib.error,uuid
from vh2_provider import NoRedirect,UnknownOutcome,RejectedOutput
SCHEMA='''CREATE TABLE IF NOT EXISTS vh2_service_providers(id TEXT PRIMARY KEY,scope TEXT NOT NULL,config TEXT NOT NULL,api_key TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS vh2_provider_jobs(id TEXT PRIMARY KEY,world_id TEXT NOT NULL REFERENCES worlds(id),kind TEXT NOT NULL,status TEXT NOT NULL,snapshot TEXT NOT NULL,result TEXT,error TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,submitted_at INTEGER,finished_at INTEGER);
CREATE TABLE IF NOT EXISTS vh2_provider_outputs(job_id TEXT PRIMARY KEY REFERENCES vh2_provider_jobs(id),image TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS vh2_service_provider_immutable BEFORE UPDATE ON vh2_service_providers BEGIN SELECT RAISE(ABORT,'Provider versions are immutable'); END;'''
COMMANDS=('queue_photo_render','dismiss_photo_render','retry_photo_render')
def current(db,scope):
 row=db.execute('SELECT * FROM vh2_service_providers WHERE scope=? ORDER BY rowid DESC LIMIT 1',(scope,)).fetchone()
 return dict(row) if row else None

def autonomous_budget(db,scope,config,now):
 # Reserve a daily attempt when autonomous work is queued, so simultaneous
 # worlds sharing a profile cannot overspend. Explicit user requests have
 # their own authorization and neither consume nor depend on this allowance.
 day=now//86400000*86400000;reset=day+86400000
 used=db.execute("SELECT COUNT(*) FROM vh2_provider_jobs WHERE kind='image' AND created_at>=? AND created_at<? AND json_extract(snapshot,'$.scope')=? AND json_extract(snapshot,'$.automatic')=1",(day,reset,scope)).fetchone()[0]
 limit=config['dailyLimit']
 return {'used':used,'limit':limit,'remaining':max(0,limit-used),'resetsAt':reset}

def retry_photo_id(key):return str(uuid.uuid5(uuid.NAMESPACE_URL,'vh2-photo-retry:'+key))

IMAGE_PARAMETER_KEYS=frozenset(('resolution','aspect_ratio','size','quality','output_format','background','output_compression','seed'))
def image_options(config):
 """Keep supported visual controls without exposing request/auth overrides."""
 parameters=config.get('imageParameters',{});options=config.get('imageProviderOptions',{})
 tag=config.get('imageProviderTag','');slug=config.get('imageProviderSlug','')
 for value,name in ((parameters,'image parameters'),(options,'provider options')):
  if not isinstance(value,dict):raise ValueError('Choose a valid object for '+name+'.')
  try:raw=json.dumps(value,allow_nan=False)
  except (TypeError,ValueError,RecursionError):raise ValueError('Invalid '+name+'.') from None
  if len(raw.encode())>30000:raise ValueError('The '+name+' are too large.')
 if not isinstance(tag,str) or tag and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]{0,159}',tag):raise ValueError('Choose a supported image provider endpoint.')
 if not isinstance(slug,str) or slug and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,119}',slug):raise ValueError('Choose a supported image provider slug.')
 for key,value in parameters.items():
  if key not in IMAGE_PARAMETER_KEYS:raise ValueError('Unsupported image parameter: '+str(key)[:80]+'.')
  if key in ('seed','output_compression'):
   if type(value) is not int or not (0 if key=='output_compression' else -9007199254740991)<=value<=(100 if key=='output_compression' else 9007199254740991):raise ValueError('Choose a valid '+key+' value.')
  elif isinstance(value,str):
   if not value or len(value)>120 or not re.fullmatch(r'[A-Za-z0-9_.:+/ -]+',value) or re.search(r'https?://|data:',value,re.I):raise ValueError('Choose a supported '+key+' value.')
  elif type(value) not in (int,float,bool) or type(value) is float and not math.isfinite(value):raise ValueError('Choose a supported '+key+' value.')
 protected={'prompt','text','description','positiveprompt','model','modelid','modelname','n','count','numimages','numberofimages','image','images','inputreferences','references','referenceimages','referenceimage','headers','authorization','auth','apikey','accesstoken','refreshtoken','token','password','secret','provider','allowfallbacks','stream','callback','webhook','baseurl','endpoint','proto','prototype','constructor'}
 def inspect(value,depth=0):
  if depth>4:raise ValueError('Image provider options are nested too deeply.')
  if isinstance(value,dict):
   if len(value)>40:raise ValueError('Too many image provider options.')
   for key,item in value.items():
    if not isinstance(key,str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,80}',key):raise ValueError('Invalid image provider option name.')
    normalized=re.sub(r'[^a-z0-9]','',key.lower())
    if normalized in protected or normalized.endswith(('url','uri','apikey','token','password','secret')) or any(re.sub(r'[^a-z0-9]','',part.lower()) in protected for part in key.split('.')):raise ValueError('Image provider options cannot override prompts, models, references, counts, routing or credentials.')
    inspect(item,depth+1)
  elif isinstance(value,list):
   if len(value)>30:raise ValueError('Too many image provider option values.')
   for item in value:inspect(item,depth+1)
  elif isinstance(value,str):
   if len(value)>2000 or re.search(r'https?://|data:|\bBearer\s',value,re.I):raise ValueError('Image provider options cannot contain URLs or credentials.')
  elif type(value) not in (int,float,bool) or type(value) is float and not math.isfinite(value):raise ValueError('Invalid image provider option value.')
 inspect(options)
 provider=config.get('provider','openrouter')
 if provider=='openrouter':
  if options and (not tag or not slug):raise ValueError('Select an image provider endpoint before using its advanced options.')
  if re.fullmatch(r'\d+x\d+',str(parameters.get('size','')),re.I) and any(parameters.get(k) for k in ('resolution','aspect_ratio')):raise ValueError('Choose either an exact pixel size or resolution and aspect ratio, not both.')
  if str(parameters.get('output_format','')).lower() in ('jpeg','jpg') and str(parameters.get('background','')).lower()=='transparent':raise ValueError('Transparent backgrounds require PNG or WebP. Choose one of those formats or an opaque background.')
 elif provider=='gemini' and (parameters or options or tag or slug):raise ValueError('This Gemini image adapter does not support these advanced image settings. Clear them or choose an adapter that supports them.')
 return {'imageParameters':parameters,'imageProviderOptions':options,'imageProviderTag':tag,'imageProviderSlug':slug}

def settings(service,body=None,scope=None):
 from vh2_runtime import encode
 with service.connect() as db:
  if body is not None:
   scope=body.get('scope');enabled=body.get('enabled');model=body.get('model');limit=body.get('dailyLimit',4);refs=body.get('maxReferences',10)
   if not isinstance(scope,str) or not scope.startswith('horde:') or len(scope)>120 or type(enabled) is not bool:raise ValueError('Choose a Horde profile and enabled state.')
   if not isinstance(model,str) or not 1<=len(model.strip())<=200 or type(limit) is not int or not 1<=limit<=100 or type(refs) is not int or not 1<=refs<=20:raise ValueError('Choose an image model, daily cap and supported reference limit.')
   key=body.get('apiKey','')
   if not isinstance(key,str) or len(key)>4096 or any(c in key for c in '\r\n'):raise ValueError('Invalid key.')
   provider=body.get('provider','openrouter')
   if provider not in ('openrouter','gemini','magnific','higgsfield'):raise ValueError('Unsupported background image provider.')
   arguments=body.get('arguments',{});tool=body.get('tool','')
   if not isinstance(arguments,dict) or len(json.dumps(arguments))>30000 or not isinstance(tool,str) or len(tool)>300:raise ValueError('Invalid MCP image configuration.')
   if provider in ('magnific','higgsfield') and not tool:raise ValueError('Select an MCP image generation tool first.')
   config=dict(scope=scope,enabled=enabled,provider=provider,tool=tool,arguments=arguments,model=model.strip(),dailyLimit=limit,maxReferences=refs,baseUrl='https://openrouter.ai/api/v1',**image_options(body))
   prior=current(db,scope)
   if not key and prior and json.loads(prior['config']).get('provider','openrouter')==provider and not body.get('clearKey'):key=prior['api_key']
   if enabled and provider in ('openrouter','gemini') and not key:raise ValueError('Configure this image provider’s API key first.')
   db.execute('BEGIN IMMEDIATE')
   if not prior or json.loads(prior['config'])!=config or prior['api_key']!=key:db.execute('INSERT INTO vh2_service_providers VALUES (?,?,?,?,?)',(str(uuid.uuid4()),scope,encode(config),key,service.clock()))
  row=current(db,scope)
  config=json.loads(row['config']) if row else {}
  return {'version':row['id'] if row else None,'configured':bool(row),**config,'hasKey':bool(row and row['api_key']),'autonomousBudget':autonomous_budget(db,scope,config,service.clock()) if row else None}

def image_transport(config,key,body):
 if config.get('provider')=='gemini':return __import__('vh2_image_adapters').gemini(config,key,body)
 if config.get('provider','openrouter')!='openrouter':raise RejectedOutput('This MCP adapter requires the local Horde bridge.')
 request=urllib.request.Request(config['baseUrl']+'/images',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+key},method='POST')
 try:
  with urllib.request.build_opener(NoRedirect()).open(request,timeout=180) as response:
   raw=response.read(16000001)
   if len(raw)>16000000:raise RejectedOutput('Image response is too large.')
   item=json.loads(raw)['data'][0];mime=item.get('media_type','image/png')
   if mime not in ('image/png','image/jpeg','image/webp') or not isinstance(item.get('b64_json'),str):raise RejectedOutput('Unsupported image response.')
   return 'data:'+mime+';base64,'+item['b64_json']
 except urllib.error.HTTPError as error:
  raise RejectedOutput('Image provider returned HTTP '+str(error.code)+'. No image was returned. Check the selected model, account access or provider quota.') from None
 except (KeyError,IndexError,ValueError,TypeError):raise RejectedOutput('Image provider returned an invalid image response.') from None
 except RejectedOutput:raise
 except Exception as error:raise UnknownOutcome('Image connection failed ('+type(error).__name__+'). The provider outcome could not be confirmed; a new generation may charge again.') from None

def asset_data(db,world,ident):
 row=db.execute('SELECT mime,bytes FROM photo_assets WHERE world_id=? AND id=?',(world,ident)).fetchone()
 if not row:raise ValueError('A frozen reference asset is missing.')
 return 'data:'+row['mime']+';base64,'+base64.b64encode(row['bytes']).decode()

def compile_image(db,world,state,snapshot,config,photo=None):
 c=snapshot['companion'];ctx=snapshot['photoContext'];refs=[];roles=[];ref_ids=[]
 def add(value,role,ident):
  if value and value not in refs:refs.append(value);roles.append(role);ref_ids.append(ident)
 entries=snapshot.get('referenceAssets',[])
 for e in entries:
  if e['role']=='identity':add(asset_data(db,world,e['assetId']),'identity: '+e['label'],e['assetId'])
 if not refs and (not ctx.get('assetStudy') or ctx['assetStudy']['requiresReference']):raise ValueError('Approve identity references before background rendering; this capture has none.')
 previous=None
 if not ctx.get('referenceStudy'):
  candidates=[p for p in state.get('photos',[]) if p.get('assetId') and p.get('destination')==snapshot['destination'] and 0<ctx['atMs']-p['at']<=90*60000 and p.get('photoContext',{}).get('placeId')==ctx.get('placeId') and p.get('photoContext',{}).get('zoneId')==ctx.get('zoneId') and p.get('photoContext',{}).get('zoneRevision')==ctx.get('zoneRevision') and p.get('photoContext',{}).get('outfitRevision')==ctx.get('outfitRevision') and p.get('photoContext',{}).get('outfit')==ctx.get('outfit') and p.get('photoContext',{}).get('garmentIds',[])==ctx.get('garmentIds',[])]
  previous=max(candidates,key=lambda p:p['at']) if candidates else None
  if previous:add(asset_data(db,world,previous['assetId']),'previous photograph: preserve exact outfit and setting',previous['assetId'])
 for e in entries:
  if e['role']!='identity':add(asset_data(db,world,e['assetId']),e['role']+': '+e['label'],e['assetId'])
 if len(refs)>config['maxReferences']:raise ValueError('The frozen references exceed the configured provider capacity. No image submitted.')
 if ctx.get('assetStudy'):
  prompt=ctx['assetStudy']['prompt']
 elif ctx.get('referenceStudy'):
  prompt=f"Neutral identity reference: {ctx['referenceStudy']}. Same {(__import__('vh2_calendar').current_age(c) or 'unspecified-age')}-year-old person as the identity references. Preserve natural proportions and facial identity. Plain opaque clothing, neutral lighting and background. No phone, mirror, props, lettering or other people."
 else:
  camera='The subject holds a visible phone reflected in a real mirror; physically coherent reflection and hands.' if snapshot['captureType']=='mirror_selfie' else 'Front-camera phone selfie, handheld at arm length by the subject; no external photographer.'
  visible='; '.join(str(ctx[k]) for k in ('placeLabel','zoneDescription','outfit') if ctx.get(k))
  present=[p for p in c.get('lifeProfile',{}).get('socialCircle',[]) if p['id'] in ctx.get('personIds',[]) or ('personIds' not in ctx and p.get('name') in ctx.get('withNames',[]))]
  cast='; '.join(p['name']+': '+(p.get('appearance') or 'use assigned person reference; appearance otherwise unspecified') for p in present)
  prompt=f"One personal photograph of the {(__import__('vh2_calendar').current_age(c) or 'unspecified-age')}-year-old person in the identity references. Preserve their face, age and natural proportions. Reference-sheet views identify ONE person; do not reproduce a sheet, collage or multiple views.\nScene request: {snapshot['scene']}\nCaptured setting and clothing: {visible}.\nOther people present: {cast or 'none established'}. Do not infer appearance from occupation, relationship or name.\n{camera}\nPreserve the established outfit and location. Personality may affect expression and gesture only, never identity: {str(c.get('personality',''))[:2000]}."
  treatments={'realistic':'Natural phone-camera photograph, realistic skin texture, available light and subtle sensor grain.', 'illustrated':'Hand-painted animation illustration with textured shadows, expressive brushwork and casual phone framing.', 'film':'Candid 35mm consumer-film snapshot with fine grain and soft halation.', 'instant':'Instant-film photo with soft flash falloff, imperfect color dyes and spontaneous framing.', 'graphic_novel':'Painterly graphic-novel image with ink contours and textured color fills.'}
  prompt+='\nVisual treatment: '+treatments.get(c.get('photoStyle'),treatments['realistic'])
  if c.get('photoDirection'):prompt+='\nPersonal photo direction: '+str(c['photoDirection'])[:4000]
  if c.get('photoStyle'):prompt+='\nPreferred visual style: '+str(c['photoStyle'])[:120]
  if previous:prompt+='\nFollow-up: preserve the previous photograph\'s exact clothing, room and lighting. Change only the requested gesture or framing.'
 prompt+='\nReference roles in attachment order: '+ '; '.join(str(i+1)+'. '+r for i,r in enumerate(roles))+'. Use references only for their assigned roles. Identity references establish face, hair and body, not clothing. Use the captured outfit description and assigned garment references for clothing colors, fabrics and cuts; do not copy clothing from identity or place references. Do not render instructions as text.'
 if photo and photo.get('publicationIntent'):prompt+='\nPhotograph selected for this saved social post: '+photo['publicationIntent']['scene']+'\nKeep the captured place, clothing and identity references unchanged.'
 request={'model':config['model'],'prompt':prompt,'n':1,'input_references':[{'type':'image_url','image_url':{'url':r}} for r in refs],'provider':{'allow_fallbacks':False}}
 selected=image_options(config)
 if config.get('provider','openrouter')=='openrouter':
  request.update(selected['imageParameters'])
  if selected['imageProviderTag']:request['provider']['only']=[selected['imageProviderTag']]
  if selected['imageProviderOptions']:request['provider']['options']={selected['imageProviderSlug']:selected['imageProviderOptions']}
 return request,[hashlib.sha256(r.encode()).hexdigest() for r in refs],ref_ids

def queue_image(service,db,world,revision,state,photo_id,automatic=False):
 import vh2_media
 from vh2_runtime import encode,Conflict
 scope=state.get('integration',{}).get('providerScope');provider=current(db,scope)
 if not provider:raise ValueError('Choose an image provider and model in image settings first.')
 config=json.loads(provider['config']);job_id='image:'+photo_id
 if automatic and not config['enabled']:raise ValueError('Automatic image generation is off. You can still generate images manually.')
 if config.get('provider','openrouter') in ('openrouter','gemini') and not provider['api_key']:raise ValueError('Add the selected image provider’s API key in image settings first.')
 if db.execute('SELECT 1 FROM vh2_provider_jobs WHERE id=?',(job_id,)).fetchone():raise Conflict('This capture already has a background job. Resolve it instead of submitting again.')
 if automatic and not autonomous_budget(db,scope,config,service.clock())['remaining']:raise ValueError('Today’s automatic image allowance is used up. It resets at 00:00 UTC; manual generation is still available.')
 row=db.execute('SELECT snapshot FROM photo_jobs WHERE world_id=? AND id=?',(world,photo_id)).fetchone()
 if not row:raise ValueError('Unknown capture.')
 photo=next((p for p in state.get('photos',[]) if p['id']==photo_id),None) or __import__('vh2_library').get(db,world,'photo',photo_id)
 if automatic and not __import__('vh2_social_worker').image_purpose(state,photo):raise ValueError('This is a saved gallery idea, not a selected social photo. Generate it manually whenever you want; saving it does not use image credits.')
 frozen=json.loads(row['snapshot']);request,hashes,ref_ids=compile_image(db,world,state,frozen,config,photo)
 revision,after,_=vh2_media.command(service,db,world,revision,state,{'type':'submit_photo','photoId':photo_id,'manifest':{'provider':config.get('provider','openrouter')+'-background','model':config['model'],'promptPreview':request['prompt'],'referenceHashes':hashes}})
 request.pop('input_references',None)
 db.execute('INSERT INTO vh2_provider_jobs VALUES (?,?,?,?,?,?,?,?,?,?)',(job_id,world,'image','queued',encode({'scope':scope,'providerId':provider['id'],'photoId':photo_id,'request':request,'referenceAssetIds':ref_ids,'automatic':automatic}),None,'',service.clock(),None,None))
 return revision,after

def command(service,db,world,revision,state,body):
 import vh2_media
 from vh2_runtime import encode,Conflict
 if body['type'] in ('queue_photo_render','retry_photo_render') and 'providerVersion' in body:
  version=body['providerVersion'];provider=current(db,state.get('integration',{}).get('providerScope'))
  if not isinstance(version,str) or not version or len(version)>100:raise ValueError('Review the selected image provider before generating.')
  if not provider or provider['id']!=version:raise Conflict('Image settings changed after this preview. Review the current provider and model before generating.')
 if body['type']=='queue_photo_render':return queue_image(service,db,world,revision,state,body.get('photoId'))
 photo_id=body.get('photoId');job=db.execute('SELECT * FROM vh2_provider_jobs WHERE id=? AND world_id=?',('image:'+str(photo_id),world)).fetchone()
 photo=next((p for p in state.get('photos',[]) if p['id']==photo_id),None)
 if not photo or photo['status'] not in ('captured','submitted'):raise ValueError('Choose an unfinished image.')
 if job and job['status'] in ('queued','submitted','rendered'):raise Conflict('This image is still running. Wait for its result.')
 revision,after,_=vh2_media.command(service,db,world,revision,state,{'type':'abandon_photo','photoId':photo_id})
 if job:db.execute("UPDATE vh2_provider_jobs SET status='abandoned' WHERE id=?",(job['id'],))
 if body['type']=='dismiss_photo_render':return revision,after
 frozen=db.execute('SELECT snapshot FROM photo_jobs WHERE id=? AND world_id=?',(photo_id,world)).fetchone()
 if not frozen:
  source=db.execute('SELECT p.world_id,p.snapshot,w.state FROM photo_jobs p JOIN worlds w ON w.id=p.world_id WHERE p.id=?',(photo_id,)).fetchone()
  # Only recover assets from a life explicitly merged into this destination.
  if not source or json.loads(source['state']).get('mergedInto')!=world:raise ValueError('The original captured references are unavailable.')
  recovered=json.loads(source['snapshot'])
  for ref in recovered.get('referenceAssets',[]):
   asset=db.execute('SELECT mime,bytes FROM photo_assets WHERE id=? AND world_id=?',(ref['assetId'],source['world_id'])).fetchone()
   if not asset:raise ValueError('An original reference asset is missing from the merged life.')
   ident=str(uuid.uuid5(uuid.NAMESPACE_URL,'vh2-recovered-reference:'+world+':'+ref['assetId']))
   db.execute('INSERT OR IGNORE INTO photo_assets VALUES (?,?,?,?)',(ident,world,asset['mime'],asset['bytes']))
   ref['assetId']=ident
  frozen={'snapshot':encode(recovered)}
 new_id=retry_photo_id(body['key'])
 db.execute('INSERT INTO photo_jobs VALUES (?,?,?)',(new_id,world,frozen['snapshot']))
 before=json.loads(encode(after));new_photo={k:v for k,v in photo.items() if k not in ('manifest','assetId','deliveredAt')}
 new_photo.update(id=new_id,status='captured',retryOf=photo_id)
 after['photos'].append(new_photo)
 for post in after.get('social',{}).get('posts',[]):
  if post.get('photoId')==photo_id and any(p['id']==post['id'] and p.get('status')=='draft' for p in state.get('social',{}).get('posts',[])):
   post.update(photoId=new_id,status='draft');post.pop('imageError',None);post.pop('abandonedAt',None)
 revision=service.commit_event(db,world,revision,before,after,'PHOTO_RETRY_REQUESTED',{'photoId':new_id,'retryOf':photo_id})
 return queue_image(service,db,world,revision,after,new_id)


def poll(service):
 if not service._worker_lock.acquire(blocking=False):return
 try:_poll(service)
 finally:service._worker_lock.release()

def provider_accepted(service,job_id,provider_job_ids):
 """Record a real provider receipt without changing submission/retry policy."""
 from vh2_runtime import encode
 if isinstance(provider_job_ids,(str,int,float)) and not isinstance(provider_job_ids,bool):provider_job_ids=[provider_job_ids]
 if not isinstance(provider_job_ids,(list,tuple)) or not 1<=len(provider_job_ids)<=20:return False
 identifiers=[]
 for value in provider_job_ids:
  if type(value) not in (str,int,float) or type(value) is float and not math.isfinite(value):return False
  ident=str(value).strip()
  if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}',ident) or '://' in ident or ident.lower().startswith('data:'):return False
  if ident not in identifiers:identifiers.append(ident)
 with service.connect() as db:
  db.execute('BEGIN IMMEDIATE');row=db.execute("SELECT status,result FROM vh2_provider_jobs WHERE id=? AND kind='image'",(job_id,)).fetchone()
  if not row or row['status']!='submitted':return False
  result=json.loads(row['result'] or '{}')
  if not isinstance(result,dict):result={}
  previous=result.get('providerJobIds',[])
  if isinstance(previous,list):identifiers=list(dict.fromkeys(previous+identifiers))[:20]
  result.update(providerAccepted=True,providerJobIds=identifiers)
  db.execute('UPDATE vh2_provider_jobs SET result=? WHERE id=?',(encode(result),job_id))
 return True

def reference_progress(service,job_id,progress):
 """Save bounded upload progress; uploaded inputs are not generation receipts."""
 from vh2_runtime import encode
 labels={'requesting_upload':'Preparing','uploading_reference':'Uploading','retrying_reference':'Retrying','confirming_reference':'Confirming','reference_ready':'Prepared'}
 if not isinstance(progress,dict) or progress.get('stage') not in labels:return False
 stage=progress['stage'];index=progress.get('index');total=progress.get('total');attempt=progress.get('attempt')
 if type(index) is not int or type(total) is not int or type(attempt) is not int or not 1<=index<=total<=20 or not 1<=attempt<=2:return False
 # Construct our own status text so adapter diagnostics can never leak URLs,
 # signed upload tokens, prompts, or image contents into persistent activity.
 value={'stage':stage,'index':index,'total':total,'attempt':attempt,'message':labels[stage]+' reference '+str(index)+' of '+str(total)+'.'}
 with service.connect() as db:
  db.execute('BEGIN IMMEDIATE');row=db.execute("SELECT status,result FROM vh2_provider_jobs WHERE id=? AND kind='image'",(job_id,)).fetchone()
  if not row or row['status']!='submitted':return False
  result=json.loads(row['result'] or '{}')
  if not isinstance(result,dict):result={}
  result['referenceProgress']=value;db.execute('UPDATE vh2_provider_jobs SET result=? WHERE id=?',(encode(result),job_id))
 return True

def _poll(service):
 from vh2_runtime import encode
 import vh2_media
 pending=service._worker_pending
 for ident,future in list(pending.items()):
  if not future.done():continue
  del pending[ident]
  with service.connect() as db:
   db.execute('BEGIN IMMEDIATE');job=db.execute('SELECT * FROM vh2_provider_jobs WHERE id=?',(ident,)).fetchone()
   if not job or job['status']!='submitted':continue
   snapshot=json.loads(job['snapshot']);revision,state=service.read(db,job['world_id'])
   try:
    result=future.result()
    if job['kind']=='image':
     if not isinstance(result,str) or len(result)>12_000_000:raise RejectedOutput('The returned image cannot be imported.')
     db.execute('INSERT OR REPLACE INTO vh2_provider_outputs VALUES (?,?)',(ident,result))
     db.execute("UPDATE vh2_provider_jobs SET status='rendered',finished_at=? WHERE id=?",(service.clock(),ident))
     continue  # Commit the result before attempting import; restarting cannot lose it.
    elif state['kernelVersion']==service.kernel_version:
     before=json.loads(encode(state));state['truth']=service.kernel({'companion':state['truth']['companion'],'now':state['simAt'],'inspect':True,'routeResult':{'id':snapshot['journeyId'],'response':result}})
     service.commit_event(db,job['world_id'],revision,before,state,'ROUTE_RESOLVED',{'journeyId':snapshot['journeyId']})
    db.execute("UPDATE vh2_provider_jobs SET status='succeeded',finished_at=?,result=? WHERE id=?",(service.clock(),encode({'imported':True}) if job['kind']=='image' else encode(result),ident))
   except Exception as error:
    status='unknown' if isinstance(error,UnknownOutcome) else 'failed'
    db.execute('UPDATE vh2_provider_jobs SET status=?,finished_at=?,error=? WHERE id=?',(status,service.clock(),str(error)[:300],ident))
    if job['kind']=='image':
     before=json.loads(encode(state))
     for post in state.get('social',{}).get('posts',[]):
      if post.get('photoId')==snapshot.get('photoId') and post.get('imagePending'):post['imageError']=str(error)[:300]
     if state!=before:service.commit_event(db,job['world_id'],revision,before,state,'SOCIAL_IMAGE_FAILED')
 # Import completed outputs independently of generation and of the life being paused.
 with service.connect() as db:
  rendered=db.execute("SELECT j.id,j.world_id,j.snapshot,o.image FROM vh2_provider_jobs j JOIN vh2_provider_outputs o ON o.job_id=j.id WHERE j.status='rendered' ORDER BY j.created_at LIMIT 4").fetchall()
 for output in rendered:
  with service.connect() as db:
   db.execute('BEGIN IMMEDIATE');revision,state=service.read(db,output['world_id'])
   if state['kernelVersion']!=service.kernel_version:continue
   photo_id=json.loads(output['snapshot'])['photoId'];photo=next((p for p in state.get('photos',[]) if p['id']==photo_id),None)
   if photo and photo.get('assetId'):
    db.execute("UPDATE vh2_provider_jobs SET status='succeeded',error='' WHERE id=?",(output['id'],));db.execute('DELETE FROM vh2_provider_outputs WHERE job_id=?',(output['id'],));continue
   if not photo or photo['status']=='abandoned':
    db.execute("UPDATE vh2_provider_jobs SET status='abandoned' WHERE id=?",(output['id'],));continue
   try:
    vh2_media.command(service,db,output['world_id'],revision,state,{'type':'import_photo','photoId':photo_id,'image':output['image']})
    db.execute("UPDATE vh2_provider_jobs SET status='succeeded',result=json_patch(COALESCE(result,'{}'),?),error='' WHERE id=?",(encode({'imported':True}),output['id']))
    db.execute('DELETE FROM vh2_provider_outputs WHERE job_id=?',(output['id'],))
   except ValueError as error:db.execute("UPDATE vh2_provider_jobs SET status='failed',error=? WHERE id=?",('Image returned but import failed: '+str(error)[:200],output['id']))
 with service.connect() as db:
  ids=[r[0] for r in db.execute("SELECT id FROM worlds WHERE json_extract(state,'$.running')=1")]
 for world in ids:
  with service.connect() as db:
   db.execute('BEGIN IMMEDIATE');revision,state=service.read(db,world)
   if state['kernelVersion']!=service.kernel_version:continue
   c=state['truth']['companion'];journey=c['lifeRuntime']['world'].get('journey');transport=c['lifeProfile']['world']['transport']
   if service.route_executor and journey and transport.get('liveRouting') and not journey.get('routeStatus') and journey.get('routeSource')!='Manual override' and not (journey.get('mode')=='WALK' and journey.get('geometry')) and state['simAt'] < journey.get('arrivesAt',0) and state['simAt']-journey.get('departedAt',0) <= 300000:
    ident='route:'+world+':'+journey['id']
    if not db.execute('SELECT 1 FROM vh2_provider_jobs WHERE id=?',(ident,)).fetchone():
     places={p['id']:p for p in c['lifeProfile']['places']};origin=places.get(journey['from'],{});dest=places.get(journey['to'],{})
     request={'origin':origin.get('googlePlaceId'),'destination':dest.get('googlePlaceId'),'originCoordinates':origin.get('mapCoordinates'),'destinationCoordinates':dest.get('mapCoordinates'),'mode':'DRIVE' if journey['mode']=='RIDESHARE' else journey['mode']}
     if (request['origin'] or request['originCoordinates']) and (request['destination'] or request['destinationCoordinates']):
      db.execute('INSERT INTO vh2_provider_jobs VALUES (?,?,?,?,?,?,?,?,?,?)',(ident,world,'route','queued',encode({'journeyId':journey['id'],'request':request}),None,'',service.clock(),None,None))
   provider=current(db,state.get('integration',{}).get('providerScope'))
   if not c.get('vh2AutonomyPaused') and provider and json.loads(provider['config'])['enabled']:
    for photo in state.get('photos',[]):
     if photo['status']!='captured' or photo.get('origin')!='autonomous' or not __import__('vh2_social_worker').image_purpose(state,photo):continue
     try:revision,state=queue_image(service,db,world,revision,state,photo['id'],automatic=True)
     except ValueError as error:
      before=json.loads(encode(state));post=__import__('vh2_social_worker').image_purpose(state,photo)
      if post:post['imageError']=str(error)[:300]
      if state!=before:revision=service.commit_event(db,world,revision,before,state,'SOCIAL_IMAGE_WAITING')
 with service.connect() as db:
  # Filter suspended automatic work before LIMIT, otherwise four paused jobs
  # can hide every manual request behind them indefinitely.
  jobs=db.execute("""SELECT j.* FROM vh2_provider_jobs j JOIN worlds w ON w.id=j.world_id
   WHERE j.status='queued' AND json_extract(w.state,'$.kernelVersion')=? AND (
    (j.kind='image' AND json_extract(j.snapshot,'$.automatic')=0)
    OR (json_extract(w.state,'$.running')=1 AND (j.kind<>'image' OR (
     COALESCE(json_extract(w.state,'$.truth.companion.vh2AutonomyPaused'),0)=0
     AND EXISTS (SELECT 1 FROM vh2_service_providers p WHERE p.id=(
      SELECT id FROM vh2_service_providers WHERE scope=json_extract(j.snapshot,'$.scope') ORDER BY rowid DESC LIMIT 1
     ) AND json_extract(p.config,'$.enabled')=1)
    )))
   ) ORDER BY CASE WHEN j.kind='image' AND json_extract(j.snapshot,'$.automatic')=0 THEN 0 ELSE 1 END,j.created_at LIMIT 4""",(service.kernel_version,)).fetchall()
 for job in jobs:
  if len(pending)>=2:break
  with service.connect() as db:
   db.execute('BEGIN IMMEDIATE');revision,state=service.read(db,job['world_id']);snapshot=json.loads(job['snapshot'])
   if state['kernelVersion']!=service.kernel_version:continue
   if job['kind']=='image':
    if snapshot.get('automatic') and not __import__('vh2_social_worker').image_purpose(state,next((p for p in state.get('photos',[]) if p['id']==snapshot['photoId']),None)):
     # Withdraw unsubmitted work when its sharing purpose disappears. No paid retry.
     before=json.loads(encode(state));photo=next((p for p in state.get('photos',[]) if p['id']==snapshot['photoId']),None)
     if photo and photo['status']=='submitted':photo.update(status='captured',deferred=True)
     if photo:
      photo.pop('publicationIntent',None);photo['shareDecision']={'accepted':False,'reason':'The selected social draft was dismissed.'}
     db.execute('DELETE FROM vh2_provider_jobs WHERE id=? AND status=\'queued\'',(job['id'],))
     if before!=state:service.commit_event(db,job['world_id'],revision,before,state,'IMAGE_RETURNED_TO_SAVED_MOMENTS',{'photoId':snapshot['photoId'],'reason':'No active sharing purpose; provider not contacted.'})
     continue
    if snapshot.get('automatic') and state['truth']['companion'].get('vh2AutonomyPaused'):continue
    live=current(db,snapshot['scope'])
    if snapshot.get('automatic') and (not live or not json.loads(live['config'])['enabled']):continue
    provider=db.execute('SELECT * FROM vh2_service_providers WHERE id=?',(snapshot['providerId'],)).fetchone()
    if not provider:db.execute("UPDATE vh2_provider_jobs SET status='failed',error='Provider configuration missing after restore.' WHERE id=?",(job['id'],));continue
    request={**snapshot['request'],'input_references':[{'type':'image_url','image_url':{'url':asset_data(db,job['world_id'],ident)}} for ident in snapshot['referenceAssetIds']]}
    executor_config=json.loads(provider['config'])
    executor_config['_on_provider_accepted']=lambda ids,ident=job['id']:provider_accepted(service,ident,ids)
    executor_config['_on_reference_progress']=lambda progress,ident=job['id']:reference_progress(service,ident,progress)
    call=service.image_executor;args=(executor_config,provider['api_key'],request)
   else:
    if not service.route_executor:continue
    if not state['truth']['companion']['lifeProfile']['world']['transport'].get('liveRouting'):
     db.execute("UPDATE vh2_provider_jobs SET status='failed',error='Automatic live routing was disabled before submission.' WHERE id=?",(job['id'],));continue
    call=service.route_executor;args=(snapshot['request'],)
   changed=db.execute("UPDATE vh2_provider_jobs SET status='submitted',submitted_at=? WHERE id=? AND status='queued'",(service.clock(),job['id'])).rowcount
   if not changed:continue
  if service._worker_pool is None:service._worker_pool=concurrent.futures.ThreadPoolExecutor(max_workers=2,thread_name_prefix='vh2-provider')
  pending[job['id']]=service._worker_pool.submit(call,*args)

def status(service,world):
 with service.connect() as db:
  rows=[dict(r) for r in db.execute("SELECT id,kind,status,error,created_at,submitted_at,finished_at,json_extract(snapshot,'$.photoId') AS photoId,json_extract(snapshot,'$.automatic') AS automatic,json_extract(result,'$.providerAccepted') AS providerAccepted,json_extract(result,'$.providerJobIds') AS providerJobIds,json_extract(result,'$.referenceProgress') AS referenceProgress FROM vh2_provider_jobs WHERE world_id=? ORDER BY created_at DESC,rowid DESC LIMIT 60",(world,))]
  for row in rows:
   row['providerAccepted']=bool(row['providerAccepted']);row['providerJobIds']=json.loads(row['providerJobIds'] or '[]');row['referenceProgress']=json.loads(row['referenceProgress']) if row['referenceProgress'] else None
  return rows
