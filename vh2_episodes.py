"""Author opportunities and constraints; the kernel chooses whether to pursue them."""
import json,uuid
COMMANDS=('configure_episodes','save_trip_opportunity','remove_trip_opportunity')
BOUNDS={'curiosity':(0,100),'socialPull':(0,100),'minEnergy':(0,100),'maxHunger':(0,100),'maxStress':(0,100),'reserveCash':(0,1000000),'maxSpend':(0,1000000),'cooldownDays':(1,365),'threshold':(-100,200)}
def command(service,db,world,revision,state,body):
 from vh2_runtime import encode
 after=json.loads(encode(state));c=after['truth']['companion'];r=c['vh2Episodes'];kind=body['type']
 if kind=='configure_episodes':
  p=body.get('policy')
  if not isinstance(p,dict) or set(p)!=set(BOUNDS)|{'enabled'} or type(p['enabled']) is not bool or any(type(p[k]) not in (int,float) or not lo<=p[k]<=hi for k,(lo,hi) in BOUNDS.items()):raise ValueError('Provide the complete overnight travel policy within its limits.')
  r['policy']=p
 elif kind=='remove_trip_opportunity':
  ident=body.get('opportunityId')
  if not any(o['id']==ident for o in r['opportunities']):raise ValueError('Unknown opportunity.')
  r['opportunities']=[o for o in r['opportunities'] if o['id']!=ident]
 else:
  o=body.get('opportunity')
  if not isinstance(o,dict):raise ValueError('Provide an overnight travel opportunity.')
  ident=o.get('id') or str(uuid.uuid4());place=o.get('placeId');person=o.get('personId') or None
  if person is not None and not isinstance(person,str):raise ValueError('Person ID must identify an existing known person.')
  if not isinstance(ident,str) or len(ident)>100 or not isinstance(place,str) or place not in {p['id'] for p in c['lifeProfile']['places']} or person is not None and person not in {p['id'] for p in c['lifeProfile']['socialCircle']}:raise ValueError('Link the opportunity to an existing place and optional known person.')
  label=o.get('label');start=o.get('availableFrom');end=o.get('availableUntil');low=o.get('minNights');high=o.get('maxNights');cost=o.get('nightlyCost');interest=o.get('interest')
  if not isinstance(label,str) or not 1<=len(label)<=120 or type(start) is not int or type(end) is not int or not after['simAt']-86400000<=start<end<=after['simAt']+366*86400000:raise ValueError('Use a name and availability window within the next year.')
  if type(low) is not int or type(high) is not int or not 1<=low<=high<=14 or type(cost) not in (int,float) or not 0<=cost<=100000 or type(interest) not in (int,float) or not 0<=interest<=100 or any(type(o.get(k)) is not bool for k in ('enabled','stayAllowed')):raise ValueError('Choose 1–14 nights, cost, interest, enabled state and accommodation permission.')
  if len(r['opportunities'])>=30 and not any(x['id']==ident for x in r['opportunities']):raise ValueError('At most thirty overnight opportunities.')
  r['opportunities']=[x for x in r['opportunities'] if x['id']!=ident]+[dict(id=ident,label=label,placeId=place,personId=person,availableFrom=start,availableUntil=end,minNights=low,maxNights=high,nightlyCost=round(cost,2),interest=interest,enabled=o['enabled'],stayAllowed=o['stayAllowed'])]
 revision=service.commit_event(db,world,revision,state,after,'EPISODE_POLICY_CHANGED',{'operation':kind});return revision,after
