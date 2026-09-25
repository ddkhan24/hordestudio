"""Durable frozen photo captures; browser adapters render, service imports once."""
from importlib import import_module as _vh_import_module
import base64, copy, hashlib, io, json, uuid
SCHEMA='''CREATE TABLE IF NOT EXISTS photo_jobs (
 id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), snapshot TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS photo_assets (
 id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), mime TEXT NOT NULL, bytes BLOB NOT NULL);
 CREATE TRIGGER IF NOT EXISTS photo_snapshot_immutable BEFORE UPDATE ON photo_jobs
 BEGIN SELECT RAISE(ABORT,'Photo captures are immutable'); END;'''

IMAGE_MIME_TYPES=('image/png','image/jpeg','image/webp')
IMAGE_MAX_DIMENSION=2048
IMAGE_OPTIMIZE_ABOVE=256*1024
CAPTURE_SNAPSHOT_VERSION=1

def compact_capture_snapshot(snapshot):
    """Return the complete immutable input needed to compile this photograph.

    A kernel capture historically embedded the entire companion simulation,
    including decision histories, routines and ledgers that image compilation
    never reads.  Keep all frozen capture/reference fields, but reduce the
    companion to the authored visual inputs consumed by compile_image().
    """
    if not isinstance(snapshot,dict) or not isinstance(snapshot.get('companion'),dict):
        raise ValueError('Invalid frozen photo capture.')
    companion=snapshot['companion'];life=companion.get('lifeProfile',{})
    if not isinstance(life,dict):life={}
    compact={key:copy.deepcopy(value) for key,value in snapshot.items() if key!='companion'}
    compact_companion={key:copy.deepcopy(companion[key]) for key in
        ('id','age','vh2Calendar','personality','photoStyle','photoDirection') if key in companion}
    people=life.get('socialCircle',[])
    if not isinstance(people,list):people=[]
    compact_companion['lifeProfile']={'socialCircle':[
        {key:copy.deepcopy(person[key]) for key in ('id','name','appearance') if key in person}
        for person in people if isinstance(person,dict)
    ]}
    compact['companion']=compact_companion
    compact['captureSnapshotVersion']=CAPTURE_SNAPSHOT_VERSION
    return compact

def optimize_image_bytes(mime,raw):
    """Bound and recompress new photographic assets when Pillow is available.

    The desktop browser normalizes uploads before they reach the service.  The
    self-host image worker has no browser, so its container includes Pillow and
    uses this path.  Existing assets are deliberately left byte-for-byte alone.
    """
    if mime not in IMAGE_MIME_TYPES:return mime,raw
    try:
        from PIL import Image,ImageOps
    except ImportError:
        return mime,raw
    try:
        with Image.open(io.BytesIO(raw)) as source:
            width,height=source.size
            if width<1 or height<1 or width*height>40_000_000:raise ValueError('Image dimensions exceed the 40 megapixel import limit.')
            image=ImageOps.exif_transpose(source)
            over=max(image.size)>IMAGE_MAX_DIMENSION
            if len(raw)<IMAGE_OPTIMIZE_ABOVE and not over:return mime,raw
            if over:
                resampling=getattr(Image,'Resampling',Image).LANCZOS
                image.thumbnail((IMAGE_MAX_DIMENSION,IMAGE_MAX_DIMENSION),resampling)
            output=io.BytesIO();has_alpha='A' in image.getbands() or 'transparency' in source.info
            if has_alpha:
                try:
                    image.convert('RGBA').save(output,'WEBP',quality=84,method=6)
                    optimized_mime='image/webp'
                except (OSError,ValueError):
                    output=io.BytesIO();image.convert('RGBA').save(output,'PNG',optimize=True)
                    optimized_mime='image/png'
            else:
                image.convert('RGB').save(output,'JPEG',quality=84,optimize=True,progressive=True)
                optimized_mime='image/jpeg'
            optimized=output.getvalue()
            if optimized and (over or len(optimized)<len(raw)):return optimized_mime,optimized
            return mime,raw
    except ValueError:
        raise
    except Exception:
        # The format signature was already validated by the caller.  A decoder
        # limitation must not make a previously supported image unimportable.
        return mime,raw

def store_asset(db,world_id,mime,raw):
    """Store one binary once per life and return its stable content ID."""
    ident=hashlib.sha256(world_id.encode()+raw).hexdigest()
    existing=db.execute('SELECT world_id,mime,bytes FROM photo_assets WHERE id=?',(ident,)).fetchone()
    if existing:
        # Equivalent MIME aliases (for example audio/mp3 vs audio/mpeg) may
        # describe the same bytes.  The first validated media type remains the
        # canonical response header for that asset.
        if existing['world_id']!=world_id or existing['bytes']!=raw:
            raise ValueError('Media content identifier collision.')
        return ident
    db.execute('INSERT INTO photo_assets VALUES (?,?,?,?)',(ident,world_id,mime,raw))
    return ident

