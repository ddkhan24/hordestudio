"""Ticketmaster Discovery v2: bounded city searches with host-owned credentials.
Search results are publisher claims, never tickets, attendance or inferred durations.
"""
import datetime,hashlib,json,re,urllib.parse,uuid
from vh2_live_data import decode,stamp
URL='https://app.ticketmaster.com/discovery/v2/events.json'
SCHEMA='''CREATE TABLE IF NOT EXISTS vh2_event_providers(scope TEXT PRIMARY KEY,version TEXT NOT NULL,enabled INTEGER NOT NULL,api_key TEXT NOT NULL,daily_limit INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS vh2_event_usage(scope TEXT NOT NULL,day INTEGER NOT NULL,attempts INTEGER NOT NULL,PRIMARY KEY(scope,day));'''
def valid_scope(scope):
 if not isinstance(scope,str) or not scope.startswith('horde:') or len(scope)>120:raise ValueError('Choose a Horde character scope.')
def settings(service,body=None,scope=None):
 if body is not None:scope=body.get('scope')
 valid_scope(scope)
 with service.connect() as db:
  if body is not None:
   enabled=body.get('enabled');limit=body.get('dailyLimit',48);key=body.get('apiKey','');clear=body.get('clearKey',False)
   if type(enabled) is not bool or type(clear) is not bool or type(limit) is not int or not 1<=limit<=1000:raise ValueError('Use an enabled state and a daily request limit from 1 to 1000.')
   if not isinstance(key,str) or len(key)>4096 or any(x in key for x in '\r\n'):raise ValueError('Invalid event API key.')
   db.execute('BEGIN IMMEDIATE');old=db.execute('SELECT * FROM vh2_event_providers WHERE scope=?',(scope,)).fetchone()
   if not key and old and not clear:key=old['api_key']
   if enabled and not key:raise ValueError('Add a Ticketmaster API key before enabling live requests.')
   db.execute('INSERT OR REPLACE INTO vh2_event_providers VALUES (?,?,?,?,?)',(scope,str(uuid.uuid4()),int(enabled),key,limit))
  row=db.execute('SELECT * FROM vh2_event_providers WHERE scope=?',(scope,)).fetchone();usage=db.execute('SELECT attempts FROM vh2_event_usage WHERE scope=? AND day=?',(scope,service.clock()//86400000)).fetchone()
  return dict(provider='ticketmaster',configured=bool(row),enabled=bool(row and row['enabled']),hasKey=bool(row and row['api_key']),dailyLimit=row['daily_limit'] if row else 48,usedToday=usage['attempts'] if usage else 0)

def reserve(service,scope):
 valid_scope(scope)
 with service.connect() as db:
  db.execute('BEGIN IMMEDIATE');r=db.execute('SELECT * FROM vh2_event_providers WHERE scope=?',(scope,)).fetchone()
  if not r or not r['enabled'] or not r['api_key']:raise ValueError('Configure and enable Ticketmaster in Ticketmaster event discovery.')
  day=service.clock()//86400000;usage=db.execute('SELECT attempts FROM vh2_event_usage WHERE scope=? AND day=?',(scope,day)).fetchone();used=usage['attempts'] if usage else 0
  if used>=r['daily_limit']:raise ValueError('Event request daily limit reached; no request submitted.')
  db.execute('INSERT OR REPLACE INTO vh2_event_usage VALUES (?,?,?)',(scope,day,used+1));db.execute('DELETE FROM vh2_event_usage WHERE day<?',(day-32,))
  return dict(r)
def current(service,scope,version):
 with service.connect() as db:
  row=db.execute('SELECT version,enabled FROM vh2_event_providers WHERE scope=?',(scope,)).fetchone()
  return bool(row and row['enabled'] and row['version']==version)

def filters(body,places):
 city=body.get('city','');country=body.get('countryCode','');state=body.get('stateCode','');keyword=body.get('keyword','');days=body.get('lookaheadDays',30);mappings=body.get('venueMappings',{})
 if not isinstance(city,str) or not 1<=len(city.strip())<=100 or any(c in city for c in '\r\n'):raise ValueError('Enter the city to search for events.')
 if not isinstance(country,str) or not re.fullmatch('[A-Za-z]{2}',country):raise ValueError('Use a two-letter country code, such as US or GB.')
 if not isinstance(state,str) or len(state)>3 or state and not re.fullmatch('[A-Za-z0-9]{1,3}',state):raise ValueError('Use a short state or province code, or leave it blank.')
 if not isinstance(keyword,str) or len(keyword)>100 or any(c in keyword for c in '\r\n'):raise ValueError('Use a search term up to 100 characters.')
 if type(days) is not int or not 1<=days<=90:raise ValueError('Search between 1 and 90 days ahead.')
 if not isinstance(mappings,dict) or len(mappings)>100 or any(not isinstance(k,str) or not 1<=len(k)<=100 or not isinstance(v,str) or v not in places for k,v in mappings.items()):raise ValueError('Link Ticketmaster venues to existing saved places.')
 return dict(city=city.strip(),countryCode=country.upper(),stateCode=state.upper(),keyword=keyword.strip(),lookaheadDays=days,venueMappings=mappings)

class EventError(ValueError):pass
def fetch(config,source,now):
 from vh2_feeds import PublicConnection
 conn=PublicConnection('app.ticketmaster.com',timeout=8)
 try:
  iso=lambda ms:datetime.datetime.fromtimestamp(ms/1000,datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
  params=dict(apikey=config['api_key'],city=source['city'],countryCode=source['countryCode'],startDateTime=iso(now),endDateTime=iso(now+source['lookaheadDays']*86400000),size=200,page=0,sort='date,asc',includeTBA='no',includeTBD='no',includeTest='no')
  for key in ('stateCode','keyword'):
   if source.get(key):params[key]=source[key]
  conn.request('GET','/discovery/v2/events.json?'+urllib.parse.urlencode(params),headers={'Accept':'application/json','User-Agent':'Horde-VH2/1.0','Accept-Encoding':'identity'})
  response=conn.getresponse()
  if response.status!=200:raise EventError({401:'Ticketmaster rejected the API key. Check the event connection.',403:'Ticketmaster denied access. Check API access for your account.',429:'Ticketmaster quota reached. Wait for the next refresh or lower the refresh frequency.'}.get(response.status,'Ticketmaster returned HTTP '+str(response.status)+'. Try again later.'))
  raw=response.read(1000001)
  if len(raw)>1000000:raise EventError('Ticketmaster response exceeds 1 MB. Narrow your search.')
  return raw,config['version']
 except EventError:raise
 except Exception:raise ValueError('Ticketmaster connection failed. Check connectivity and try again; credentials are omitted.') from None
 finally:conn.close()

def parse(raw,source,now):
 data=decode(raw)
 if not isinstance(data,dict) or data.get('fault') or data.get('errors') or not isinstance(data.get('page'),dict):raise ValueError('Ticketmaster did not return an event search result.')
 page=data['page'];embedded=data.get('_embedded',{})
 if not isinstance(embedded,dict):raise ValueError('Invalid Ticketmaster event list.')
 events=embedded.get('events',[])
 if not isinstance(events,list) or len(events)>200 or page.get('number',0)!=0 or type(page.get('totalElements')) is not int:raise ValueError('Invalid Ticketmaster event page.')
 rows=[];skipped=0
 for event in events:
  try:
   if not isinstance(event,dict):raise ValueError()
   eid=event.get('id');title=event.get('name');dates=event.get('dates') or {};start_data=dates.get('start') or {};status=(dates.get('status') or {}).get('code','')
   if not isinstance(eid,str) or not eid or not isinstance(title,str) or not title or start_data.get('dateTBA') or start_data.get('dateTBD') or start_data.get('timeTBA'):raise ValueError()
   start=stamp(start_data.get('dateTime'))
   if start<now or start>now+source.get('lookaheadDays',30)*86400000:continue
   end_value=(dates.get('end') or {}).get('dateTime');end=stamp(end_value) if end_value else None
   if end is not None and end<=start:raise ValueError()
   venues=(event.get('_embedded') or {}).get('venues') or [];venue=venues[0] if len(venues)==1 else {};vid=venue.get('id','');location=', '.join(x for x in (venue.get('name'),(venue.get('address') or {}).get('line1'),(venue.get('city') or {}).get('name'),(venue.get('country') or {}).get('countryCode')) if isinstance(x,str))[:500]
   tags=list(source.get('tags',[]))
   for classification in event.get('classifications',[]):
    for key in ('segment','genre','subGenre'):
     name=(classification.get(key) or {}).get('name','')
     if name and name.lower() not in ('undefined','miscellaneous'):tags.append(name.lower()[:40])
   url=event.get('url','');u=urllib.parse.urlsplit(url)
   if u.scheme!='https' or not u.hostname or u.username or u.password:url=URL
   event_status={'onsale':'listed','offsale':'unavailable','cancelled':'cancelled','postponed':'postponed','rescheduled':'tentative'}.get(status,'tentative')
   row=dict(id=hashlib.sha256((source['id']+'|ticketmaster|'+eid).encode()).hexdigest(),sourceId=source['id'],provider='ticketmaster',providerEventId=eid,providerVenueId=vid,venueName=venue.get('name','')[:200],title=title[:300],receivedAt=now,publishedAt=None,expiresAt=min(now+source['freshHours']*3600000,end or start+86400000),startsAt=start,endsAt=end,eventStatus=event_status,locationText=location,placeId=source.get('venueMappings',{}).get(vid),sourceUrl=url,scope='publisher_claim',confidence='unverified',type='calendar_event',tags=list(dict.fromkeys(tags))[:20])
   row['versionKey']=hashlib.sha256(json.dumps({k:v for k,v in row.items() if k not in ('receivedAt','expiresAt')},sort_keys=True).encode()).hexdigest()[:16];rows.append(row)
  except (ValueError,TypeError,AttributeError,KeyError,OverflowError):skipped+=1
 source['warning']=('Showing the first 200 results; narrow the city, search term or date window. ' if page['totalElements']>len(events) else '')+f'{skipped} incomplete or undated events skipped. Listings do not confirm tickets or attendance. Missing end times are left open; characters reconsider stays through needs and commitments.'
 return sorted(rows,key=lambda row:row['startsAt'],reverse=True)
