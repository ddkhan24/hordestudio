"""Service-owned gifts, with explicit denominations and no real payments."""
import base64,json,uuid
COMMANDS=('configure_gifts','add_gift_item','add_owned_item','update_owned_item','archive_owned_item','use_possession','offer_gift')
def command(service,db,world_id,revision,state,body):
 from vh2_runtime import encode,Conflict
 after=json.loads(encode(state));c=after['truth']['companion'];p=c['lifeProfile']['world']['gifts'];r=c['lifeRuntime']['world'];kind=body['type']
 meta=c.setdefault('vh2Gifts',{'currency':'USD'})
 if kind=='configure_gifts':
  currency=body.get('currency');policy=body.get('policy');keys={'enabled','mailAllowed','cashAllowed','minTrust','maxValue','deliveryHours','playerBudget'}
  if not isinstance(currency,str) or len(currency)!=3 or not all('A'<=x<='Z' for x in currency):raise ValueError('Use a three-letter uppercase currency label.')
  if currency!=meta['currency'] and (r['gifts'] or c.get('vh2Finance',{}).get('ledger') or c.get('vh2Finance',{}).get('unpaid',0) or c.get('vh2Travel',{}).get('trips')):raise Conflict('Cannot relabel the currency after financial or trip activity. No currency conversion is performed.')
  if not isinstance(policy,dict) or set(policy)!=keys or any(type(policy[k]) is not bool for k in ('enabled','mailAllowed','cashAllowed')):raise ValueError('Provide complete gift preferences.')
  for k,low,high in [('minTrust',-100,100),('maxValue',0,1000000),('deliveryHours',0,720),('playerBudget',0,10000000)]:
   if type(policy[k]) not in (int,float) or not low<=policy[k]<=high:raise ValueError('Invalid gift preference.')
  if r['playerBalance'] is not None and policy['playerBudget']!=p['playerBudget']:raise Conflict('Starting funds cannot reset an existing gift wallet.')
  p.update(policy);meta['currency']=currency
 elif kind=='use_possession':
  if after['truth'].get('present',{}).get('availability')=='asleep':raise ValueError('Wait until awake to use possessions.')
  use_possession(c,body,after['simAt'],after['truth'].get('present',{}).get('placeId'))
 elif kind=='archive_owned_item':
  item=next((i for i in c['lifeProfile']['world']['items'] if i['id']==body.get('itemId') and (i['owned'] or i['id'] in r['inventory'])),None)
  if not item:raise ValueError('Choose an owned item.')
  item['archived']=True
 elif kind in ('add_gift_item','add_owned_item','update_owned_item'):
  items=c['lifeProfile']['world']['items'];name=body.get('name');category=body.get('category');tags=body.get('tags',[]);photo=body.get('photo','')
  existing=next((i for i in items if i['id']==body.get('itemId')),None) if kind=='update_owned_item' else None
  if kind=='update_owned_item' and (not existing or not (existing['owned'] or existing['id'] in r['inventory'])):raise ValueError('Choose an owned item to edit.')
  if len(items)>=150 and not existing:raise Conflict('The current item catalogue supports 150 items.')
  if not isinstance(name,str) or not 1<=len(name.strip())<=200 or category not in ('top','bottom','dress','outerwear','underwear','shoes','accessory','food','ticket','vehicle','object'):raise ValueError('Provide an item name and supported item category.')
  if not isinstance(tags,list) or len(tags)>20 or any(not isinstance(t,str) or not 1<=len(t)<=40 for t in tags):raise ValueError('Use at most 20 short item tags.')
  if not isinstance(photo,str) or len(photo)>1400000:raise ValueError('Gift reference is too large.')
  if photo:
   header,sep,data=photo.partition(',')
   if header not in ('data:image/png;base64','data:image/jpeg;base64','data:image/webp;base64') or not sep:raise ValueError('Upload a PNG, JPEG or WebP reference.')
   try:raw=base64.b64decode(data,validate=True)
   except Exception:raise ValueError('Invalid image encoding.')
   if not (raw.startswith(b'\x89PNG\r\n\x1a\n') or raw.startswith(b'\xff\xd8\xff') or raw[:4]==b'RIFF' and raw[8:12]==b'WEBP'):raise ValueError('The reference does not contain a supported image.')
  value={'id':'gift-item:'+str(uuid.uuid5(uuid.NAMESPACE_URL,world_id+':'+body['key'])),'name':name.strip(),'category':category,'tags':list(dict.fromkeys(t.lower() for t in tags)),'warmth':1,'photo':photo,'owned':kind=='add_owned_item','incompatible':[],'possession':validate_possession(category,body.get('possession',{}),c,after['simAt'])}
  if existing:
   for field in ('name','category','tags','photo'):existing[field]=value[field]
  else:items.append(value)
 else:
  value=body.get('value');gift_kind=body.get('kind')
  if gift_kind not in ('cash','item') or type(value) not in (int,float) or not 0<=value<=1000000 or gift_kind=='cash' and value<=0:raise ValueError('Offer an item or a positive simulated cash amount.')
  if body.get('currency')!=meta['currency']:raise ValueError('Use this timeline’s configured currency; automatic conversion is not available.')
  if abs(value*100-round(value*100))>0.00001 or gift_kind=='cash' and round(value*100)<1:raise ValueError('Use at most two decimal places and at least 0.01 for simulated cash.')
  value=round(value*100)/100
  if not p['enabled']:raise ValueError('This person is not accepting gift offers.')
  frame=c['lifeProfile']['world']['frame']
  if frame['mode'] not in ('direct','public_social') and r['connection']['state']!='accepted':raise ValueError('Connect before offering gifts.')
  consent=r.get('cashConsent' if gift_kind=='cash' else 'mailConsent')
  if consent is None:consent=p['cashAllowed' if gift_kind=='cash' else 'mailAllowed']
  if not consent:raise ValueError('Permission for this gift type has not been established.')
  trust=c.get('relationshipDynamics',{}).get('trust',c.get('mood',{}).get('relationship',0))
  if trust<p['minTrust']:raise ValueError('The relationship requirement has not been met.')
  funds=r['playerBalance'] if r['playerBalance'] is not None else p['playerBudget']
  if value>funds:raise ValueError('Not enough simulated sender funds.')
  if gift_kind=='item':
   item=next((i for i in c['lifeProfile']['world']['items'] if i['id']==body.get('itemId')),None)
   if not item:raise ValueError('Choose a gift item first.')
   if item['owned'] or item['id'] in r['inventory'] or any(g['itemId']==item['id'] and g['status']!='declined' for g in r['gifts']):raise ValueError('This item is already owned or on its way.')
  if len(r['gifts'])>=100 and not any(g['status'] in ('received','declined') for g in r['gifts']):raise Conflict('Resolve pending gifts before offering another.')
  request={'id':'gift:'+str(uuid.uuid5(uuid.NAMESPACE_URL,world_id+':'+body['key'])),'kind':gift_kind,'itemId':body.get('itemId',''),'value':value,'currency':meta['currency']}
  after['truth']=service.kernel({'companion':c,'now':state['simAt'],'inspect':True,'giftCommand':request})
 revision=service.commit_event(db,world_id,revision,state,after,'GIFT_ACTION',{'operation':kind})
 return revision,after


