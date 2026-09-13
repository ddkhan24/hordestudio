"""Service-owned in-world publication and player interactions.

Publication is an explicit operator action for now. Capturing a photo never
implies permission to post it, and social metadata cannot rewrite its reality.
"""
import json,base64,hashlib
import uuid
import vh2_library

COMMANDS=('regenerate_social_draft','dismiss_social_draft','import_starter_post','import_starter_gallery','publish_photo','withdraw_post','like_post','comment_post')

def starter_records(db,world,state):
    records={p['id']:p for p in (json.loads(r['data']) for r in db.execute("SELECT data FROM media_records WHERE world_id=? AND kind='post' AND json_extract(data,'$.origin')='authored_starter' ORDER BY position",(world,)))}
    records.update({p['id']:p for p in state.get('social',{}).get('posts',[]) if p.get('origin')=='authored_starter'})
    return list(records.values())

def repair_starter_duplicates(service,db,world,revision,state):
    """Merged lives retain old post IDs. Stable source identity survives the move."""
    groups={}
    for post in starter_records(db,world,state):
        if post.get('sourceId') and not post.get('mergedInto'):groups.setdefault(post['sourceId'],[]).append(post)
    groups=[posts for posts in groups.values() if len(posts)>1]
    if not groups:return revision,state,0
    after=json.loads(json.dumps(state));posts=after.setdefault('social',{}).setdefault('posts',[]);count=0
    for group in groups:
        keep=json.loads(json.dumps(group[0]));comments={}
        for item in group:
            for comment in item.get('comments',[]):comments.setdefault((comment.get('authorId'),comment.get('createdAt'),comment.get('text')),comment)
            for persona,reaction in item.get('likesByPersona',{}).items():
                prior=keep.setdefault('likesByPersona',{}).get(persona,{})
                if reaction.get('likedAt',0)>=prior.get('likedAt',0):keep['likesByPersona'][persona]=reaction
            if item.get('likedAt',0)>keep.get('likedAt',0):
                for key in ('likedByPlayer','likedAt','likeNoticedAt'):keep[key]=item.get(key)
            elif item.get('likedByPlayer') and not keep.get('likedAt'):keep['likedByPlayer']=True
        keep['comments']=list(comments.values())
        # A prior withdrawal remains authoritative; applying setup cannot republish it.
        if any(p['status']=='withdrawn' for p in group):keep['status']='withdrawn'
        for item in group:
            posts[:]=[p for p in posts if p['id']!=item['id']]
            if item['id']==keep['id']:posts.append(keep)
            else:posts.append({**item,'status':'merged','mergedInto':keep['id']});count+=1
    revision=service.commit_event(db,world,revision,state,after,'STARTER_POST_DUPLICATES_MERGED',{'merged':count})
    return revision,after,count

