#!/usr/bin/env python3
"""Build a redistributable starting character from a verified portable ZIP.
Only authored setup and current media are bundled; personal conversations,
provider receipts, archived worlds and per-player reactions are never shipped.
"""
import argparse,base64,gzip,hashlib,importlib.util,json,pathlib,re,uuid,zipfile

def sanitize_bundled_item_namespaces(clean,source_world_ids):
 """Detach authored item IDs from private source lives without changing media or prose."""
 result=json.loads(json.dumps(clean));namespace=result['id']
 worlds=sorted({str(value) for value in source_world_ids if value})
 items=result.get('lifeProfile',{}).get('world',{}).get('items',[])
 possessions=result.get('lifeSetupPolicies',{}).get('possessions',[])
 mapping={}
 for item in items+possessions:
  old=item.get('id');new=old
  if not isinstance(old,str):continue
  for world in worlds:new=new.replace(world,namespace)
  if new!=old:mapping[old]=new
 for rows in (items,possessions):
  ids=[mapping.get(row.get('id'),row.get('id')) for row in rows]
  if len(ids)!=len(set(ids)):raise ValueError('Bundled item namespace normalization would create duplicate IDs')
 scalar={'id','entityId','itemId','garmentId','propId'}
 arrays={'itemIds','garmentIds','propIds','inventory','incompatible','ids'}
 def remap(value,key=''):
  if isinstance(value,dict):return {k:remap(v,k) for k,v in value.items()}
  if isinstance(value,list):return [remap(v,key) for v in value]
  if isinstance(value,str) and key in scalar|arrays:return mapping.get(value,value)
  return value
 result=remap(result)
 if isinstance(result.get('lifeProfile'),dict):result['lifeProfile']['seed']=namespace
 return result

def apply_profile_overlay(clean,overlay):
 if overlay.get('format')!='horde-bundled-profile-overlay' or overlay.get('version')!=1 or overlay.get('characterName')!=clean['name']:raise ValueError('Invalid authored profile overlay')
 if set(overlay)-{'format','version','characterName','topLevel','lifeProfile','policies','peoplePolicies','notes'}:raise ValueError('Unknown profile overlay section')
 for section,target in [('topLevel',clean),('lifeProfile',clean['lifeProfile'])]:
  for k,v in overlay.get(section,{}).items():
   if k not in target:raise ValueError('Unknown authored field: '+k)
   target[k]=v
   # Saved setup is applied after creation; it must not restore stale prose.
   if section=='topLevel' and k in clean.get('lifeSetupPolicies',{}).get('expression',{}):clean['lifeSetupPolicies']['expression'][k]=v
 for key,patch in overlay.get('policies',{}).items():
  if key=='institutions':
   if not isinstance(patch,list):raise ValueError('Institutions must be a list')
   schedule_ids={s['id'] for s in clean['lifeProfile']['weeklySchedule']}
   if any(r.get('scheduleId') not in schedule_ids for r in patch):raise ValueError('Institution refers to a missing commitment')
   clean['lifeSetupPolicies'][key]=patch;continue
  target=clean['lifeSetupPolicies'].get(key)
  if not isinstance(target,dict) or set(patch)-set(target):raise ValueError('Unknown setup policy field: '+key)
  target.update(patch)
 people={r['personId']:r for r in clean['lifeSetupPolicies']['peopleLives']}
 for ident,patch in overlay.get('peoplePolicies',{}).items():
  if ident not in people or set(patch)-set(people[ident]['policy']):raise ValueError('Unknown participant policy field: '+ident)
  people[ident]['policy'].update(patch)
 return clean

