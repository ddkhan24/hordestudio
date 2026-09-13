"""Persistent authored and fictional residents; private setup is not character knowledge."""
import json,uuid,hashlib,math,re
COMMANDS=('configure_population','add_resident','remove_resident')
TRAITS={'curiosity','conscientiousness','sociability','openness','trustOpenness','sensitivity'}
def validate_fictional(c,raw):
 if not isinstance(raw,dict) or set(raw)-{'enabled','targetCount','seed','homePlaceIds','publicPlaceIds','ageMin','ageMax'}:raise ValueError('Unsupported fictional population policy.')
 policy={'enabled':False,'targetCount':0,'seed':'local-residents','homePlaceIds':[],'publicPlaceIds':[],'ageMin':18,'ageMax':65,**raw}
 if type(policy['enabled']) is not bool or type(policy['targetCount']) is not int or not 0<=policy['targetCount']<=30 or not isinstance(policy['seed'],str) or not 1<=len(policy['seed'])<=80:raise ValueError('Choose fictional population enabled, up to 30 residents, and a stable seed.')
 if any(type(policy[k]) is not int or not 18<=policy[k]<=90 for k in ('ageMin','ageMax')) or policy['ageMin']>policy['ageMax']:raise ValueError('Fictional adult age range must be 18–90.')
 places={p['id']:p for p in c['lifeProfile']['places']}
 for key in ('homePlaceIds','publicPlaceIds'):
  ids=policy[key]
  if not isinstance(ids,list) or len(ids)>48 or any(not isinstance(i,str) or i not in places for i in ids):raise ValueError('Choose recorded population places.')
  if key=='homePlaceIds' and any(places[i].get('kind')!='home' for i in ids):raise ValueError('Choose permitted recorded residences.')
  if key=='publicPlaceIds' and any(places[i].get('kind')=='home' or places[i].get('encounterScope')!='nearby' for i in ids):raise ValueError('Choose public places with nearby encounters enabled.')
  policy[key]=list(dict.fromkeys(ids))
 if policy['enabled'] and (not policy['homePlaceIds'] or not policy['publicPlaceIds']):raise ValueError('Fictional residents need permitted homes and public places.')
 return policy

def seed_residents(c,world,policy):
 from vh2_people import connected
 if not policy['enabled']:return
 r=c['vh2Population'];pairs=[(home,place) for home in policy['homePlaceIds'] for place in policy['publicPlaceIds'] if connected(c,home,place) and connected(c,place,home)]
 if not pairs:raise ValueError('Connect permitted residences and public places with recorded walking routes before seeding residents.')
 first=['Sam','Morgan','Taylor','Casey','Alex','Jamie','Jordan','Riley','Avery','Cameron','Drew','Reese','Parker','Skyler','Quinn','Rowan']
 last=['Bennett','Ellis','Reed','Hayes','Brooks','Rivera','Patel','Chen','Carter','Morgan','Shah','Park','Taylor','Reyes','Wright','Singh']
 for index in range(policy['targetCount']):
  token=world+'|'+policy['seed']+'|'+str(index);digest=hashlib.sha256(token.encode()).digest();ident='resident:'+str(uuid.uuid5(uuid.NAMESPACE_URL,token))
  if any(p['id']==ident for p in r['residents']):continue
  if len(r['residents'])>=100:raise ValueError('This life supports at most 100 residents.')
  home,place=pairs[int.from_bytes(digest[:4],'big')%len(pairs)];traits={key:25+digest[4+i]%66 for i,key in enumerate(sorted(TRAITS))}
  interest='meeting new people' if traits['sociability']>=65 else 'quiet time and familiar places' if traits['curiosity']<45 else 'exploring local interests'
  start=480+60*(digest[11]%10);end=min(1440,start+240)
  r['residents'].append({'id':ident,'name':first[digest[0]%len(first)]+' '+last[digest[1]%len(last)],'sharedDescription':'Enjoys '+interest+'.','placeId':place,'homePlaceId':home,'initialPlaceId':place,'age':policy['ageMin']+digest[10]%(policy['ageMax']-policy['ageMin']+1),'days':list(range(7)),'start':start,'end':end,'openness':traits['openness'],'personality':traits,'introducedAt':None,'provenance':'fictional_simulation','residenceSource':'fictional_simulation_authorized_home','seed':policy['seed']})

