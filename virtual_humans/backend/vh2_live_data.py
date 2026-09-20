"""Bounded provider adapters. Observations are claims, never attendance or bookings."""
import datetime,hashlib,json

def stamp(value):
 if not isinstance(value,str):raise ValueError('An explicit offset timestamp is required.')
 try:
  dt=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
  if dt.tzinfo is None:raise ValueError()
  return int(dt.timestamp()*1000)
 except (ValueError,OverflowError):raise ValueError('An explicit offset timestamp is required.') from None

def decode(raw):
 if not isinstance(raw,(str,bytes)) or len(raw)>1000000:raise ValueError('JSON feed exceeds 1 MB.')
 try:return json.loads(raw,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON number.')))
 except (UnicodeError,json.JSONDecodeError):raise ValueError('Invalid JSON feed.') from None

def sports_data(raw):
 try:
  data=decode(raw)
 except ValueError as error:
  prefix=(raw.decode('utf-8-sig',errors='replace') if isinstance(raw,bytes) else str(raw)).lstrip().lower()[:1000]
  if prefix.startswith('<'):
   if '<rss' in prefix or '<feed' in prefix:
    raise ValueError('This is a sports news RSS/Atom feed. Add it as Local news with a sports interest tag. Live scores require an OpenLigaDB match-data URL.') from None
   raise ValueError('This URL returned a webpage or XML, not match data. Sports scores require an OpenLigaDB JSON match-data URL; a league homepage or setup guide will not work. Changing result IDs cannot fix this.') from None
  raise ValueError('The sports source did not return valid JSON match data. Check the URL or retry if the provider is unavailable. Changing result IDs cannot fix this.') from error
 if not isinstance(data,list) or len(data)>500:
  raise ValueError('Expected an OpenLigaDB match list, with up to 500 matches. Check that the URL is a match-data endpoint.')
 if any(not isinstance(row,dict) or 'matchID' not in row for row in data):
  raise ValueError('This JSON is not an OpenLigaDB match list. League listings, team lists and other providers use different formats.')
 return data

def flights(raw,source,now):
 data=decode(raw)
 if not isinstance(data,dict) or type(data.get('schemaVersion')) is not int or data.get('schemaVersion')!=1 or not isinstance(data.get('flights'),list) or len(data['flights'])>450:raise ValueError('Expected version 1 flight timetable with at most 450 flights.')
 observed=stamp(data.get('observedAt'))
 if not now-3600000<=observed<=now+60000:raise ValueError('Flight observations must be within the last hour of simulation time.')
 mapping=source.get('stopMappings',{});rows=[];seen=set()
 for row in data['flights']:
  if not isinstance(row,dict):raise ValueError('Invalid flight entry.')
  ident=row.get('id')
  if not isinstance(row.get('from'),str) or not isinstance(row.get('to'),str):raise ValueError('Flight endpoints must be terminal identifiers.')
  origin=mapping.get(row.get('from'));dest=mapping.get(row.get('to'))
  if not isinstance(ident,str) or not 1<=len(ident)<=120 or ident in seen:raise ValueError('Flights require unique short service IDs.')
  seen.add(ident)
  if not origin or not dest or origin==dest:continue
  dep=stamp(row.get('departsAt'));arr=stamp(row.get('arrivesAt'));status=row.get('status','scheduled')
  if arr<=dep or arr-dep>48*3600000 or status not in ('scheduled','cancelled'):raise ValueError('Invalid flight times or status.')
  if arr<now or dep>now+30*86400000:continue
  key='flight:'+hashlib.sha256((source['id']+'|'+ident).encode()).hexdigest()[:40]
  rows.append(dict(id=key,label=str(row.get('label') or ident)[:120],kind='flight',**{'from':origin,'to':dest},departsAt=dep,arrivesAt=arr,boardingMinutes=60,cost=source.get('fare',0),source=source['url'],sourceId=source['id'],sourceTripId=ident,status=status,updatedAt=observed,fareSource='authored_estimate'))
 source['warning']='Published flights, not bookings or ticket availability. Fare is an authored estimate; check-in allowance is 60 minutes.'
 return rows

def sports(raw,source,now):
 data=sports_data(raw)
 if not isinstance(data,list) or len(data)>500:raise ValueError('Expected at most 500 OpenLigaDB matches.')
 rows=[]
 for match in data:
  if not isinstance(match,dict):raise ValueError('Invalid match entry.')
  ident=match.get('matchID');start=stamp(match.get('matchDateTimeUTC'))
  if type(ident) is not int:raise ValueError('Match ID must be an integer.')
  if start>now+90*86400000 or start<now-source['freshHours']*3600000:continue
  teams=[match.get('team1',{}).get('teamName'),match.get('team2',{}).get('teamName')]
  if any(not isinstance(t,str) or not t for t in teams):continue
  finished=match.get('matchIsFinished') is True
  # Result IDs are league-defined. Only the configured result type is interpreted.
  result=next((r for r in match.get('matchResults',[]) if r.get('resultTypeID')==source.get('sportsResultType',2)),None)
  score=None
  if result and all(type(result.get(k)) is int and 0<=result[k]<=100000 for k in ('pointsTeam1','pointsTeam2')):score=[result['pointsTeam1'],result['pointsTeam2']]
  # Do not leak results into a replay set before kickoff.
  if start>now:score=None;finished=False
  title=' vs '.join(teams)
  if score is not None:title+=f" — {score[0]}–{score[1]}"+(' (finished)' if finished else ' (reported score)')
  key=hashlib.sha256((source['id']+'|sport|'+str(ident)).encode()).hexdigest()
  version=hashlib.sha256(json.dumps([start,score,finished,teams]).encode()).hexdigest()[:16]
  rows.append(dict(id=key,sourceId=source['id'],type='sports_update',title=title[:300],startsAt=start,receivedAt=now,publishedAt=None,expiresAt=now+source['freshHours']*3600000,sourceUrl=source['url'],scope='publisher_claim',confidence='unverified',placeId=None,tags=source.get('tags',[]),score=score,finished=finished,versionKey=version))
 source['warning']='Community-maintained sports claims. Venue and end time are not inferred; no automatic attendance. Result type is league-specific.'
 return rows
