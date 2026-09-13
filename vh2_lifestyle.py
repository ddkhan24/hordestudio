"""Stable place identity, residence, local-time metadata, finances and closet styles."""
import json,uuid,math
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
COMMANDS=('configure_health_policy','configure_live_routing','remove_life_entry','apply_life_proposal','configure_institution','remove_institution','upsert_place','record_route','configure_place_context','set_residence','set_hometown','configure_finances','settle_expenses','configure_closet','add_closet_style','remove_closet_style')
def validate_institution_rule(rule,life):
 fields={'label','scheduleId','minimumAttendance','fee','missedStress'}
 if not isinstance(rule,dict) or set(rule)!=fields:raise ValueError('Provide the complete institution rule.')
 block=next((b for b in life['weeklySchedule'] if b['id']==rule['scheduleId']),None)
 if not block or block['endMinute']<=block['startMinute']:raise ValueError('Select an existing same-day scheduled commitment.')
 if not isinstance(rule['label'],str) or not 1<=len(rule['label'].strip())<=120:raise ValueError('Provide an institution name.')
 for key,lo,hi in [('minimumAttendance',0.01,1),('fee',0,100000),('missedStress',0,20)]:
  if type(rule[key]) not in (int,float) or not math.isfinite(rule[key]) or not lo<=rule[key]<=hi:raise ValueError('Invalid institution consequence.')
 return {**rule,'label':rule['label'].strip()}

def clear_future_route_caches(c,stale):
 """Drop only untravelled invalid legs; existing arrival/history remains authoritative."""
 world=c['lifeRuntime']['world'];cleared=[]
 for ident,a in c.get('vh2People',{}).get('actors',{}).items():
  queued=a.get('remaining',[]) if a.get('journey') else a.get('remaining',[])+(a.get('pending') or {}).get('path',[])
  if any(stale(l) for l in queued):
   a['remaining']=[];a['pending']=None;a['blockedReason']='Saved map routes changed; reconsidering from the next actual arrival.';cleared.append(ident)
 travel=c.get('vh2Travel',{});trip=next((t for t in travel.get('trips',[]) if t['id']==travel.get('activeId') and t.get('status') not in ('completed','cancelled','expired')),None)
 if trip and any(stale(l) for l in trip.get('legs',[])):
  trip['legs']=[];trip['reason']='Saved map routes changed; the remaining route needs to be planned again.'
  if world.get('journey'):trip['cancelAfterArrival']=True
  elif trip.get('status')!='planned':trip['status']='blocked';trip['recoveryTargetIndex']=trip.get('stopIndex',0)
  cleared.append(trip['id'])
 return cleared

def invalidate_changed_place_routes(c,replacements,at,state=None):
 """Invalidate future route evidence when an authored endpoint changes, never travel history."""
 from vh2_runtime import Conflict
 def coordinates(value):
  return isinstance(value,(list,tuple)) and len(value)==2 and all(type(x) in (int,float) and math.isfinite(x) for x in value) and abs(value[0])<=180 and abs(value[1])<=90
 old={p['id']:p for p in c['lifeProfile']['places']}
 # An exact established coordinate anchors the physical endpoint. Correcting
 # only its provider label does not move it or invalidate an actual route.
 # Without that coordinate proof, a different listing remains a spatial edit.
 changed={p['id']:p for p in replacements if p['id'] in old and (
  old[p['id']].get('mapCoordinates')!=p.get('mapCoordinates') or
  old[p['id']].get('googlePlaceId')!=p.get('googlePlaceId') and not coordinates(p.get('mapCoordinates')))}
 if not changed:return None
 world=c['lifeRuntime']['world'];actors=c.get('vh2People',{}).get('actors',{})
 for ident,journey in [(c['id'],world.get('journey'))]+[(i,a.get('journey')) for i,a in actors.items()]:
  if journey and any(journey.get(k) in changed for k in ('from','to')):
   name=c.get('name','This person') if ident==c['id'] else next((p.get('name',ident) for p in c['lifeProfile'].get('socialCircle',[]) if p['id']==ident),ident)
   raise Conflict(f'Wait until {name} arrives before changing the location of an active route endpoint.')
 def nearby(a,b):
  if not coordinates(a) or not coordinates(b):return False
  lon1,lat1,lon2,lat2=map(math.radians,(*a,*b));h=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
  return 6371000*2*math.asin(min(1,math.sqrt(h)))<=150
 def stale(leg):
  touched=[side for side in ('from','to') if leg.get(side) in changed]
  if not touched:return False
  geometry=leg.get('geometry')
  if isinstance(geometry,dict):geometry=geometry.get('coordinates')
  # A provider/source label alone does not establish which coordinates were used.
  # Retain actual geometry already matching the corrected endpoint (e.g. a good
  # Google/OSM route paired with a bad display pin); do not reprice or redraw it.
  return not (isinstance(geometry,list) and len(geometry)>=2 and all(nearby(geometry[0 if side=='from' else -1],changed[leg[side]].get('mapCoordinates')) for side in touched))
 legs=c['lifeProfile'].get('travelLegs',[]);removed=[l for l in legs if stale(l)]
 c['lifeProfile']['travelLegs']=[l for l in legs if not stale(l)]
 cleared=clear_future_route_caches(c,stale)
 weather_invalidated=not world.get('journey') and world.get('placeId') in changed
 if weather_invalidated:
  c['lifeRuntime']['environment']=None
  if state is not None:
   for key in ('weather','weatherAttemptAt','weatherAttemptPoint','weatherError'):state.setdefault('worldData',{}).pop(key,None)
   present=state['truth'].get('present',{})
   present['environment']=None
   present['position']={'status':'at_place','placeId':world['placeId'],'coordinates':changed[world['placeId']].get('mapCoordinates'),'source':'place'}
 result={'at':at,'placeIds':sorted(changed),'removedRouteCount':len(removed),'removedRoutes':[{k:l.get(k) for k in ('from','to','mode','source')} for l in removed[:100]],'removedRoutesTruncated':len(removed)>100,'clearedFutureRouteIds':cleared,'weatherInvalidated':weather_invalidated}
 # The canonical event contains this transition; the snapshot keeps only a
 # small author-facing receipt, with no duplicated old geometry or photos.
 c.setdefault('vh2Geography',{})['lastRouteInvalidation']=result
 return result

