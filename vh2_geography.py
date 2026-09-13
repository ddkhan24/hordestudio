"""Local geographic affordances, explicitly sourced and persisted per life."""
import json,math,re,hashlib
COMMANDS=('configure_geographic_life','set_place_capabilities','import_world_pack')
CAPABILITIES={'food','rest','leisure','exercise','swimming'}
def infer(place):
 # Suggestions inferred from authored place names are not verified business data.
 label=str(place.get('label','')).lower();caps=[]
 if place.get('kind')=='home':caps=['food','rest','leisure','exercise']
 elif re.search(r'\b(caf[eé]|restaurant|food court|diner|coffee|mcdonald|chipotle|dutch bros)\b',label):caps=['food','leisure']
 elif re.search(r'\bpool\b',label):caps=['exercise','leisure','swimming']
 elif re.search(r'\b(gym|fitness|sports)\b',label):caps=['exercise','leisure']
 elif place.get('kind')=='social':caps=['leisure','rest']
 return {'capabilities':caps,'mealCost':None,'hours':None,'source':'authored-place inference','closed':False,'access':'unknown','entryCost':0}
def validate(meta):
 if not isinstance(meta,dict):raise ValueError('Place capabilities must be an object.')
 caps=meta.get('capabilities',[])
 if not isinstance(caps,list) or len(caps)>len(CAPABILITIES) or any(c not in CAPABILITIES for c in caps):raise ValueError('Unsupported place capability.')
 cost=meta.get('mealCost')
 if cost is not None and (type(cost) not in (int,float) or not math.isfinite(cost) or not 0<=cost<=10000):raise ValueError('Invalid meal cost.')
 access=meta.get('access','unknown');entry=meta.get('entryCost',0)
 if access not in ('public','permitted','unknown'):raise ValueError('Choose public, permitted or unknown place access.')
 if type(entry) not in (int,float) or not math.isfinite(entry) or not 0<=entry<=10000:raise ValueError('Invalid entry cost.')
 hours=meta.get('hours')
 if hours is not None:
  if not isinstance(hours,list) or len(hours)>30:raise ValueError('Invalid hours.')
  for h in hours:
   if not isinstance(h,dict) or not isinstance(h.get('days'),list) or any(type(d) is not int or not 0<=d<=6 for d in h['days']) or any(type(h.get(k)) is not int or not 0<=h[k]<=1440 for k in ('start','end')):raise ValueError('Invalid opening window.')
 return {'capabilities':list(dict.fromkeys(caps)),'mealCost':cost,'hours':hours,'closed':meta.get('closed') is True,'source':str(meta.get('source','authored'))[:300],'access':access,'entryCost':entry}
