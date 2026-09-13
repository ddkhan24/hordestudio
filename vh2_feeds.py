"""Bounded public RSS/Atom ingestion; source claims never imply attendance."""
import uuid,concurrent.futures,datetime,email.utils,hashlib,http.client,ipaddress,json,socket,ssl,urllib.parse,xml.etree.ElementTree as ET
class LiveClockError(ValueError):pass
def require_live_clock(sim,wall):
 if abs(wall-sim)>300000:
  direction='behind' if sim<wall else 'ahead of'
  raise LiveClockError(f'Live events are waiting: this life is {round(abs(wall-sim)/60000)} minutes {direction} real time. Use Catch up to current time in Life Overview.' if sim<wall else 'This life is ahead of real time. Live feeds resume when real time catches up; history cannot be rewound.')

COMMANDS=('configure_world_feed','remove_world_feed','import_world_feed','refresh_world_feed')
def url_parts(url):
 if not isinstance(url,str) or len(url)>2048:raise ValueError('Use a public HTTPS feed URL.')
 p=urllib.parse.urlsplit(url)
 if p.scheme!='https' or not p.hostname or p.username or p.password or p.port not in (None,443) or p.fragment:raise ValueError('Use a public HTTPS feed URL without credentials.')
 return p
class PublicConnection(http.client.HTTPSConnection):
 def connect(self):
  addresses=socket.getaddrinfo(self.host,443,type=socket.SOCK_STREAM)
  if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):raise ValueError('Feed hosts must resolve only to public addresses.')
  raw=socket.create_connection((addresses[0][4][0],443),timeout=self.timeout)
  try:self.sock=ssl.create_default_context().wrap_socket(raw,server_hostname=self.host)
  except Exception:raw.close();raise

def fetch(url,limit=1000000):
 p=url_parts(url);conn=PublicConnection(p.hostname,timeout=8)
 try:
  conn.request('GET',urllib.parse.urlunsplit(('', '',p.path or '/',p.query,'')),headers={'User-Agent':'Horde-VH2/1.0','Accept':'application/rss+xml, application/atom+xml, application/xml, text/calendar, application/json, application/zip, application/x-protobuf, application/octet-stream','Accept-Encoding':'identity'})
  response=conn.getresponse()
  if response.status!=200:raise ValueError('Feed returned HTTP '+str(response.status)+'. Redirects are not followed; use the final feed URL.')
  raw=response.read(limit+1)
  if len(raw)>limit:raise ValueError('Feed exceeds its size limit.')
  return raw
 finally:conn.close()

def parse(raw,source,now):
 if isinstance(raw,str):raw=raw.encode()
 if not isinstance(raw,bytes) or len(raw)>1000000 or b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():raise ValueError('Unsupported or oversized feed XML.')
 try:
  decoded=raw.decode('utf-8-sig')
 except UnicodeDecodeError:raise ValueError('Feed must use UTF-8 XML.')
 if '\x00' in decoded or '<!DOCTYPE' in decoded.upper() or '<!ENTITY' in decoded.upper():raise ValueError('Feed declarations are not supported.')
 if decoded.lstrip().startswith('BEGIN:VCALENDAR'):
  return __import__('vh2_calendar').parse(decoded.strip(),source,now)
 source['warning']=''
 try:root=ET.fromstring(raw)
 except ET.ParseError:raise ValueError('The source is not valid RSS/Atom XML.')
 local=lambda e:e.tag.rsplit('}',1)[-1]
 if local(root) not in ('rss','feed','RDF'):raise ValueError('Expected RSS or Atom.')
 rows=[]
 for item in [e for e in root.iter() if local(e) in ('item','entry')][:100]:
  fields={local(e):''.join(e.itertext()).strip() for e in item}
  title=fields.get('title','')[:300]
  if not title:continue
  ident=fields.get('guid') or fields.get('id') or fields.get('link') or title
  date=fields.get('pubDate') or fields.get('published') or fields.get('updated');published=None
  if date:
   try:
    try:dt=email.utils.parsedate_to_datetime(date)
    except (ValueError,TypeError):dt=datetime.datetime.fromisoformat(date.replace('Z','+00:00'))
    if dt.tzinfo is not None:published=int(dt.timestamp()*1000)
   except (ValueError,TypeError,OverflowError):pass
  # Publication time is not an event start time. No location inference from text.
  if published is not None and (published>now+300000 or published<now-source['freshHours']*3600000):continue
  rows.append(dict(id=hashlib.sha256((source['id']+'|'+ident).encode()).hexdigest(),sourceId=source['id'],title=title,publishedAt=published,receivedAt=now,expiresAt=min(now,published if published is not None else now)+source['freshHours']*3600000,placeId=source.get('placeId'),sourceUrl=source['url'],scope='publisher_claim',confidence='unverified',type='news',tags=source.get('tags',[])))
 return rows

