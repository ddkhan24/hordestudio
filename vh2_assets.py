"""Reviewed, versioned references stored in the existing backed-up asset store."""
import base64,hashlib,json,uuid
COMMANDS=('add_bible_asset','review_bible_asset','archive_bible_asset')
REFERENCE_VIEWS={
 'identity':('turnaround','front_face','three_quarter','profile','full_body'),
 'person':('front_face','three_quarter','profile','full_body'),
 'place':('establishing','reverse_angle','detail'),
 'zone':('establishing','reverse_angle','detail'),
 'garment':('front','back','detail'),
 'prop':('front','back','detail'),
 'pose':('front_camera_selfie','mirror_selfie','full_body')
}
def reference_subjects(c):
 life=c['lifeProfile']
 return {'identity':{c['id']:c},'person':{p['id']:p for p in life['socialCircle']},
  'place':{p['id']:p for p in life['places']},'zone':{z['id']:z for z in c.get('vh2Visual',{}).get('zones',[])},
  'garment':{p['id']:p for p in life['world']['items']},'prop':{p['id']:p for p in life['world']['items']},'pose':{'pose':{'label':'Pose guide'}}}

def normalize_reference_plan(c,plan):
 """Resolve familiar generator aliases once; never guess between two named people."""
 import re
 def norm(value):return re.sub(r'[^a-z0-9]','',str(value or '').lower())
 role={'main_character':'identity','main':'identity','self':'identity','character':'identity','npc':'person','support':'person','supporting_person':'person','room':'zone','location':'place','object':'prop','item':'prop','clothing':'garment'}.get(plan.get('role'),plan.get('role'))
 subjects=reference_subjects(c)
 if role not in subjects:raise ValueError(f"Reference '{plan.get('label',plan.get('id',''))}' has an unsupported subject type.")
 owner=plan.get('entityId')
 if role=='identity':owner=c['id']
 elif owner not in subjects[role]:
  label=re.sub(r'\s+(?:identity\s+)?(?:views?|portrait|reference|exterior|front|profile).*$', '',str(plan.get('label','')),flags=re.I)
  candidates=[key for key,value in subjects[role].items() if norm(value.get('name') or value.get('label')) in (norm(owner),norm(label))]
  if len(candidates)==1:owner=candidates[0]
 if owner not in subjects[role]:raise ValueError(f"Reference '{plan.get('label',plan.get('id',''))}' refers to a missing or ambiguous {role}. Add that subject to this life first.")
 view=str(plan.get('view') or REFERENCE_VIEWS[role][0]).strip().lower().replace(' ','_').replace('-','_')
 aliases={'character_sheet':'turnaround','turnaround_sheet':'turnaround','reference_sheet':'turnaround','sheet':'turnaround','portrait':'front_face','headshot':'front_face','face':'front_face','front':'front_face','three_quarter_view':'three_quarter','3/4':'three_quarter','side':'profile','side_profile':'profile','fullbody':'full_body','full_length':'full_body'} if role in ('identity','person') else {'front':'establishing','wide':'establishing','interior':'establishing','exterior':'establishing','overview':'establishing','reverse':'reverse_angle','closeup':'detail','close_up':'detail'} if role in ('place','zone') else {'product':'front','packshot':'front','closeup':'detail','close_up':'detail'}
 view=aliases.get(view,view)
 if view not in REFERENCE_VIEWS[role]:raise ValueError(f"Reference '{plan.get('label',plan.get('id',''))}' has unsupported view '{view}'. Use {', '.join(REFERENCE_VIEWS[role])}.")
 subject=subjects[role][owner];label=plan.get('label') or (subject.get('name') or subject.get('label') or role)+' · '+view.replace('_',' ')
 return {**plan,'role':role,'entityId':owner,'view':view,'label':label,'description':plan.get('description') or label+' reference image.'}