def command(service,db,world,revision,state,body):
 from vh2_runtime import encode,Conflict
 after=json.loads(encode(state));c=after['truth']['companion'];kind=body['type'];places={p['id']:p for p in c['lifeProfile']['places']};now=after['simAt']
 if kind=='apply_life_proposal':
  return apply_proposal(service,db,world,revision,state,body)
 if kind=='configure_health_policy':
  policy=validate_policy(body.get('policy'),{'enabled':True,'illnessRatePerYear':2,'recoveryScale':1},{'illnessRatePerYear':(0,12),'recoveryScale':(.5,2)},'health')
  c.setdefault('vh2Health',{'episode':None,'events':[],'lastAt':None,'lastDay':None})['policy']=policy
 elif kind=='configure_live_routing':
  if type(body.get('enabled')) is not bool:raise ValueError('Choose whether automatic live routing is enabled.')
  c['lifeProfile']['world']['transport']['liveRouting']=body['enabled']
 elif kind=='remove_life_entry':
  section=body.get('section');ident=body.get('entryId')
  if section not in ('weeklySchedule','activityOptions'):raise ValueError('Choose a commitment or activity.')
  if body.get('baseSetupVersion')!=c.get('vh2SetupVersion',0):raise Conflict('Life setup changed. Reopen this entry before removing it.')
  rows=c['lifeProfile'][section]
  if not any(x['id']==ident for x in rows):raise ValueError('This entry no longer exists.')
  if section=='weeklySchedule' and any(r['scheduleId']==ident for r in c.get('vh2Institutions',{}).get('rules',[])):raise Conflict('Remove the linked institution rule before removing this commitment.')
  c['lifeProfile'][section]=[x for x in rows if x['id']!=ident]
 elif kind in ('configure_institution','remove_institution'):
  r=c.setdefault('vh2Institutions',{'rules':[],'sessions':{},'events':[],'unpaid':0,'lastAt':None})
  ident=body.get('id')
  if kind=='remove_institution':
   if not any(x['id']==ident for x in r['rules']):raise ValueError('Unknown institution rule.')
   if any(x['ruleId']==ident and x['status']=='open' for x in r['sessions'].values()):raise Conflict('Wait until the current institution session ends.')
   r['rules']=[x for x in r['rules'] if x['id']!=ident]
  else:
   rule=validate_institution_rule(body.get('rule'),c['lifeProfile'])
   if len(r['rules'])>=20 or any(x['scheduleId']==rule['scheduleId'] for x in r['rules']):raise ValueError('Each commitment supports one rule, up to twenty total.')
   r['rules'].append(dict(rule,id=str(uuid.uuid4())))
 elif kind=='settle_expenses':
  amount=body.get('amount');currency=body.get('currency');r=c['vh2Finance'];w=c['lifeRuntime']['world']
  if type(amount) not in (int,float) or not 0<amount<=1000000:raise ValueError('Enter a positive payment up to 1,000,000.')
  cents=round(amount*100)
  if abs(amount*100-cents)>0.00001 or cents<1:raise ValueError('Use at most two decimal places.')
  if currency!=c.get('vh2Gifts',{}).get('currency','USD'):raise ValueError('Use the timeline currency. No conversion is performed.')
  if cents>round(r['unpaid']*100):raise ValueError('The payment exceeds outstanding expenses.')
  if cents>round(w['balance']*100):raise ValueError('Not enough available funds.')
  if r['trackedBalance'] is not None and abs(w['balance']-r['trackedBalance'])>.001:
   r['sequence']+=1;r['ledger'].append({'id':f"finance:{c['id']}:{r['sequence']}",'at':now,'kind':'life_cashflow','amountMinor':round((w['balance']-r['trackedBalance'])*100),'currency':currency,'balanceMinor':round(w['balance']*100),'detail':'Recorded cash changes before expense settlement.'})
  w['balance']=(round(w['balance']*100)-cents)/100;r['unpaid']=(round(r['unpaid']*100)-cents)/100
  r['sequence']+=1;r['ledger'].append({'id':f"finance:{c['id']}:{r['sequence']}",'at':now,'kind':'expense_settlement','amountMinor':-cents,'currency':currency,'balanceMinor':round(w['balance']*100),'detail':f"Settled outstanding expenses; remaining {r['unpaid']:.2f}."});r['ledger']=r['ledger'][-400:];r['trackedBalance']=w['balance']
 elif kind=='upsert_place':
  place=body.get('place')
  if not isinstance(place,dict) or set(place)-{'id','label','kind','longitude','latitude','googlePlaceId','detail'}:raise ValueError('Provide a place name, kind and optional coordinates.')
  ident=place.get('id') or 'place:'+str(uuid.uuid4());label=place.get('label');pkind=place.get('kind','other')
  if not isinstance(ident,str) or not 1<=len(ident)<=80 or not isinstance(label,str) or not 1<=len(label)<=200 or pkind not in ('home','work','study','social','errand','outdoor','transit','other'):raise ValueError('Invalid place identity or kind.')
  row={**places.get(ident,{}),'id':ident,'label':label,'kind':pkind}
  if 'longitude' in place or 'latitude' in place:
   lon=place.get('longitude');lat=place.get('latitude')
   if type(lon) not in (int,float) or type(lat) not in (int,float) or not -180<=lon<=180 or not -90<=lat<=90:raise ValueError('Enter valid longitude and latitude.')
   row['mapCoordinates']=[lon,lat]
  if 'detail' in place:
   if not isinstance(place['detail'],str) or len(place['detail'])>2000:raise ValueError('Use up to 2000 characters for place details.')
   row['detail']=place['detail']
  if 'googlePlaceId' in place:
   if not isinstance(place['googlePlaceId'],str) or len(place['googlePlaceId'])>300:raise ValueError('Invalid provider place ID.')
   if place['googlePlaceId'] and place['googlePlaceId']!=row.get('googlePlaceId') and 'longitude' not in place and 'latitude' not in place:row['mapCoordinates']=None
   row['googlePlaceId']=place['googlePlaceId']
  if ident not in places and (len(places)>=550 or sum(not p.startswith('osm:') for p in places)>=80):raise ValueError('At most eighty authored places and 550 total map places in this timeline.')
  invalidate_changed_place_routes(c,[row],now,after)
  c['lifeProfile']['places']=[p for p in c['lifeProfile']['places'] if p['id']!=ident]+[row]
 elif kind=='record_route':
  origin=body.get('from');dest=body.get('to');mode=body.get('mode');minutes=body.get('minutes');cost=body.get('cost',0)
  if not isinstance(origin,str) or not isinstance(dest,str) or origin not in places or dest not in places or origin==dest or mode not in ('WALK','DRIVE','BICYCLE','TRANSIT','RIDESHARE'):raise ValueError('Choose existing different places and a transport mode.')
  if type(minutes) not in (int,float) or not 1<=minutes<=360 or type(cost) not in (int,float) or not 0<=cost<=100000:raise ValueError('Route time must be 1–360 minutes, with a nonnegative cost.')
  legs=c['lifeProfile']['travelLegs'];legs=[l for l in legs if (l['from'],l['to'],l['mode'])!=(origin,dest,mode)]
  if len(legs)>=5100:raise ValueError('At most 5,100 route legs.')
  legs.append({'from':origin,'to':dest,'mode':mode,'minutes':minutes,'cost':round(cost,2),'source':'authored_duration'});c['lifeProfile']['travelLegs']=legs
 elif kind in ('configure_place_context','set_residence','set_hometown'):
  ident=body.get('placeId')
  if not isinstance(ident,str) or ident not in places:raise ValueError('Choose a saved place.')
  if 'vh2Travel' not in c:c=service.kernel({'companion':c,'now':now,'inspect':True,'tripStops':[]})['companion'];after['truth']['companion']=c
  r=c['vh2Travel']
  if kind=='configure_place_context':
   zone=body.get('timeZone');city=body.get('city','');country=body.get('country','')
   if not isinstance(zone,str) or not isinstance(city,str) or not isinstance(country,str) or len(city)>120 or len(country)>120:raise ValueError('Provide a timezone, city and country.')
   try:ZoneInfo(zone)
   except (ZoneInfoNotFoundError,ValueError):raise ValueError('Use an IANA timezone, such as Europe/London.')
   r['places'][ident]={'timeZone':zone,'city':city,'country':country}
   if c['lifeRuntime']['world']['placeId']==ident and not c['lifeRuntime']['world']['journey']:
    r['clockHistory'].append({'at':now,'timeZone':zone,'placeId':ident});r['currentContext']={**r['places'][ident],'placeId':ident,'arrivedAt':now}
  elif kind=='set_hometown':r['hometownId']=ident
  else:
   if c['lifeRuntime']['world']['journey'] or c['lifeRuntime']['world']['placeId']!=ident:raise Conflict('Move there before changing the current residence.')
   if places[ident]['kind']!='home':raise ValueError('The residence must be a home place.')
   r['residenceId']=ident
 elif kind=='configure_finances':
  p=body.get('policy')
  if not isinstance(p,dict) or set(p)!={'enabled','incomePerHour','dailyIncome','dailyExpense','workPlaceIds'} or type(p['enabled']) is not bool:raise ValueError('Provide the complete finance policy.')
  if any(type(p[k]) not in (int,float) or not 0<=p[k]<=100000 for k in ('incomePerHour','dailyIncome','dailyExpense')):raise ValueError('Invalid income or expense.')
  if not isinstance(p['workPlaceIds'],list) or any(not isinstance(i,str) or i not in places for i in p['workPlaceIds']):raise ValueError('Choose existing work places.')
  c['vh2Finance']['policy']=p;c['vh2Finance']['lastAt']=now;c['vh2Finance']['trackedBalance']=c['lifeRuntime']['world']['balance']
 elif kind=='configure_closet':
  if type(body.get('enabled')) is not bool or type(body.get('repetitionPenalty')) not in (int,float) or not 0<=body['repetitionPenalty']<=100:raise ValueError('Invalid closet settings.')
  if 'outfitMode' in body:
   if body['outfitMode'] not in ('presets','items'):raise ValueError('Choose outfit presets or mixed garments.')
   if body['enabled']!=(body['outfitMode']=='items'):raise ValueError('Clothing mode and style selection must agree.')
   c['lifeProfile']['world']['closet']['mode']=body['outfitMode']
  else:
   c['lifeProfile']['world']['closet']['mode']='items' if body['enabled'] else 'presets'
  c['vh2Closet']['enabled']=body['enabled'];c['vh2Closet']['repetitionPenalty']=body['repetitionPenalty']
 elif kind=='add_closet_style':
  styles=c['vh2Closet']['styles'];name=body.get('name');context=body.get('context');tags=body.get('tags',[]);pieces=body.get('pieces');warmth=body.get('warmth',1)
  if len(styles)>=20:raise ValueError('At most twenty style profiles.')
  if not isinstance(name,str) or not 1<=len(name)<=120 or context not in ('any','casual','home','work','fitness','active','sleep','social','formal'):raise ValueError('Give the style a name and supported context.')
  if not isinstance(pieces,dict) or not pieces or set(pieces)-{'top','bottom','dress','outerwear','underwear','shoes','accessory'}:raise ValueError('Use supported garment categories.')
  if any(not isinstance(names,list) or len(names)>20 or any(not isinstance(n,str) or not 1<=len(n)<=120 for n in names) for names in pieces.values()):raise ValueError('Use up to twenty garment descriptions per category.')
  if not isinstance(tags,list) or len(tags)>20 or any(not isinstance(t,str) or len(t)>40 for t in tags) or type(warmth) not in (int,float) or not 0<=warmth<=5:raise ValueError('Invalid tags or warmth.')
  if not pieces.get('dress') and not (pieces.get('top') and pieces.get('bottom')):raise ValueError('Include a dress or both tops and bottoms.')
  styles.append({'id':str(uuid.uuid4()),'name':name,'context':context,'tags':tags,'pieces':pieces,'warmth':warmth})
 else:
  styles=c['vh2Closet']['styles'];ident=body.get('styleId')
  if not any(s['id']==ident for s in styles):raise ValueError('Unknown style.')
  c['vh2Closet']['styles']=[s for s in styles if s['id']!=ident]
 c['vh2SetupVersion']=c.get('vh2SetupVersion',0)+1
 revision=service.commit_event(db,world,revision,state,after,'LIFESTYLE_CONFIGURED',{'operation':kind})
 return revision,after