def ensure(c):return c.setdefault('vh2Signals',dict(sources=[],signals=[],known=[],events=[],decisions=[]))
def ingest(c,source,raw,now,wall):
 if source.get('kind')=='gtfs_rt':return __import__('vh2_realtime').ingest(c,source,raw,now,wall)
 if source.get('kind') in ('gtfs','flights_json','aviationstack'):
  incoming=__import__('vh2_flights').parse(raw,source,now) if source.get('kind')=='aviationstack' else __import__('vh2_live_data').flights(raw,source,now) if source.get('kind')=='flights_json' else __import__('vh2_gtfs').parse(raw,source,now);transport=c.setdefault('vh2Transport',{'services':[],'sequence':0});active=c['lifeRuntime']['world'].get('journey') or {}
  old={s['id']:s for s in transport['services']}
  for s in incoming:
   prior=old.get(s['id'],{});base={'departure':s['departsAt'],'arrival':s['arrivesAt']}
   if prior.get('scheduledTimes')==base and prior.get('realtime',{}).get('observedAt',0)>=now-300000:
    s.update(scheduledTimes=base,realtime=prior['realtime'],departsAt=prior['departsAt'],arrivesAt=prior['arrivesAt'],status=prior['status'])
  kept=[s for s in transport['services'] if s.get('sourceId')!=source['id'] or s['id']==active.get('serviceId')]
  ids={s['id'] for s in kept};updated=kept+[s for s in incoming if s['id'] not in ids]
  updated=[s for s in updated if s['arrivesAt']>=now or s['id']==active.get('serviceId')]
  if len(updated)>500:raise ValueError('Combined timetable exceeds 500 services. Narrow stop mappings or remove a feed.')
  transport['services']=updated
  source.update(lastSuccessAt=wall,lastAttemptAt=wall,error='',errorCode='',itemCount=len(incoming));return len(incoming)
 r=ensure(c);incoming=__import__('vh2_ticketmaster').parse(raw,source,now) if source.get('kind')=='ticketmaster' else __import__('vh2_live_data').sports(raw,source,now) if source.get('kind')=='openliga' else parse(raw,source,now);old={s['id']:s for s in r['signals'] if s['expiresAt']>now}
 if source.get('kind')=='ticketmaster':
  latest={s['id']:s for s in incoming}
  for known in r.get('known',[]):
   current=latest.get(known['id'])
   if current and current['versionKey']==known.get('versionKey'):known.update(expiresAt=current['expiresAt'],receivedAt=current['receivedAt'])
  # Replace this search snapshot; absence is not a cancellation or proof of availability.
  old={k:v for k,v in old.items() if v['sourceId']!=source['id']}
 for signal in incoming:
  if signal['id'] not in old or signal['type'] in ('calendar_event','sports_update'):old[signal['id']]=signal
 r['signals']=list(old.values())[-500:];source.update(lastSuccessAt=wall,lastAttemptAt=wall,error='',errorCode='',itemCount=len(incoming))
 return len(incoming)
