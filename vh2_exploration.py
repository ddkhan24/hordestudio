import json
COMMANDS=('configure_exploration',)
BOUNDS={'curiosity':(0,100),'sociability':(0,100),'minEnergy':(0,100),'maxHunger':(0,100),'maxStress':(0,100),'cooldownHours':(1,720),'maxTravelMinutes':(1,720),'stayMinutes':(1,1440),'threshold':(-100,200)}
def command(service,db,world_id,revision,state,body):
 from vh2_runtime import encode
 p=body.get('policy')
 if not isinstance(p,dict) or set(p)!=set(BOUNDS)|{'enabled','interests'} or type(p['enabled']) is not bool:raise ValueError('Provide the complete exploration policy.')
 if any(type(p[k]) not in (int,float) or not low<=p[k]<=high for k,(low,high) in BOUNDS.items()):raise ValueError('Invalid exploration setting.')
 if not isinstance(p['interests'],list) or len(p['interests'])>30 or any(not isinstance(t,str) or not 1<=len(t)<=40 for t in p['interests']):raise ValueError('Use up to thirty short interest tags.')
 after=json.loads(encode(state));after['truth']['companion']['vh2Exploration']['policy']=p
 # Compatibility command: one movement switch, never a second visit scheduler.
 if 'vh2Geography' in after['truth']['companion']:
  char=after['truth']['companion'];char['vh2Geography']['enabled']=p['enabled']
  if not p['enabled']:
   for goal in char['lifeRuntime']['activities']['goals']:
    if goal['id'].startswith('geo:') and goal['status'] not in ('completed','abandoned'):goal['status']='abandoned';goal['reason']='Independent life disabled.'
 revision=service.commit_event(db,world_id,revision,state,after,'EXPLORATION_CONFIGURED')
 return revision,after
