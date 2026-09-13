"""Persistent travel intentions: recorded routes, actual arrivals, no bookings."""
import json
import uuid
COMMANDS=('plan_trip','cancel_trip')
def command(service,db,world_id,revision,state,body):
 from vh2_runtime import encode,Conflict
 after=json.loads(encode(state));c=after['truth']['companion'];now=after['simAt']
 r=c.setdefault('vh2Travel',dict(places={},trips=[],events=[],sequence=0,activeId=None,clockHistory=[],residenceId=next((p['id'] for p in c['lifeProfile']['places'] if p['kind']=='home'),''),hometownId=None,custody=False,carPlaceId=None,bikePlaceId=None))
 active=next((t for t in r['trips'] if t['id']==r['activeId']),None)
 if body['type']=='cancel_trip':
  if not active or active['status'] in ('completed','cancelled','expired'):raise Conflict('There is no active trip to cancel.')
  if active['status']=='travelling':active['cancelAfterArrival']=True
  else:active['status']='cancelled';r['activeId']=None
 else:
  if active and active['status'] not in ('completed','cancelled','expired'):raise Conflict('Complete or cancel the current trip first.')
  if not c['lifeProfile']['world']['transport']['enabled']:raise ValueError('Enable transport and configure routes before planning a trip.')
  label=body.get('label');stops=body.get('stops');start=body.get('startsAt',now)
  if not isinstance(label,str) or not 1<=len(label.strip())<=120:raise ValueError('Give the trip a short name.')
  if type(start) is not int or not now<=start<=now+30*86400000:raise ValueError('Departure must be within the next 30 simulated days.')
  if not isinstance(stops,list) or not 1<=len(stops)<=12:raise ValueError('Provide between one and twelve stops.')
  places={p['id'] for p in c['lifeProfile']['places']}
  for stop in stops:
   if not isinstance(stop,dict) or set(stop)!={'placeId','stayMinutes'} or not isinstance(stop['placeId'],str) or stop['placeId'] not in places or type(stop['stayMinutes']) is not int or not 0<=stop['stayMinutes']<=43200:raise ValueError('Every stop needs an existing place and a stay of zero to 30 days.')
  if c['lifeRuntime']['world']['journey'] or c['lifeRuntime']['world'].get('outing'):raise Conflict('Finish the current journey before planning another.')
  check=service.kernel(dict(companion=c,now=now,inspect=True,tripStops=stops,tripStartsAt=start))
  if check.get('tripRoutes') is None:raise ValueError('No affordable recorded route through these stops. Configure routes and available transport first.')
  r['trips']=r['trips'][-49:]
  trip=dict(id='trip:'+str(uuid.uuid4()),label=label.strip(),stops=stops,startsAt=start,status='planned',legSequence=0,stopIndex=0,legs=[],createdAt=now)
  r['trips'].append(trip);r['activeId']=trip['id']
 revision=service.commit_event(db,world_id,revision,state,after,'TRAVEL_INTENTION_CHANGED',{'operation':body['type']})
 return revision,after