def apply_proposal(service,db,world,revision,state,body):
 """Merge reviewed authoring rows; never replace runtime or remove existing entities."""
 from vh2_runtime import encode,Conflict
 after=json.loads(encode(state));c=after['truth']['companion'];life=c['lifeProfile'];proposal=body.get('proposal')
 special={'finance','possessions','exploration','peopleLives','institutions','rooms','referencePlan','routes','expression','personalPreferences','personalCalendar','autonomy','socialPolicy','geography','population','socialPlanPolicy','socialPrivateVisitPermissions','healthPolicy','psychologyPolicy','relationshipPolicy','storyPolicy'}
 allowed=special|{'sleepPolicy','breakPolicy','workweekDays','styleProfiles','places','socialCircle','wardrobe','weeklySchedule','activityOptions','fashionSense','grooming','foodHabits','mediaHabits','moneyPattern','healthRoutine','digitalLife','seasonalVariation'}
 if body.get('version') not in (1,2) or not isinstance(proposal,dict) or not proposal or set(proposal)-allowed:raise ValueError('Provide a supported version 1 or 2 life proposal.')
 # Author edits must be re-reviewed after another author edit, but simulation ticks do not invalidate them.
 if body.get('baseSetupVersion',0)!=c.get('vh2SetupVersion',0):raise Conflict('Life setup changed. Review a fresh proposal before applying.')
 if c['lifeRuntime']['world'].get('journey') and set(proposal)&{'rooms','weeklySchedule','peopleLives'}:
  raise Conflict('Wait until the current journey ends before changing rooms, commitments or supporting-person locations. Wardrobe and other preferences can be saved now.')
 # Place edits use the same physical endpoint guard as the map editor below;
 # text-only corrections remain safe during travel.
 merged=json.loads(encode(life))
 schedule_repairs=[]
 if 'weeklySchedule' in proposal:
  # Legacy schedules reused IDs for separate weekday blocks. Keep the first
  # identity (and its existing references); retain later blocks under stable IDs.
  used={r.get('id') for r in merged.get('weeklySchedule',[])}|{r.get('id') for r in proposal['weeklySchedule'] if isinstance(r,dict)} if isinstance(proposal['weeklySchedule'],list) else set()
  seen=set()
  for index,row in enumerate(merged.get('weeklySchedule',[])):
   ident=row.get('id')
   if ident in seen:
    import hashlib
    suffix=hashlib.sha256((str(index)+':'+encode(row)).encode()).hexdigest()[:12]
    candidate=str(ident)[:60]+'_'+suffix
    counter=0
    while candidate in used:
     counter+=1;candidate=str(ident)[:50]+'_'+suffix+'_'+str(counter)
    row['id']=candidate;used.add(candidate)
    schedule_repairs.append({'index':index,'oldId':ident,'newId':candidate})
   seen.add(row['id'])
 for key,value in proposal.items():
  if key in special:continue
  if key in ('sleepPolicy','breakPolicy'):
   bounds={'sleepPolicy':{'pressurePerHour':(1,10),'recoveryPerHour':(3,20),'windDownMinutes':(5,60),'sleepNeedHours':(4,12),'napCutoffHours':(0,6),'stimulationResistance':(0,25),'hungerSensitivity':(0,2)},'breakPolicy':{'intervalMinutes':(30,360),'mealMinutes':(10,60),'restMinutes':(5,45),'hungerThreshold':(40,95)}}[key]
   flags={'enabled'}|({'foodAvailable'} if key=='breakPolicy' else set())
   if not isinstance(value,dict) or not value or set(value)-set(bounds)-flags:raise ValueError('Unsupported '+key+' settings.')
   for field,v in value.items():
    if field in flags:
     if type(v) is not bool:raise ValueError('Use true or false for '+field)
    elif type(v) not in (int,float) or not bounds[field][0]<=v<=bounds[field][1]:raise ValueError('Invalid '+field)
   merged[key]={**merged.get(key,{}),**value};continue
  if key=='workweekDays':
   if not isinstance(value,list) or not value or len(value)>7 or any(type(v) is not int or v<0 or v>6 for v in value) or len(set(value))!=len(value):raise ValueError('Choose distinct weekdays.')
   merged[key]=value;continue
  if key=='styleProfiles':
   if not isinstance(value,list) or len(value)>20:raise ValueError('Use up to twenty styles.')
   styles={x['id']:x for x in c['vh2Closet']['styles']}
   for style in value:
    validate_style(style);styles[style['id']]=style
   if len(styles)>20:raise ValueError('The closet supports twenty styles.')
   c['vh2Closet']['styles']=list(styles.values())
   # Drafting style options must not replace the selected complete-outfit mode.
   c['vh2Closet']['enabled']=bool(styles) and c['lifeProfile']['world']['closet']['mode']=='items'
   continue
  if key in ('places','socialCircle','wardrobe','weeklySchedule','activityOptions'):
   if not isinstance(value,list) or len(value)>100 or any(not isinstance(x,dict) or not isinstance(x.get('id'),str) or not 1<=len(x['id'])<=80 for x in value):raise ValueError('Every proposed entity needs a stable ID.')
   if len({x['id'] for x in value})!=len(value):raise ValueError('Duplicate IDs in '+key+' proposal.')
   if len({x['id'] for x in merged.get(key,[])})!=len(merged.get(key,[])):raise ValueError('Existing '+key+' contains duplicate IDs; resolve these before applying changes to that section.')
   rows={x['id']:x for x in merged.get(key,[])}
   for row in value:
    previous=rows.get(row['id'],{});combined={**previous,**row}
    if key=='places' and row.get('googlePlaceId') and row['googlePlaceId']!=previous.get('googlePlaceId') and 'mapCoordinates' not in row:combined['mapCoordinates']=None
    rows[row['id']]=combined
   merged[key]=list(rows.values())
  else:
   if not isinstance(value,str) or len(value)>4000:raise ValueError('Use a short life description.')
   merged[key]=value
 place_ids={p['id'] for p in merged['places']};people_ids={p['id'] for p in merged.get('socialCircle',[])}
 if 'personalCalendar' in proposal:
  merged['personalCalendar']=__import__('vh2_calendar').validate_personal(proposal['personalCalendar'],{**c,'lifeProfile':merged},__import__('vh2_calendar').local_datetime(state).date())
 for row in merged.get('weeklySchedule',[]):
  __import__('vh2_calendar').validate_dates(row)
  if row.get('placeId') and row['placeId'] not in place_ids:raise ValueError('A commitment points to an unknown place.')
  if any(i not in people_ids for i in row.get('withIds',[])):raise ValueError('A commitment points to an unknown person.')
 for row in merged.get('activityOptions',[]):
  if row.get('requiredPlaceId') and row['requiredPlaceId'] not in place_ids:raise ValueError('An activity points to an unknown place.')
  if row.get('participantId') and row['participantId'] not in people_ids:raise ValueError('An activity points to an unknown person.')
 normalized=service.kernel({'normalizeLife':merged,'now':state['simAt']})['lifeProfile']
 if 'institutions' in proposal:
  rows=proposal['institutions'];seen=set()
  if not isinstance(rows,list) or len(rows)>20:raise ValueError('Use up to twenty institution rules.')
  institutions=c.setdefault('vh2Institutions',{'rules':[],'sessions':{},'events':[],'unpaid':0,'lastAt':None})
  rules={r['id']:r for r in institutions['rules']}
  for row in rows:
   ident=row.get('id') if isinstance(row,dict) else None
   if not isinstance(ident,str) or not 1<=len(ident)<=80 or ident in seen:raise ValueError('Institution rules need distinct stable IDs.')
   seen.add(ident);rule={'id':ident,**validate_institution_rule({k:v for k,v in row.items() if k!='id'},normalized)}
   if ident in rules and rules[ident]!=rule and any(s['ruleId']==ident and s['status']=='open' for s in institutions['sessions'].values()):raise Conflict('Wait until the current institution session ends before changing its rule.')
   rules[ident]=rule
  if len(rules)>20 or len({r['scheduleId'] for r in rules.values()})!=len(rules):raise ValueError('Each commitment supports one rule, up to twenty total.')
  institutions['rules']=list(rules.values())
 for key in ('places','socialCircle','wardrobe','weeklySchedule','activityOptions'):
  if key in proposal and {x['id'] for x in normalized.get(key,[])}!={x['id'] for x in merged.get(key,[])}:raise ValueError('The proposal exceeds limits or contains invalid entities.')
 if 'places' in proposal:invalidate_changed_place_routes(c,normalized['places'],after['simAt'],after)
 # Keep state outside reviewed author fields exactly as it was.
 for key in proposal:
  if key!='styleProfiles' and key not in special:life[key]=normalized[key]
 if 'personalCalendar' in proposal:life['personalCalendar']=normalized['personalCalendar']
 new_life=state['simAt']==life.get('initializedAt') and not state.get('photos') and not state.get('communication',{}).get('messages')
 if 'possessions' in proposal:
  items=proposal['possessions'];existing={i['id']:i for i in life['world']['items']}
  if not isinstance(items,list) or len(items)>50:raise ValueError('Use up to fifty authored possessions.')
  ids=set()
  for item in items:
   if not isinstance(item,dict) or set(item)-{'id','name','category','description','tags'}:raise ValueError('Possessions need an ID, name, category and visual description.')
   for field,limit in [('id',80),('name',200),('description',2000)]:
    if not isinstance(item.get(field),str) or not 1<=len(item[field].strip())<=limit:raise ValueError('Invalid possession '+field+'.')
   ident=item['id']
   if ident in ids:raise ValueError('Duplicate possession IDs.')
   ids.add(ident)
   if item.get('category') not in ('object','food','top','bottom','dress','outerwear','underwear','shoes','accessory'):raise ValueError('Unsupported possession category.')
   tags=item.get('tags',[])
   if not isinstance(tags,list) or len(tags)>20 or any(not isinstance(t,str) or not 1<=len(t)<=40 for t in tags):raise ValueError('Invalid possession tags.')
   prior=existing.get(ident)
   if not prior and not new_life:raise Conflict('New starting possessions belong to a new life. Record an acquisition to add an item to an established life.')
   existing[ident]={**(prior or {'photo':'','owned':True,'warmth':1,'incompatible':[]}), 'id':ident,'name':item['name'],'category':item['category'],'tags':tags,'referenceDescription':item['description']}
   if not prior and ident not in c['lifeRuntime']['world']['inventory']:c['lifeRuntime']['world']['inventory'].append(ident)
  if len(existing)>150:raise ValueError('The life supports up to 150 possessions.')
  life['world']['items']=list(existing.values())
 finance=proposal.get('finance')
 if isinstance(finance,dict) and 'startingBalance' in finance:
  balance=finance['startingBalance'];grants=c.setdefault('vh2SetupGrants',{})
  if type(balance) not in (int,float) or not 0<=balance<=1000000:raise ValueError('Invalid starting balance.')
  prior=grants.get('startingBalance')
  if prior and prior['amount']!=balance or not prior and not new_life:raise Conflict('Starting balance can only be set once, when a new life is created. Existing funds are preserved.')
  if not prior:
   c['lifeRuntime']['world']['balance']=balance;c['vh2Finance']['trackedBalance']=balance
   grants['startingBalance']={'at':state['simAt'],'amount':balance,'source':'authored new-life budget'}
 # Food availability in a new-life draft creates a small explicit starter stock,
 # once. Updating an established life must never refill its resources.
 if proposal.get('breakPolicy',{}).get('foodAvailable') is True and not c.get('vh2SetupGrants',{}).get('starterFood') and new_life:
  resources=c['lifeRuntime']['activities'].setdefault('resources',{})
  resources['ingredients']=max(resources.get('ingredients',0),3)
  c.setdefault('vh2SetupGrants',{})['starterFood']={'at':state['simAt'],'amount':3,'source':'authored new-life food availability'}
 # Explicit starting positions are allowed only when no position exists; never teleport an existing person.
 people_lives=proposal.get('peopleLives',[])
 residents=proposal.get('population',{}).get('residents',[]) if isinstance(proposal.get('population',{}),dict) else []
 participant_ids=people_ids|{p['id'] for p in c.get('vh2Population',{}).get('residents',[])}|{p['id'] for p in residents if isinstance(p,dict) and isinstance(p.get('id'),str)} if isinstance(residents,list) else people_ids
 if not isinstance(people_lives,list) or len(people_lives)>30:raise ValueError('Use up to thirty supporting-person life configurations.')
 if len({p.get('personId') for p in people_lives if isinstance(p,dict)})!=len(people_lives):raise ValueError('Supporting-person lives need distinct person IDs.')
 for item in people_lives:
  if not isinstance(item,dict) or set(item)-{'personId','policy','initialPlaceId','startingBalance','commitments'} or item.get('personId') not in participant_ids:raise ValueError('Link independent lives to known people or authored residents.')
  ident=item['personId'];initial=item.get('initialPlaceId');actor=c.get('vh2People',{}).get('actors',{}).get(ident);old=c.get('vh2NpcTravel',{}).get('people',{}).get(ident,{})
  # The first complete setup replaces only untouched automatic initial actors.
  # Persisted participants are never reset by applying another setup proposal.
  if actor and new_life and not c.get('vh2SetupVersion',0) and not actor.get('started') and 'startingBalance' in item and initial:
   c['vh2People']['actors'].pop(ident);c['lifeRuntime']['world']['people'].pop(ident,None);actor=None;old={}
  if not actor:c.setdefault('vh2People',{'actors':{},'events':[],'sequence':0}).setdefault('setup',{}).setdefault(ident,{})['status']='pending_configuration'
  if not actor and 'startingBalance' in item:
   balance=item['startingBalance']
   if type(balance) not in (int,float) or not 0<=balance<=1000000:raise ValueError('Invalid proposed starting budget.')
   c.setdefault('vh2People',{'actors':{},'events':[],'sequence':0}).setdefault('setup',{}).setdefault(ident,{})['startingBalance']=balance
  position=actor or old or c['lifeRuntime']['world']['people'].get(ident,{})
  if initial:
   if initial not in place_ids:raise ValueError('Unknown initial place.')
   if position.get('placeId') and position['placeId']!=initial:raise Conflict('An initial-place proposal cannot relocate an existing person.')
   if not position.get('placeId'):c['lifeRuntime']['world']['people'][ident]={'placeId':initial}
  if 'commitments' in item:
   rows=item['commitments'];commitment_ids=set()
   if not isinstance(rows,list) or len(rows)>14:raise ValueError('Use up to fourteen recurring commitments per person.')
   for row in rows:
    __import__('vh2_calendar').validate_dates(row)
    if not isinstance(row,dict) or set(row)-{'id','placeId','days','start','end','activity','flexibility','startsOn','endsOn','breaks','calendarSource'}:raise ValueError('Unsupported supporting-person commitment fields.')
    if not isinstance(row.get('id'),str) or not 1<=len(row['id'])<=80 or row['id'] in commitment_ids:raise ValueError('Supporting-person commitments need distinct stable IDs.')
    commitment_ids.add(row['id'])
    if row.get('placeId') not in place_ids:raise ValueError('A supporting-person commitment needs a saved place.')
    if not isinstance(row.get('days'),list) or not row['days'] or len(set(row['days']))!=len(row['days']) or any(type(d) is not int or not 0<=d<=6 for d in row['days']):raise ValueError('Use distinct commitment weekdays.')
    if type(row.get('start')) is not int or type(row.get('end')) is not int or not 0<=row['start']<row['end']<=1440:raise ValueError('Commitments need a valid local-time interval; split overnight shifts across two days.')
    if not isinstance(row.get('activity'),str) or not 1<=len(row['activity'])<=200 or row.get('flexibility','hard') not in ('hard','soft'):raise ValueError('Give the commitment an activity and flexibility.')
   others=[r for r in life['world']['people'] if r['personId']!=ident]
   if len(others)+len(rows)>60:raise ValueError('This life supports up to sixty supporting-person commitment rows.')
   life['world']['people']=others+[{**row,'personId':ident,'flexibility':row.get('flexibility','hard'),'goal':'','goalMinutes':60,'mood':''} for row in rows]
 c['vh2SetupVersion']=c.get('vh2SetupVersion',0)+1
 revision=service.commit_event(db,world,revision,state,after,'LIFE_SETUP_APPLIED',{'version':body['version'],'sections':list(proposal),'setupVersion':c['vh2SetupVersion'],'scheduleIdRepairs':schedule_repairs})
 # Each existing command validates its own capability. WorldService owns the outer
 # transaction, so a failure in ANY section rolls back all events and state changes.
 if 'finance' in proposal:
  if isinstance(finance,dict) and 'currency' in finance:
   import vh2_gifts
   # Use the existing denomination owner and its no-relabel-after-activity guard.
   # This does not convert balances or enable gifts.
   revision,after=vh2_gifts.command(service,db,world,revision,after,{'type':'configure_gifts','currency':finance['currency'],'policy':{k:after['truth']['companion']['lifeProfile']['world']['gifts'][k] for k in ('enabled','mailAllowed','cashAllowed','minTrust','maxValue','deliveryHours','playerBudget')}})
  revision,after=command(service,db,world,revision,after,{'type':'configure_finances','policy':{k:v for k,v in finance.items() if k not in ('startingBalance','currency')} if isinstance(finance,dict) else finance})
 if 'exploration' in proposal:
  import vh2_exploration
  revision,after=vh2_exploration.command(service,db,world,revision,after,{'type':'configure_exploration','policy':proposal['exploration']})
 if 'routes' in proposal:
  routes=proposal['routes']
  if not isinstance(routes,list) or len(routes)>100:raise ValueError('Use up to one hundred estimated route connections per proposal.')
  for route in routes:
   if not isinstance(route,dict) or set(route)-{'from','to','mode','minutes','cost'}:raise ValueError('Routes require origin, destination, mode, minutes and cost.')
   # Never replace a recorded street route with an AI estimate.
   existing=next((l for l in after['truth']['companion']['lifeProfile']['travelLegs'] if (l['from'],l['to'],l['mode'])==(route.get('from'),route.get('to'),route.get('mode'))),None)
   if existing:continue
   revision,after=command(service,db,world,revision,after,{'type':'record_route',**route})
 if 'rooms' in proposal:
  import vh2_visual
  rooms=proposal['rooms']
  if not isinstance(rooms,list) or len(rooms)>100 or any(not isinstance(r,dict) or set(r)-{'id','placeId','label','description'} or not r.get('id') for r in rooms):raise ValueError('Rooms need stable IDs and place links.')
  if len({r['id'] for r in rooms})!=len(rooms):raise ValueError('Duplicate room IDs.')
  for room in rooms:revision,after=vh2_visual.command(service,db,world,revision,after,{'type':'save_place_zone','zoneId':room['id'],**{k:v for k,v in room.items() if k!='id'}})
 if 'referencePlan' in proposal:
  before=json.loads(encode(after));char=after['truth']['companion'];plans=proposal['referencePlan']
  if not isinstance(plans,list) or len(plans)>100:raise ValueError('Use up to one hundred planned references.')
  from vh2_assets import normalize_reference_plan
  if any(not isinstance(p,dict) or not isinstance(p.get('id'),str) for p in plans) or len({p['id'] for p in plans})!=len(plans):raise ValueError('Reference plans need unique stable IDs.')
  existing={r['id']:r for r in char.get('vh2ReferencePlan',[])}
  for plan in plans:
   if not isinstance(plan,dict) or set(plan)-{'id','role','entityId','view','description','label'}:raise ValueError('Invalid reference plan.')
   plan=normalize_reference_plan(char,plan)
   if any(not isinstance(plan.get(k),str) or not 1<=len(plan[k])<=limit for k,limit in [('id',80),('label',120),('description',2000)]):raise ValueError('Reference plans need an ID, label and description.')
   existing[plan['id']]={**plan,'entityId':char['id'] if plan['entityId']=='self' else plan['entityId']}
  if len(existing)>100:raise ValueError('Too many planned references.')
  char['vh2ReferencePlan']=list(existing.values());revision=service.commit_event(db,world,revision,before,after,'REFERENCE_PLAN_CONFIGURED')
 revision,after=apply_complete_policies(service,db,world,revision,after,proposal)
 return revision,after