def reference_prompt(role,view,subject,description='',style='realistic',companion=None):
 """Visual specification only: social biography is never an appearance fallback."""
 human=role in ('identity','person')
 visual=str(subject.get('appearance') or subject.get('referenceDescription') or '').strip() if human else str(subject.get('referenceDescription') or subject.get('description') or subject.get('detail') or '').strip()
 if role in ('prop','garment') and not visual:visual=', '.join([str(subject.get('name',''))]+[str(t) for t in subject.get('tags',[])])
 if human:
  base='Studio reference of ONE person. Preserve the same face, age, hair, body proportions and distinguishing features as this subject’s supplied references, if any. Plain opaque everyday clothing and a neutral background. Do not borrow another person’s identity or infer physical traits from a name, occupation, relationship or personality.'
  detail='Authored appearance: '+visual[:2000] if visual else 'No physical appearance has been authored. If no subject reference is supplied, create an initial neutral character design for review; its appearance is not an established fact.'
  age=__import__('vh2_calendar').current_age(companion or subject,subject)
  if isinstance(age,(int,float)) and not isinstance(age,bool) and 0<=age<=120:detail+=' Age: '+str(age)+' years.'
 else:
  base={'zone':'Unoccupied room reference. Preserve its layout, furniture, materials and permanent fixtures. No people.', 'place':'Unoccupied environment reference. Preserve its architecture, layout, materials and persistent objects. No people.', 'prop':'Isolated product reference of this object. Preserve its shape, materials, color and functional details. No wearer or unrelated objects.', 'garment':'Isolated garment reference. Preserve its color, fabric, cut, pattern and fastenings. No wearer.', 'pose':'Identity-independent pose guide using a plain clothed mannequin.'}[role]
  detail='Visual description: '+(visual[:2000] or 'Visual details are not yet specified; establish an initial design for review.')
 views={'turnaround':'Create ONE cohesive character turnaround sheet: front-facing full body, side-profile full body, rear full body, plus a large three-quarter face portrait. All views depict the EXACT same person in identical clothing. Clean pale neutral background, even lighting, clear separation between views.', 'front_face':'One front-facing head-and-shoulders portrait, face unobstructed, looking toward camera.', 'three_quarter':'One head-and-shoulders portrait with the face turned about 45 degrees toward the camera.', 'profile':'One true side-profile portrait, head turned 90 degrees from the camera.', 'full_body':'One full-length view, entire body and feet in frame.', 'establishing':'One wide establishing view showing the spatial layout.', 'reverse_angle':'One view from the opposite side of the same space. Preserve the established layout.', 'detail':'One close-up of a distinctive physical detail.', 'front':'One front product view, entire item visible on a neutral background.', 'back':'One rear product view, entire item visible on a neutral background.', 'front_camera_selfie':'Demonstrate a handheld front-camera pose at arm’s length.', 'mirror_selfie':'Demonstrate a physically coherent mirror selfie pose with a visible reflected phone.'}
 extra=(' Additional visual direction: '+description[:1200]) if description and description.strip()!=visual else ''
 treatment={'illustrated':'Hand-painted animation illustration with textured brushwork.', 'graphic_novel':'Painterly graphic-novel rendering with ink contours.', 'film':'Natural photographic rendering with fine film grain.', 'instant':'Natural photographic rendering with gentle instant-film color.'}.get(style,'Natural realistic photographic rendering with clear physical detail.')
 return base+' '+detail+extra+' '+views[view]+' '+treatment+' No lettering, captions or watermark. This is a production reference, not an event in the character’s life.'

ROLES=tuple(REFERENCE_VIEWS)
def ensure(c):return c.setdefault('vh2Assets',{'entries':[]})
def generated_entry(entries,photo,role,owner):
 return next((e for e in entries if e.get('role')==role and e.get('entityId')==owner and e.get('assetId')==photo.get('assetId') and e.get('source',{}).get('photoId')==photo['id']),None)

def generated_reference(world_id,photo,role,owner,label,tags,at):
 return {'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'vh2-generated-reference:'+world_id+':'+photo['id']+':'+role+':'+owner)),
  'assetId':photo['assetId'],'role':role,'entityId':owner,'label':label,'tags':tags,'status':'pending','version':1,'createdAt':at,
  'parents':photo.get('photoContext',{}).get('referenceAssetIds',[]),'source':{'kind':'generated','photoId':photo['id'],'manifest':photo.get('manifest',{})}}