def build(source,out,approve_references=False,conversation_overlay=None,location_overlay=None,profile_overlay=None,feed_overlay=None,route_overlay=None,extra_reference_overlay=None):
 out.mkdir(parents=True,exist_ok=True);prefix=out.as_posix()+'/'
 with zipfile.ZipFile(source) as z:
  if z.testzip():raise ValueError('Damaged source package')
  package=json.loads(z.read('character.json'));archive=package['archive'];c=archive['companion'];source_id=c['id']
  worlds=[]
  for row in archive.get('vh2ServiceArchives',[]):
   payload=json.loads(gzip.decompress(z.read(row['data']['$hordeAsset'])))['payload']
   if not payload['state'].get('mergedInto'):worlds.append(payload)
  if len(worlds)!=1:raise ValueError('Expected exactly one unmerged life for this character')
  payload=worlds[0];state=payload['state'];person=state['truth']['companion'];now=state['simAt'];assets={a['id']:a for a in payload['tables']['photo_assets']};written={}
  def media(raw,mime):
   digest=hashlib.sha256(raw).hexdigest();ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/webm':'webm'}[mime]
   name=digest[:24]+'.'+ext;(out/name).write_bytes(raw);written[name]={'sha256':digest,'bytes':len(raw),'mime':mime};return prefix+name
  def saved_asset(ident):
   row=assets[ident];return media(base64.b64decode(row['bytes'],validate=True),row['mime'])
  def resolve(value):
   if isinstance(value,dict) and '$hordeAsset' in value:return media(z.read(value['$hordeAsset']),value['mime'])
   if isinstance(value,dict):return {k:resolve(v) for k,v in value.items() if k not in ('__proto__','prototype','constructor')}
   if isinstance(value,list):return [resolve(v) for v in value]
   if isinstance(value,str) and value.startswith('data:image/'):
    header,data=value.split(',',1);return media(base64.b64decode(data,validate=True),header[5:].split(';')[0])
   return value
  runtime=('mood','humanDynamics','emotionState','relationshipDynamics','lifeEvents','commitments','lifeRuntime','continuityRuntime','currentOutfit','currentLocationDetail','usage','trauma','memory','personaVisualMemory','socialPosts','socialFeedRuntime','socialRelationship','videoJobs','lastProactiveAt')
  clean={k:v for k,v in c.items() if k not in runtime and not k.startswith('vh2') and not re.search('api.?key|token|secret|password',k,re.I)}
  clean.update(id='aslyn_jonas_v18',bundledId='aslyn-jonas-v18',name=c['name'])
  full_personality=clean.get('lifeSetupPolicies',{}).get('expression',{}).get('personality','')
  if isinstance(full_personality,str) and full_personality.startswith(clean.get('personality','')) and len(full_personality)>len(clean.get('personality','')):clean['personality']=full_personality
  # Earlier archives exported actor routines without their established placement
  # or resources. Recover those facts from the canonical life snapshot.
  for row in clean.get('lifeSetupPolicies',{}).get('peopleLives',[]):
   actor=person.get('vh2People',{}).get('actors',{}).get(row.get('personId'),{})
   place=actor.get('placeId') or (actor.get('journey') or {}).get('from') or actor.get('policy',{}).get('homePlaceId')
   if place:row.setdefault('initialPlaceId',place)
   if type(actor.get('balance')) in (int,float):row.setdefault('startingBalance',actor['balance'])
  population=clean.get('lifeSetupPolicies',{}).get('population',{})
  known_people={p['id'] for p in clean.get('lifeProfile',{}).get('socialCircle',[])}
  if 'residents' in population:population['residents']=[p for p in population['residents'] if p.get('id') not in known_people]
  clean['startingSocialPosts']=[]
  posts={json.loads(r['data'])['id']:json.loads(r['data']) for r in payload['tables']['media_records'] if r['kind']=='post'}
  posts.update({p['id']:p for p in state.get('social',{}).get('posts',[])})
  for p in posts.values():
   if p.get('status')!='published':continue
   photo=saved_asset(p['assetId']) if p.get('assetId') else ''
   clean['startingSocialPosts'].append({'id':p.get('sourceId') or p['id'],'kind':'photo' if photo else 'status','text':p.get('caption',''),'photo':photo,'visibility':'public','seedAgeDays':max(0,(now-p.get('publishedAt',now))/86400000)})
  photos={json.loads(r['data'])['id']:json.loads(r['data']) for r in payload['tables']['media_records'] if r['kind']=='photo'};photos.update({p['id']:p for p in state.get('photos',[])})
  clean['startingGallery']=[{'id':p['id'],'kind':'photo','text':p.get('caption') or p.get('scene',''),'photo':saved_asset(p['assetId']),'visibility':'private','seedAgeDays':max(0,(now-p.get('capturedAt',now))/86400000)} for p in photos.values() if p.get('status') in ('stored','delivered') and p.get('destination')!='reference' and p.get('assetId')]
  clean['startingReferences']=[{'id':r['id'],'role':r['role'],'entityId':'aslyn_jonas_v18' if r['role']=='identity' else r['entityId'],'label':r['label'],'tags':r.get('tags',[]),'status':'approved' if approve_references else r['status'],'image':saved_asset(r['assetId'])} for r in person.get('vh2Assets',{}).get('entries',[]) if (r.get('status') in ('approved','pending') or approve_references and r.get('status')=='rejected') and r.get('assetId')]
  videos={v['id']:v['data'] for v in archive.get('media',{}).get('videos',[])};clips={}
  for clip in c.get('startingVideoClips',[])+c.get('videoJobs',[]):clips[clip['id']]=clip
  clean['startingVideoClips']=[]
  for clip in clips.values():
   if clip.get('deletedAt') or clip.get('status')!='ready':continue
   ref=videos.get(clip.get('archiveMediaId'));src=resolve(ref) if ref else None
   if not src:raise ValueError('Ready clip lacks embedded media: '+clip['id'])
   caption=clip.get('caption','')
   if clip['id']=='vh_clip_1789164499406_0_6811642121157613':caption='boring day rant'
   clean['startingVideoClips'].append({'id':clip['id'],'status':'ready','caption':caption,'bundledSrc':src,'duration':clip.get('duration',5),'seedAgeDays':clip.get('seedAgeDays',max(0,(now-clip.get('createdAt',now))/86400000))})
  clean=resolve(clean)
  # New users select their own model connections. Do not pin the publisher's providers.
  for k in ('model','imageModel','videoModel','referenceImageModel','lifeBuilderModel','lifeAppraisalModel'):clean[k]=''
  clean.update(imageSource='provider',referenceImageSource='',videoProvider='',
               mcpImageTool='',mcpImageArguments={},imageProviderTag='',imageProviderOptions={})
  # Setup is applied after profile creation; nested overrides must inherit too.
  expression=clean.get('lifeSetupPolicies',{}).get('expression',{})
  for k in ('model','imageModel','videoModel','referenceImageModel','lifeBuilderModel','lifeAppraisalModel','textProvider','videoProvider'):
   if k in expression:expression[k]=''
  for k in ('imageSource','referenceImageSource','mcpImageTool','mcpImageArguments','imageProviderTag','imageProviderOptions'):
   if k in expression:expression[k]=clean[k]
  clean['textProvider']='';clean['priorContact']='never_spoken';clean['knownBeforeDays']=0;clean['startingRelationship']=0
  if conversation_overlay:
   overlay=json.loads(pathlib.Path(conversation_overlay).read_text())
   voice=overlay.pop('voice',{})
   if set(overlay)-{'textingStyle','conversationStyle','chatLength','chatAvoid','chatExamples'}:raise ValueError('Unsupported conversation overlay fields')
   clean.update(overlay)
   clean.setdefault('lifeProfile',{}).setdefault('world',{}).setdefault('voice',{}).update(voice)
   # The saved setup expression is applied after creation, so update both copies.
   for k,v in overlay.items():
    if k in expression:expression[k]=v
   if 'voice' in expression:expression['voice'].update(voice)
  location_report=None
  if location_overlay:
   spec=importlib.util.spec_from_file_location('location_overlay',pathlib.Path(__file__).with_name('apply-bundled-location-overlay.py'))
   module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
   overlay=json.loads(pathlib.Path(location_overlay).read_text());clean,location_report=module.apply_overlay(clean,overlay)
   # Keep the authored setup expression consistent with the top-level profile.
   for patch in overlay.get('authoredTextReplacements',[]):
    clean.setdefault('lifeSetupPolicies',{}).setdefault('expression',{})[patch['field']]=clean[patch['field']]
   plan=overlay.get('referenceReplacementPlan',{});folder=out/plan['generatedFolder']
   owners={'place':{p['id']:p['label'] for p in clean['lifeProfile']['places']},'zone':{r['id']:r['label'] for r in clean['lifeSetupPolicies']['rooms']}}
   replacements=[];keys=set()
   for role,files in [('place',plan.get('placeFiles',{})),('zone',plan.get('roomFiles',{}))]:
    for entity_id,filename in files.items():
     if entity_id not in owners[role]:raise ValueError('Generated reference owner is missing: '+entity_id)
     path=folder/filename
     if path.resolve().parent!=folder.resolve() or not path.is_file():raise ValueError('Invalid generated reference path')
     raw=path.read_bytes()
     if not raw.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('Expected generated PNG reference')
     if not approve_references:raise ValueError('Replacement references require explicit publisher approval')
     digest=hashlib.sha256(raw).hexdigest();name=path.relative_to(out).as_posix();written[name]={'sha256':digest,'bytes':len(raw),'mime':'image/png'}
     keys.add((role,entity_id))
     replacements.append({'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'horde:aslyn-v18:reference:'+role+':'+entity_id+':'+digest)), 'role':role,'entityId':entity_id,'label':owners[role][entity_id]+' · '+('Room reference' if role=='zone' else 'Place reference'),'tags':['room_overview' if role=='zone' else 'establishing','generated_setting','v18_location_refresh'],'status':'approved','image':prefix+name})
   clean['startingReferences']=[r for r in clean['startingReferences'] if (r['role'],r['entityId']) not in keys]+replacements
  if extra_reference_overlay:
   overlay=json.loads(pathlib.Path(extra_reference_overlay).read_text())
   if overlay.get('format')!='horde-bundled-reference-overlay' or overlay.get('version')!=1 or overlay.get('characterName')!=clean['name']:raise ValueError('Invalid reference overlay')
   if not approve_references:raise ValueError('Additional references require explicit publisher approval')
   places={p['id']:p for p in clean['lifeProfile']['places']};seen=set();new_refs=[]
   for row in overlay['references']:
    ident=row['entityId'];path=pathlib.Path(row['path'])
    if ident not in places or ident in seen:raise ValueError('Unknown or duplicate place reference: '+ident)
    if not path.resolve().is_relative_to(out.resolve()):raise ValueError('Reference asset is outside the bundle')
    if any(r['role']=='place' and r['entityId']==ident for r in clean['startingReferences']):raise ValueError('Additional reference would replace an existing place reference')
    description=row['referenceDescription']
    if not isinstance(description,str) or not description.strip() or len(description)>1500:raise ValueError('Invalid reference description')
    raw=path.read_bytes();digest=hashlib.sha256(raw).hexdigest();name=path.relative_to(out).as_posix()
    if digest!=row['sha256'] or not raw.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('Reference asset does not match its approved original')
    seen.add(ident);written[name]={'sha256':digest,'bytes':len(raw),'mime':'image/png'}
    places[ident]['referenceDescription']=description
    new_refs.append({'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'horde:aslyn-v18:reference:place:'+ident+':'+digest)),'role':'place','entityId':ident,'label':places[ident]['label']+' · Place reference','tags':['establishing','generated_setting','v18_location_refresh'],'status':'approved','image':prefix+name})
   clean['startingReferences'].extend(new_refs)
   (out/'authored-place-provenance.json').write_text(json.dumps(overlay,ensure_ascii=False,indent=2)+'\n')
  if profile_overlay:clean=apply_profile_overlay(clean,json.loads(pathlib.Path(profile_overlay).read_text()))
  if route_overlay:
   overlay=json.loads(pathlib.Path(route_overlay).read_text());pack=json.loads(pathlib.Path(overlay['newPack']).read_text());mapping=overlay.get('bindings',{})
   ids={p['id'] for p in clean['lifeProfile']['places']};routes=[]
   for raw in pack['routes']:
    row={**raw,'from':mapping.get(raw['from'],raw['from']),'to':mapping.get(raw['to'],raw['to']),'source':pack['source'],'cost':0}
    if row['from'] not in ids or row['to'] not in ids:raise ValueError('Updated route refers to a missing saved place')
    routes.append(row)
   kept=[r for r in clean['lifeProfile']['travelLegs'] if r.get('source')!=overlay['oldSource']]
   clean['lifeProfile']['travelLegs']=kept+routes
  if feed_overlay:
   overlay=json.loads(pathlib.Path(feed_overlay).read_text())
   if overlay.get('format')!='horde-bundled-feed-overlay' or overlay.get('version')!=1 or overlay.get('characterName')!=clean['name']:raise ValueError('Invalid feed overlay')
   posts={row['id']:row for row in clean['startingSocialPosts']}
   for row in overlay['posts']:
    path=pathlib.Path(row['photo']);name=path.relative_to(out).as_posix()
    if not path.resolve().is_relative_to(out.resolve()):raise ValueError('Feed asset is outside the bundle')
    raw=path.read_bytes();digest=hashlib.sha256(raw).hexdigest()
    if digest!=row['sha256'] or not raw.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('Feed asset does not match its approved original')
    written[name]={'sha256':digest,'bytes':len(raw),'mime':'image/png'}
    posts[row['id']]={k:v for k,v in row.items() if k!='sha256'}
   clean['startingSocialPosts']=list(posts.values())
  clean=sanitize_bundled_item_namespaces(clean,[row.get('worldId') for row in archive.get('vh2ServiceArchives',[])])
  # Only enumerate and retain files actually reachable from the final template.
  used=set()
  def collect(value):
   if isinstance(value,str) and value.startswith(prefix):used.add(value[len(prefix):])
   elif isinstance(value,dict):
    for item in value.values():collect(item)
   elif isinstance(value,list):
    for item in value:collect(item)
  collect(clean)
  for name in list(written):
   if name not in used:
    (out/name).unlink();del written[name]
  result={'_format':'horde-studio-virtual-human','_version':3,'_kind':'character-template','companion':clean}
  (out/'character.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
  report={'sourceSha256':hashlib.sha256(pathlib.Path(source).read_bytes()).hexdigest(),'sourceCompanionId':source_id,'name':clean['name'],'posts':len(clean['startingSocialPosts']),'galleryPhotos':len(clean['startingGallery']),'clips':len(clean['startingVideoClips']),'references':len(clean['startingReferences']),'files':written,'privateConversationsIncluded':False}
  (out/'inventory.json').write_text(json.dumps(report,indent=2)+'\n')
  if location_report:(out/'location-provenance.json').write_text(json.dumps(location_report,ensure_ascii=False,indent=2)+'\n')
  print(json.dumps({k:v for k,v in report.items() if k!='files'},indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('output',type=pathlib.Path);p.add_argument('--approve-references',action='store_true',help='Use only when the publisher has explicitly approved every non-archived reference');p.add_argument('--conversation-overlay',type=pathlib.Path);p.add_argument('--location-overlay',type=pathlib.Path);p.add_argument('--profile-overlay',type=pathlib.Path);p.add_argument('--feed-overlay',type=pathlib.Path);p.add_argument('--route-overlay',type=pathlib.Path);p.add_argument('--extra-reference-overlay',type=pathlib.Path);a=p.parse_args();build(a.source,a.output,a.approve_references,a.conversation_overlay,a.location_overlay,a.profile_overlay,a.feed_overlay,a.route_overlay,a.extra_reference_overlay)
