"""Commit procedural capture/publication intents in the same transaction as life."""
import json,uuid

BOUNDS={'captureInterest':(0,100),'sharingInterest':(0,100),'sociability':(0,100),'noveltyWeight':(0,50),
 'minEnergy':(0,100),'maxStress':(0,100),'captureThreshold':(0,200),'shareThreshold':(0,200),'invitationThreshold':(0,200),
 'captureCooldownMinutes':(5,1440),'postCooldownMinutes':(5,1440),'inviteCooldownMinutes':(10,10080),'maxPendingCaptures':(1,12)}

def configure(service,db,world_id,revision,state,body):
 from vh2_runtime import encode
 policy=body.get('policy')
 if not isinstance(policy,dict) or set(policy)!=set(BOUNDS)|{'enabled'} or type(policy['enabled']) is not bool:raise ValueError('Provide the complete life expression policy.')
 if any(type(policy[k]) not in (int,float) or not low<=policy[k]<=high for k,(low,high) in BOUNDS.items()) or type(policy['maxPendingCaptures']) is not int:raise ValueError('Invalid life expression policy value.')
 after=json.loads(encode(state));after['truth']['companion']['vh2Agency']['policy']=policy
 revision=service.commit_event(db,world_id,revision,state,after,'LIFE_EXPRESSION_CONFIGURED')
 return revision,after

def advance(service,db,world_id,state):
 from vh2_runtime import encode
 c=state['truth']['companion'];agency=c.get('vh2Agency')
 if c.get('vh2AutonomyPaused') or not agency or not (agency['policy']['enabled'] or c.get('socialFeedEnabled')):return []
 outcomes=[];photos=state.setdefault('photos',[]);posts=state.setdefault('social',{}).setdefault('posts',[])
 for photo in photos:
  if photo.get('origin')=='autonomous' and photo.get('status')=='captured':
   photo['deferred']=True
   for saved in agency['captures']:
    if saved.get('photoId')==photo['id'] and saved['status']=='pending':saved['status']='saved'
 for intent in agency['captures']:
  if intent['status']!='pending' or intent.get('photoId'):continue
  # This must run in the event that produced the intention, never reconstruct from later reality.
  if intent['at']!=state['simAt']:
   intent['status']='expired';intent['reason']='The original capture moment was not frozen.';continue
  frozen=service.kernel({'companion':c,'now':state['simAt'],'inspect':True,'capture':True})
  source=next((e for e in state['truth']['events'] if e['id']==intent['sourceEventId']),{})
  reason=source.get('summary') or intent.get('reason') or 'A recorded personal moment.'
  scene=('A candid phone photograph at '+str(frozen['photoContext'].get('placeLabel') or 'the recorded place')+'. Recorded moment: '+reason)[:600]
  context={**frozen['photoContext'],'scene':scene,'destination':'gallery'}
  photo_id=str(uuid.uuid5(uuid.NAMESPACE_URL,'vh2-photo:'+intent['id']))
  snapshot={'companion':frozen['companion'],'photoContext':context,'scene':scene,'captureType':intent['captureType'],'destination':'gallery','kernelVersion':state['kernelVersion']}
  __import__('vh2_assets').freeze(snapshot)
  db.execute('INSERT INTO photo_jobs VALUES (?,?,?)',(photo_id,world_id,encode(snapshot)))
  source=next((e for e in state['truth']['events'] if e['id']==intent['sourceEventId']),{})
  photos.append({'id':photo_id,'status':'captured','deferred':True,'at':intent['at'],'scene':scene,'captureReason':reason,'captureType':intent['captureType'],
   'destination':'gallery','origin':'autonomous','sourceEventId':intent['sourceEventId'],'sourceKind':source.get('kind'),
   'photoContext':context,'referenceLabels':[{'role':r['role'],'label':r['label'],'version':r['version']} for r in snapshot.get('referenceAssets',[])],'intentId':intent['id']})
  intent['photoId']=photo_id;intent['status']='saved'
  outcomes.append({'id':intent['id']+':captured','kind':'capture_intent','at':intent['at'],'photoId':photo_id,'summary':'Saved a photo idea and its original references. No image generation was requested.'})
 eligible=[p for p in photos if p.get('assetId') and not p.get('publicationIntent') and db.execute('SELECT 1 FROM photo_assets WHERE world_id=? AND id=?',(world_id,p['assetId'])).fetchone()]
 reviewed=service.kernel({'companion':c,'now':state['simAt'],'inspect':True,'mediaReview':{'photos':eligible,'posts':posts}})
 c['vh2Agency']=reviewed['companion']['vh2Agency']
 for action in reviewed['actions']:
  photo=next(p for p in photos if p['id']==action['photoId']);photo['shareDecision']=action['decision']
  if not action['publish']:continue
  post_id=str(uuid.uuid5(uuid.NAMESPACE_URL,'vh2-auto-post:'+photo['id']))
  posts.append({'id':post_id,'photoId':photo['id'],'assetId':photo['assetId'],'caption':'','capturedAt':photo['at'],'publishedAt':state['simAt'],
   'captureContext':photo['photoContext'],'status':'draft' if c.get('socialFeedEnabled') else 'published','visibility':c.get('socialAudience','public'),'origin':'autonomous','sourceEventId':photo['sourceEventId'],
   'likedByPlayer':False,'comments':[]})
  outcomes.append({'id':post_id,'kind':'publication_intent' if c.get('socialFeedEnabled') else 'publication','at':state['simAt'],'photoId':photo['id'],'summary':'Chose a previously captured photo for a social draft.' if c.get('socialFeedEnabled') else 'Shared a previously captured photo on the simulated profile.'})
 return outcomes
