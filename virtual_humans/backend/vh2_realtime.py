"""Bounded GTFS-RT TripUpdate subset; no vehicle-location or booking inference.

Wire field numbers follow the public GTFS Realtime protocol specification:
https://gtfs.org/documentation/realtime/reference/
Unknown protobuf fields are skipped, unsupported trip types are not invented.
"""
import copy

def fields(raw):
 if not isinstance(raw,bytes) or len(raw)>1000000:raise ValueError('Realtime feed exceeds 1 MB.')
 out={};pos=0
 def varint():
  nonlocal pos
  value=0
  for shift in range(0,70,7):
   if pos>=len(raw):raise ValueError('Truncated realtime protobuf.')
   b=raw[pos];pos+=1;value|=(b&127)<<shift
   if b<128:
    if value>=1<<64:raise ValueError('Invalid protobuf integer.')
    return value
  raise ValueError('Invalid protobuf integer.')
 while pos<len(raw):
  tag=varint();number,wire=tag>>3,tag&7
  if not number:raise ValueError('Invalid protobuf field.')
  if wire==0:value=varint()
  elif wire in (1,2,5):
   size=varint() if wire==2 else 8 if wire==1 else 4
   if pos+size>len(raw):raise ValueError('Truncated realtime protobuf.')
   value=raw[pos:pos+size];pos+=size
  else:raise ValueError('Unsupported protobuf wire type.')
  out.setdefault(number,[]).append(value)
 return out

def one(obj,key,default=None):
 values=obj.get(key,[])
 if len(values)>1:raise ValueError('Duplicate scalar realtime field.')
 return values[0] if values else default

def string(obj,key,default=''):
 value=one(obj,key)
 if value is None:return default
 if not isinstance(value,bytes):raise ValueError('Invalid realtime string.')
 return value.decode('utf-8')

def integer(obj,key,default=None,signed=False):
 value=one(obj,key,default)
 if value is None:return None
 if type(value) is not int:raise ValueError('Invalid realtime number.')
 if signed:
  value &= 0xffffffff
  if value>=1<<31:value-=1<<32
 return value

def updates(raw,now):
 root=fields(raw);header=fields(one(root,1,b''));stamp=integer(header,3)
 if string(header,1) not in ('1.0','2.0') or integer(header,2,0)!=0:raise ValueError('Only full GTFS-RT 1.0/2.0 datasets are supported.')
 if stamp is None or not now-300000<=stamp*1000<=now+60000:raise ValueError('Realtime timestamp is missing, stale or ahead of simulation time.')
 result=[];seen=set();skipped=0
 for raw_entity in root.get(2,[]):
  entity=fields(raw_entity)
  if 3 not in entity:continue
  if integer(entity,2,0):raise ValueError('Deleted entities require differential feed semantics.')
  update=fields(one(entity,3));trip=fields(one(update,1,b''));ident=string(trip,1);date=string(trip,3);relation=integer(trip,4,0)
  observed=integer(update,4,stamp)*1000
  if not ident or len(date)!=8 or not date.isdigit() or relation not in (0,3) or observed<now-300000 or observed>now+60000:
   skipped+=1;continue
  if (ident,date) in seen:raise ValueError('Duplicate realtime trip/date.')
  seen.add((ident,date));stops={}
  for data in update.get(2,[]):
   stop=fields(data);seq=integer(stop,1)
   if seq is None:skipped+=1;continue
   if seq in stops:raise ValueError('Duplicate realtime stop sequence.')
   def event(key):
    if key not in stop:return None
    e=fields(one(stop,key));return {'time':integer(e,2),'delay':integer(e,1,signed=True)}
   stops[seq]={'relationship':integer(stop,5,0),'arrival':event(2),'departure':event(3)}
  result.append({'tripId':ident,'date':date,'cancelled':relation==3,'stops':stops,'delay':integer(update,5,signed=True),'observedAt':observed})
 return result,stamp*1000,skipped

def prediction(change,sequence,endpoint,baseline):
 if sequence is None:return None
 delay=change['delay']
 for seq,stop in sorted(change['stops'].items()):
  if seq>sequence:break
  if stop['relationship']==2:delay=None;continue
  if stop['relationship']!=0:continue
  for key in ('arrival','departure'):
   if seq==sequence and endpoint=='arrival' and key=='departure':break
   event=stop.get(key) or {}
   if seq==sequence and key==endpoint and event.get('time') is not None:return event['time']*1000
   if event.get('delay') is not None:delay=event['delay']
   elif event.get('time') is not None:delay=None # No static time for that intermediate stop: do not invent an offset.
 return baseline+delay*1000 if delay is not None else None

def ingest(c,source,raw,now,wall):
 changes,stamp,skipped=updates(raw,now);lookup={(u['tripId'],u['date']):u for u in changes};transport=c.setdefault('vh2Transport',{'services':[],'sequence':0})
 services=copy.deepcopy(transport['services']);count=0;j=c['lifeRuntime']['world'].get('journey');journey=copy.deepcopy(j)
 for service in services:
  if service.get('sourceId')!=source['scheduleSourceId']:continue
  base=service.setdefault('scheduledTimes',{'departure':service['departsAt'],'arrival':service['arrivesAt']})
  change=lookup.get((service.get('sourceTripId'),service.get('serviceDate')))
  prior=service.get('realtime',{})
  if prior.get('observedAt',0)>(change['observedAt'] if change else stamp):continue
  service.update(departsAt=base['departure'],arrivesAt=base['arrival'],status='scheduled')
  service['realtime']={'sourceId':source['id'],'observedAt':stamp,'status':'no_prediction','sourceUrl':source['url']}
  if not change:continue
  count+=1;dep=change['stops'].get(service.get('departureStopSequence'),{});arr=change['stops'].get(service.get('arrivalStopSequence'),{})
  cancelled=change['cancelled'] or dep.get('relationship')==1 or arr.get('relationship')==1
  predicted=False
  if cancelled:service['status']='cancelled'
  else:
   for endpoint,stop,key,field in [('departure',dep,'departure','departsAt'),('arrival',arr,'arrival','arrivesAt')]:
    if stop.get('relationship',0)!=0:continue
    value=prediction(change,service.get(endpoint+'StopSequence'),key,base[endpoint])
    if value is None:continue
    if abs(value-base[endpoint])>48*3600000:raise ValueError('Realtime change exceeds 48 hours.')
    service[field]=value
    predicted=True
   if service['arrivesAt']<=service['departsAt']:raise ValueError('Realtime arrival precedes departure.')
  service['realtime'].update(status='cancelled' if cancelled else 'prediction' if predicted else 'no_prediction',observedAt=change['observedAt'])
  if journey and journey.get('serviceId')==service['id']:
   # No teleport, refund, reboarding or retroactive departure during a trip.
   journey['serviceUpdate']=copy.deepcopy(service['realtime'])
   if not cancelled:
    journey['arrivesAt']=max(now,service['arrivesAt']);journey['targetStart']=journey['arrivesAt'];journey['targetEnd']=journey['arrivesAt']+1
 transport['services']=services
 if journey:c['lifeRuntime']['world']['journey']=journey
 source.update(lastAttemptAt=wall,lastSuccessAt=wall,error='',itemCount=count,warning=f'{skipped} unsupported or ambiguous entries skipped. Predictions require exact service date and stop sequence. Onboard cancellations retain the last known destination.')
 return count