def decode_image(image):
    if not isinstance(image,str) or len(image)>12_000_000:
        raise ValueError('Image exceeds the import limit.')
    if not image.startswith('data:image/'):
        raise ValueError('The provider returned text or a link instead of image data. No photo was delivered. Check Image activity and the selected image model.')
    try:
        header,data=image.split(',',1);mime=header.removeprefix('data:').removesuffix(';base64')
        if header!=f'data:{mime};base64' or mime not in IMAGE_MIME_TYPES:raise ValueError()
        raw=base64.b64decode(data,validate=True)
        valid=(mime=='image/png' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or (mime=='image/jpeg' and raw.startswith(b'\xff\xd8\xff')) or (mime=='image/webp' and raw.startswith(b'RIFF') and raw[8:12]==b'WEBP')
        if not valid or len(raw)<24:raise ValueError()
    except (ValueError,TypeError):raise ValueError('Import a PNG, JPEG or WebP data image.') from None
    return optimize_image_bytes(mime,raw)


def command(service,db,world_id,revision,state,body):
    from .vh2_runtime import encode, Conflict
    if body['type'] not in ('capture_photo','capture_reference'):
        target=next((p for p in state.get('photos',[]) if p['id']==body.get('photoId')),None)
        if target and target.get('recipientPersonaId'):
            state=_vh_import_module('.vh2_conversations',__package__).view(state,target['recipientPersonaId'])
    after=json.loads(encode(state));kind=body['type'];photos=after.setdefault('photos',[])
    if kind not in ('capture_photo','capture_reference') and not any(p['id']==body.get('photoId') for p in photos):
        archived=_vh_import_module('.vh2_library',__package__).get(db,world_id,'photo',body.get('photoId'))
        if archived:photos.append(archived)
    if kind in ('capture_photo','capture_reference'):
        scene=body.get('scene');mode=body.get('captureType','front_camera_selfie');destination=body.get('destination','private_chat')
        origin=body.get('origin','explicit_player_request')
        if origin not in ('explicit_player_request','dialogue_action'):raise ValueError('Unsupported photo origin.')
        view=body.get('view') if kind=='capture_reference' else None
        if kind=='capture_reference':
            role=body.get('role','identity');entity=body.get('entityId') or after['truth']['companion']['id'];description=body.get('description','')
            from .vh2_assets import REFERENCE_VIEWS, reference_subjects
            if role not in REFERENCE_VIEWS or not isinstance(description,str) or len(description)>1200:raise ValueError('Choose a supported reference role and short visual description.')
            if view not in REFERENCE_VIEWS[role]:raise ValueError('Choose a supported view for this reference role.')
            char=after['truth']['companion'];owners=reference_subjects(char)
            if not isinstance(entity,str) or entity not in owners[role]:raise ValueError('Link this reference study to an existing entity.')
            subject=owners[role][entity];label=subject.get('label') or subject.get('name') or role
            scene='Production reference: '+label+' '+view.replace('_',' ');mode='front_camera_selfie';destination='reference'
            seed_id=body.get('seedEntryId')
            if seed_id:
                seed=next((e for e in char.get('vh2Assets',{}).get('entries',[]) if e['id']==seed_id),None)
                if not seed or seed['role']!=role or seed['entityId']!=entity or seed['status'] not in ('approved','pending'):raise ValueError('Choose an available reference belonging to this subject.')
            from .vh2_assets import reference_prompt
            study={'role':role,'entityId':entity,'view':view,'requiresReference':role=='identity' and view not in ('front_face','turnaround'),'seedEntryId':seed_id,'prompt':reference_prompt(role,view,subject,description,char.get('photoStyle','realistic'),char)}
        if destination not in (('reference',) if kind=='capture_reference' else ('private_chat','gallery')):raise ValueError('Choose private chat or gallery.')
        if not isinstance(scene,str) or not 1<=len(scene.strip())<=600:raise ValueError('Describe the photo in 1–600 characters.')
        if mode not in ('front_camera_selfie','mirror_selfie'):raise ValueError('Choose front camera or mirror selfie.')
        if any(p['status']=='captured' and p.get('origin')!='autonomous' or p['status']=='submitted' and (lambda j: j[0] in ('queued','submitted','rendered') if j else service.clock()-p.get('submittedWallAt',0)<15*60000)(db.execute('SELECT status FROM vh2_provider_jobs WHERE id=?',('image:'+p['id'],)).fetchone()) for p in photos):raise Conflict('An image is already being prepared or rendered. Open Image activity to see its progress.')
        revision,state=service.synchronize_communication(db,world_id,revision,state)
        after=json.loads(encode(state));photos=after.setdefault('photos',[])
        frozen=service.kernel({'companion':after['truth']['companion'],'now':after['simAt'],'inspect':True,'capture':True})
        if kind=='capture_photo' and frozen['present']['availability']=='asleep':raise Conflict('The character is asleep and cannot take a selfie.')
        photo_id=str(uuid.uuid5(uuid.NAMESPACE_URL,'vh2-photo:'+body['key']))
        context={**frozen['photoContext'],'scene':scene.strip(),'destination':destination}
        snapshot={'companion':frozen['companion'],'photoContext':context,'scene':scene.strip(),'captureType':mode,'destination':destination,'kernelVersion':state['kernelVersion']}
        if kind=='capture_reference':context.update(placeId='',garmentIds=[],withNames=[],personIds=[],referenceStudy=view,assetStudy=study)
        _vh_import_module('.vh2_assets',__package__).freeze(snapshot)
        snapshot=compact_capture_snapshot(snapshot)
        db.execute('INSERT INTO photo_jobs VALUES (?,?,?)',(photo_id,world_id,encode(snapshot)))
        photos.append({'id':photo_id,'status':'captured','origin':origin,'at':after['simAt'],'scene':scene.strip(),'captureType':mode,'destination':destination,'photoContext':context,**({'recipientPersonaId':after['communication']['personaId'],'recipientConversationGeneration':after['communication'].get('generation',0)} if destination=='private_chat' else {})})
        event='PHOTO_CAPTURED';details={'photoId':photo_id,'snapshot':snapshot,'origin':origin}
    else:
        photo_id=body.get('photoId');item=next((p for p in photos if p['id']==photo_id),None)
        if not item:raise ValueError('Unknown photo capture.')
        if kind=='submit_photo':
            if item['status']!='captured':raise Conflict('Photo already submitted or finished; no automatic resubmission.')
            manifest=body.get('manifest',{})
            if not isinstance(manifest,dict) or set(manifest)-{'promptPreview','referenceHashes','provider','model','style','direction'}:raise ValueError('Invalid photo manifest.')
            for k,limit in (('promptPreview',20000),('provider',100),('model',200),('style',100),('direction',4000)):
                if k in manifest and (not isinstance(manifest[k],str) or len(manifest[k])>limit):raise ValueError('Invalid photo manifest field.')
            hashes=manifest.get('referenceHashes',[])
            if not isinstance(hashes,list) or len(hashes)>20 or any(not isinstance(h,str) or len(h)!=64 or any(ch not in '0123456789abcdef' for ch in h) for h in hashes):raise ValueError('Invalid photo reference hashes.')
            item['manifest']=manifest
            for k in ('style','direction'):
                if k in manifest:item['photoContext'][k]=manifest[k]
            item['status']='submitted';item['submittedWallAt']=service.clock();event='PHOTO_SUBMITTED';details={'photoId':photo_id}
            for post in after.get('social',{}).get('posts',[]):
                if post.get('photoId')==photo_id:post.pop('imageError',None)
        elif kind=='abandon_photo':
            if item['status'] not in ('captured','submitted'):raise Conflict('Photo is already finished.')
            item['status']='abandoned';event='PHOTO_ABANDONED';details={'photoId':photo_id}
            for post in after.get('social',{}).get('posts',[]):
                if post.get('photoId')==photo_id and post.get('status')=='draft' and post.get('imagePending'):post.update(status='abandoned',abandonedAt=after['simAt'])
        elif kind=='import_photo':
            if item['status']!='submitted':raise Conflict('Photo is not awaiting an image.')
            image=body.get('image','')
            mime,raw=decode_image(image)
            asset=store_asset(db,world_id,mime,raw)
            gallery=item.get('destination') in ('gallery','reference') or bool(after['communication'].get('deletedAt')) or item.get('recipientConversationGeneration',0)!=after['communication'].get('generation',0)
            item.update(status='stored' if gallery else 'delivered',assetId=asset,deliveredAt=after['simAt'])
            for post in after.get('social',{}).get('posts',[]):
                if post.get('photoId')==photo_id and post.get('status')=='draft' and post.get('imagePending'):
                    post.update(assetId=asset,imagePending=False);post.pop('imageError',None)
            usage=after['truth']['companion'].setdefault('usage',{});usage['photosGenerated']=int(usage.get('photosGenerated',0))+1
            if not gallery:
                after['communication']['messages'].append({'id':photo_id,'role':'assistant','type':'photo','deliveryState':'delivered','text':'[Photo shared]',
                    'scene':item['scene'],'timestamp':after['simAt'],'capturedAt':item['at'],'assetId':asset,'photoContext':item['photoContext']})
                after['playerKnowledge'].append({'kind':'photo_delivered','photoId':photo_id,'at':after['simAt'],'capturedAt':item['at']})
            _vh_import_module('.vh2_assets',__package__).bind_imported_reference(db,world_id,after,item)
            event='PHOTO_STORED' if gallery else 'PHOTO_DELIVERED';details={'photoId':photo_id,'assetId':asset}
            if item.get('referenceBinding'):details['referenceBinding']=item['referenceBinding']
        else:raise ValueError('Unsupported photo command.')
    if kind in ('import_photo','abandon_photo'):
        for intent in after['truth']['companion'].get('vh2Agency',{}).get('captures',[]):
            if intent.get('photoId')==photo_id:intent['status']='rendered' if kind=='import_photo' else 'abandoned'
    revision=service.commit_event(db,world_id,revision,state,after,event,details)
    return revision,after,photo_id