def command(service,db,world_id,revision,state,body):
    from vh2_runtime import Conflict,encode
    revision,state=service.synchronize_communication(db,world_id,revision,state)
    if body['type']=='import_starter_post':revision,state,_=repair_starter_duplicates(service,db,world_id,revision,state)
    after=json.loads(encode(state));posts=after.setdefault('social',{}).setdefault('posts',[])
    kind=body['type'];now=after['simAt']
    if kind in ('import_starter_post','import_starter_gallery'):
        source=body.get('sourceId');caption=body.get('caption','');age=body.get('ageDays',1)
        if not isinstance(source,str) or not 1<=len(source)<=200:raise ValueError('A stable starter post ID is required.')
        if not isinstance(caption,str) or len(caption)>4000:raise ValueError('Starter captions must be at most 4000 characters.')
        if type(age) not in (int,float) or not 0<=age<=36500:raise ValueError('Use a valid starter post age.')
        ident=str(uuid.uuid5(uuid.NAMESPACE_URL,('vh2-gallery:' if kind=='import_starter_gallery' else 'vh2-starter:')+world_id+':'+source))
        existing=next((p for p in starter_records(db,world_id,after) if not p.get('mergedInto') and (p.get('sourceId')==source or p['id']==ident)),None)
        if kind=='import_starter_gallery':
            existing=next((p for p in after.get('photos',[]) if p.get('sourceId')==source),None) or vh2_library.get(db,world_id,'photo',ident)
            if not existing:
                row=db.execute("SELECT data FROM media_records WHERE world_id=? AND kind='photo' AND json_extract(data,'$.sourceId')=? AND json_extract(data,'$.origin')='authored_starter' ORDER BY position LIMIT 1",(world_id,source)).fetchone()
                existing=json.loads(row['data']) if row else None
        if existing:ident=existing['id']
        image=body.get('image','');asset=None
        if image:
            if not isinstance(image,str) or len(image)>12_000_000:raise ValueError('Starter image exceeds the import limit.')
            try:
                header,data=image.split(',',1);mime=header.removeprefix('data:').removesuffix(';base64')
                if header!=f'data:{mime};base64' or mime not in ('image/png','image/jpeg','image/webp'):raise ValueError()
                raw=base64.b64decode(data,validate=True)
                valid=(mime=='image/png' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or (mime=='image/jpeg' and raw.startswith(b'\xff\xd8\xff')) or (mime=='image/webp' and raw.startswith(b'RIFF') and raw[8:12]==b'WEBP')
                if not valid or len(raw)<24:raise ValueError()
            except (ValueError,TypeError):raise ValueError('Import a PNG, JPEG or WebP starter image.')
            asset=hashlib.sha256((world_id+ident).encode()+raw).hexdigest()
            previous=db.execute('SELECT mime,bytes FROM photo_assets WHERE world_id=? AND id=?',(world_id,existing.get('assetId'))).fetchone() if existing and existing.get('assetId') else None
            if previous and previous['mime']==mime and previous['bytes']==raw:asset=existing['assetId']
            db.execute('INSERT OR IGNORE INTO photo_assets VALUES (?,?,?,?)',(asset,world_id,mime,raw))
        if not caption.strip() and not asset:raise ValueError('Starter posts need text or a completed photo.')
        at=max(0,now-int(age*86400000))
        if kind=='import_starter_gallery':
            if not asset:raise ValueError('A starter gallery photo needs an image.')
            recorded_at=existing.get('at',existing.get('capturedAt',at)) if existing else at
            photo={**(existing or {}),'id':ident,'sourceId':source,'assetId':asset,'scene':caption.strip(),'caption':caption.strip(),'status':'stored','destination':'gallery','origin':'authored_starter','at':recorded_at,'capturedAt':recorded_at,'deliveredAt':existing.get('deliveredAt',at) if existing else at,'photoContext':existing.get('photoContext',{'origin':'authored_starter'}) if existing else {'origin':'authored_starter'}}
            if existing==photo:return revision,state,ident
            after['photos']=[p for p in after.get('photos',[]) if p['id']!=ident]+[photo]
            revision=service.commit_event(db,world_id,revision,state,after,'STARTER_GALLERY_IMPORTED',{'photoId':ident})
            return revision,after,ident
        post={'id':ident,'photoId':'starter:'+source,'assetId':asset,'caption':caption.strip(),'capturedAt':at,'publishedAt':at,'starterAgeDays':age,'starterAnchorAt':now,
              'captureContext':{},'status':'published','visibility':'public','origin':'authored_starter','sourceId':source,
              'likedByPlayer':False,'comments':[]}
        if existing:
            # Keep reactions, withdrawal and historical date while refreshing authored content.
            post={**existing,'assetId':asset,'caption':caption.strip(),'starterAgeDays':age,'starterAnchorAt':existing.get('starterAnchorAt',existing['capturedAt']+int(age*86400000))}
            if 'starterAgeDays' in existing and existing['starterAgeDays']!=age:post['capturedAt']=post['publishedAt']=max(0,post['starterAnchorAt']-int(age*86400000))
            if post==existing:return revision,state,ident
            posts[:]=[p for p in posts if p['id']!=ident]
        posts.append(post);event='STARTER_POST_UPDATED' if existing else 'STARTER_POST_IMPORTED'
    elif kind=='publish_photo':
        photo=next((p for p in after.get('photos',[]) if p['id']==body.get('photoId')),None)
        if not photo:
            photo=vh2_library.get(db,world_id,'photo',body.get('photoId'))
        if not photo or photo['status'] not in ('delivered','stored') or not photo.get('assetId'):
            raise Conflict('Choose a completed photo from this timeline.')
        if photo.get('destination')=='reference':raise Conflict('Production references are not lived photographs and cannot be published.')
        if any(p['photoId']==photo['id'] for p in posts) or vh2_library.published(db,world_id,photo['id']):raise Conflict('This photo already has a publication record.')
        if after['truth']['present']['availability']=='asleep':raise Conflict('The character is asleep and cannot publish now.')
        caption=body.get('caption','')
        if not isinstance(caption,str) or len(caption)>1200:raise ValueError('Caption must be at most 1200 characters.')
        if not db.execute('SELECT 1 FROM photo_assets WHERE world_id=? AND id=?',(world_id,photo['assetId'])).fetchone():
            raise Conflict('The photo asset is missing; no post was published.')
        post={'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'vh2-post:'+body['key'])),
              'photoId':photo['id'],'assetId':photo['assetId'],'caption':caption.strip(),
              'capturedAt':photo['at'],'publishedAt':now,'captureContext':photo['photoContext'],
              'status':'published','visibility':'public','origin':'explicit_operator',
              'likedByPlayer':False,'comments':[]}
        posts.append(post);event='SOCIAL_PHOTO_PUBLISHED'
    else:
        post=next((p for p in posts if p['id']==body.get('postId')),None)
        if not post:
            post=vh2_library.get(db,world_id,'post',body.get('postId'))
            if post:posts.append(post)
        if post and post.get('mergedInto'):
            target=post['mergedInto'];post=next((p for p in posts if p['id']==target),None) or vh2_library.get(db,world_id,'post',target)
            if post and not any(p['id']==post['id'] for p in posts):posts.append(post)
        if kind=='regenerate_social_draft':
            if not post or post['status']!='draft' or not post.get('generationError'):raise Conflict('Only a failed draft can be regenerated.')
            retry=json.loads(json.dumps(post));retry.update(id='social-retry:'+str(uuid.uuid4()),status='draft',caption='',captionReady=False,retryOf=post['id'])
            retry.pop('generationError',None);retry['photoId']=retry['id']
            post.update(status='abandoned',abandonedAt=now);posts.append(retry)
            revision=service.commit_event(db,world_id,revision,state,after,'SOCIAL_REGENERATION_REQUESTED',{'postId':retry['id'],'retryOf':post['id']})
            return revision,after,retry['id']
        if kind=='dismiss_social_draft':
            if not post or post['status']!='draft':raise Conflict('This draft is not available.')
            post.update(status='abandoned',abandonedAt=now)
            revision=service.commit_event(db,world_id,revision,state,after,'SOCIAL_DRAFT_DISMISSED',{'postId':post['id']})
            return revision,after,post['id']
        if not post or post['status']!='published':raise Conflict('This post is not available.')
        if kind=='withdraw_post':
            post.update(status='withdrawn',withdrawnAt=now);event='SOCIAL_POST_WITHDRAWN'
        elif kind=='like_post':
            if type(body.get('liked')) is not bool:raise ValueError('Set liked to true or false.')
            primary=__import__('vh2_conversations').canonical(after)['communication']['personaId']
            persona=after['communication']['personaId'];likes=post.setdefault('likesByPersona',{})
            if not likes and post.get('likedAt'):likes[primary]={k:post.get(k) for k in ('likedByPlayer','likedAt','likeNoticedAt')}
            reaction=likes.setdefault(persona,{'likedByPlayer':False})
            if reaction.get('likedByPlayer',False)!=body['liked']:reaction.update(likedByPlayer=body['liked'],likedAt=now,likeNoticedAt=None)
            if persona==primary:post.update(reaction)
            event='SOCIAL_POST_LIKED' if body['liked'] else 'SOCIAL_POST_UNLIKED'
        elif kind=='comment_post':
            text=body.get('text')
            if not isinstance(text,str) or not 1<=len(text.strip())<=500:raise ValueError('Comment must contain 1–500 characters.')
            if len(post['comments'])>=50:raise Conflict('This post has reached its 50-comment preview limit.')
            post['comments'].append({'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'vh2-comment:'+body['key'])),
                'text':text.strip(),'authorId':after['communication']['personaId'],'createdAt':now})
            event='SOCIAL_COMMENT_ADDED'
        else:raise ValueError('Unsupported social command.')
    # Interactions are recorded, not assumed to be noticed or converted to affection.
    revision=service.commit_event(db,world_id,revision,state,after,event,{'postId':post['id'],'photoId':post['photoId']})
    return revision,after,post['id']

def observe(state):
    """Notice social activity and retain its provenance in retrievable life memory."""
    if state['truth']['present']['availability']!='available':return
    now=state['simAt'];c=state['truth']['companion'];psych=c.get('vh2Psychology')
    def remember(ident,summary,post,persona=None):
        if psych is None:return
        episodes=psych.setdefault('episodes',[])
        episodes.append({'id':ident,'at':now,'kind':'social_observation','summary':summary,
                         'postId':post['id'],'personaId':persona,'origin':post.get('origin'),
                         'evidenceScope':'observed_social_record','placeId':None})
        psych['episodes']=episodes[-psych.get('policy',{}).get('memoryLimit',200):]
    for post in state.get('social',{}).get('posts',[]):
        if post.get('status')!='published':continue
        if not post.get('publicationRememberedAt'):
            post['publicationRememberedAt']=now
            source='Authored starting-profile history' if post.get('origin')=='authored_starter' else 'Own social publication'
            remember('social-publication:'+post['id'],source+': '+post.get('caption','')+'. This records a post, not proof of events described in its caption.',post)
    # Recall new reactions after indexing publications, so an initial library
    # scan cannot crowd a newly noticed comment out of the working memory.
    for post in state.get('social',{}).get('posts',[]):
        if post.get('status')!='published':continue
        primary=state.get('communication',{}).get('personaId')
        for persona,reaction in (post.get('likesByPersona') or {primary:post}).items():
            if reaction.get('likedAt') and not reaction.get('likeNoticedAt'):
                reaction['likeNoticedAt']=now
                if persona==primary:post['likeNoticedAt']=now
                action='liked' if reaction.get('likedByPlayer') else 'removed their like from'
                remember('social-like:'+post['id']+':'+str(persona)+':'+str(reaction['likedAt'])+':'+str(reaction.get('likedByPlayer')), 'Noticed that contact '+str(persona)+' '+action+' own post: '+post.get('caption',''),post,persona)
        for comment in post.get('comments',[]):
            if not comment.get('noticedAt'):
                comment['noticedAt']=now
                remember('social-comment:'+comment['id'],'Read a comment on own post '+post.get('caption','')+': '+comment['text']+'. Comment content is the author’s statement, not verified fact.',post,comment.get('authorId'))

def activity_at(post):
    return max([post.get('publishedAt') or 0,post.get('likeNoticedAt') or 0]+
               [r.get('likeNoticedAt') or 0 for r in post.get('likesByPersona',{}).values()]+
               [c.get('noticedAt') or 0 for c in post.get('comments',[])])

def pending(post):
    return any(bool(r.get('likedAt')) and not r.get('likeNoticedAt') for r in (post.get('likesByPersona') or {'legacy':post}).values()) or any(not c.get('noticedAt') for c in post.get('comments',[]))

def persona_post(post,state,persona_id=None):
    primary=__import__('vh2_conversations').canonical(state)['communication']['personaId']
    persona=persona_id or state['communication']['personaId']
    reaction=post.get('likesByPersona',{}).get(persona,post if persona==primary and not post.get('likesByPersona') else {})
    return {**post,'likedByPlayer':reaction.get('likedByPlayer',False),'likedAt':reaction.get('likedAt'),'likeNoticedAt':reaction.get('likeNoticedAt')}

def context(state):
    posts=sorted((persona_post(p,state) for p in state.get('social',{}).get('posts',[]) if p.get('status') in ('published','withdrawn')),key=activity_at)
    return [{**{k:p.get(k) for k in ('id','caption','capturedAt','publishedAt','captureContext','status','origin')},
             'likedByPlayer':p.get('likedByPlayer',False) if p.get('likeNoticedAt') else None,
             'likeNoticedAt':p.get('likeNoticedAt'),
             'comments':[{k:c.get(k) for k in ('id','text','authorId','createdAt','noticedAt')} for c in p.get('comments',[]) if c.get('noticedAt')][-10:]}
            for p in posts][-20:]

def notifications(state):
    """A separate attention channel so unrelated chat cannot crowd out reactions."""
    rows=[]
    for p in state.get('social',{}).get('posts',[]):
        if p.get('status') not in ('published','withdrawn'):continue
        for persona,reaction in (p.get('likesByPersona') or {state.get('communication',{}).get('personaId'):p}).items():
            if reaction.get('likeNoticedAt'):
                rows.append({'postId':p['id'],'caption':p.get('caption',''),'authorId':persona,'kind':'like' if reaction.get('likedByPlayer') else 'unlike','noticedAt':reaction['likeNoticedAt']})
        for c in p.get('comments',[]):
            if c.get('noticedAt'):
                rows.append({'postId':p['id'],'caption':p.get('caption',''),'kind':'comment',**{k:c.get(k) for k in ('id','text','authorId','createdAt','noticedAt')}})
    return sorted(rows,key=lambda r:r['noticedAt'])[-12:]
