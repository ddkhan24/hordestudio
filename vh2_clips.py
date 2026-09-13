"""Author-side clip drafts and durable generation receipts."""
import json,re,math
COMMANDS=('request_clip','update_clip_job','separate_clip_creation','delete_clip','import_starter_clip','edit_clip_caption')
def command(service,db,world,revision,state,body):
 from vh2_runtime import encode,Conflict
 after=json.loads(encode(state));clips=after.setdefault('clips',[]);kind=body['type'];now=state['simAt']
 if kind=='import_starter_clip':
  ident=body.get('clipId');caption=body.get('caption','');age=body.get('ageDays',1)
  if not isinstance(ident,str) or not re.fullmatch(r'[A-Za-z0-9_:-]{1,100}',ident) or not isinstance(caption,str) or len(caption)>1200 or type(age) not in (int,float) or not 0<=age<=3650:raise ValueError('Provide a valid starter clip and age.')
  if any(c['id']==ident for c in clips):return revision,state
  clips.append({'id':ident,'status':'ready','caption':caption,'origin':'authored_starter','createdAt':max(0,now-int(age*86400000)),'updatedAt':now,'progress':100})
  revision=service.commit_event(db,world,revision,state,after,'STARTER_CLIP_IMPORTED',{'clipId':ident,'mediaStorage':'character_archive'})
  return revision,after
 if kind=='separate_clip_creation':
  # Preserve the mistaken technical messages in the event history and an archive,
  # but remove them from conversation/attention; they were never player speech.
  ids={c['id'] for c in clips}
  removed=[m for m in after['communication']['messages'] if m.get('type')=='clip_request' and any('[CLIP REQUEST '+ident+']' in m.get('text','') for ident in ids)]
  removed_ids={m['id'] for m in removed}
  after.setdefault('clipCreationArchive',[]).extend(removed)
  after['communication']['messages']=[m for m in after['communication']['messages'] if m['id'] not in removed_ids]
  after['hiddenClipMessageIds']=list(dict.fromkeys(after.get('hiddenClipMessageIds',[])+list(removed_ids)))
  for clip in clips:
   if clip['status'] in ('requested','accepted','refused'):
    clip.update(status='draft',concept=clip.get('concept') or clip['requestText'],characterDecision='',reason='',updatedAt=now)
  for job in db.execute('SELECT * FROM dialogue_jobs WHERE world_id=?',(world,)).fetchall():
   ready=set(json.loads(job['snapshot']).get('context',{}).get('readyMessageIds',[]))
   if ready & removed_ids and job['status'] in ('queued','leased','failed','unknown'):
    db.execute("UPDATE dialogue_jobs SET status='superseded',token=NULL,lease_until=NULL,reason='Clip creation is not a conversation request.' WHERE id=?",(job['id'],))
    if after['communication'].get('replyJob',{}).get('id')==job['id']:after['communication']['replyJob']=None
  revision=service.commit_event(db,world,revision,state,after,'CLIP_CREATION_SEPARATED',{'hiddenMessageIds':list(removed_ids)})
  return revision,after
 if kind=='request_clip':
  raw=body.get('clip',{});ident=raw.get('id');text=raw.get('requestText')
  if not isinstance(ident,str) or not re.fullmatch(r'[A-Za-z0-9_:-]{1,100}',ident) or not isinstance(text,str) or not 1<=len(text)<=1200:raise ValueError('Provide a clip ID and description.')
  if any(c['id']==ident for c in clips):raise Conflict('Clip request already exists.')
  if not after['truth']['companion'].get('allowVideoClips'):raise Conflict('Enable Video & Clips for this life first.')
  clip={k:raw.get(k) for k in ('id','requestText','provider','model','duration','resolution','clipType','cameraRig','scenePlaceId','sceneZoneId')}
  if clip['provider'] not in ('openrouter','evolink','wavespeed','fal','hotapi'):raise ValueError('Unsupported clip provider.')
  if not isinstance(clip['model'],str) or len(clip['model'])>300 or type(clip['duration']) not in (int,float) or not 2<=clip['duration']<=30 or clip['resolution'] not in ('480p','720p','1080p','2k','4k'):raise ValueError('Invalid clip model, duration or quality.')
  char=after['truth']['companion'];place=clip.get('scenePlaceId');zone=clip.get('sceneZoneId')
  if place and place not in {p['id'] for p in char['lifeProfile']['places']}:raise ValueError('Choose an existing scene location.')
  if zone and not any(z['id']==zone and z['placeId']==place for z in char.get('vh2Visual',{}).get('zones',[])):raise ValueError('The scene room must belong to the selected place.')
  clip.update(status='draft',concept=text,createdAt=now,updatedAt=now,progress=0,origin='author_render')
  clips.append(clip)
  revision=service.commit_event(db,world,revision,state,after,'CLIP_DRAFT_CREATED',{'clipId':ident})
  return revision,after
 clip=next((c for c in clips if c['id']==body.get('clipId')),None)
 if not clip:raise Conflict('Unknown clip.')
 if kind=='delete_clip':
  if clip['status'] in ('submitting','generating','downloading','queued'):raise Conflict('Wait for generation to finish before deleting this clip.')
  clip['deletedAt']=now
  revision=service.commit_event(db,world,revision,state,after,'CLIP_DELETED',{'clipId':clip['id']})
  return revision,after
 if clip.get('deletedAt'):raise Conflict('This clip was deleted.')
 if kind=='edit_clip_caption':
  caption=body.get('caption')
  if not isinstance(caption,str) or len(caption)>1200:raise ValueError('Use a caption of up to 1,200 characters.')
  clip['caption']=caption.strip();clip['updatedAt']=now
  revision=service.commit_event(db,world,revision,state,after,'CLIP_CAPTION_EDITED',{'clipId':clip['id']})
  return revision,after
 update=body.get('update',{});status=update.get('status')
 transitions={'draft':('submitting',),'accepted':('submitting',),'submitting':('generating','unknown'),'generating':('generating','downloading','ready','failed','unknown'),'downloading':('ready','failed'),'failed':('submitting',)}
 if status not in transitions.get(clip['status'],()):raise Conflict('This clip cannot make that transition. An unknown submission must not be retried automatically.')
 for k in ('providerJobId','outputUrl','assetId','error','model'):
  if k in update:
   if not isinstance(update[k],str) or len(update[k])>4000:raise ValueError('Invalid clip receipt.')
   clip[k]=update[k]
 if 'prompt' in update:
  if not isinstance(update['prompt'],str) or len(update['prompt'])>12000:raise ValueError('Invalid clip prompt.')
  clip['prompt']=update['prompt']
 if update.get('referenceManifest') is not None:
  manifest=update['referenceManifest']
  if not isinstance(manifest,dict) or len(json.dumps(manifest))>16000:raise ValueError('Invalid clip reference manifest.')
  clip['referenceManifest']=manifest
 progress=update.get('progress',clip.get('progress',0))
 if type(progress) not in (int,float) or not math.isfinite(progress):raise ValueError('Invalid clip progress.')
 clip.update(status=status,updatedAt=now,progress=min(100,max(0,progress)))
 revision=service.commit_event(db,world,revision,state,after,'CLIP_JOB_UPDATED',{'clipId':clip['id'],'status':status})
 return revision,after
