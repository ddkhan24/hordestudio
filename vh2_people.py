"""Author independent supporting-person lives without changing their known history."""
import json,re,hashlib
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
COMMANDS=('prepare_people','set_person_location','configure_person_life','configure_person_network','correct_person_vehicle_ownership')
BOUNDS={'curiosity':(0,100),'conscientiousness':(0,100),'temperature':(1,50),'sleepStart':(0,23),'sleepEnd':(0,23),'mealCost':(0,10000),'incomePerHour':(0,100000),'dailyExpense':(0,100000)}
def initial_actor(ident,policy,initial,now,balance=100):
 return {'id':ident,'policy':policy,'placeId':initial,'carPlaceId':policy['homePlaceId'] if policy['ownsCar'] else None,'bikePlaceId':policy['homePlaceId'] if policy['ownsBicycle'] else None,'balance':round(balance,2),'energy':75,'hunger':30,'stress':20,'boredom':35,'socialNeed':35,'lastAt':now,'sequence':0,'started':False,'action':None,'journey':None,'pending':None,'remaining':[],'visits':{initial:now}}

def default_policy(c,home,personality=None):
 traits=personality or {};places=c['lifeProfile']['places'];caps=c.get('vh2Geography',{}).get('places',{})
 return {'homePlaceId':home,'foodPlaceIds':[p['id'] for p in places if (p.get('kind')!='home' or p['id']==home) and 'food' in caps.get(p['id'],{}).get('capabilities',[])][:48],'leisurePlaceIds':[p['id'] for p in places if (p.get('kind')!='home' or p['id']==home) and 'leisure' in caps.get(p['id'],{}).get('capabilities',[])][:48],'paidPlaceIds':[],'modes':['WALK','TRANSIT','RIDESHARE'],'ownsCar':False,'ownsBicycle':False,'curiosity':traits.get('curiosity',50),'conscientiousness':traits.get('conscientiousness',70),'temperature':8,'sleepStart':23,'sleepEnd':7,'mealCost':4,'incomePerHour':0,'dailyExpense':0}

def connected(c,start,end):
 if start==end:return True
 seen={start};pending=[start]
 while pending:
  here=pending.pop()
  for leg in c['lifeProfile'].get('travelLegs',[]):
   if leg.get('from')!=here or leg.get('mode')!='WALK' or not isinstance(leg.get('minutes'),(int,float)) or leg['minutes']<=0 or leg.get('cost',0)>0:continue
   there=leg.get('to')
   if there==end:return True
   if there not in seen:seen.add(there);pending.append(there)
 return False

def prepare_residents(state):
 c=state['truth']['companion'];r=c.setdefault('vh2People',{'actors':{},'events':[],'sequence':0});setup=r.setdefault('setup',{})
 population=c.get('vh2Population',{});fictional=population.get('fictional',{});places={p['id']:p for p in c['lifeProfile']['places']}
 for person in population.get('residents',[]):
  ident=person['id'];record=setup.setdefault(ident,{})
  if record.get('status')=='pending_configuration':continue
  if ident in r['actors']:record.update(status='ready',reason='');continue
  initial=person.get('initialPlaceId') or person.get('placeId');home=person.get('homePlaceId')
  if not home and fictional.get('enabled'):
   candidates=[p for p in fictional.get('homePlaceIds',[]) if places.get(p,{}).get('kind')=='home' and connected(c,p,initial) and connected(c,initial,p)]
   if candidates:
    slot=int(hashlib.sha256((fictional.get('seed','')+'|'+ident).encode()).hexdigest()[:8],16)%len(candidates);home=candidates[slot]
    person.update(homePlaceId=home,residenceSource='fictional_simulation_authorized_home')
  if home not in places or places[home].get('kind')!='home' or initial not in places:
   record.update(status='needs_location',reason='Choose a recorded home for this resident or enable fictional population with permitted residences.');continue
  if not connected(c,home,initial) or not connected(c,initial,home):
   record.update(status='needs_route',reason='This resident needs recorded walking routes between home and their starting place.');continue
  traits=person.get('personality',{});policy=default_policy(c,home,traits)
  policy['leisurePlaceIds']=[person['placeId']]+[p for p in policy['leisurePlaceIds'] if p!=person['placeId']][:47]
  r['actors'][ident]=initial_actor(ident,policy,initial,state['simAt'])
  r['actors'][ident]['provenance']=person.get('provenance','authored_simulation')
  record.update(status='ready',reason='',homePlaceId=home,initialPlaceId=initial,source=person.get('residenceSource','explicit author residence'),placementImported=True)
  network=r.setdefault('network',{'enabled':True,'pairs':{},'events':[],'policy':{'groupPlansEnabled':True},'lastAt':state['simAt']})
  network.setdefault('dispositions',{})[ident]={k:traits.get(k,person.get('openness',50) if k=='openness' else 50) for k in ('openness','trustOpenness','sensitivity','sociability')}

