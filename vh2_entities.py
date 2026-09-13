"""Versioned, rebuildable entity views over the transitional kernel snapshot.

These records are read projections, not a second simulation writer.
"""
import hashlib

PROJECTION_VERSION=2


def entities(state):
    c=state['truth']['companion'];person_id=c['id'];result=[]
    def add(kind,key,data):
        result.append({'kind':kind,'id':key,'data':data})
    add('person',person_id,{'name':c['name'],'age':c.get('age'),
        'placeId':state['truth']['present'].get('placeId'),'needs':c.get('humanDynamics',{})})
    profile=c.get('lifeProfile',{})
    for place in profile.get('places',[]):
        add('place',place['id'],{k:place.get(k) for k in ('label','kind','mapCoordinates','parentPlaceId','googlePlaceId') if k in place})
        if place.get('photo'):
            digest=hashlib.sha256(place['photo'].encode()).hexdigest()
            add('asset','place:'+place['id']+':'+digest,{'role':'place','entityId':place['id'],'contentHash':digest,'sourcePath':['lifeProfile','places',place['id'],'photo']})
    for item in profile.get('world',{}).get('items',[]):
        add('item',item['id'],{k:item.get(k) for k in ('name','category','tags','owned')})
    for goal in c.get('lifeRuntime',{}).get('activities',{}).get('goals',[]):
        add('action',goal['id'],{'actorId':person_id,'label':goal.get('label'),
            'status':{'planned':'proposed','active':'running'}.get(goal.get('status'),goal.get('status')),
            'sourceStatus':goal.get('status'),'stepIndex':goal.get('stepIndex'),
            'startedAt':goal.get('startedAt'),'completedAt':goal.get('completedAt'),
            'reason':goal.get('reason'),'steps':goal.get('steps',[])})
    keys=[(r['kind'],r['id']) for r in result]
    if len(keys)!=len(set(keys)):
        raise ValueError('Duplicate entity IDs in kernel output')
    return result


def transitions(before,after):
    old={(r['kind'],r['id']):r['data'] for r in entities(before)} if before else {}
    new={(r['kind'],r['id']):r['data'] for r in entities(after)}
    result=[]
    for kind,key in sorted(old.keys() | new.keys()):
        a,b=old.get((kind,key)),new.get((kind,key))
        if a is None or b is None:
            result.append({'type':'ENTITY_REGISTERED' if b else 'ENTITY_LEFT_CURRENT_VIEW','kind':kind,'entityId':key})
        elif kind=='action' and a.get('status')!=b.get('status'):
            result.append({'type':'ACTION_STATE_CHANGED','kind':kind,'entityId':key,'from':a.get('status'),'to':b.get('status'),'reason':b.get('reason')})
        elif kind=='person' and a.get('placeId')!=b.get('placeId'):
            result.append({'type':'PERSON_LOCATION_CHANGED','kind':kind,'entityId':key,'from':a.get('placeId'),'to':b.get('placeId')})
    return result
