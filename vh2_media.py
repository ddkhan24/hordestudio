"""Durable frozen photo captures; browser adapters render, service imports once."""
import base64, hashlib, json, uuid
SCHEMA='''CREATE TABLE IF NOT EXISTS photo_jobs (
 id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), snapshot TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS photo_assets (
 id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), mime TEXT NOT NULL, bytes BLOB NOT NULL);
 CREATE TRIGGER IF NOT EXISTS photo_snapshot_immutable BEFORE UPDATE ON photo_jobs
 BEGIN SELECT RAISE(ABORT,'Photo captures are immutable'); END;'''
def command(service,db,world_id,revision,state,body):
    from vh2_runtime import encode, Conflict
    if body['type'] not in ('capture_photo','capture_reference'):
        target=next((p for p in state.get('photos',[]) if p['id']==body.get('photoId')),None)
        if target and target.get('recipientPersonaId'):
            state=__import__('vh2_conversations').view(state,target['recipientPersonaId'])
    after=json.loads(encode(state));kind=body['type'];photos=after.setdefault('photos',[])
    if kind not in ('capture_photo','capture_reference') and not any(p['id']==body.get('photoId') for p in photos):
        archived=__import__('vh2_library').get(db,world_id,'photo',body.get('photoId'))
        if archived:photos.append(archived)
    if kind in ('capture_photo','capture_reference'):
        scene=body.get('scene');mode=body.get('captureType','front_camera_selfie');destination=body.get('destination','private_chat')
        view=body.get('view') if kind=='capture_reference' else None
        if kind=='capture_reference':
            role=body.get('role','identity');entity=body.get('entityId') or after['truth']['companion']['id'];description=body.get('description','')
            from vh2_assets import REFERENCE_VIEWS,reference_subjects
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
            from vh2_assets import reference_prompt
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
        __import__('vh2_assets').freeze(snapshot)
        db.execute('INSERT INTO photo_jobs VALUES (?,?,?)',(photo_id,world_id,encode(snapshot)))
        photos.append({'id':photo_id,'status':'captured','at':after['simAt'],'scene':scene.strip(),'captureType':mode,'destination':destination,'photoContext':context,**({'recipientPersonaId':after['communication']['personaId'],'recipientConversationGeneration':after['communication'].get('generation',0)} if destination=='private_chat' else {})})
        event='PHOTO_CAPTURED';details={'photoId':photo_id,'snapshot':snapshot,'origin':'explicit_player_request'}
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
            if not isinstance(image,str) or len(image)>12_000_000:raise ValueError('Image exceeds the import limit.')
            try:
                header,data=image.split(',',1);mime=header.removeprefix('data:').removesuffix(';base64')
                if header!=f'data:{mime};base64' or mime not in ('image/png','image/jpeg','image/webp'):raise ValueError()
                raw=base64.b64decode(data,validate=True)
                valid=(mime=='image/png' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or (mime=='image/jpeg' and raw.startswith(b'\xff\xd8\xff')) or (mime=='image/webp' and raw.startswith(b'RIFF') and raw[8:12]==b'WEBP')
                if not valid or len(raw)<24:raise ValueError()
            except (ValueError,TypeError):raise ValueError('Import a PNG, JPEG or WebP data image.')
            asset=hashlib.sha256((world_id+photo_id).encode()+raw).hexdigest()
            db.execute('INSERT INTO photo_assets VALUES (?,?,?,?)',(asset,world_id,mime,raw))
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
            __import__('vh2_assets').bind_imported_reference(db,world_id,after,item)
            event='PHOTO_STORED' if gallery else 'PHOTO_DELIVERED';details={'photoId':photo_id,'assetId':asset}
            if item.get('referenceBinding'):details['referenceBinding']=item['referenceBinding']
        else:raise ValueError('Unsupported photo command.')
    if kind in ('import_photo','abandon_photo'):
        for intent in after['truth']['companion'].get('vh2Agency',{}).get('captures',[]):
            if intent.get('photoId')==photo_id:intent['status']='rendered' if kind=='import_photo' else 'abandoned'
    revision=service.commit_event(db,world_id,revision,state,after,event,details)
    return revision,after,photo_id
