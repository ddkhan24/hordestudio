"""Scheduled transport records; no real ticket purchase or booking integration."""
import json,uuid
COMMANDS=('save_transport_service','cancel_transport_service','retry_trip','configure_travel_recovery')
def command(service,db,world,revision,state,body):
 from vh2_runtime import encode,Conflict
 after=json.loads(encode(state));c=after['truth']['companion'];r=c.setdefault('vh2Transport',{'services':[],'sequence':0});kind=body['type'];now=after['simAt']
 if kind=='configure_travel_recovery':
  policy=body.get('policy');limits={'reconsiderMinutes':(1,120),'maxAttempts':(1,100),'maxSpend':(0,100000),'maxWaitMinutes':(0,1440)}
  if not isinstance(policy,dict) or set(policy)!={'enabled',*limits} or type(policy.get('enabled')) is not bool:raise ValueError('Provide complete travel recovery settings.')
  for key,(low,high) in limits.items():
   if type(policy[key]) not in (int,float) or not low<=policy[key]<=high or key!='maxSpend' and type(policy[key]) is not int:raise ValueError('Invalid travel recovery setting: '+key)
  c['vh2Travel']['recoveryPolicy']=policy
 elif kind=='retry_trip':
  tr=c.get('vh2Travel',{});trip=next((t for t in tr.get('trips',[]) if t['id']==tr.get('activeId')),None)
  if not trip or trip['status']!='blocked' or c['lifeRuntime']['world'].get('journey'):raise Conflict('Only a blocked trip at an actual place can be reconsidered.')
  index=trip.get('recoveryTargetIndex',trip['stopIndex'])
  remaining=[{**stop,'stayCost':0 if i in trip.get('paidStays',[]) else stop.get('stayCost',0)} for i,stop in enumerate(trip['stops']) if i>=index]
  checked=service.kernel({'companion':c,'now':now,'inspect':True,'tripStops':remaining})
  if checked.get('tripRoutes') is None:raise ValueError('There is still no affordable route onward.')
  # A request wakes the resolver once attention permits; history and paid stops remain intact.
  trip['recoveryRequested']=True
 elif kind=='cancel_transport_service':
  row=next((s for s in r['services'] if s['id']==body.get('serviceId')),None)
  if not row:raise ValueError('Unknown scheduled service.')
  row['status']='cancelled';row['updatedAt']=now
 else:
  data=body.get('service')
  keys={'id','label','kind','from','to','departsAt','arrivesAt','boardingMinutes','cost','source'}
  if not isinstance(data,dict) or set(data)-keys:raise ValueError('Provide a scheduled service record.')
  places={p['id'] for p in c['lifeProfile']['places']};origin=data.get('from');dest=data.get('to');label=data.get('label');source=data.get('source','user-authored');ident=data.get('id') or str(uuid.uuid4())
  if not isinstance(ident,str) or not 1<=len(ident)<=100 or not isinstance(label,str) or not 1<=len(label)<=160 or not isinstance(source,str) or not 1<=len(source)<=300:raise ValueError('Use a short service name, ID and provenance.')
  if not isinstance(origin,str) or not isinstance(dest,str) or origin not in places or dest not in places or origin==dest or data.get('kind') not in ('flight','train','bus','ferry'):raise ValueError('Choose different existing terminal places and a transport type.')
  dep=data.get('departsAt');arr=data.get('arrivesAt');board=data.get('boardingMinutes',15);cost=data.get('cost',0)
  if type(dep) is not int or type(arr) is not int or dep%60000 or arr%60000 or not now<=dep<=now+180*86400000 or not dep<arr<=dep+72*3600000:raise ValueError('Use whole-minute UTC departures within 180 days and a duration up to 72 hours.')
  if type(board) is not int or not 0<=board<=240 or type(cost) not in (int,float) or not 0<=cost<=100000:raise ValueError('Invalid boarding buffer or simulated fare.')
  active=c['lifeRuntime']['world'].get('journey')
  if active and active.get('serviceId')==ident:raise Conflict('An already departed service cannot be rewritten.')
  if len(r['services'])>=500 and not any(s['id']==ident for s in r['services']):r['services']=[s for s in r['services'] if s['arrivesAt']>=now]
  if len(r['services'])>=500 and not any(s['id']==ident for s in r['services']):raise ValueError('At most 500 scheduled departures.')
  r['services']=[s for s in r['services'] if s['id']!=ident]+[{'id':ident,'label':label,'kind':data['kind'],'from':origin,'to':dest,'departsAt':dep,'arrivesAt':arr,'boardingMinutes':board,'cost':round(cost,2),'source':source,'status':'scheduled','updatedAt':now}]
 revision=service.commit_event(db,world,revision,state,after,'TRANSPORT_SERVICE_CHANGED',{'operation':kind})
 return revision,after