def command(service,db,world_id,revision,state,body):
 from vh2_runtime import encode
 after=json.loads(encode(state));c=after['truth']['companion'];r=ensure(c);kind=body['type'];ident=body.get('sourceId');source=next((s for s in r['sources'] if s['id']==ident),None)
 if kind=='configure_world_feed':
  url=__import__('vh2_ticketmaster').URL if body.get('kind')=='ticketmaster' else __import__('vh2_flights').URL if body.get('kind')=='aviationstack' else body.get('url');url_parts(url);place=body.get('placeId') or None;hours=body.get('freshHours',48);interval=body.get('intervalMinutes',60);tags=body.get('tags',[])
  if place is not None and not isinstance(place,str):raise ValueError('Select an existing place scope.')
  if place and place not in {p['id'] for p in c['lifeProfile']['places']}:raise ValueError('Select an existing place scope.')
  event_filters=__import__('vh2_ticketmaster').filters(body,{p['id'] for p in c['lifeProfile']['places']}) if body.get('kind')=='ticketmaster' else None
  if event_filters and place:raise ValueError('A city search cannot be assigned to one place. Link individual venues instead.')
  minimum=1 if body.get('kind')=='gtfs_rt' else 15
  if type(hours) is not int or not 1<=hours<=168 or type(interval) is not int or not minimum<=interval<=1440:raise ValueError(f'Refresh must be {minimum}–1440 minutes and freshness 1–168 hours.')
  if not isinstance(tags,list) or len(tags)>12 or any(not isinstance(t,str) or len(t)>40 for t in tags):raise ValueError('Use up to twelve short interest tags.')
  if source is None:
   if len(r['sources'])>=8:raise ValueError('At most eight feeds per character.')
   ident=hashlib.sha256((url+'|'+str(place)+(json.dumps({k:v for k,v in event_filters.items() if k!='venueMappings'},sort_keys=True) if event_filters else '')+('|' + str(body.get('departureIata'))+'|'+str(body.get('arrivalIata')) if body.get('kind')=='aviationstack' else '')).encode()).hexdigest()[:24];source=next((s for s in r['sources'] if s['id']==ident),None)
   if source is None:source={'id':ident};r['sources'].append(source)
  venue=body.get('calendarVenueConfirmed',False)
  if type(venue) is not bool or venue and not place:raise ValueError('A confirmed calendar venue needs an existing place.')
  zone=body.get('timeZone') or None
  if zone is not None:
   from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
   if not isinstance(zone,str):raise ValueError('Use an IANA feed timezone.')
   try:ZoneInfo(zone)
   except (ZoneInfoNotFoundError,ValueError):raise ValueError('Use an IANA feed timezone.')
  feed_kind=body.get('kind','rss')
  if feed_kind not in ('rss','gtfs','gtfs_rt','flights_json','openliga','aviationstack','ticketmaster'):raise ValueError('Unsupported feed type.')
  purpose=body.get('purpose',source.get('purpose') if source.get('kind')==feed_kind else None)
  if purpose is not None:
   if purpose not in {'ticketmaster':('events',),'rss':('news','events'),'gtfs':('transport',),'gtfs_rt':('realtime',),'aviationstack':('flights',),'flights_json':('transport','flights'),'openliga':('sports',)}[feed_kind]:raise ValueError('Choose a purpose supported by this feed format.')
   source['purpose']=purpose
  else:source.pop('purpose',None)
  schedule=body.get('scheduleSourceId')
  if feed_kind=='gtfs_rt':
   if not any(s['id']==schedule and s.get('kind')=='gtfs' for s in r['sources']):raise ValueError('Link realtime updates to an existing GTFS schedule feed.')
   if any(s['id']!=source['id'] and s.get('kind')=='gtfs_rt' and s.get('scheduleSourceId')==schedule for s in r['sources']):raise ValueError('Only one realtime feed may update a schedule source.')
  source['scheduleSourceId']=schedule if feed_kind=='gtfs_rt' else None
  mappings=body.get('stopMappings',{});fare=body.get('fare',0)
  places={p['id'] for p in c['lifeProfile']['places']}
  if not isinstance(mappings,dict) or len(mappings)>20 or any(not isinstance(k,str) or not 1<=len(k)<=100 or not isinstance(v,str) or v not in places for k,v in mappings.items()):raise ValueError('GTFS stops must map to saved places.')
  if feed_kind in ('gtfs','flights_json','aviationstack') and len(set(mappings.values()))<2:raise ValueError('Map at least two GTFS stops to different saved places.')
  if type(fare) not in (int,float) or not 0<=fare<=100000:raise ValueError('Invalid estimated transit fare.')
  result_type=body.get('sportsResultType',2)
  if type(result_type) is not int or not 1<=result_type<=1000:raise ValueError('Use a valid league result type ID.')
  if feed_kind=='aviationstack':
   import re
   departure=body.get('departureIata');arrival=body.get('arrivalIata')
   if any(not isinstance(code,str) or not re.fullmatch('[A-Z]{3}',code) or code not in mappings for code in (departure,arrival)) or departure==arrival:raise ValueError('Map two different three-letter IATA airport codes to saved places.')
   source.update(departureIata=departure,arrivalIata=arrival)
  if event_filters:
   source.update(event_filters,lastSuccessAt=None,itemCount=0,warning='')
   r['signals']=[s for s in r['signals'] if s['sourceId']!=source['id']]
  source.update(kind=feed_kind,stopMappings=mappings,fare=fare,sportsResultType=result_type)
  source.update(configurationVersion=str(uuid.uuid4()),calendarVenueConfirmed=venue,timeZone=zone,url=url,placeId=place,freshHours=hours,intervalMinutes=interval,tags=tags,error='',lastAttemptAt=None)
 elif kind=='refresh_world_feed':
  if not source:raise ValueError('Unknown feed.')
  source.update(lastAttemptAt=None,error='')
 elif kind=='remove_world_feed':
  if not source:raise ValueError('Unknown feed.')
  if any(s.get('scheduleSourceId')==ident for s in r['sources']):raise ValueError('Remove the linked realtime feed before its schedule source.')
  for s in c.get('vh2Transport',{}).get('services',[]):
   if s.get('realtime',{}).get('sourceId')==ident:
    base=s.get('scheduledTimes',{});s.update(departsAt=base.get('departure',s['departsAt']),arrivesAt=base.get('arrival',s['arrivesAt']),status='scheduled');s.pop('realtime',None)
  if c.get('vh2Transport'):c['vh2Transport']['services']=[s for s in c['vh2Transport']['services'] if s.get('sourceId')!=ident or s['id']==(c['lifeRuntime']['world'].get('journey') or {}).get('serviceId')]
  r['sources'].remove(source);r['signals']=[s for s in r['signals'] if s['sourceId']!=ident]
 else:
  if not source:raise ValueError('Configure a source first.')
  ingest(c,source,body.get('xml',''),after['simAt'],service.clock())
 revision=service.commit_event(db,world_id,revision,state,after,'WORLD_FEED_CHANGED',{'operation':kind})
 return revision,after