def prepare(state):
 """Initialize once from explicit spatial evidence; unresolved people remain unplaced."""
 c=state.get('truth',{}).get('companion')
 if not c:return
 prepare_residents(state)
 r=c.setdefault('vh2People',{'actors':{},'events':[],'sequence':0});setup=r.setdefault('setup',{});places={p['id']:p for p in c['lifeProfile']['places']}
 for person in c['lifeProfile'].get('socialCircle',[]):
  ident=person['id'];record=setup.setdefault(ident,{'status':'needs_location','reason':'Choose a home and starting place.'})
  if record.get('status')=='pending_configuration':continue
  if ident in r['actors']:record.update(status='ready',reason='');continue
  homes={p['placeId'] for p in c['lifeProfile'].get('world',{}).get('people',[]) if p.get('personId')==ident and p.get('placeId') in places and places[p['placeId']].get('kind')=='home' and (p.get('start',0)>=1200 or p.get('end',0)<=480 or (p.get('start')==0 and p.get('end')==1440) or p.get('availability')=='asleep')}
  relationship=str(person.get('relationship','')).lower()
  roommate=bool(re.search(r'\broommate\b',relationship)) and not re.search(r'\b(ex|former|previous|old)\b',relationship)
  if roommate and not homes:
   residence=c.get('vh2Travel',{}).get('residenceId')
   if residence not in places:
    candidates=[p['id'] for p in places.values() if p.get('kind')=='home'];residence=candidates[0] if len(candidates)==1 else None
   if residence in places:homes.add(residence);record.setdefault('source','authored roommate relationship; initial simulation position at shared home')
  home=record.get('homePlaceId') or (next(iter(homes)) if len(homes)==1 else None)
  old=c.get('vh2NpcTravel',{}).get('people',{}).get(ident,{})
  current=old.get('placeId') or c['lifeRuntime']['world'].get('people',{}).get(ident,{}).get('placeId') or record.get('initialPlaceId') or (home if roommate else None)
  if old.get('journey'):current=old['journey'].get('from') or current
  if home not in places or current not in places:record.update(status='needs_location',reason='Choose a home and starting place.',**({'homePlaceId':home} if home else {}));continue
  caps=c.get('vh2Geography',{}).get('places',{})
  policy={'homePlaceId':home,'foodPlaceIds':[p for p in places if (places[p].get('kind')!='home' or p==home) and 'food' in caps.get(p,{}).get('capabilities',[])][:48],'leisurePlaceIds':[p for p in places if (places[p].get('kind')!='home' or p==home) and 'leisure' in caps.get(p,{}).get('capabilities',[])][:48],'paidPlaceIds':[],'modes':['WALK','TRANSIT','RIDESHARE'],'ownsCar':False,'ownsBicycle':False,'curiosity':50,'conscientiousness':70,'temperature':8,'sleepStart':23,'sleepEnd':7,'mealCost':4,'incomePerHour':0,'dailyExpense':0}
  now=state['simAt'];r['actors'][ident]={'id':ident,'policy':policy,'placeId':current,'carPlaceId':None,'bikePlaceId':None,'balance':record.get('startingBalance',100),'energy':75,'hunger':30,'stress':20,'boredom':35,'lastAt':now,'sequence':0,'started':False,'action':None,'journey':None,'pending':None,'remaining':[],'visits':{current:now}}
  if old.get('journey'):
   r['actors'][ident].update(journey=json.loads(json.dumps(old['journey'])),placeId='',started=True)
  record.update(status='ready',reason='',homePlaceId=home,initialPlaceId=current,source=record.get('source','authored residence and observed location'),defaults='Simulation defaults: budget 100 unless specified; no vehicle or paid job assumed.')
 if r['actors'] and 'network' not in r:r['network']={'enabled':True,'pairs':{},'events':[],'policy':{'groupPlansEnabled':True},'lastAt':state['simAt']}

