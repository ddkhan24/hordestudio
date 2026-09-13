"""Shared keyless airport geography; journey estimates are explicitly simulated."""
import csv, io, json, math, threading, time
from pathlib import Path
from vh2_feeds import fetch
URL='https://davidmegginson.github.io/ourairports-data/airports.csv'
_LOCK=threading.Lock()

def parse(raw):
 if len(raw)>20000000:raise ValueError('Airport catalogue exceeds 20 MB.')
 rows=[]
 for i,r in enumerate(csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))):
  if i>=150000:raise ValueError('Airport catalogue exceeds row limit.')
  if r.get('scheduled_service')!='yes' or r.get('type') not in ('large_airport','medium_airport'):continue
  try:lat=float(r['latitude_deg']);lon=float(r['longitude_deg'])
  except (KeyError,TypeError,ValueError):continue
  if not -90<=lat<=90 or not -180<=lon<=180:continue
  if not r.get('ident') or not r.get('name'):continue
  rows.append(dict(id=r['ident'][:20],code=(r.get('iata_code') or r['ident'])[:20],name=r['name'][:200],latitude=lat,longitude=lon))
 if not rows:raise ValueError('No scheduled-service airports found in the catalogue.')
 return rows

def catalogue(service):
 # One host cache shared by every VH. No world-specific keys or configuration.
 path=Path(service.path).with_name('ourairports-cache.json')
 with _LOCK:
  cached=None
  try:
   if path.stat().st_size<4000000:cached=json.loads(path.read_text())
  except (OSError,ValueError):pass
  if cached and time.time()-cached['fetchedAt']<7*86400:return cached,False
  try:
   rows=parse(fetch(URL,limit=20000000));data=dict(fetchedAt=time.time(),airports=rows)
   tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data));tmp.replace(path)
   return data,False
  except Exception:
   if cached:return cached,True
   raise ValueError('Airport download unavailable. Retry when online; no API key is needed.') from None

def distance(a,b):
 lat1,lat2=map(math.radians,[a['latitude'],b['latitude']]);dl=math.radians(b['longitude']-a['longitude'])
 return 6371*2*math.asin(min(1,math.sqrt(math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dl/2)**2)))

def estimate(airports,origin,destination,now):
 for p in (origin,destination):
  if type(p.get('latitude')) not in (int,float) or type(p.get('longitude')) not in (int,float) or not -90<=p['latitude']<=90 or not -180<=p['longitude']<=180:raise ValueError('Set both places on the map first, so their airports can be found automatically.')
 a=min(airports,key=lambda x:distance(origin,x));b=min(airports,key=lambda x:distance(destination,x))
 ground1=distance(origin,a);ground2=distance(destination,b)
 if a['id']==b['id']:raise ValueError('Both places use the same nearby airport. Use ground transport for this journey.')
 if max(ground1,ground2)>250:raise ValueError('No supported airport within 250 km of one of these places. Choose a nearer regional hub.')
 km=distance(a,b);air=math.ceil(km/750*60+30);ground=math.ceil((ground1+ground2)/45*60)+45
 dep=(now//60000+180)*60000
 return dict(origin=a,destination=b,distanceKm=round(km),airMinutes=air,groundMinutes=ground,service=dict(label=f"Simulated journey: {a['code']} → {b['code']}",kind='flight',**{'from':origin['id'],'to':destination['id']},departsAt=dep,arrivesAt=dep+(air+ground)*60000,boardingMinutes=90,cost=0,source='Simulation estimate using OurAirports geography; not a verified airline route or timetable. Includes estimated ground transfers; no fare model.'))

def route(service,body):
 with service.connect() as db:
  _,state=service.read(db,body.get('worldId'))
 places={p['id']:p for p in state['truth']['companion']['lifeProfile']['places']}
 a=places.get(body.get('from'));b=places.get(body.get('to'))
 if not a or not b or a['id']==b['id']:raise ValueError('Choose two different saved places.')
 # Validate coordinates before requesting the public catalogue.
 for p in (a,b):
  if p.get('latitude') is None or p.get('longitude') is None:raise ValueError('Set both places on the map first.')
 data,stale=catalogue(service)
 return {**estimate(data['airports'],a,b,state['simAt']),'provider':'OurAirports','shared':True,'stale':stale,'fetchedAt':data['fetchedAt'],'simulated':True}