def command(service,db,world,revision,state,body):
 from vh2_runtime import encode,Conflict
 after=json.loads(encode(state));c=after['truth']['companion'];g=c.setdefault('vh2Geography',{'enabled':False,'places':{},'knownPlaceIds':[],'maxTravelMinutes':60,'unknownMealCost':10})
 g.setdefault('savedPlaceIds',[p['id'] for p in c['lifeProfile']['places'] if not p['id'].startswith('osm:')])
 kind=body['type'];places={p['id']:p for p in c['lifeProfile']['places']}
 if kind=='configure_geographic_life':
  if type(body.get('enabled')) is not bool:raise ValueError('Choose enabled or disabled.')
  for ident,p in places.items():g['places'].setdefault(ident,infer(p))
  g['knownPlaceIds']=list(dict.fromkeys(g['knownPlaceIds']+g['savedPlaceIds']))
  if 'maxTravelMinutes' in body:
   if type(body['maxTravelMinutes']) not in (int,float) or not math.isfinite(body['maxTravelMinutes']) or not 1<=body['maxTravelMinutes']<=240:raise ValueError('Maximum travel must be 1–240 minutes.')
   g['maxTravelMinutes']=body['maxTravelMinutes']
  g['enabled']=body['enabled'];c['lifeProfile']['world']['transport']['enabled']=True
  if c.get('vh2Exploration'):c['vh2Exploration']['policy']['enabled']=g['enabled']
  if not g['enabled']:
   for goal in c['lifeRuntime']['activities']['goals']:
    if goal['id'].startswith('geo:') and goal['status'] not in ('completed','abandoned'):goal['status']='abandoned';goal['reason']='Geographic life disabled.'
 elif kind=='set_place_capabilities':
  ident=body.get('placeId')
  if ident not in places:raise ValueError('Choose an existing place.')
  g['places'][ident]=validate(body.get('capabilities'));g['nextReview']=0
 else:
  pack=__import__('vh2_world_packs').get(db,body['packId']) if body.get('packId') else body.get('pack')
  if not isinstance(pack,dict) or pack.get('version')!=1 or not isinstance(pack.get('places'),list) or not 1<=len(pack['places'])<=500 or not isinstance(pack.get('routes'),list) or len(pack['routes'])>5000:raise ValueError('Choose a version 1 world pack with up to 500 places and 5,000 routes.')
  if not isinstance(pack.get('license'),str) or not pack['license'] or not isinstance(pack.get('source'),str) or not pack['source']:raise ValueError('World packs require source and licence attribution.')
  installed=next((p for p in g.get('packs',[]) if p['source']==pack['source'] and p.get('packId')==pack.get('id',pack.get('bbox'))),None)
  replacement=body.get('replacePackId');previous_pack=None
  if replacement is not None:
   if not isinstance(replacement,str) or not replacement:raise ValueError('Choose the immutable installed region to replace.')
   previous_pack=__import__('vh2_world_packs').get(db,replacement)
   previous_receipt=next((p for p in g.get('packs',[]) if p['source']==previous_pack['source'] and p.get('packId')==previous_pack.get('id',previous_pack.get('bbox'))),None)
   if not previous_receipt:raise ValueError('The region being replaced is not installed in this life.')
   if installed and installed is not previous_receipt:raise ValueError('The replacement region is already installed separately.')
   previous_hash=hashlib.sha256(json.dumps(previous_pack,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
   if previous_receipt.get('contentHash') not in (None,previous_hash):raise ValueError('The previous region does not match its immutable installation receipt.')
   installed=previous_receipt
  refresh=body.get('refresh',False)
  if type(refresh) is not bool:raise ValueError('Choose whether to refresh this installed map pack.')
  if replacement is not None and refresh:raise ValueError('Choose either region replacement or a same-content binding refresh.')
  if installed and not refresh and previous_pack is None:raise ValueError('This world pack is already installed for this life. Use refresh to update its saved-place bindings.')
  if refresh and not installed:raise ValueError('Install this world pack before refreshing its bindings.')
  content_hash=hashlib.sha256(json.dumps(pack,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
  if installed and previous_pack is None and installed.get('contentHash') not in (None,content_hash):raise ValueError('Refresh requires the same immutable map pack content.')
  new=[];ids=set(places);mapped={};seen=set();coordinate_fills=[]
  def name(value):return ' '.join(re.findall(r'\w+',value.casefold()))
  supplied=body.get('bindings',{})
  if not isinstance(supplied,dict):raise ValueError('Link map places to distinct existing saved places.')
  mapped={**(installed.get('bindings',{}) if installed else {})}
  for key,value in supplied.items():
   for previous in [k for k,v in mapped.items() if v==value and k!=key and k not in supplied]:del mapped[previous]
  mapped.update(supplied)
  if any(k not in {p.get('id') for p in pack['places']} or v not in places for k,v in mapped.items()) or len(set(mapped.values()))!=len(mapped):raise ValueError('Link map places to distinct existing saved places.')
  for p in pack['places']:
   ident=p.get('id');xy=p.get('mapCoordinates');label=p.get('label')
   if not isinstance(ident,str) or not 1<=len(ident)<=80 or ident in seen or ident in ids and ident not in mapped and not refresh and previous_pack is None or not isinstance(label,str) or not 1<=len(label)<=160:raise ValueError('Place IDs must be unique and labels nonempty; existing places are never overwritten.')
   if not isinstance(xy,list) or len(xy)!=2 or any(type(v) not in (int,float) or not math.isfinite(v) for v in xy) or abs(xy[0])>180 or abs(xy[1])>90:raise ValueError('Every imported place needs valid longitude and latitude.')
   seen.add(ident);canonical=mapped.get(ident,ident);ids.add(canonical)
   if canonical in places:
    previous=places[canonical].get('mapCoordinates')
    if previous:
     lon1,lat1,lon2,lat2=map(math.radians,(*previous,*xy));h=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
     if 6371000*2*math.asin(min(1,math.sqrt(h)))>150:raise ValueError('The linked map point is more than 150 metres from '+places[canonical]['label']+'. Correct its saved coordinates or choose the matching map point before importing routes.')
    else:coordinate_fills.append({**places[canonical],'mapCoordinates':xy})
   else:new.append({'id':canonical,'label':label,'kind':'other','mapCoordinates':xy})
   if canonical!=ident and canonical in places:g['places'].setdefault(canonical,infer(places[canonical]))
   elif canonical not in g['places'] or g['places'][canonical].get('source') in {pack['source'],previous_pack['source'] if previous_pack else pack['source']}:g['places'][canonical]=validate({**p.get('capabilities',{}),'source':pack['source']})
  if coordinate_fills:
   from vh2_lifestyle import invalidate_changed_place_routes
   invalidate_changed_place_routes(c,coordinate_fills,after['simAt'],after)
   for row in coordinate_fills:places[row['id']]['mapCoordinates']=row['mapCoordinates']
  routes=[]
  for raw in pack['routes']:
   l={**raw,'from':mapped.get(raw.get('from'),raw.get('from')),'to':mapped.get(raw.get('to'),raw.get('to'))}
   if l.get('from') not in ids or l.get('to') not in ids or l.get('mode')!='WALK' or type(l.get('minutes')) not in (int,float) or not math.isfinite(l['minutes']) or not 0<l['minutes']<=720:raise ValueError('Pack walking routes must connect known places with positive travel times.')
   geometry=l.get('geometry')
   if geometry is not None and (not isinstance(geometry,list) or not 2<=len(geometry)<=10000 or any(not isinstance(x,list) or len(x)!=2 or any(type(v) not in (int,float) or not math.isfinite(v) for v in x) or abs(x[0])>180 or abs(x[1])>90 for x in geometry)):raise ValueError('Invalid route geometry.')
   routes.append({'geometry':geometry,'from':l['from'],'to':l['to'],'mode':'WALK','minutes':l['minutes'],'cost':0,'source':pack['source']})
  existing=c['lifeProfile']['travelLegs'];removed=[];cleared=[]
  def shape(leg):return json.dumps([[float(x),float(y)] for x,y in leg['geometry']],separators=(',',':')) if leg.get('geometry') else None
  def route_key(leg):return (leg.get('from'),leg.get('to'),leg.get('mode'),leg.get('source'),math.floor(float(leg.get('minutes',0))+.5),float(leg.get('cost',0)),shape(leg))
  if refresh or previous_pack is not None:
   # Legacy receipts lack bindings. Exact immutable geometry is stronger
   # ownership evidence than the shared provider/source label alone.
   ownership_pack=previous_pack or pack
   shapes={shape(l) for l in ownership_pack['routes'] if shape(l)};known_keys={route_key(l) for l in routes} if previous_pack is None else set()
   old_bindings=installed.get('bindings',{})
   evidence=set()
   for raw in ownership_pack['routes']:
    old={**raw,'from':old_bindings.get(raw['from'],raw['from']),'to':old_bindings.get(raw['to'],raw['to']),'source':ownership_pack['source'],'cost':0}
    known_keys.add(route_key(old))
    evidence.add((route_key(old)[4],route_key(old)[5],shape(old)))
   owned=lambda l:l.get('source')==ownership_pack['source'] and l.get('mode')=='WALK' and ((route_key(l)[4],route_key(l)[5],shape(l)) in evidence if previous_pack is not None and shape(l) else shape(l) in shapes if shape(l) else route_key(l) in known_keys)
   removed=[l for l in existing if owned(l)];existing=[l for l in existing if not owned(l)]
   new_keys={route_key(l) for l in routes};changed_pairs={(l['from'],l['to'],l['mode']) for l in removed if route_key(l) not in new_keys}
   for journey in [c['lifeRuntime']['world'].get('journey')]+[a.get('journey') for a in c.get('vh2People',{}).get('actors',{}).values()]:
    if previous_pack is None and journey and (journey.get('from'),journey.get('to'),journey.get('mode')) in changed_pairs:raise Conflict('Wait for the current map route to finish before changing its binding.')
   from vh2_lifestyle import clear_future_route_caches
   cleared=clear_future_route_caches(c,lambda l:(l.get('from'),l.get('to'),l.get('mode')) in changed_pairs and l.get('source')==ownership_pack['source'])
  if len(places)+len(new)>550 or len(existing)+len(routes)>5100:raise ValueError('This life exceeds the local pack capacity.')
  c['lifeProfile']['places']+=new;c['lifeProfile']['travelLegs']=existing+routes
  metadata={'packId':pack.get('id',pack.get('bbox')),'source':pack['source'],'license':pack['license'],'bindings':mapped,'contentHash':content_hash}
  if previous_pack is not None:metadata['replacedFrom']={'packId':installed.get('packId'),'source':installed['source'],'contentHash':previous_hash,'libraryId':replacement}
  if installed:installed.update(metadata,refreshedAt=after['simAt'])
  else:g.setdefault('packs',[]).append({**metadata,'placeCount':len(new),'importedAt':after['simAt']})
  g['lastPackRefresh']={'at':after['simAt'],'contentHash':content_hash,'refresh':refresh,'replacement':previous_pack is not None,'removedRouteCount':len(removed),'installedRouteCount':len(routes),'clearedFutureRouteIds':cleared,'bindings':mapped}
  # World data is not automatically personal knowledge. Nearby discoveries occur in the engine.
  g['nextReview']=0
 revision=service.commit_event(db,world,revision,state,after,'GEOGRAPHIC_LIFE_CHANGED',{'operation':kind})
 return revision,after