def poll(service):
 if not service._feed_lock.acquire(blocking=False):return
 try:return _poll(service)
 finally:service._feed_lock.release()

def _poll(service):
 """Network work runs outside SQLite transactions and never blocks life ticks."""
 if not hasattr(service,'_feed_pending'):service._feed_pending={}
 for key,(future,url) in list(service._feed_pending.items()):
  if not future.done():continue
  del service._feed_pending[key];world,ident=key
  with service.connect() as db:
   db.execute('BEGIN IMMEDIATE');revision,state=service.read(db,world)
   if not state['running'] or state['kernelVersion']!=service.kernel_version:continue
   after=json.loads(json.dumps(state));c=after['truth']['companion'];source=next((s for s in ensure(c)['sources'] if s['id']==ident and s['url']==url),None)
   if not source:continue
   if getattr(future,'vh2SourceVersion',source.get('configurationVersion'))!=source.get('configurationVersion'):continue
   try:
    raw=future.result()
    if source.get('kind') in ('aviationstack','ticketmaster'):
     adapter=__import__('vh2_ticketmaster' if source['kind']=='ticketmaster' else 'vh2_flights')
     raw,version=raw
     if not adapter.current(service,after.get('integration',{}).get('providerScope'),version):continue
     require_live_clock(after['simAt'],service.clock())
    ingest(c,source,raw,after['simAt'],service.clock())
   except Exception as error:source.update(lastAttemptAt=service.clock(),error=str(error)[:300],errorCode='timeline_not_live' if isinstance(error,LiveClockError) else 'provider_error')
   service.commit_event(db,world,revision,state,after,'WORLD_FEED_REFRESHED',{'sourceId':ident})
 with service.connect() as db:
  rows=db.execute("SELECT id,state FROM worlds WHERE json_extract(state,'$.running')=1").fetchall()
 for row in rows:
  state=json.loads(row['state'])
  if state['kernelVersion']!=service.kernel_version:continue
  for source in state['truth']['companion'].get('vh2Signals',{}).get('sources',[]):
   key=(row['id'],source['id'])
   if len(service._feed_pending)>=2:return
   clock_recovered=source.get('errorCode')=='timeline_not_live' and abs(service.clock()-state['simAt'])<=300000
   if key in service._feed_pending or not clock_recovered and service.clock()-(source.get('lastAttemptAt') or 0)<source['intervalMinutes']*60000:continue
   if not hasattr(service,'_feed_pool'):service._feed_pool=concurrent.futures.ThreadPoolExecutor(max_workers=2,thread_name_prefix='vh2-feed')
   if source.get('kind') in ('aviationstack','ticketmaster'):
    adapter=__import__('vh2_ticketmaster' if source['kind']=='ticketmaster' else 'vh2_flights')
    try:
     require_live_clock(state['simAt'],service.clock())
     config=adapter.reserve(service,state.get('integration',{}).get('providerScope'))
    except ValueError as error:
     with service.connect() as writer:
      writer.execute('BEGIN IMMEDIATE');revision,current=service.read(writer,row['id']);after=json.loads(json.dumps(current));item=next((s for s in ensure(after['truth']['companion'])['sources'] if s['id']==source['id']),None)
      if item:item.update(error=str(error),errorCode='timeline_not_live' if isinstance(error,LiveClockError) else 'provider_error',lastAttemptAt=service.clock());service.commit_event(writer,row['id'],revision,current,after,'WORLD_FEED_REFRESHED',{'sourceId':source['id']})
     continue
    future=service._feed_pool.submit(adapter.fetch,config,dict(source),state['simAt']) if source['kind']=='ticketmaster' else service._feed_pool.submit(adapter.fetch,config,dict(source))
   else:future=service._feed_pool.submit(fetch,source['url'],20000000) if source.get('kind')=='gtfs' else service._feed_pool.submit(fetch,source['url'])
   future.vh2SourceVersion=source.get('configurationVersion')
   service._feed_pending[key]=(future,source['url'])