def validate_style(style):
 if not isinstance(style,dict) or set(style)-{'id','name','context','tags','pieces','warmth'} or not isinstance(style.get('id'),str) or not 1<=len(style['id'])<=80:raise ValueError('A style requires a stable ID.')
 if not isinstance(style.get('name'),str) or not 1<=len(style['name'])<=120 or style.get('context') not in ('any','casual','home','work','fitness','active','sleep','social','formal'):raise ValueError('Invalid style name or context.')
 pieces=style.get('pieces');tags=style.get('tags',[]);warmth=style.get('warmth',1)
 if not isinstance(pieces,dict) or set(pieces)-{'top','bottom','dress','outerwear','underwear','shoes','accessory'} or not (pieces.get('dress') or pieces.get('top') and pieces.get('bottom')):raise ValueError('A style needs a dress or tops and bottoms.')
 if any(not isinstance(v,list) or len(v)>20 or any(not isinstance(n,str) or not 1<=len(n)<=120 for n in v) for v in pieces.values()):raise ValueError('Invalid garment options.')
 if not isinstance(tags,list) or len(tags)>20 or any(not isinstance(t,str) or len(t)>40 for t in tags) or type(warmth) not in (int,float) or not 0<=warmth<=5:raise ValueError('Invalid style tags or warmth.')
 style['tags']=tags;style['warmth']=warmth