def command(service,db,world_id,revision,state,body):
 from vh2_runtime import encode,Conflict
 from vh2_people import prepare_residents
 after=json.loads(encode(state));c=after['truth']['companion']
 r=c.setdefault('vh2Population',{'enabled':False,'openness':50,'residents':[],'contacts':{},'events':[],'sequence':0})
 kind=body['type'];places={p['id']:p for p in c['lifeProfile']['places']}
 if kind=='configure_population':
  if type(body.get('enabled')) is not bool or type(body.get('openness')) not in (int,float) or not math.isfinite(body['openness']) or not 0<=body['openness']<=100:raise ValueError('Provide enabled and openness from 0 to 100.')
  r.update(enabled=body['enabled'],openness=body['openness'])
  if 'fictional' in body:r['fictional']=validate_fictional(c,body['fictional'])
  if r.get('fictional'):seed_residents(c,world_id,r['fictional'])
 elif kind=='add_resident':
  ident=body.get('residentId',body.get('id'))
  if ident is not None and (not isinstance(ident,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}',ident) or ident in ('__proto__','constructor','prototype')):raise ValueError('Resident ID must be a stable identifier of up to 80 characters.')
  ident=ident or 'resident:'+str(uuid.uuid5(uuid.NAMESPACE_URL,world_id+':'+body['key']))
  previous=next((p for p in r['residents'] if p['id']==ident),None)
  if not previous and any(p['id']==ident for p in c['lifeProfile']['socialCircle']):raise ValueError('This ID belongs to a known person; use their life settings.')
  if not previous and len(r['residents'])>=100:raise Conflict('This local population supports at most 100 residents.')
  raw={**(previous or {}),**body};name=raw.get('name');description=raw.get('sharedDescription','');place=places.get(raw.get('placeId'))
  if not isinstance(name,str) or not 1<=len(name.strip())<=100:raise ValueError('Provide a name of 1–100 characters.')
  if not isinstance(description,str) or len(description)>500:raise ValueError('Introduction details must be at most 500 characters.')
  if not place or place['kind']=='home':raise ValueError('Choose a recorded public place, not a private home.')
  if place.get('encounterScope')!='nearby':raise ValueError('Set this place’s encounter scope to nearby before adding residents.')
  start=raw.get('start');end=raw.get('end');days=raw.get('days');openness=raw.get('openness')
  if type(start) is not int or type(end) is not int or not 0<=start<end<=1440:raise ValueError('Choose an availability window within one day.')
  if not isinstance(days,list) or not days or any(type(d) is not int or not 0<=d<=6 for d in days):raise ValueError('Choose weekdays from 0 to 6.')
  if type(openness) not in (int,float) or not math.isfinite(openness) or not 0<=openness<=100:raise ValueError('Resident openness must be 0–100.')
  home=raw.get('homePlaceId');initial=raw.get('initialPlaceId',place['id']);age=raw.get('age');traits=raw.get('personality',{})
  if home is not None and (not isinstance(home,str) or places.get(home,{}).get('kind')!='home'):raise ValueError('Choose a recorded resident home.')
  if initial not in places:raise ValueError('Choose a recorded starting place.')
  if age is not None and (type(age) is not int or not 18<=age<=100):raise ValueError('Adult resident age must be 18–100.')
  if not isinstance(traits,dict) or set(traits)-TRAITS or any(type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=100 for v in traits.values()):raise ValueError('Use supported personality values from 0 to 100.')
  record={**(previous or {}),'id':ident,'name':name.strip(),'sharedDescription':description.strip(),'placeId':place['id'],'days':sorted(set(days)),'start':start,'end':end,'openness':openness,'initialPlaceId':initial,'personality':traits,'provenance':(previous or {}).get('provenance','authored_simulation'),'introducedAt':(previous or {}).get('introducedAt')}
  if home is not None:record['homePlaceId']=home
  if age is not None:record['age']=age
  actor=c.get('vh2People',{}).get('actors',{}).get(ident)
  if actor and home is not None and actor['policy']['homePlaceId']!=home:raise Conflict('This resident already has a home. Change their life policy explicitly; rebuilding must not relocate them.')
  if actor:
   record['initialPlaceId']=(previous or {}).get('initialPlaceId',initial)
   for trait in ('curiosity','conscientiousness'):
    if trait in traits:actor['policy'][trait]=traits[trait]
   network=c['vh2People'].setdefault('network',{'enabled':True,'pairs':{},'events':[]});dispositions=network.setdefault('dispositions',{}).setdefault(ident,{})
   for trait in ('openness','trustOpenness','sensitivity','sociability'):
    if trait in traits:dispositions[trait]=traits[trait]
  if previous:previous.update(record)
  else:r['residents'].append(record)
 else:
  p=next((p for p in r['residents'] if p['id']==body.get('residentId')),None)
  if not p:raise ValueError('Unknown resident.')
  if p['introducedAt'] is not None:raise Conflict('An introduced person is part of this timeline’s history and cannot be erased through population setup.')
  if c.get('vh2People',{}).get('actors',{}).get(p['id']):raise Conflict('This resident has an independent persistent life and cannot be erased through population setup.')
  r['residents'].remove(p);r['contacts'].pop(p['id'],None)
 prepare_residents(after)
 revision=service.commit_event(db,world_id,revision,state,after,'POPULATION_CONFIGURED',{'operation':kind})
 return revision,after