def validate_possession(category,raw,c,now):
 if not isinstance(raw,dict):raise ValueError('Provide item details.')
 allowed={'food':{'servings','hungerRelief','expiresAt','dietaryTags'},'ticket':{'placeId','eventName','startsAt','endsAt'},'vehicle':{'vehicleType','placeId','canOperate'},'object':set()}.get(category,set())
 if set(raw)-allowed:raise ValueError('Unsupported item details.')
 out={'kind':category,'usedAt':None}
 if category=='food':
  servings=raw.get('servings',1);relief=raw.get('hungerRelief',25);expires=raw.get('expiresAt',now+86400000);tags=raw.get('dietaryTags',[])
  if type(servings) is not int or not 1<=servings<=50 or type(relief) not in (int,float) or not 1<=relief<=100 or type(expires) not in (int,float) or expires<=now:raise ValueError('Food needs positive servings, hunger relief and a future expiry.')
  if not isinstance(tags,list) or any(not isinstance(t,str) or len(t)>60 for t in tags) or len(tags)>20:raise ValueError('Invalid dietary tags.')
  out.update(servings=servings,hungerRelief=relief,expiresAt=expires,dietaryTags=tags)
 if category in ('ticket','vehicle'):
  place=raw.get('placeId');places={p['id'] for p in c['lifeProfile']['places']}
  if place not in places:raise ValueError('Choose the event or vehicle location.')
  out['placeId']=place
 if category=='ticket':
  start=raw.get('startsAt');end=raw.get('endsAt');name=raw.get('eventName','')
  if type(start) not in (int,float) or type(end) not in (int,float) or not now<end or not start<end or not isinstance(name,str) or not 1<=len(name)<=160:raise ValueError('Provide the event name and valid start/end times.')
  out.update(eventName=name,startsAt=start,endsAt=end)
 if category=='vehicle':
  mode=raw.get('vehicleType','car');ability=raw.get('canOperate',False)
  if mode not in ('car','bicycle') or type(ability) is not bool:raise ValueError('Choose a car or bicycle and establish ability to operate it.')
  out.update(vehicleType=mode,canOperate=ability)
 return out

def use_possession(c,body,now,present_place=None):
 items=c['lifeProfile']['world']['items'];w=c['lifeRuntime']['world'];item=next((i for i in items if i['id']==body.get('itemId')),None)
 if not item or not (item['owned'] or item['id'] in w['inventory']):raise ValueError('This item has not been received or is not owned.')
 p=item.get('possession',{});kind=item['category']
 if w.get('journey'):raise ValueError('Wait until the current journey ends.')
 if kind=='food':
  if p.get('expiresAt',0)<=now or p.get('servings',0)<=0:raise ValueError('This food has expired or has been consumed.')
  if c.get('humanDynamics',{}).get('sleepStage') in ('asleep','deep','rem'):raise ValueError('Wait until awake to eat.')
  p['servings']-=1;c['humanDynamics']['hunger']=max(0,c['humanDynamics']['hunger']-p['hungerRelief']);p['usedAt']=now
 elif kind=='ticket':
  if p.get('usedAt') is not None or not p['startsAt']<=now<=p['endsAt'] or (w.get('placeId') or present_place)!=p['placeId']:raise ValueError('Use an unused ticket at its venue during the event.')
  p['usedAt']=now
 elif kind=='vehicle':
  if p.get('usedAt') is not None:raise ValueError('This vehicle has already been collected.')
  if (w.get('placeId') or present_place)!=p['placeId'] or not p.get('canOperate'):raise ValueError('Collect the vehicle at its location with ability to operate it established.')
  c['lifeProfile']['world']['transport'][p['vehicleType']]=True;p['usedAt']=now
 else:raise ValueError('This item is kept in possessions; wearable items are selected through the wardrobe.')
 events=w.setdefault('events',[]);events.append({'id':'item-use:'+str(uuid.uuid4()),'type':'possession','at':now,'summary':('Ate a serving of ' if kind=='food' else 'Used ')+item['name']});w['events']=events[-120:]