def validate_policy(raw,defaults,bounds,label):
 if not isinstance(raw,dict) or set(raw)-set(defaults):raise ValueError('Unsupported '+label+' policy fields.')
 result={**defaults,**raw}
 for key,value in result.items():
  if isinstance(defaults[key],bool):
   if type(value) is not bool:raise ValueError(label+' '+key+' must be on or off.')
  elif key in bounds:
   if type(value) not in (int,float) or not bounds[key][0]<=value<=bounds[key][1]:raise ValueError('Invalid '+label+' '+key)
 return result


def apply_complete_policies(service,db,world,revision,state,proposal):
 """Apply the reviewed complete-life draft through the existing command owners.
 All writes remain in the outer proposal transaction, including expression.
 """
 from vh2_runtime import encode
 import vh2_player,vh2_geography,vh2_population,vh2_people,vh2_plans
 if 'expression' in proposal:
  revision,state=vh2_player.command(service,db,world,revision,state,{'type':'configure_expression_profile','fields':proposal['expression']})
 if 'personalPreferences' in proposal:
  revision,state=vh2_player.command(service,db,world,revision,state,{'type':'configure_personal_preferences','profile':proposal['personalPreferences']})
 for section in ('autonomy','geography','population','peopleLives','socialPolicy','psychologyPolicy','relationshipPolicy','healthPolicy','storyPolicy'):
  if section not in proposal:continue
  if section=='population':
   raw=proposal[section]
   if not isinstance(raw,dict) or set(raw)-{'enabled','openness','fictional','residents'}:raise ValueError('Invalid population proposal.')
   revision,state=vh2_population.command(service,db,world,revision,state,{'type':'configure_population',**{k:v for k,v in raw.items() if k!='residents'}})
   residents=raw.get('residents',[])
   if not isinstance(residents,list) or len(residents)>30:raise ValueError('Use up to thirty resident proposals.')
   for resident in residents:
    if not isinstance(resident,dict) or not isinstance(resident.get('id'),str):raise ValueError('Residents require a stable ID.')
    revision,state=vh2_population.command(service,db,world,revision,state,{'type':'add_resident','key':'proposal:'+resident['id'],**resident})
   continue
  if section=='peopleLives':
   for item in proposal[section]:revision,state=vh2_people.command(service,db,world,revision,state,{'type':'configure_person_life',**{k:v for k,v in item.items() if k not in ('initialPlaceId','commitments')}})
   continue
  raw=proposal[section];before=json.loads(encode(state));c=state['truth']['companion']
  if section=='autonomy':
   values=validate_policy(raw,{'enabled':c.get('vh2Geography',{}).get('enabled',False),'spontaneousExpression':c['vh2Agency']['policy']['enabled'],'socialPosting':c.get('socialFeedEnabled',False),'liveWeather':c.get('lifeWeatherEnabled',False)},{},'autonomy')
   c['vh2Agency']['policy']['enabled']=values['spontaneousExpression']
   c['socialFeedEnabled']=values['socialPosting'];c['lifeWeatherEnabled']=values['liveWeather']
   c['vh2SocialPolicy']={'enabled':values['socialPosting'],'frequency':c.get('socialPostFrequency','occasional')}
   c.setdefault('vh2Geography',{})['enabled']=values['enabled']
   if c.get('vh2Exploration'):c['vh2Exploration']['policy']['enabled']=values['enabled']
   if values['enabled']:c['lifeProfile']['world']['transport']['enabled']=True
  elif section=='socialPolicy':
   values=validate_policy({k:v for k,v in raw.items() if k!='dispositions'} if isinstance(raw,dict) else raw,{**{'encountersEnabled':True,'groupPlansEnabled':True,'introductionsEnabled':True,'sociability':50,'openness':50},**{k:v for k,v in c.get('vh2SocialSetup',{}).items() if k!='dispositions'}},{'sociability':(0,100),'openness':(0,100)},'social')
   c['vh2Agency']['policy']['sociability']=values['sociability']
   network=c.setdefault('vh2People',{}).setdefault('network',{'pairs':{},'events':[]})
   network['enabled']=values['encountersEnabled'];network.setdefault('policy',{})['groupPlansEnabled']=values['groupPlansEnabled']
   population=c.setdefault('vh2Population',{'residents':[],'contacts':{},'events':[],'sequence':0})
   population.update(enabled=values['introductionsEnabled'],openness=values['openness'])
   for place in c['lifeProfile']['places']:
    if place.get('kind') in ('social','outdoor','errand') and 'encounterScope' not in place:place['encounterScope']='nearby'
   for ident in c.get('vh2People',{}).get('actors',{}):network.setdefault('dispositions',{}).setdefault(ident,{'sociability':values['sociability'],'openness':values['openness']})
   dispositions=raw.get('dispositions',{})
   if not isinstance(dispositions,dict) or len(dispositions)>100:raise ValueError('Invalid social dispositions.')
   for ident,traits in dispositions.items():
    if ident not in c.get('vh2People',{}).get('actors',{}) or not isinstance(traits,dict) or set(traits)-{'sociability','openness','trustOpenness','sensitivity'} or any(type(v) not in (int,float) or not 0<=v<=100 for v in traits.values()):raise ValueError('Dispositions need known participating people and values from 0 to 100.')
    network.setdefault('dispositions',{}).setdefault(ident,{}).update(traits)
   c['vh2SocialSetup']={**values,'dispositions':dispositions}
  elif section=='geography':
   if not isinstance(raw,dict) or set(raw)-{'enabled','maxTravelMinutes','places'} or type(raw.get('enabled')) is not bool:raise ValueError('Invalid geographic setup.')
   max_minutes=raw.get('maxTravelMinutes',60)
   if type(max_minutes) not in (int,float) or not 1<=max_minutes<=360:raise ValueError('Invalid geographic travel limit.')
   places=raw.get('places',[]);known={p['id'] for p in c['lifeProfile']['places']}
   if not isinstance(places,list) or len(places)>550:raise ValueError('Use up to 550 place capability records, matching the saved place library.')
   g=c.setdefault('vh2Geography',{'places':{},'knownPlaceIds':[]});g.update(enabled=raw['enabled'],maxTravelMinutes=max_minutes,nextReview=0)
   g.setdefault('places',{});g.setdefault('knownPlaceIds',[])
   for place in c['lifeProfile']['places']:g['places'].setdefault(place['id'],vh2_geography.infer(place))
   for row in places:
    if not isinstance(row,dict) or row.get('placeId') not in known:raise ValueError('Capabilities require a saved place.')
    g['places'][row['placeId']]=vh2_geography.validate({k:v for k,v in row.items() if k!='placeId'})
    if row.get('access')=='public':
     next(p for p in c['lifeProfile']['places'] if p['id']==row['placeId'])['encounterScope']='nearby'
   if raw['enabled']:c['lifeProfile']['world']['transport']['enabled']=True
   if c.get('vh2Exploration'):c['vh2Exploration']['policy']['enabled']=raw['enabled']
  elif section=='storyPolicy':
   from pathlib import Path
   schema=json.loads(Path(__file__).with_name('vh2-story-policy.json').read_text())
   previous=c.get('vh2Story',{}).get('policy',{})
   values=validate_policy(raw,{k:previous.get(k,s['default']) for k,s in schema.items()},{k:(s['min'],s['max']) for k,s in schema.items() if s.get('type')!='boolean'},'story pacing')
   c.setdefault('vh2Story',{'threads':[],'events':[],'sequence':0,'lastReview':None,'nextAt':0})['policy']=values
  elif section=='healthPolicy':
   c.setdefault('vh2Health',{'episode':None,'events':[],'lastAt':None,'lastDay':None})['policy']=validate_policy(raw,{**{'enabled':True,'illnessRatePerYear':2,'recoveryScale':1},**c.get('vh2Health',{}).get('policy',{})},{'illnessRatePerYear':(0,12),'recoveryScale':(.5,2)},'health')
  elif section=='psychologyPolicy':
   defaults={'enabled':True,'learningRate':.2,'experienceWeight':6,'emotionalImpact':1,'affectHalfLifeHours':3,'memoryLimit':200}
   values=validate_policy(raw,{**defaults,**c['vh2Psychology'].get('policy',{})},{'learningRate':(0,1),'experienceWeight':(0,20),'emotionalImpact':(0,3),'affectHalfLifeHours':(.25,48),'memoryLimit':(20,500)},'psychology')
   if type(values['memoryLimit']) is not int:raise ValueError('Use a whole memory limit.')
   c['vh2Psychology']['policy']=values
  elif section=='relationshipPolicy':
   defaults={'enabled':True,'positiveStep':.1,'negativeStep':.2,'dailyLimit':1,'minPositiveExchanges':3,'minPositiveSpanHours':24,'cooldownMinutes':30,'friendliness':50,'guardedness':50,'trustOpenness':50,'rejectionSensitivity':50}
   bounds={'positiveStep':(0,1),'negativeStep':(0,2),'dailyLimit':(0,5),'minPositiveExchanges':(1,20),'minPositiveSpanHours':(0,168),'cooldownMinutes':(1,1440),**{k:(0,100) for k in ('friendliness','guardedness','trustOpenness','rejectionSensitivity')}}
   values=validate_policy(raw,{**defaults,**c['vh2Psychology'].get('relationshipPolicy',{})},bounds,'relationship')
   if type(values['minPositiveExchanges']) is not int:raise ValueError('Use a whole exchange count.')
   c['vh2Psychology']['relationshipPolicy']=values
  revision=service.commit_event(db,world,revision,before,state,'LIFE_CAPABILITY_CONFIGURED',{'section':section})
 for section,field in [('socialPlanPolicy','policy'),('socialPrivateVisitPermissions','permissions')]:
  if section in proposal:
   before=json.loads(encode(state));c=state['truth']['companion'];plans=c.setdefault('vh2Plans',{'plans':[],'events':[],'sequence':0})
   if section=='socialPlanPolicy':plans['policy']=vh2_plans.validate_social_plan_policy({**plans.get('policy',{}),**proposal[section]})
   else:
    supplied=vh2_plans.validate_private_visit_permissions(c,proposal[section]);permissions={p['personId']:p for p in plans.get('privateVisitPermissions',[])}
    permissions.update({p['personId']:p for p in supplied});plans['privateVisitPermissions']=list(permissions.values())
   revision=service.commit_event(db,world,revision,before,state,'SOCIAL_PLAN_POLICY_CONFIGURED',{'section':section})
 return revision,state