def command(service,db,world_id,revision,state,body):
 from vh2_runtime import encode,Conflict
 if body['type']=='correct_person_vehicle_ownership':
  after=json.loads(encode(state));c=after['truth']['companion'];ident=body.get('personId');a=c.get('vh2People',{}).get('actors',{}).get(ident)
  if not a:raise ValueError('Choose an independent person.')
  if a.get('journey'):raise Conflict('Wait until this person arrives before correcting vehicle ownership.')
  if any(type(body.get(k)) is not bool for k in ('ownsCar','ownsBicycle')):raise ValueError('Choose car and bicycle ownership explicitly.')
  reason=body.get('reason')
  if not isinstance(reason,str) or not 1<=len(reason.strip())<=600:raise ValueError('Describe the authored fact this setup correction restores.')
  changed=[]
  for flag,location,mode in [('ownsCar','carPlaceId','DRIVE'),('ownsBicycle','bikePlaceId','BICYCLE')]:
   if a['policy'][flag]==body[flag]:continue
   a['policy'][flag]=body[flag];a[location]=a['placeId'] if body[flag] else None;changed.append(flag)
   if body[flag] and mode not in a['policy']['modes']:a['policy']['modes'].append(mode)
   if not body[flag]:a['policy']['modes']=[m for m in a['policy']['modes'] if m!=mode] or ['WALK']
  if changed:a['remaining']=[];a['pending']=None
  c['vh2SetupVersion']=c.get('vh2SetupVersion',0)+1
  revision=service.commit_event(db,world_id,revision,state,after,'PERSON_VEHICLE_SETUP_CORRECTED',{'personId':ident,'changed':changed,'reason':reason.strip(),'source':'explicit_author_correction','placeId':a['placeId']})
  return revision,after
 if body['type'] in ('prepare_people','set_person_location'):
  after=json.loads(encode(state));c=after['truth']['companion'];prepare(after)
  if body['type']=='set_person_location':
   ident=body.get('personId');places={p['id'] for p in c['lifeProfile']['places']}
   if ident not in {p['id'] for p in c['lifeProfile']['socialCircle']}:raise ValueError('Choose a known person.')
   if ident in c['vh2People']['actors']:raise Conflict('This person is already participating. Use travel settings to change their policy.')
   if body.get('homePlaceId') not in places or body.get('initialPlaceId') not in places:raise ValueError('Choose both their home and their established starting place.')
   balance=body.get('startingBalance',100)
   if type(balance) not in (int,float) or not 0<=balance<=1000000:raise ValueError('Enter a valid simulated budget.')
   c['vh2People']['setup'][ident].update(homePlaceId=body['homePlaceId'],initialPlaceId=body['initialPlaceId'],startingBalance=balance,source='explicit author location')
   prepare(after)
  revision=service.commit_event(db,world_id,revision,state,after,'PEOPLE_PREPARED',{'operation':body['type']})
  return revision,after
 if body['type']=='configure_person_network':
  if type(body.get('enabled')) is not bool:raise ValueError('Network enabled must be true or false.')
  after=json.loads(encode(state));r=after['truth']['companion'].setdefault('vh2People',{'actors':{},'events':[],'sequence':0})
  n=r.setdefault('network',{'pairs':{},'events':[]});n.update(enabled=body['enabled'],lastAt=after['simAt'])
  policy=body.get('policy',n.get('policy',{}));bounds={'encounterCooldownMinutes':(30,1440),'friendMeetings':(3,100),'friendDays':(1,90),'friendWarmth':(1,100),'quietDays':(1,365),'planCooldownHours':(1,168),'planDurationMinutes':(5,120),'maxPlanTravelMinutes':(1,120)}
  if not isinstance(policy,dict) or set(policy)-set(bounds)-{'groupPlansEnabled'}:raise ValueError('Unsupported network policy.')
  for key,value in policy.items():
   if key=='groupPlansEnabled':
    if type(value) is not bool:raise ValueError('Group planning must be true or false.')
   elif type(value) is not int or not bounds[key][0]<=value<=bounds[key][1]:raise ValueError('Network setting outside its supported range.')
  n['policy']=policy
  dispositions=body.get('dispositions',n.get('dispositions',{}))
  if not isinstance(dispositions,dict) or len(dispositions)>100:raise ValueError('Invalid person dispositions.')
  for person,traits in dispositions.items():
   if person not in r['actors'] or not isinstance(traits,dict) or set(traits)-{'openness','trustOpenness','sensitivity','sociability'} or any(type(v) is not int or not 0<=v<=100 for v in traits.values()):raise ValueError('Use independent people and disposition values from 0 to 100.')
  n['dispositions']=dispositions
  if not body['enabled']:
   for plan in after['truth']['companion'].get('vh2Plans',{}).get('plans',[]):
    if plan.get('scope')!='peers':continue
    if plan['status'] in ('accepted','active'):plan.update(status='cancelled',resolvedAt=after['simAt'])
  revision=service.commit_event(db,world_id,revision,state,after,'PERSON_NETWORK_CONFIGURED',{'enabled':body['enabled']})
  return revision,after
 c=state['truth']['companion'];ident=body.get('personId');known=next((p for p in c['lifeProfile']['socialCircle'] if p['id']==ident),None)
 resident=next((p for p in c.get('vh2Population',{}).get('residents',[]) if p['id']==ident),None)
 if not known and not resident:raise ValueError('Choose a known person or an authored resident.')
 policy=body.get('policy');required=set(BOUNDS)|{'homePlaceId','foodPlaceIds','leisurePlaceIds','paidPlaceIds','modes','ownsCar','ownsBicycle'}
 if not isinstance(policy,dict) or not required.issubset(policy) or set(policy)-required-{'timeZone'}:raise ValueError('Provide the complete independent-life policy.')
 if 'timeZone' in policy:
  if not isinstance(policy['timeZone'],str) or len(policy['timeZone'])>80:raise ValueError('Choose an IANA time zone for this person.')
  try:ZoneInfo(policy['timeZone'])
  except (ZoneInfoNotFoundError,ValueError):raise ValueError('Choose a valid IANA time zone for this person.')
 if any(type(policy[k]) not in (int,float) or not lo<=policy[k]<=hi for k,(lo,hi) in BOUNDS.items()):raise ValueError('Invalid life policy value.')
 if any(type(policy[k]) is not bool for k in ('ownsCar','ownsBicycle')):raise ValueError('Vehicle ownership must be true or false.')
 places={p['id'] for p in c['lifeProfile']['places']}
 if not isinstance(policy['homePlaceId'],str) or policy['homePlaceId'] not in places:raise ValueError('Choose a recorded home place.')
 for k in ('foodPlaceIds','leisurePlaceIds','paidPlaceIds'):
  if not isinstance(policy[k],list) or len(policy[k])>64 or any(type(x) is not str or x not in places for x in policy[k]):raise ValueError('Choose up to 64 recorded activity places.')
 if not isinstance(policy['modes'],list) or not policy['modes'] or any(m not in ('WALK','DRIVE','BICYCLE','TRANSIT','RIDESHARE') for m in policy['modes']):raise ValueError('Choose supported travel modes.')
 if policy['sleepStart']==policy['sleepEnd']:raise ValueError('Sleep start and end must differ.')
 after=json.loads(encode(state));r=after['truth']['companion'].setdefault('vh2People',{'actors':{},'events':[],'sequence':0});a=r['actors'].get(ident)
 if a:
  if a.get('journey'):raise Conflict('Wait until this person arrives before changing mobility.')
  if policy['ownsCar']!=a['policy']['ownsCar'] or policy['ownsBicycle']!=a['policy']['ownsBicycle']:raise Conflict('Vehicle ownership is fixed at life setup; this setting cannot create or erase possessions.')
  a['policy']=policy
 else:
  balance=body.get('startingBalance')
  if type(balance) not in (int,float) or not 0<=balance<=1000000:raise ValueError('Starting simulated travel/meal budget must be 0–1000000.')
  old=c.get('vh2NpcTravel',{}).get('people',{}).get(ident,{})
  if old.get('journey'):raise Conflict('Wait until this person arrives before enabling independent life.')
  initial=old.get('placeId') or c['lifeRuntime']['world']['people'].get(ident,{}).get('placeId') or r.get('setup',{}).get(ident,{}).get('initialPlaceId') or (resident or {}).get('placeId')
  if initial not in places:raise ValueError('This person needs an established initial place.')
  now=state['simAt'];r['actors'][ident]={'id':ident,'policy':policy,'placeId':initial,'carPlaceId':policy['homePlaceId'] if policy['ownsCar'] else None,'bikePlaceId':policy['homePlaceId'] if policy['ownsBicycle'] else None,'balance':round(balance,2),'energy':75,'hunger':30,'stress':20,'boredom':35,'lastAt':now,'sequence':0,'started':False,'action':None,'journey':None,'pending':None,'remaining':[],'visits':{initial:now}}
 r.setdefault('setup',{}).setdefault(ident,{}).update(status='ready',reason='')
 revision=service.commit_event(db,world_id,revision,state,after,'PERSON_LIFE_CONFIGURED',{'personId':ident})
 return revision,after