def bind_imported_reference(db,world_id,state,photo):
 """Link an explicit reference study in the same transaction as image import.

 A removed target or an incomplete older capture must not discard a paid
 image. Retain the image with a precise binding issue for manual correction.
 """
 if photo.get('destination')!='reference' or not photo.get('assetId'):return
 def issue(message):photo['referenceBinding']={'status':'needs_attention','error':message}
 row=db.execute('SELECT snapshot FROM photo_jobs WHERE world_id=? AND id=?',(world_id,photo['id'])).fetchone()
 if not row:issue('The original reference plan is unavailable. The image is saved; choose its subject in the Reference Library.');return
 snapshot=json.loads(row['snapshot'])
 if not isinstance(snapshot,dict):issue('The original reference plan is incomplete. The image is saved; link it in the Reference Library.');return
 context=snapshot.get('photoContext',{});study=context.get('assetStudy') if isinstance(context,dict) else None
 if snapshot.get('destination')!='reference' or not isinstance(study,dict):issue('This older capture does not identify a reference subject and view. The image is saved; link it in the Reference Library.');return
 role=study.get('role');owner=study.get('entityId');view=study.get('view')
 if not isinstance(role,str) or role not in REFERENCE_VIEWS or not isinstance(owner,str) or not isinstance(view,str) or view not in REFERENCE_VIEWS[role] or context.get('referenceStudy')!=view:issue('The captured reference plan has an unsupported subject or view. The image is saved; link it in the Reference Library.');return
 c=state['truth']['companion'];owners=reference_subjects(c)
 if owner not in owners[role]:issue('The original reference subject is no longer in this life. The image is saved; choose its subject in the Reference Library.');return
 entries=ensure(c)['entries'];entry=generated_entry(entries,photo,role,owner)
 if not entry:
  if len(entries)>=300:issue('The Reference Library has reached its 300-image limit. This image is saved and can still be viewed in Media.');return
  subject=owners[role][owner];label=(str(subject.get('label') or subject.get('name') or role)+' · '+view.replace('_',' '))[:120]
  entry=generated_reference(world_id,photo,role,owner,label,[view]+(['face'] if view=='front_face' else []),state['simAt']);entries.append(entry)
 photo['referenceBinding']={'status':'linked','entryId':entry['id']}

