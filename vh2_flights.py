"""Host-owned Aviationstack credentials, quota reservations and bounded live-flight adapter."""
import datetime,hashlib,json,urllib.parse,uuid
from vh2_live_data import decode,stamp,flights
URL='https://api.aviationstack.com/v1/flights'
SCHEMA='''CREATE TABLE IF NOT EXISTS vh2_flight_providers(scope TEXT PRIMARY KEY,version TEXT NOT NULL,enabled INTEGER NOT NULL,api_key TEXT NOT NULL,daily_limit INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS vh2_flight_usage(scope TEXT NOT NULL,day INTEGER NOT NULL,attempts INTEGER NOT NULL,PRIMARY KEY(scope,day));'''
def valid_scope(scope):
 if not isinstance(scope,str) or not scope.startswith('horde:') or len(scope)>120:raise ValueError('Choose a Horde character scope.')
def settings(service,body=None,scope=None):
 if body is not None:scope=body.get('scope')
 valid_scope(scope)
 with service.connect() as db:
  if body is not None:
   enabled=body.get('enabled');limit=body.get('dailyLimit',4);key=body.get('apiKey','');clear=body.get('clearKey',False)
   if type(enabled) is not bool or type(clear) is not bool or type(limit) is not int or not 1<=limit<=1000:raise ValueError('Use an enabled state and a daily request limit from 1 to 1000.')
   if not isinstance(key,str) or len(key)>4096 or any(x in key for x in '\r\n'):raise ValueError('Invalid flight API key.')
   db.execute('BEGIN IMMEDIATE');old=db.execute('SELECT * FROM vh2_flight_providers WHERE scope=?',(scope,)).fetchone()
   if not key and old and not clear:key=old['api_key']
   if enabled and not key:raise ValueError('Add an Aviationstack API key before enabling live requests.')
   db.execute('INSERT OR REPLACE INTO vh2_flight_providers VALUES (?,?,?,?,?)',(scope,str(uuid.uuid4()),int(enabled),key,limit))
  row=db.execute('SELECT * FROM vh2_flight_providers WHERE scope=?',(scope,)).fetchone();usage=db.execute('SELECT attempts FROM vh2_flight_usage WHERE scope=? AND day=?',(scope,service.clock()//86400000)).fetchone()
  return dict(provider='aviationstack',configured=bool(row),enabled=bool(row and row['enabled']),hasKey=bool(row and row['api_key']),dailyLimit=row['daily_limit'] if row else 4,usedToday=usage['attempts'] if usage else 0)

def reserve(service,scope):
 valid_scope(scope)
 with service.connect() as db:
  db.execute('BEGIN IMMEDIATE');r=db.execute('SELECT * FROM vh2_flight_providers WHERE scope=?',(scope,)).fetchone()
  if not r or not r['enabled'] or not r['api_key']:raise ValueError('Configure and enable Aviationstack in the flight connection settings.')
  day=service.clock()//86400000;usage=db.execute('SELECT attempts FROM vh2_flight_usage WHERE scope=? AND day=?',(scope,day)).fetchone();used=usage['attempts'] if usage else 0
  if used>=r['daily_limit']:raise ValueError('Flight request daily limit reached; no request submitted.')
  db.execute('INSERT OR REPLACE INTO vh2_flight_usage VALUES (?,?,?)',(scope,day,used+1));db.execute('DELETE FROM vh2_flight_usage WHERE day<?',(day-32,))
  return dict(r)
def current(service,scope,version):
 with service.connect() as db:
  row=db.execute('SELECT version,enabled FROM vh2_flight_providers WHERE scope=?',(scope,)).fetchone()
  return bool(row and row['enabled'] and row['version']==version)
class FlightError(ValueError):pass
def fetch(config,source):
 from vh2_feeds import PublicConnection
 conn=PublicConnection('api.aviationstack.com',timeout=8)
 try:
  query=urllib.parse.urlencode({'access_key':config['api_key'],'dep_iata':source['departureIata'],'arr_iata':source['arrivalIata'],'limit':100})
  conn.request('GET','/v1/flights?'+query,headers={'Accept':'application/json','User-Agent':'Horde-VH2/1.0','Accept-Encoding':'identity'})
  response=conn.getresponse()
  if response.status!=200:raise FlightError('Aviationstack request failed with HTTP '+str(response.status)+'. Check account access and quota.')
  raw=response.read(1000001)
  if len(raw)>1000000:raise FlightError('Aviationstack response exceeds 1 MB.')
  return raw,config['version']
 except FlightError:raise
 except Exception:raise ValueError('Aviationstack connection failed; credentials and provider error bodies are omitted.') from None
 finally:conn.close()
def parse(raw,source,now):
 data=decode(raw)
 if not isinstance(data,dict) or data.get('error') or not isinstance(data.get('data'),list):raise ValueError('Aviationstack did not return flight data. Check account access, filters and quota.')
 if len(data['data'])>100:raise ValueError('Aviationstack response exceeds 100 records.')
 pagination=data.get('pagination',{})
 if not isinstance(pagination,dict) or type(pagination.get('total',len(data['data']))) is not int:raise ValueError('Invalid Aviationstack pagination.')
 # Never replace a known timetable with an incomplete first page.
 if pagination.get('total',len(data['data']))>len(data['data']) or pagination.get('offset',0)!=0:raise ValueError('Flight result is paginated. Narrow the airport pair; incomplete results were not imported.')
 rows=[];skipped=0;seen=set()
 for row in data['data']:
  if not isinstance(row,dict):skipped+=1;continue
  dep=row.get('departure') or {};arr=row.get('arrival') or {};flight=row.get('flight') or {}
  if not all(isinstance(x,dict) for x in (dep,arr,flight)):skipped+=1;continue
  status=row.get('flight_status');origin=dep.get('iata');dest=arr.get('iata')
  if origin!=source['departureIata'] or dest!=source['arrivalIata']:continue
  if status not in ('scheduled','cancelled'):continue
  try:
   published=stamp(dep.get('scheduled'));end=stamp(arr.get('scheduled'));departure=stamp(dep.get('estimated')) if dep.get('estimated') else published;arrival=stamp(arr.get('estimated')) if arr.get('estimated') else end
  except ValueError:skipped+=1;continue
  ident=flight.get('iata') or flight.get('icao')
  if not isinstance(ident,str) or not ident:skipped+=1;continue
  key=hashlib.sha256(json.dumps([ident,published,origin,dest]).encode()).hexdigest()
  if key in seen:continue
  seen.add(key)
  iso=lambda t:datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).isoformat()
  rows.append(dict(id=key,label=ident,**{'from':origin,'to':dest},departsAt=iso(departure),arrivesAt=iso(arrival),status=status))
 incoming=flights(json.dumps(dict(schemaVersion=1,observedAt=datetime.datetime.fromtimestamp(now/1000,datetime.timezone.utc).isoformat(),flights=rows)),source,now)
 source['warning']=f'Aviationstack live-flight listings; {skipped} incomplete entries skipped. No bookings, availability guarantee or inferred flight positions. Fare and 60-minute check-in are estimates.'
 return incoming
