"""Stable room zones and immutable outfit revision identities."""
import hashlib,json,uuid
COMMANDS=('save_place_zone','enter_place_zone')
def synchronize(state):
 c=state.get('truth',{}).get('companion')
 if not c:return
 w=c['lifeRuntime']['world'];v=c.setdefault('vh2Visual',{'zones':[],'zoneId':None,'placeId':None,'outfitRevision':0,'outfitSignature':None})
 place=w.get('placeId') or state['truth'].get('present',{}).get('placeId')
 if w.get('journey') or v['placeId']!=place:v['zoneId']=None
 v['placeId']=place
 worn=w.get('outfit') or {};ids=worn.get('ids',[])
 items={i['id']:i for i in c['lifeProfile']['world']['items']}
 description=worn.get('label') or c.get('currentOutfit','')
 identity={'ids':ids,'outfit':worn.get('label',''),'description':description,'garments':[{k:items[i].get(k) for k in ('id','name','category','tags','photo')} for i in ids if i in items]}
 signature=hashlib.sha256(json.dumps(identity,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 if signature!=v['outfitSignature']:v['outfitSignature']=signature;v['outfitRevision']+=1;v['outfitChangedAt']=state['simAt']

def decorate(snapshot):
 v=snapshot['companion'].get('vh2Visual',{});ctx=snapshot['photoContext']
 if ctx.get('referenceStudy'):return
 same=ctx.get('placeId')==v.get('placeId');zone=next((z for z in v.get('zones',[]) if same and z['id']==v.get('zoneId')),None)
 ctx.update(zoneId=zone['id'] if zone else None,zoneRevision=zone['revision'] if zone else None,zoneDescription=zone['description'] if zone else '',outfitRevision=v.get('outfitRevision'),outfitSignature=v.get('outfitSignature'))

def command(service,db,world,revision,state,body):
 from vh2_runtime import encode,Conflict
 after=json.loads(encode(state));synchronize(after);c=after['truth']['companion'];v=c['vh2Visual'];w=c['lifeRuntime']['world']
 if body['type']=='save_place_zone':
  place=body.get('placeId');label=body.get('label');description=body.get('description','');ident=body.get('zoneId') or 'zone:'+str(uuid.uuid4())
  if not isinstance(place,str) or place not in {p['id'] for p in c['lifeProfile']['places']}:raise ValueError('Choose an existing place.')
  if not isinstance(label,str) or not 1<=len(label)<=120 or not isinstance(description,str) or len(description)>2000 or not isinstance(ident,str) or not 1<=len(ident)<=100:raise ValueError('Invalid zone identity or description.')
  old=next((z for z in v['zones'] if z['id']==ident),None)
  if old and old['placeId']!=place:raise Conflict('A zone cannot move to another place.')
  if not old and len(v['zones'])>=200:raise ValueError('At most 200 zones.')
  row={'id':ident,'placeId':place,'label':label,'description':description,'revision':old['revision']+1 if old else 1}
  v['zones']=[z for z in v['zones'] if z['id']!=ident]+[row]
 else:
  ident=body.get('zoneId');zone=next((z for z in v['zones'] if z['id']==ident),None)
  if not zone or w.get('journey') or zone['placeId']!=v['placeId']:raise Conflict('Enter a zone only while physically present at its place.')
  if after['truth']['present'].get('availability')=='asleep':raise Conflict('The character cannot move zones while asleep.')
  v['zoneId']=ident
 revision=service.commit_event(db,world,revision,state,after,'VISUAL_CONTINUITY_CHANGED',{'operation':body['type']});return revision,after