def command(service,db,world_id,revision,state,body):
 from vh2_runtime import encode
 after=json.loads(encode(state));c=after['truth']['companion'];entries=ensure(c)['entries'];kind=body['type']
 if kind=='add_bible_asset':
  role=body.get('role');owner=body.get('entityId','');tags=body.get('tags',[]);label=body.get('label','');photo_id=body.get('photoId');parents=[]
  owners=reference_subjects(c)
  if role not in ROLES or not isinstance(owner,str) or owner not in owners[role]:raise ValueError('Link the reference to an existing identity, place, person or garment.')
  if not isinstance(label,str) or not 1<=len(label.strip())<=120 or not isinstance(tags,list) or len(tags)>20 or any(not isinstance(t,str) or not 1<=len(t)<=40 for t in tags):raise ValueError('Add a short label and up to twenty tags.')
  if photo_id:
   photo=next((p for p in after.get('photos',[]) if p['id']==photo_id and p.get('assetId')),None)
   if not photo:raise ValueError('Choose a rendered photo from this timeline.')
   existing=generated_entry(entries,photo,role,owner)
   if existing:
    binding={'status':'linked','entryId':existing['id']}
    if photo.get('destination')=='reference' and photo.get('referenceBinding')!=binding:
     photo['referenceBinding']=binding
     revision=service.commit_event(db,world_id,revision,state,after,'ASSET_BIBLE_CHANGED',{'operation':'link_existing_generated_reference','entryId':existing['id']})
     return revision,after
    return revision,state
   asset=photo['assetId'];parents=photo.get('photoContext',{}).get('referenceAssetIds',[]);source={'kind':'generated','photoId':photo_id,'manifest':photo.get('manifest',{})}
  else:
   image=body.get('image','')
   if not isinstance(image,str) or len(image)>12000000:raise ValueError('Image exceeds 12 MB encoded.')
   try:
    header,data=image.split(',',1);mime=header.removeprefix('data:').removesuffix(';base64');raw=base64.b64decode(data,validate=True)
    valid=header==f'data:{mime};base64' and ((mime=='image/png' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or (mime=='image/jpeg' and raw.startswith(b'\xff\xd8\xff')) or (mime=='image/webp' and raw.startswith(b'RIFF') and raw[8:12]==b'WEBP'))
    if not valid or len(raw)<24:raise ValueError()
   except (ValueError,TypeError):raise ValueError('Upload a PNG, JPEG or WebP image.')
   asset=hashlib.sha256(world_id.encode()+raw).hexdigest();db.execute('INSERT OR IGNORE INTO photo_assets VALUES (?,?,?,?)',(asset,world_id,mime,raw));source={'kind':'upload'}
  if len(entries)>=300:raise ValueError('The current bible supports 300 references.')
  entry=generated_reference(world_id,photo,role,owner,label.strip(),tags,after['simAt']) if photo_id else {'id':str(uuid.uuid4()),'assetId':asset,'role':role,'entityId':owner,'label':label.strip(),'tags':tags,'status':'pending','version':1,'createdAt':after['simAt'],'parents':parents,'source':source}
  entries.append(entry)
  if photo_id and photo.get('destination')=='reference':photo['referenceBinding']={'status':'linked','entryId':entry['id']}
 else:
  entry=next((e for e in entries if e['id']==body.get('entryId')),None)
  if not entry:raise ValueError('Unknown bible reference.')
  status='archived' if kind=='archive_bible_asset' else body.get('status')
  if status not in ('approved','rejected','archived'):raise ValueError('Approve, reject or archive the reference.')
  entry['status']=status;entry['version']+=1;entry['reviewedAt']=after['simAt']
 revision=service.commit_event(db,world_id,revision,state,after,'ASSET_BIBLE_CHANGED',{'operation':kind,'entryId':entry['id']})
 return revision,after

def freeze(snapshot):
 __import__('vh2_visual').decorate(snapshot)
 c=snapshot['companion'];context=snapshot['photoContext'];place=context.get('placeId');garments=set(context.get('garmentIds',[]));names=set(context.get('withNames',[]));people=set(context.get('personIds',[])) if 'personIds' in context else {p['id'] for p in c['lifeProfile']['socialCircle'] if p['name'] in names and sum(x['name']==p['name'] for x in c['lifeProfile']['socialCircle'])==1};mode=snapshot['captureType']
 scored=[]
 for e in c.get('vh2Assets',{}).get('entries',[]):
  study=context.get('assetStudy')
  if e['status']!='approved' and not (study and e['id']==study.get('seedEntryId') and e['status']=='pending'):continue
  role=e['role'];owner=e['entityId'];tags=e['tags'];score=None
  study=context.get('assetStudy')
  if study:
   if role!=study['role'] or owner!=study['entityId']:continue
   score=100+(1000 if e['id']==study.get('seedEntryId') else 0)+(10 if study['view'] in tags else 0)
   scored.append((score,e));continue
  if context.get('referenceStudy') and role!='identity':continue
  if role=='identity' and owner==c['id']:
   full=mode=='mirror_selfie' or context.get('referenceStudy')=='full_body'
   score=100+(35 if 'turnaround' in tags else 30 if full and 'full_body' in tags else 20 if 'face' in tags or 'front_face' in tags else 10 if 'three_quarter' in tags else 0)
  elif role=='zone' and owner==context.get('zoneId'):score=110
  elif role=='place' and owner==place:score=90
  elif role=='person' and owner in people:score=95
  elif role=='garment' and owner in garments:score=85
  elif role=='prop' and owner in context.get('propIds',[]):score=85
  elif role=='pose' and mode in tags:score=70
  if score is not None:scored.append((score+(5 if mode in tags else 0),e))
 scored.sort(key=lambda x:(-x[0],x[1]['id']));selected=[];counts={};assets=set()
 for _,e in scored:
  key=(e['role'],e['entityId']);limit=2 if e['role']=='identity' else 1
  if counts.get(key,0)>=limit or e['assetId'] in assets:continue
  selected.append({k:e[k] for k in ('id','assetId','role','entityId','label','tags','version')});counts[key]=counts.get(key,0)+1;assets.add(e['assetId'])
  if len(selected)>=8:break
 snapshot['referenceAssets']=selected;context['referenceAssetIds']=[e['id'] for e in selected]
 return selected
